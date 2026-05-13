import { join } from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import type { Provider } from "../model/provider.js";
import { OpenAICompatibleProvider } from "../model/openai-compatible.js";
import { OpenAIResponsesProvider } from "../model/openai-responses.js";
import { AnthropicCompatibleProvider } from "../model/anthropic-compatible.js";
import { ToolRegistry } from "../tools/registry.js";
import { readFileTool } from "../tools/read.js";
import { searchTool } from "../tools/search.js";
import { editFileTool } from "../tools/edit.js";
import { writeFileTool } from "../tools/write.js";
import { bashTool } from "../tools/bash.js";
import { listDirTool } from "../tools/list-dir.js";
import { applyPatchTool } from "../tools/apply-patch.js";
import { globTool } from "../tools/glob.js";
import { findUpTool } from "../tools/find-up.js";
import { createSkillTool } from "../tools/skill.js";
import { ReadStateTracker } from "../tools/file-mutation.js";
import { runSession } from "../session/loop.js";
import type { ApprovalResponse } from "../permission/approval.js";
import { discoverSkills, summarizeSkills } from "../skill/discovery.js";
import type { SkillSummary } from "../skill/types.js";

import type {
  LiveScenarioConfig,
  ScenarioDefinition,
  ScenarioResult,
} from "./scenario-types.js";
import { TranscriptCapture, evaluateScenario } from "./transcript-capture.js";

async function buildRegistry(cwd: string): Promise<{
  registry: ToolRegistry;
  availableSkills: SkillSummary[];
}> {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(searchTool);
  registry.register(editFileTool);
  registry.register(writeFileTool);
  registry.register(bashTool);
  registry.register(listDirTool);
  registry.register(applyPatchTool);
  registry.register(globTool);
  registry.register(findUpTool);
  const skills = await discoverSkills({ cwd });
  if (skills.length > 0) registry.register(createSkillTool(skills));
  return { registry, availableSkills: summarizeSkills(skills) };
}

function createProviderFromConfig(config: LiveScenarioConfig): Provider {
  const providerConfig = {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    maxOutputTokens: config.maxOutputTokens,
    protocol: config.protocol,
  };

  if (config.provider === "openai") {
    return config.protocol === "responses"
      ? new OpenAIResponsesProvider(providerConfig)
      : new OpenAICompatibleProvider(providerConfig);
  }
  return new AnthropicCompatibleProvider({
    ...providerConfig,
    authToken: config.authToken,
  });
}

function makeAutoApprovalHandler(
  sensitiveDeny: boolean,
): (request: {
  toolName: string;
  input: unknown;
  reason: string;
  metadata?: Record<string, unknown>;
}) => Promise<ApprovalResponse> {
  return async (request) => {
    if (sensitiveDeny && request.metadata?.sensitive) {
      return "abort";
    }
    return "allow_once";
  };
}

async function setupWorkspace(
  setup: ScenarioDefinition["setup"],
  baseDir: string,
): Promise<{ workspace: string; external?: string }> {
  const root = join(baseDir, `scenario-${randomUUID().slice(0, 8)}`);
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  if (setup?.files) {
    for (const [path, content] of Object.entries(setup.files)) {
      const filePath = join(workspace, path);
      const dir = join(filePath, "..");
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(filePath, content, "utf-8");
    }
  }

  let external: string | undefined;
  if (setup?.externalFiles && Object.keys(setup.externalFiles).length > 0) {
    external = join(root, "external");
    await mkdir(external, { recursive: true });
    for (const [path, content] of Object.entries(setup.externalFiles)) {
      const filePath = join(external, path);
      const dir = join(filePath, "..");
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(filePath, content, "utf-8");
    }
  }

  return { workspace, external };
}

export async function runScenario(
  scenario: ScenarioDefinition,
  config: LiveScenarioConfig,
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const outputDir = config.outputDir ?? join(process.cwd(), ".live-scenarios");
  await mkdir(outputDir, { recursive: true });

  // Create isolated workspace
  const baseTmp = await mkdtemp(join(tmpdir(), "myagent-live-"));
  let ws: string;

  if (scenario.setup) {
    const setupPaths = await setupWorkspace(scenario.setup, baseTmp);
    ws = setupPaths.workspace;
  } else {
    ws = config.cwd;
  }

  const effectiveConfig: LiveScenarioConfig = {
    ...config,
    maxTurns: scenario.run?.maxTurns ?? config.maxTurns,
    maxOutputTokens: scenario.run?.maxOutputTokens ?? config.maxOutputTokens,
    autoApprove: scenario.run?.autoApprove ?? config.autoApprove,
  };

  const provider = createProviderFromConfig(effectiveConfig);
  const { registry, availableSkills } = await buildRegistry(ws);
  const capture = new TranscriptCapture(config.provider, config.model, scenario.name);
  const readState = new ReadStateTracker();

  const approvalHandler = effectiveConfig.autoApprove
    ? makeAutoApprovalHandler(false)
    : makeAutoApprovalHandler(true);

  let result: ScenarioResult;

  try {
    const { transcript, aborted } = await runSession(
      provider,
      registry,
      [{ role: "user", content: scenario.prompt }],
      {
        cwd: ws,
        approval: "auto",
        maxTurns: effectiveConfig.maxTurns ?? scenario.expect.maxTurns ?? 10,
        approvalHandler,
        onEvent: capture.handler,
        sessionApprovalRules: [],
        readState,
        availableSkills,
      },
    );

    const scenarioTranscript = capture.buildTranscript(transcript);
    const failures = evaluateScenario(
      capture.getEntries(),
      transcript,
      scenario.expect,
    );

    // If aborted and success expected, that's a failure
    if (aborted && scenario.expect.success) {
      failures.push({
        rule: "success",
        detail: "Session was aborted",
      });
    }

    // Write transcript
    const transcriptPath = join(outputDir, `${scenario.name}-${Date.now()}.json`);
    await writeFile(transcriptPath, JSON.stringify(scenarioTranscript, null, 2), "utf-8");

    result = {
      scenario: scenario.name,
      provider: config.provider,
      model: config.model,
      passed: failures.length === 0,
      failures,
      transcriptPath,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (scenario.setup) {
      await rm(baseTmp, { recursive: true }).catch(() => {});
    }
  }

  return result;
}

export function formatResult(result: ScenarioResult): string {
  const lines: string[] = [
    `Scenario: ${result.scenario}`,
    `Provider: ${result.provider} / ${result.model}`,
    `Result: ${result.passed ? "PASS" : "FAIL"}`,
    `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
    `Transcript: ${result.transcriptPath}`,
  ];

  if (result.failures.length > 0) {
    lines.push("Failures:");
    for (const f of result.failures) {
      lines.push(`  [${f.rule}] ${f.detail}`);
    }
  }

  return lines.join("\n");
}
