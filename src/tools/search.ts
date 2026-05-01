import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolvePathInfo } from "../workspace/path-info.js";
import {
  isSensitiveReadPath,
  sensitiveGrepExcludeArgs,
  sensitiveRgExcludeGlobs,
} from "../permission/sensitive-paths.js";

const execFileAsync = promisify(execFile);

const inputSchema = z.object({
  pattern: z.string().describe("Search pattern"),
  path: z
    .string()
    .optional()
    .default(".")
    .describe("Directory to search in, absolute or relative to workspace root"),
});

const executionInputSchema = inputSchema.extend({
  resolvedPath: z.string().optional(),
  realPath: z.string().optional(),
  excludeSensitive: z.boolean().optional(),
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
    const parsed = executionInputSchema.parse(input);
    const { pattern } = parsed;
    const excludeSensitive =
      context.permissionResolved && parsed.excludeSensitive === false ? false : true;

    let absPath: string;
    if (parsed.resolvedPath && context.permissionResolved) {
      absPath = parsed.resolvedPath;
    } else {
      const pathInfo = resolvePathInfo(context.cwd, parsed.path);
      if (
        !pathInfo ||
        !pathInfo.insideWorkspace ||
        isSensitiveReadPath(pathInfo.realPath)
      ) {
        return {
          ok: false,
          output:
            "search requires permission-resolved input for external/sensitive paths",
        };
      }
      absPath = pathInfo.absolutePath;
    }

    const useRg = await detectRg();

    try {
      let stdout: string;
      if (useRg) {
        const baseArgs = ["-n", "--no-heading", "--color", "never"];
        const globArgs =
          excludeSensitive !== false
            ? sensitiveRgExcludeGlobs().flatMap((g) => ["--glob", g])
            : [];
        const result = await execFileAsync(
          "rg",
          [...baseArgs, ...globArgs, "--", pattern, absPath],
          { cwd: context.cwd, timeout: 10_000 },
        );
        stdout = result.stdout;
      } else {
        const excludeArgs = excludeSensitive !== false ? sensitiveGrepExcludeArgs() : [];
        const result = await execFileAsync(
          "grep",
          ["-rn", ...excludeArgs, "-e", pattern, absPath],
          { cwd: context.cwd, timeout: 10_000 },
        );
        stdout = result.stdout;
      }
      return { ok: true, output: stdout || "No matches found" };
    } catch (err: any) {
      if (err.code === 1) return { ok: true, output: "No matches found" };
      return { ok: false, output: `Search failed: ${err.message}` };
    }
  },
};
