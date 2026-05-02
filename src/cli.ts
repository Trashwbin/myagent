#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import * as readline from "node:readline";
import { OpenAICompatibleProvider } from "./model/openai-compatible.js";
import { AnthropicCompatibleProvider } from "./model/anthropic-compatible.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read.js";
import { searchTool } from "./tools/search.js";
import { editFileTool } from "./tools/edit.js";
import { writeFileTool } from "./tools/write.js";
import { bashTool } from "./tools/bash.js";
import { listDirTool } from "./tools/list-dir.js";
import { applyPatchTool } from "./tools/apply-patch.js";
import { globTool } from "./tools/glob.js";
import { findUpTool } from "./tools/find-up.js";
import { ReadStateTracker } from "./tools/file-mutation.js";
import { runTurn } from "./session/loop.js";
import type { ApprovalRequest, SessionState, TurnEvent } from "./session/loop.js";
import type { ApprovalMode } from "./permission/rules.js";
import type { Provider } from "./model/provider.js";
import { getGitDiffStat } from "./workspace/diff.js";
import { ProviderRuntimeError, formatProviderError } from "./model/errors.js";
import { openStore } from "./storage/store.js";
import type { TranscriptStore } from "./storage/store.js";
import { resolvePrimaryAnswer, resolveSecondaryAnswer } from "./cli/approval.js";
import { formatToolInputSummary } from "./cli/format-tool-input.js";
import type { ApprovalResponse, ApprovalRule } from "./permission/approval.js";
import {
  loadConfig,
  resolveApprovalMode,
  resolveModelName,
  resolveProviderConfig,
  resolveProviderName,
} from "./config/config.js";
import type { Config, ProviderName } from "./config/config.js";

function canonicalWorkspaceRoot(path: string): string {
  return realpathSync.native(resolve(path));
}

function makeApprovalHandler(
  rl: readline.Interface,
): (request: ApprovalRequest) => Promise<ApprovalResponse> {
  return async (request: ApprovalRequest): Promise<ApprovalResponse> => {
    return new Promise((resolve) => {
      const allowAlways = request.metadata?.sensitive !== true;
      const primaryPrompt = allowAlways
        ? "Approve? [Enter/y once, a always, n abort] "
        : "Approve sensitive request? [Enter/y once, n abort] ";

      const askPrimary = () => {
        rl.question(primaryPrompt, (answer) => {
          const primary = resolvePrimaryAnswer(answer, { allowAlways });
          if (primary === "allow_once") {
            resolve("allow_once");
          } else if (primary === "always" && allowAlways) {
            askSecondary();
          } else {
            resolve("abort");
          }
        });
      };

      const askSecondary = () => {
        rl.question("Always allow? [s session, w workspace, n cancel] ", (answer) => {
          const secondary = resolveSecondaryAnswer(answer);
          if (secondary === "cancel") {
            askPrimary();
          } else {
            resolve(secondary);
          }
        });
      };

      askPrimary();
    });
  };
}

function askLine(rl: readline.Interface): Promise<string | null> {
  return new Promise((resolve) => {
    const onClose = () => resolve(null);
    rl.once("close", onClose);
    rl.question("> ", (answer) => {
      rl.removeListener("close", onClose);
      resolve(answer);
    });
  });
}

