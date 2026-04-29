#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { FakeProvider } from "./model/fake.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read.js";
import { searchTool } from "./tools/search.js";
import { editFileTool } from "./tools/edit.js";
import { bashTool } from "./tools/bash.js";
import { runSession } from "./session/loop.js";
import type { ApprovalMode } from "./permission/rules.js";

const program = new Command();

program
  .name("myagent")
  .description("A small coding-agent runtime")
  .option("--cwd <path>", "working directory", process.cwd())
  .option("--provider <provider>", "model provider (fake|openai|anthropic)", "fake")
  .option("--model <model>", "model name")
  .option("--approval <mode>", "approval mode (auto|on-request|never)", "auto")
  .argument("<prompt>", "task prompt")
  .action(async (prompt, options) => {
    const cwd = resolve(options.cwd);
    const approval = options.approval as ApprovalMode;

    if (options.provider !== "fake") {
      console.error(`Provider "${options.provider}" not yet implemented. Use --provider fake.`);
      process.exit(1);
    }

    const provider = new FakeProvider([
      [
        { type: "text_delta", text: `Received task: ${prompt}` },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(searchTool);
    registry.register(editFileTool);
    registry.register(bashTool);

    const { transcript } = await runSession(
      provider,
      registry,
      [{ role: "user", content: prompt }],
      { cwd, approval },
    );

    for (const msg of transcript) {
      const prefix = msg.role === "tool_result" ? `tool:${msg.toolName}` : msg.role;
      console.log(`[${prefix}] ${msg.content}`);
    }
  });

program.parse();
