#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { resolve } from "node:path";
import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { FakeProvider } from "./model/fake.js";
import { OpenAICompatibleProvider } from "./model/openai-compatible.js";
import { AnthropicCompatibleProvider } from "./model/anthropic-compatible.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read.js";
import { searchTool } from "./tools/search.js";
import { editFileTool } from "./tools/edit.js";
import { bashTool } from "./tools/bash.js";
import { runTurn, runSession } from "./session/loop.js";
import type { ApprovalRequest, SessionState } from "./session/loop.js";
import type { ApprovalMode } from "./permission/rules.js";
import type { Provider } from "./model/provider.js";
import { restoreCheckpoint } from "./workspace/checkpoint.js";
import { getGitDiffStat } from "./workspace/diff.js";
import { ProviderRuntimeError, formatProviderError } from "./model/errors.js";

function makeApprovalHandler(
  rl: readline.Interface,
): (request: ApprovalRequest) => Promise<"allow" | "deny"> {
  return async (request: ApprovalRequest): Promise<"allow" | "deny"> => {
    console.log("\nTool requires approval:");
    console.log(`- tool: ${request.toolName}`);
    console.log(`- reason: ${request.reason}`);
    console.log(`- input: ${JSON.stringify(request.input)}`);

    return new Promise((resolve) => {
      rl.question("Approve? [y/N] ", (answer) => {
        const ok =
          answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
        resolve(ok ? "allow" : "deny");
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

function printMessages(
  messages: Array<{ role: string; content: string; toolName?: string }>,
) {
  for (const msg of messages) {
    if (msg.role === "user") continue;
    const prefix = msg.role === "tool_result" ? `tool:${msg.toolName}` : msg.role;
    console.log(`[${prefix}] ${msg.content}`);
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
  cwd: string,
  approval: ApprovalMode,
) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const approvalHandler = makeApprovalHandler(rl);

  const session: SessionState = {
    id: randomUUID(),
    cwd,
    messages: [],
  };

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
          { approval, approvalHandler },
        );
        Object.assign(session, updated);
        printMessages(newMessages);
      } catch (err) {
        if (err instanceof ProviderRuntimeError) {
          console.error(`\n${formatProviderError(err)}`);
          continue;
        }
        throw err;
      }
    }

    const diffStat = await getGitDiffStat(cwd);
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
  .argument("[prompt]", "task prompt")
  .action(async (prompt: string | undefined, options: Record<string, string>) => {
    const cwd = resolve(options.cwd);
    const approval = options.approval as ApprovalMode;

    // Rewind mode
    if (options.rewind) {
      await restoreCheckpoint(cwd, options.rewind);
      console.log(`Restored checkpoint: ${options.rewind}`);
      process.exit(0);
    }

    // Chat mode
    if (options.chat) {
      const provider = createProvider(options, "");
      const registry = buildRegistry();
      await chatMode(provider, registry, cwd, approval);
      return;
    }

    // Single-shot mode
    if (!prompt) {
      console.error("Prompt is required (unless using --rewind or --chat)");
      process.exit(1);
    }

    const provider = createProvider(options, prompt);
    const registry = buildRegistry();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const approvalHandler = makeApprovalHandler(rl);

    try {
      const { transcript } = await runSession(
        provider,
        registry,
        [{ role: "user", content: prompt }],
        { cwd, approval, approvalHandler },
      );

      for (const msg of transcript) {
        const prefix = msg.role === "tool_result" ? `tool:${msg.toolName}` : msg.role;
        console.log(`[${prefix}] ${msg.content}`);
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
  });

const argv =
  process.argv[2] === "--"
    ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
    : process.argv;

program.parse(argv);
