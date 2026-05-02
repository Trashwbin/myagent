import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";

const execAsync = promisify(exec);

const MAX_BYTES = 20_000;
const MAX_LINES = 500;

const inputSchema = z.object({
  command: z.string().describe("Shell command to execute"),
});

export function truncateOutput(output: string): string {
  let lines = output.split("\n");
  let truncated = false;

  if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES);
    truncated = true;
  }

  let result = lines.join("\n");
  if (result.length > MAX_BYTES) {
    result = result.slice(0, MAX_BYTES);
    truncated = true;
  }

  if (truncated) {
    result += `\n\n[output truncated: showing first ${MAX_BYTES} bytes / ${MAX_LINES} lines]\nUse a narrower command, file path, --stat, head/tail, or search for a specific pattern.`;
  }

  return result;
}

export const bashTool: ToolDefinition = {
  name: "bash",
  description: [
    "Execute a shell command.",
    "",
    "Use bash for: git operations, build/test/run scripts, simple filesystem primitives (cp, mv, mkdir),",
    "and commands that dedicated tools cannot express.",
    "",
    "Prefer dedicated tools for file exploration:",
    "- glob for file discovery, grep for content search, Read for file reading, find_up for ancestor config lookup.",
    "- Do not use bash for `cat`, `head`, `tail`, `ls`, `rg`, or `grep` when dedicated tools can express the task.",
  ].join("\n"),
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { command } = inputSchema.parse(input);
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.cwd,
        timeout: 30_000,
      });
      const raw = stdout || stderr || `Command completed with no output: ${command}`;
      return { ok: true, output: truncateOutput(raw) };
    } catch (err: any) {
      const raw = err.stdout || err.stderr || err.message;
      return { ok: false, output: truncateOutput(raw) };
    }
  },
};
