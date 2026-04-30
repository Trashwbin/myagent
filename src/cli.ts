#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { resolve } from "node:path";
import * as readline from "node:readline";
import { FakeProvider } from "./model/fake.js";
import { OpenAICompatibleProvider } from "./model/openai-compatible.js";
import { AnthropicCompatibleProvider } from "./model/anthropic-compatible.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read.js";
import { searchTool } from "./tools/search.js";
import { editFileTool } from "./tools/edit.js";
import { bashTool } from "./tools/bash.js";
import { runTurn, runSession } from "./session/loop.js";
import type { ApprovalRequest, SessionState, TurnEvent } from "./session/loop.js";
import type { ApprovalMode } from "./permission/rules.js";
import type { Provider } from "./model/provider.js";
import { restoreCheckpoint } from "./workspace/checkpoint.js";
import { getGitDiffStat } from "./workspace/diff.js";
import { ProviderRuntimeError, formatProviderError } from "./model/errors.js";
import { openStore } from "./storage/store.js";
import type { TranscriptStore } from "./storage/store.js";
import { resolveApprovalAnswer } from "./cli/approval.js";

function makeApprovalHandler(
  rl: readline.Interface,
): (request: ApprovalRequest) => Promise<"allow" | "deny"> {
  return async (_request: ApprovalRequest): Promise<"allow" | "deny"> => {
    return new Promise((resolve) => {
      rl.question("Approve? [Y/n] ", (answer) => {
        resolve(resolveApprovalAnswer(answer));
      });
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
      case "tool_approval_required":
        console.log(`\n[approval] ${event.name}: ${event.reason}`);
        console.log(`  input: ${JSON.stringify(event.input)}`);
        break;
      case "tool_started":
        console.log(`[tool:${event.name}] ...`);
        break;
      case "tool_result":
        console.log(`[tool:${event.message.toolName}] ${event.message.content}`);
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

function createProvider(options: Record<string, string>, prompt: string): Provider {
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
  if (options.provider === "openai") {
    const apiKey = process.env.MYAGENT_API_KEY;
    if (!apiKey) {
      console.error("MYAGENT_API_KEY is required for openai provider");
      process.exit(1);
    }
    return new OpenAICompatibleProvider({
      provider: "openai",
      model: options.model || process.env.MYAGENT_MODEL || "gpt-4o",
      baseUrl: process.env.MYAGENT_BASE_URL,
      apiKey,
    });
  }
  if (options.provider === "anthropic") {
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
      model: options.model || process.env.MYAGENT_MODEL || "claude-sonnet-4-5",
      baseUrl: process.env.MYAGENT_BASE_URL,
      apiKey,
      authToken,
    });
  }
  console.error(
    `Provider "${options.provider}" not supported. Use fake, openai, or anthropic.`,
  );
  process.exit(1);
}

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(searchTool);
  registry.register(editFileTool);
  registry.register(bashTool);
  return registry;
}

async function chatMode(
  provider: Provider,
  registry: ToolRegistry,
  session: SessionState,
  approval: ApprovalMode,
  store: TranscriptStore,
) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
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
        const { session: updated, newMessages } = await runTurn(
          provider,
          registry,
          session,
          input,
          { approval, approvalHandler, onEvent },
        );
        Object.assign(session, updated);
        store.appendMessages(session.id, newMessages);
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
  .option("--provider <provider>", "model provider (fake|openai|anthropic)", "fake")
  .option("--model <model>", "model name")
  .option("--approval <mode>", "approval mode (auto|on-request|never)", "auto")
  .option("--rewind <checkpointId>", "restore checkpoint and exit")
  .option("--chat", "interactive chat mode")
  .option("--resume <sessionId>", "resume a previous session")
  .option("--sessions", "list historical sessions and exit")
  .argument("[prompt]", "task prompt")
  .action(async (prompt: string | undefined, options: Record<string, string>) => {
    let cwd = resolve(options.cwd);
    const approval = options.approval as ApprovalMode;
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
        if (explicitCwd && resolve(options.cwd) !== resolve(session.cwd)) {
          console.error(
            `Session ${options.resume} belongs to ${session.cwd}, but --cwd is ${resolve(options.cwd)}. Use a future fork command to move history to another workspace.`,
          );
          process.exit(1);
        }
        cwd = session.cwd;
        const provider = createProvider(options, "");
        const registry = buildRegistry();
        await chatMode(provider, registry, session, approval, store);
        return;
      }

      // Chat mode (new session)
      if (options.chat) {
        const session = store.createSession({
          workspaceRoot: cwd,
          provider: options.provider,
          model: options.model,
        });
        const provider = createProvider(options, "");
        const registry = buildRegistry();
        await chatMode(provider, registry, session, approval, store);
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
      const provider = createProvider(options, prompt);
      const registry = buildRegistry();
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const approvalHandler = makeApprovalHandler(rl);
      const onEvent = makeEventRenderer();

      try {
        const { transcript } = await runSession(
          provider,
          registry,
          [{ role: "user", content: prompt }],
          { cwd, approval, approvalHandler, onEvent },
        );

        store.appendMessages(session.id, transcript);

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
