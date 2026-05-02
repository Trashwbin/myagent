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
const DEFAULT_MAX_RESULTS = 200;
const MAX_OUTPUT_CHARS = 20_000;
const SEARCH_MAX_BUFFER = 4 * 1024 * 1024;
const DEFAULT_EXCLUDED_DIRS = [
  ".git",
  ".myagent",
  ".omc",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
];

const inputSchema = z.object({
  pattern: z.string().describe("Search pattern (regex or literal string)"),
  path: z
    .string()
    .optional()
    .default(".")
    .describe("Directory to search in, absolute or relative to workspace root"),
  include: z
    .string()
    .optional()
    .describe("Glob pattern to include (e.g. '*.ts', '*.{js,jsx}')"),
  exclude: z
    .array(z.string().min(1))
    .optional()
    .default([])
    .describe("Additional glob patterns or directory names to exclude"),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .default(DEFAULT_MAX_RESULTS)
    .describe("Maximum number of matching lines to return"),
  before_context: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Number of lines before each match to show"),
  after_context: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Number of lines after each match to show"),
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

function expandExcludeForRg(pattern: string): string[] {
  const normalized = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  if (!/[/*?[\]{}]/.test(normalized)) {
    return [
      `!${normalized}`,
      `!**/${normalized}`,
      `!${normalized}/**`,
      `!**/${normalized}/**`,
    ];
  }
  return [pattern.startsWith("!") ? pattern : `!${pattern}`];
}

function rgExcludeGlobs(extra: string[]): string[] {
  return [...DEFAULT_EXCLUDED_DIRS, ...extra].flatMap(expandExcludeForRg);
}

function grepExcludeArgs(extra: string[]): string[] {
  const patterns = [...DEFAULT_EXCLUDED_DIRS, ...extra];
  const args: string[] = [];
  for (const pattern of patterns) {
    const normalized = pattern.replace(/^!/, "");
    if (!/[/*?[\]{}]/.test(normalized)) {
      args.push(`--exclude-dir=${normalized}`, `--exclude=${normalized}`);
    }
  }
  return args;
}

function truncateOutput(stdout: string, maxLines: number): string {
  if (!stdout) return "No matches found";

  const lines = stdout.split("\n");
  const selectedLines = lines.slice(0, maxLines);
  let output = selectedLines.join("\n");
  if (output.length > MAX_OUTPUT_CHARS) {
    output = output.slice(0, MAX_OUTPUT_CHARS);
  }

  const truncated = lines.length > maxLines || stdout.length > MAX_OUTPUT_CHARS;
  if (truncated) {
    output += `\n... search results truncated. Narrow the pattern or path for more.`;
  }
  return output;
}

function capturedStdout(err: unknown): string {
  const maybe = err as { stdout?: unknown };
  return typeof maybe.stdout === "string" ? maybe.stdout : "";
}

export const searchTool: ToolDefinition = {
  name: "grep",
  description: [
    "Search for a pattern in file contents. Uses ripgrep internally when available.",
    "",
    "Usage:",
    "- Searches file contents, not filenames. Use glob for file discovery.",
    "- Returns file path, line number, and matched text for each result.",
    "- Use before_context/after_context to see surrounding lines.",
    "- Use include to narrow to specific file types (e.g. '*.ts').",
    "- Use max_results to limit output size.",
    "- For large files, prefer grep to locate content, then use Read with offset/limit.",
  ].join("\n"),
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = executionInputSchema.parse(input);
    const {
      pattern,
      include,
      exclude,
      max_results: maxResults,
      before_context: beforeContext,
      after_context: afterContext,
    } = parsed;
    const excludeSensitive =
      context.permissionResolved && parsed.excludeSensitive === false
        ? false
        : true;

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
            "grep requires permission-resolved input for external/sensitive paths",
        };
      }
      absPath = pathInfo.absolutePath;
    }

    const useRg = await detectRg();

    try {
      let stdout: string;
      if (useRg) {
        const baseArgs = ["-n", "--no-heading", "--color", "never"];
        if (beforeContext) baseArgs.push("-B", String(beforeContext));
        if (afterContext) baseArgs.push("-A", String(afterContext));
        const defaultGlobArgs = rgExcludeGlobs(exclude).flatMap((g) => [
          "--glob",
          g,
        ]);
        const includeArgs = include
          ? ["--glob", include]
          : [];
        const globArgs =
          excludeSensitive !== false
            ? sensitiveRgExcludeGlobs().flatMap((g) => ["--glob", g])
            : [];
        const result = await execFileAsync(
          "rg",
          [
            ...baseArgs,
            ...defaultGlobArgs,
            ...includeArgs,
            ...globArgs,
            "--",
            pattern,
            absPath,
          ],
          {
            cwd: context.cwd,
            timeout: 10_000,
            maxBuffer: SEARCH_MAX_BUFFER,
          },
        );
        stdout = result.stdout;
      } else {
        const excludeArgs = [
          ...grepExcludeArgs(exclude),
          ...(excludeSensitive !== false ? sensitiveGrepExcludeArgs() : []),
        ];
        const contextArgs: string[] = [];
        if (beforeContext) contextArgs.push("-B", String(beforeContext));
        if (afterContext) contextArgs.push("-A", String(afterContext));
        const includeArgs = include
          ? ["--include", include]
          : [];
        const result = await execFileAsync(
          "grep",
          [
            "-rn",
            ...excludeArgs,
            ...includeArgs,
            ...contextArgs,
            "-e",
            pattern,
            absPath,
          ],
          {
            cwd: context.cwd,
            timeout: 10_000,
            maxBuffer: SEARCH_MAX_BUFFER,
          },
        );
        stdout = result.stdout;
      }
      return { ok: true, output: truncateOutput(stdout, maxResults) };
    } catch (err: any) {
      if (err.code === 1) return { ok: true, output: "No matches found" };
      if (String(err.message).includes("maxBuffer")) {
        const partial = truncateOutput(capturedStdout(err), maxResults);
        return {
          ok: true,
          output:
            partial === "No matches found"
              ? "Search produced too much output. Narrow the pattern or path."
              : partial,
        };
      }
      return { ok: false, output: `Search failed: ${err.message}` };
    }
  },
};
