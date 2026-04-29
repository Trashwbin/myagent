import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolveWorkspacePath } from "../workspace/path.js";

const execFileAsync = promisify(execFile);

const inputSchema = z.object({
  pattern: z.string().describe("Search pattern"),
  path: z.string().optional().default(".").describe("Directory to search in"),
});

let rgAvailable: boolean | undefined;

async function detectRg(): Promise<boolean> {
  if (rgAvailable !== undefined) return rgAvailable;
  try {
    await execFileAsync("rg", ["--version"], { timeout: 3_000 });
    rgAvailable = true;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

export const searchTool: ToolDefinition = {
  name: "search",
  description: "Search for a pattern in the workspace",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { pattern, path: searchPath } = inputSchema.parse(input);
    const absPath = resolveWorkspacePath(context.cwd, searchPath);
    if (!absPath) {
      return { ok: false, output: "Search path is outside workspace" };
    }

    const useRg = await detectRg();

    try {
      let stdout: string;
      if (useRg) {
        const result = await execFileAsync(
          "rg",
          ["-n", "--no-heading", "--color", "never", "--", pattern, absPath],
          { cwd: context.cwd, timeout: 10_000 },
        );
        stdout = result.stdout;
      } else {
        const result = await execFileAsync("grep", ["-rn", "-e", pattern, absPath], {
          cwd: context.cwd,
          timeout: 10_000,
        });
        stdout = result.stdout;
      }
      return { ok: true, output: stdout || "No matches found" };
    } catch (err: any) {
      if (err.code === 1) return { ok: true, output: "No matches found" };
      return { ok: false, output: `Search failed: ${err.message}` };
    }
  },
};