function makeEventRenderer(): (event: TurnEvent) => void {
  let streamedText = false;
  const sensitiveToolCalls = new Set<string>();

  return (event: TurnEvent) => {
    switch (event.type) {
      case "assistant_text_delta":
        process.stdout.write(event.text);
        streamedText = true;
        break;
      case "assistant_message":
        if (streamedText) {
          process.stdout.write("\n");
          streamedText = false;
        }
        break;
      case "tool_approval_required": {
        const meta = event.metadata;
        if (meta?.sensitive) sensitiveToolCalls.add(event.id);
        const inputSummary = formatToolInputSummary(event.input);
        const intentLabel = event.name === "bash" && meta?.intentKind
          ? `bash (${meta.intentKind as string})`
          : event.name;
        if (event.name === "bash" && meta?.externalDirectoryPattern) {
          console.log(`\n[approval] ${intentLabel}: ${event.reason}`);
          if (meta.externalDirectoryRoot)
            console.log(`  project: ${meta.externalDirectoryRoot}`);
          console.log(`  grants: ${meta.externalDirectoryPattern}`);
          if (meta.approvalPattern)
            console.log(`  command pattern: ${meta.approvalPattern}`);
          if (inputSummary) console.log(`  input: ${inputSummary}`);
          if (!meta.sensitive) {
            console.log(
              `  Tip: press "a" to reuse this approval for this session/workspace.`,
            );
          }
        } else if (meta?.externalDirectoryPattern) {
          console.log(`\n[approval] ${intentLabel}: ${event.reason}`);
          if (meta.externalDirectoryRoot)
            console.log(`  project: ${meta.externalDirectoryRoot}`);
          console.log(`  grants: ${meta.externalDirectoryPattern}`);
          if (inputSummary) console.log(`  input: ${inputSummary}`);
        } else if (event.name === "bash" && meta?.approvalPattern) {
          console.log(`\n[approval] ${intentLabel}: ${event.reason}`);
          console.log(`  command pattern: ${meta.approvalPattern}`);
          if (inputSummary) console.log(`  input: ${inputSummary}`);
        } else {
          console.log(`\n[approval] ${intentLabel}: ${event.reason}`);
          if (meta) {
            if (meta.realPath) console.log(`  path: ${meta.realPath}`);
            if (meta.insideWorkspace === false) console.log(`  [outside workspace]`);
            if (meta.sensitive) console.log(`  [sensitive]`);
            if (meta.additions !== undefined || meta.deletions !== undefined) {
              console.log(`  changes: +${meta.additions ?? 0} -${meta.deletions ?? 0}`);
            }
            if (typeof meta.diff === "string" && meta.diff) {
              console.log(meta.diff);
            }
          }
          const sensitiveSummary = formatToolInputSummary(event.input, {
            sensitive: meta?.sensitive === true,
          });
          console.log(`  input: ${sensitiveSummary}`);
        }
        break;
      }
      case "tool_started": {
        const sensitive = sensitiveToolCalls.has(event.id);
        const summary = formatToolInputSummary(event.input, { sensitive });
        const intentKind = (event.input as Record<string, unknown>)?.intentKind as string | undefined;
        const label = event.name === "bash" && intentKind
          ? `bash (${intentKind})`
          : event.name;
        if (summary) {
          console.log(`[tool:${label}] ${summary}`);
        } else {
          console.log(`[tool:${label}] ...`);
        }
        break;
      }
      case "tool_result":
        console.log(`[tool:${event.message.toolName}] ${event.message.content}`);
        break;
      case "turn_truncated":
        console.log(
          "\n[truncated] Turn stopped because the model hit its output token limit.",
        );
        break;
    }
  };
}

function printSessionList(
  sessions: Array<{
    id: string;
    workspaceRoot: string;
    provider?: string;
    model?: string;
    title?: string;
    updatedAt: number;
  }>,
) {
  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }
  for (const s of sessions) {
    const time = new Date(s.updatedAt).toLocaleString();
    const title = s.title ?? "(untitled)";
    console.log(`${s.id}  ${title}`);
    console.log(`  workspace: ${s.workspaceRoot}`);
    console.log(`  provider: ${s.provider ?? "-"}  model: ${s.model ?? "-"}`);
    console.log(`  updated: ${time}`);
  }
}

function createProvider(config: Config): Provider {
  const provider = resolveProviderName(config);
  const providerConfig = resolveProviderConfig(config, provider);
  const model = resolveModelName(config, provider);

  if (provider === "openai") {
    if (!providerConfig.apiKey) {
      console.error(
        "OpenAI provider requires apiKey in config.providers.openai.apiKey or top-level apiKey.",
      );
      process.exit(1);
    }
    return new OpenAICompatibleProvider({
      provider: "openai",
      model,
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
      maxOutputTokens: providerConfig.maxOutputTokens,
    });
  }

  if (!providerConfig.apiKey && !providerConfig.authToken) {
    console.error(
      "Anthropic provider requires apiKey or authToken in config.providers.anthropic or top-level config.",
    );
    process.exit(1);
  }
  return new AnthropicCompatibleProvider({
    provider: "anthropic",
    model,
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    authToken: providerConfig.authToken,
    maxOutputTokens: providerConfig.maxOutputTokens,
  });
}

function resolveSessionProvider(config: Config): {
  provider: ProviderName;
  model: string;
} {
  const provider = resolveProviderName(config);
  return {
    provider,
    model: resolveModelName(config, provider),
  };
}

