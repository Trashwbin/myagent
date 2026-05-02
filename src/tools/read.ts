import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolvePathInfo } from "../workspace/path-info.js";
import { isSensitiveReadPath } from "../permission/sensitive-paths.js";

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

const inputSchema = z.object({
  path: z
    .string()
    .describe("File path, absolute or relative to workspace root"),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe("Line number to start reading from (1-indexed)"),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(DEFAULT_LIMIT)
    .describe("Maximum number of lines to return"),
});

const executionInputSchema = inputSchema.extend({
  resolvedPath: z.string().optional(),
  realPath: z.string().optional(),
});

export const readFileTool: ToolDefinition = {
  name: "Read",
  description: [
    "Read a file from the local filesystem.",
    "",
    "Usage:",
    "- By default, returns up to 2000 lines from the start of the file.",
    "- The offset parameter is the line number to start from (1-indexed).",
    "- To read later sections, call this tool again with a larger offset.",
    "- Use the grep tool to find specific content in large files or files with long lines.",
    "- If you are unsure of the correct file path, use the glob tool to look up filenames.",
    "- Contents are returned with each line prefixed by its line number.",
    "- Any line longer than 2000 characters is truncated.",
    "- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.",
  ].join("\n"),
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { path, offset, limit, resolvedPath, realPath } =
      executionInputSchema.parse(input);

    let absPath: string;
    let resolvedRealPath: string | undefined;
    if (resolvedPath && context.permissionResolved) {
      absPath = resolvedPath;
      resolvedRealPath = realPath;
    } else {
      const pathInfo = resolvePathInfo(context.cwd, path);
      if (
        !pathInfo ||
        !pathInfo.insideWorkspace ||
        isSensitiveReadPath(pathInfo.realPath)
      ) {
        return {
          ok: false,
          output:
            "Read requires permission-resolved input for external/sensitive paths",
        };
      }
      absPath = pathInfo.absolutePath;
      resolvedRealPath = pathInfo.realPath;
    }

    try {
      const content = await readFile(absPath, "utf-8");
      const lines = content.split("\n");
      // Remove trailing empty element from split if content ends with \n
      if (content.endsWith("\n") && lines[lines.length - 1] === "") {
        lines.pop();
      }

      const totalLines = lines.length;
      const start = Math.max(0, offset - 1);
      const page = lines.slice(start, start + limit);
      const isPartial =
        offset > 1 || start + limit < totalLines;

      // Format with line numbers, truncating long lines
      const numbered = page.map((line, i) => {
        const lineNum = start + i + 1;
        const truncated =
          line.length > MAX_LINE_LENGTH
            ? line.slice(0, MAX_LINE_LENGTH) + "…"
            : line;
        return `${lineNum}: ${truncated}`;
      });

      let output: string;
      if (numbered.length === 0) {
        output = `File has ${totalLines} lines (offset=${offset} is past end of file)`;
      } else {
        output = numbered.join("\n");
        if (isPartial) {
          const endLine = start + page.length;
          output += `\n\n<File has ${totalLines} total lines. Showing lines ${start + 1}-${endLine}. Use offset=${endLine + 1} to continue reading.>`;
        }
      }

      if (context.readState && resolvedRealPath) {
        try {
          const s = await stat(absPath);
          context.readState.record({
            path,
            realPath: resolvedRealPath,
            mtimeMs: s.mtimeMs,
            readAt: Date.now(),
            partial: isPartial,
          });
        } catch {
          // stat failed — skip read state recording
        }
      }

      return { ok: true, output };
    } catch (err: any) {
      return { ok: false, output: `Failed to read file: ${err.message}` };
    }
  },
};
