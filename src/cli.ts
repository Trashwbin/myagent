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
import { runSession } from "./session/loop.js";
import type { ApprovalRequest } from "./session/loop.js";
import type { ApprovalMode } from "./permission/rules.js";
import type { Provider } from "./model/provider.js";
import { restoreCheckpoint } from "./workspace/checkpoint.js";
import { getGitDiffStat } from "./workspace/diff.js";

function createApprovalHandler(): {
  handler: (request: ApprovalRequest) => Promise<"allow" | "deny">;
  close: () => void;
} {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    handler: async (request: ApprovalRequest): Promise<"allow" | "deny"> => {
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
    },
    close: () => rl.close(),
  };
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
  .argument("[prompt]", "task prompt")
  .action(async (prompt: string | undefined, options: Record<string, string>) => {
    const cwd = resolve(options.cwd);

    // Rewind mode: restore checkpoint and exit
    if (options.rewind) {
      await restoreCheckpoint(cwd, options.rewind);
      console.log(`Restored checkpoint: ${options.rewind}`);
      process.exit(0);
    }

    if (!prompt) {
      console.error("Prompt is required (unless using --rewind)");
      process.exit(1);
    }

    const approval = options.approval as ApprovalMode;

    let provider: Provider;
    if (options.provider === "fake") {
      provider = new FakeProvider([
        [
          { type: "text_delta", text: `Received task: ${prompt}` },
          { type: "stop", reason: "end_turn" },
        ],
      ]);
    } else if (options.provider === "openai") {
      const apiKey = process.env.MYAGENT_API_KEY;
      if (!apiKey) {
        console.error("MYAGENT_API_KEY is required for openai provider");
        process.exit(1);
      }
      provider = new OpenAICompatibleProvider({
        provider: "openai",
        model: options.model || process.env.MYAGENT_MODEL || "gpt-4o",
        baseUrl: process.env.MYAGENT_BASE_URL,
        apiKey,
      });
    } else if (options.provider === "anthropic") {
      const apiKey = process.env.MYAGENT_API_KEY;
      const authToken = process.env.MYAGENT_AUTH_TOKEN;
      if (!apiKey && !authToken) {
        console.error(
          "MYAGENT_API_KEY or MYAGENT_AUTH_TOKEN is required for anthropic provider",
        );
        process.exit(1);
      }
      provider = new AnthropicCompatibleProvider({
        provider: "anthropic",
        model: options.model || process.env.MYAGENT_MODEL || "claude-sonnet-4-5",
        baseUrl: process.env.MYAGENT_BASE_URL,
        apiKey,
        authToken,
      });
    } else {
      console.error(
        `Provider "${options.provider}" not supported. Use fake, openai, or anthropic.`,
      );
      process.exit(1);
    }

    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(searchTool);
    registry.register(editFileTool);
    registry.register(bashTool);

    const { handler: approvalHandler, close: closeRl } = createApprovalHandler();

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
    } finally {
      closeRl();
    }
  });

const argv =
  process.argv[2] === "--"
    ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
    : process.argv;

program.parse(argv);