function buildRegistry(): ToolRegistry {
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
  return registry;
}

async function chatMode(
  provider: Provider,
  registry: ToolRegistry,
  session: SessionState,
  approval: ApprovalMode,
  store: TranscriptStore,
  maxTurns?: number,
) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const sessionApprovalRules: ApprovalRule[] = [];
  const readState = new ReadStateTracker();
  const approvalHandler = makeApprovalHandler(rl);
  const onEvent = makeEventRenderer();

  console.log(`Session: ${session.id}`);
  console.log("Type your message, /exit to quit.\n");

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const input = await askLine(rl);
      if (input === null) break;
      if (input.trim() === "") continue;
      if (input === "/exit" || input === "/quit") break;

      try {
        const {
          session: updated,
          newMessages,
          aborted,
        } = await runTurn(provider, registry, session, input, {
          approval,
          maxTurns,
          approvalHandler,
          onEvent,
          sessionApprovalRules,
          store,
          readState,
        });
        Object.assign(session, updated);
        store.appendMessages(session.id, newMessages);

        if (aborted) {
          console.log("\nTurn aborted. Tell myagent what to do differently.\n");
        }
      } catch (err) {
        if (err instanceof ProviderRuntimeError) {
          console.error(`\n${formatProviderError(err)}`);
          continue;
        }
        throw err;
      }
    }

    const diffStat = await getGitDiffStat(session.cwd);
    if (diffStat) {
      console.log("\n--- Changes ---");
      console.log(diffStat);
    }
  } finally {
    rl.close();
  }
}

// --- Extracted handlers ---

function handleSessions(): void {
  const store = openStore();
  try {
    printSessionList(store.listSessions());
  } finally {
    store.close();
  }
}

async function handleResume(
  sessionId: string,
  options: { cwd: string },
): Promise<void> {
  let cwd = canonicalWorkspaceRoot(options.cwd);
  let config = loadConfig({ workspaceRoot: cwd });

  const explicitCwd = process.argv.includes("--cwd");

  const store = openStore();
  try {
    const session = store.getSession(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
    if (explicitCwd && canonicalWorkspaceRoot(options.cwd) !== session.cwd) {
      console.error(
        `Session ${sessionId} belongs to ${session.cwd}, but --cwd is ${canonicalWorkspaceRoot(options.cwd)}. Use a future fork command to move history to another workspace.`,
      );
      process.exit(1);
    }
    cwd = session.cwd;
    config = loadConfig({ workspaceRoot: cwd });
    const provider = createProvider(config);
    const registry = buildRegistry();
    await chatMode(
      provider,
      registry,
      session,
      resolveApprovalMode(config),
      store,
      config.maxTurns,
    );
  } finally {
    store.close();
  }
}

async function handleMainRun(options: { cwd: string }): Promise<void> {
  let cwd = canonicalWorkspaceRoot(options.cwd);
  const config = loadConfig({ workspaceRoot: cwd });
  const resolved = resolveSessionProvider(config);

  const store = openStore();
  try {
    const session = store.createSession({
      workspaceRoot: cwd,
      provider: resolved.provider,
      model: resolved.model,
    });
    const provider = createProvider(config);
    const registry = buildRegistry();
    await chatMode(
      provider,
      registry,
      session,
      resolveApprovalMode(config),
      store,
      config.maxTurns,
    );
  } finally {
    store.close();
  }
}

// --- Commander setup ---

const program = new Command();

program
  .name("myagent")
  .description("A small coding-agent runtime")
  .option("--cwd <path>", "working directory", process.cwd());

program.action(async (options: { cwd: string }) => {
  await handleMainRun(options);
});

// Subcommand: sessions
const sessionsCmd = program
  .command("sessions")
  .description("List historical sessions and exit");

sessionsCmd.action(async () => {
  handleSessions();
});

// Subcommand: resume
const resumeCmd = program
  .command("resume <sessionId>")
  .description("Resume a previous session in interactive chat mode");

resumeCmd.option("--cwd <path>", "working directory", process.cwd());

resumeCmd.action(async (sessionId: string, options: { cwd: string }) => {
  await handleResume(sessionId, options);
});

// --- Entry point ---

const argv =
  process.argv[2] === "--"
    ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
    : process.argv;

program.parse(argv);
