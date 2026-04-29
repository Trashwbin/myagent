import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";

const execFileAsync = promisify(execFile);

const inputSchema = z.object({
  pattern: z.string().describe("Search pattern"),
  path: z.string().optional().default(".").describe("Directory to search in"),
});

export const searchTool: ToolDefinition = {
  name: "search",
  description: "Search for a pattern in the workspace using grep",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { pattern, path: searchPath } = inputSchema.parse(input);
    try {
      const { stdout } = await execFileAsync(
        "grep",
        ["-rn", "-e", pattern, searchPath],
        { cwd: context.cwd, timeout: 10_000 },
      );
      return { ok: true, output: stdout || "No matches found" };
    } catch (err: any) {
      if (err.code === 1) return { ok: true, output: "No matches found" };
      return { ok: false, output: `Search failed: ${err.message}` };
    }
  },
};
