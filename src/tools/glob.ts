import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolvePathInfo } from "../workspace/path-info.js";
import { isSensitiveReadPath } from "../permission/sensitive-paths.js";

const execFileAsync = promisify(execFile);

const DEFAULT_LIMIT = 100;
const MAX_BUFFER = 4 * 1024 * 1024;

const inputSchema = z.object({
  pattern: z
    .string()
    .describe(
      "Glob pattern to match files against (e.g. '**/*.ts', '*.md', 'package.json')",
    ),
  path: z
    .string()
    .optional()
    .default(".")
    .describe("Directory to search in, absolute or relative to workspace root"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .default(DEFAULT_LIMIT)
    .describe("Maximum number of results to return"),
});

const executionInputSchema = inputSchema.extend({
  resolvedPath: z.string().optional(),
  realPath: z.string().optional(),
});

export const globTool: ToolDefinition = {
  name: "glob",
  description: [
    "Find files by name pattern using glob matching.",
    "",
    "Usage:",
    "- Returns file paths matching the given glob pattern.",
    "- Pattern examples: '**/*.ts', '*.md', 'package.json', 'apply-patch.ts'.",
    "- path must be a directory; defaults to workspace root.",
    "- Results are sorted by modification time (most recent first).",
    "- Use glob for file discovery, grep for content search, Read for content reading.",
  ].join("\n"),
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = executionInputSchema.parse(input);
    const { pattern, limit } = parsed;

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
            "glob requires permission-resolved input for external/sensitive paths",
        };
      }
      absPath = pathInfo.absolutePath;
    }

    try {
      const dirStat = await stat(absPath);
      if (!dirStat.isDirectory()) {
        return { ok: false, output: `glob path must be a directory: ${absPath}` };
      }
    } catch (err: any) {
      return { ok: false, output: `Path does not exist: ${absPath}` };
    }

    try {
      const { stdout } = await execFileAsync(
        "rg",
        ["--files", "--hidden", "--glob", pattern, "--sortr", "modified", absPath],
        { cwd: context.cwd, timeout: 10_000, maxBuffer: MAX_BUFFER },
      );

      if (!stdout.trim()) {
        return { ok: true, output: "No files found" };
      }

      const files = stdout.trim().split("\n");
      const truncated = files.length > limit;
      const selected = files.slice(0, limit);

      let output = selected.join("\n");
      if (truncated) {
        output += `\n\n(Results truncated: showing ${limit} of ${files.length}. Use a more specific pattern or path.)`;
      }

      return { ok: true, output };
    } catch (err: any) {
      if (err.code === 1) return { ok: true, output: "No files found" };
      if (err.code === 2) {
        return { ok: false, output: `glob failed: ${err.message}` };
      }
      if (String(err.message).includes("maxBuffer")) {
        return {
          ok: true,
          output:
            "Too many results. Narrow the pattern or path.",
        };
      }
      return { ok: false, output: `glob failed: ${err.message}` };
    }
  },
};
