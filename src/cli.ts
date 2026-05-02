#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import * as readline from "node:readline";
import { FakeProvider } from "./model/fake.js";
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
import { runTurn, runSession } from "./session/loop.js";
import type { ApprovalRequest, SessionState, TurnEvent } from "./session/loop.js";
import type { ApprovalMode } from "./permission/rules.js";
import type { Provider } from "./model/provider.js";
import { restoreCheckpoint } from "./workspace/checkpoint.js";
import { getGitDiffStat } from "./workspace/diff.js";
import { ProviderRuntimeError, formatProviderError } from "./model/errors.js";
import { openStore } from "./storage/store.js";
import type { TranscriptStore } from "./storage/store.js";
import { resolvePrimaryAnswer, resolveSecondaryAnswer } from "./cli/approval.js";
import { formatToolInputSummary } from "./cli/format-tool-input.js";
import type { ApprovalResponse, ApprovalRule } from "./permission/approval.js";
import { loadSettings, resolveSetting, resolveApprovalMode } from "./config/settings.js";
import type { Settings } from "./config/settings.js";

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
        if (event.name === "bash" && meta?.externalDirectoryPattern) {
          console.log(`\n[approval] bash: ${event.reason}`);
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
          console.log(`\n[approval] ${event.name}: ${event.reason}`);
          if (meta.externalDirectoryRoot)
            console.log(`  project: ${meta.externalDirectoryRoot}`);
          console.log(`  grants: ${meta.externalDirectoryPattern}`);
          if (inputSummary) console.log(`  input: ${inputSummary}`);
        } else if (event.name === "bash" && meta?.approvalPattern) {
          console.log(`\n[approval] bash: ${event.reason}`);
          console.log(`  command pattern: ${meta.approvalPattern}`);
          if (inputSummary) console.log(`  input: ${inputSummary}`);
        } else {
          console.log(`\n[approval] ${event.name}: ${event.reason}`);
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
        if (summary) {
          console.log(`[tool:${event.name}] ${summary}`);
        } else {
          console.log(`[tool:${event.name}] ...`);
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

function createProvider(
  options: Record<string, string>,
  prompt: string,
  settings: Settings,
  maxOutputTokens?: number,
): Provider {
  if (options.provider === "fake") {
    return prompt
      ? new FakeProvider([
          [
            { type: "text_delta", text: `Received task: ${prompt}` },
            { type: "stop", reason: "end_turn" },
          ],
        ])
      : new FakeProvider([]);
  }

  const provider = resolveSetting(
    options.provider || undefined,
    process.env.MYAGENT_PROVIDER as "openai" | "anthropic" | undefined,
    settings.provider,
    "openai",
  );

  const model = resolveSetting(
    options.model || undefined,
    process.env.MYAGENT_MODEL || undefined,
    settings.model,
    provider === "openai" ? "gpt-4o" : "claude-sonnet-4-5",
  );

  const baseUrl = resolveSetting<string | undefined>(
    undefined,
    process.env.MYAGENT_BASE_URL || undefined,
    settings.baseUrl,
    undefined,
  );

  if (provider === "openai") {
    const apiKey = process.env.MYAGENT_API_KEY;
    if (!apiKey) {
      console.error("MYAGENT_API_KEY is required for openai provider");
      process.exit(1);
    }
    return new OpenAICompatibleProvider({
      provider: "openai",
      model,
      baseUrl,
      apiKey,
      maxOutputTokens,
    });
  }

  if (provider === "anthropic") {
    const apiKey = process.env.MYAGENT_API_KEY;
    const authToken = process.env.MYAGENT_AUTH_TOKEN;
    if (!apiKey && !authToken) {
      console.error(
        "MYAGENT_API_KEY or MYAGENT_AUTH_TOKEN is required for anthropic provider",
      );
      process.exit(1);
    }
    return new AnthropicCompatibleProvider({
      provider: "anthropic",
      model,
      baseUrl,
      apiKey,
      authToken,
      maxOutputTokens,
    });
  }

  console.error(
    `Provider "${provider}" not supported. Use fake, openai, or anthropic.`,
  );
  process.exit(1);
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

const program = new Command();

program
  .name("myagent")
  .description("A small coding-agent runtime")
  .option("--cwd <path>", "working directory", process.cwd())
  .option("--provider <provider>", "model provider (fake|openai|anthropic)")
  .option("--model <model>", "model name")
  .option("--approval <mode>", "approval mode (auto|on-request)", "auto")
  .option("--max-turns <n>", "max agent turns")
  .option("--rewind <checkpointId>", "restore checkpoint and exit")
  .option("--chat", "interactive chat mode")
  .option("--resume <sessionId>", "resume a previous session")
  .option("--sessions", "list historical sessions and exit")
  .argument("[prompt]", "task prompt")
  .action(async (prompt: string | undefined, options: Record<string, string>) => {
    let cwd = canonicalWorkspaceRoot(options.cwd);
    let settings = loadSettings({ workspaceRoot: cwd });

    const resolveMaxTurns = () =>
      resolveSetting<number | undefined>(
        options.maxTurns ? parseInt(options.maxTurns, 10) : undefined,
        process.env.MYAGENT_MAX_TURNS ? parseInt(process.env.MYAGENT_MAX_TURNS, 10) : undefined,
        settings.maxTurns,
        undefined,
      );

    const resolveMaxOutputTokens = () =>
      resolveSetting<number | undefined>(
        undefined,
        process.env.MYAGENT_MAX_OUTPUT_TOKENS
          ? parseInt(process.env.MYAGENT_MAX_OUTPUT_TOKENS, 10)
          : undefined,
        settings.maxOutputTokens,
        undefined,
      );
    const explicitCwd = process.argv.includes("--cwd");

    // Rewind mode
    if (options.rewind) {
      await restoreCheckpoint(cwd, options.rewind);
      console.log(`Restored checkpoint: ${options.rewind}`);
      process.exit(0);
    }

    const store = openStore();

    try {
      // Sessions list mode
      if (options.sessions) {
        printSessionList(store.listSessions());
        return;
      }

      // Resume mode
      if (options.resume) {
        const session = store.getSession(options.resume);
        if (!session) {
          console.error(`Session not found: ${options.resume}`);
          process.exit(1);
        }
        if (explicitCwd && canonicalWorkspaceRoot(options.cwd) !== session.cwd) {
          console.error(
            `Session ${options.resume} belongs to ${session.cwd}, but --cwd is ${canonicalWorkspaceRoot(options.cwd)}. Use a future fork command to move history to another workspace.`,
          );
          process.exit(1);
        }
        cwd = session.cwd;
        settings = loadSettings({ workspaceRoot: cwd });
        const provider = createProvider(options, "", settings, resolveMaxOutputTokens());
        const registry = buildRegistry();
        await chatMode(provider, registry, session, resolveApprovalMode(process.argv, options.approval, process.env.MYAGENT_APPROVAL, settings), store, resolveMaxTurns());
        return;
      }

      // Chat mode (new session)
      if (options.chat) {
        const session = store.createSession({
          workspaceRoot: cwd,
          provider: options.provider,
          model: options.model,
        });
        const provider = createProvider(options, "", settings, resolveMaxOutputTokens());
        const registry = buildRegistry();
        await chatMode(provider, registry, session, resolveApprovalMode(process.argv, options.approval, process.env.MYAGENT_APPROVAL, settings), store, resolveMaxTurns());
        return;
      }

      // Single-shot mode
      if (!prompt) {
        console.error(
          "Prompt is required (unless using --rewind, --chat, --sessions, or --resume)",
        );
        process.exit(1);
      }

      const session = store.createSession({
        workspaceRoot: cwd,
        provider: options.provider,
        model: options.model,
      });
      const provider = createProvider(options, prompt, settings, resolveMaxOutputTokens());
      const registry = buildRegistry();
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const approvalHandler = makeApprovalHandler(rl);
      const onEvent = makeEventRenderer();
      const readState = new ReadStateTracker();

      try {
        const { transcript, aborted, stopReason } = await runSession(
          provider,
          registry,
          [{ role: "user", content: prompt }],
          {
            cwd,
            approval: resolveApprovalMode(process.argv, options.approval, process.env.MYAGENT_APPROVAL, settings),
            maxTurns: resolveMaxTurns(),
            approvalHandler,
            onEvent,
            sessionApprovalRules: [],
            store,
            readState,
          },
        );

        store.appendMessages(session.id, transcript);

        if (aborted) {
          console.error("\nTurn aborted.");
          process.exit(1);
        }

        const diffStat = await getGitDiffStat(cwd);
        if (diffStat) {
          console.log("\n--- Changes ---");
          console.log(diffStat);
        }
      } catch (err) {
        if (err instanceof ProviderRuntimeError) {
          console.error(`\n${formatProviderError(err)}`);
          process.exit(1);
        }
        throw err;
      } finally {
        rl.close();
      }
    } finally {
      store.close();
    }
  });

const argv =
  process.argv[2] === "--"
    ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
    : process.argv;

program.parse(argv);
