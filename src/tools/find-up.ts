import { z } from "zod";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolvePathInfo } from "../workspace/path-info.js";
import { isSensitiveReadPath } from "../permission/sensitive-paths.js";

const inputSchema = z.object({
  name: z
    .string()
    .describe("File or directory name to search for (e.g. 'package.json', 'tsconfig.json')"),
  start_path: z
    .string()
    .optional()
    .default(".")
    .describe("File or directory to start searching from. Defaults to workspace root."),
  stop: z
    .string()
    .optional()
    .describe("Upper bound directory. Search will not go above this directory."),
});

const executionInputSchema = inputSchema.extend({
  resolvedStartPath: z.string().optional(),
  resolvedStopPath: z.string().optional(),
  realStartPath: z.string().optional(),
});

export const findUpTool: ToolDefinition = {
  name: "find_up",
  description: [
    "Find the nearest file or directory by name, walking up the directory tree.",
    "",
    "Usage:",
    "- Searches from start_path upward through parent directories.",
    "- Returns the first (nearest) match found.",
    "- start_path can be a file (search starts from its directory) or a directory.",
    "- stop is an optional upper bound; the search will not go above it.",
    "- Typical targets: package.json, tsconfig.json, .gitignore, .eslintrc.json.",
    "- Use glob for downward file discovery, grep for content search, Read for content reading.",
  ].join("\n"),
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { name, start_path, stop, resolvedStartPath, resolvedStopPath } =
      executionInputSchema.parse(input);

    let startAbs: string;
    if (resolvedStartPath && context.permissionResolved) {
      startAbs = resolvedStartPath;
    } else {
      const pathInfo = resolvePathInfo(context.cwd, start_path);
      if (
        !pathInfo ||
        !pathInfo.insideWorkspace ||
        isSensitiveReadPath(pathInfo.realPath)
      ) {
        return {
          ok: false,
          output:
            "find_up requires permission-resolved input for external/sensitive paths",
        };
      }
      startAbs = pathInfo.absolutePath;
    }

    let stopAbs: string | undefined;
    if (stop) {
      if (resolvedStopPath && context.permissionResolved) {
        stopAbs = resolvedStopPath;
      } else {
        const stopInfo = resolvePathInfo(context.cwd, stop);
        if (
          !stopInfo ||
          !stopInfo.insideWorkspace ||
          isSensitiveReadPath(stopInfo.realPath)
        ) {
          return {
            ok: false,
            output:
              "find_up stop path requires permission-resolved input for external/sensitive paths",
          };
        }
        stopAbs = stopInfo.absolutePath;
      }
    }

    // If start_path is a file, begin from its directory
    let current: string;
    try {
      const s = statSync(startAbs);
      current = s.isDirectory() ? startAbs : dirname(startAbs);
    } catch {
      current = startAbs;
    }

    // Walk up
    while (true) {
      const candidate = join(current, name);
      if (existsSync(candidate)) {
        return { ok: true, output: candidate };
      }

      if (stopAbs && current === stopAbs) break;

      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return { ok: true, output: "No matching ancestor found" };
  },
};
