import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolvePathInfo } from "../workspace/path-info.js";
import { isSensitiveReadPath } from "../permission/sensitive-paths.js";

const inputSchema = z.object({
  path: z.string().describe("File path relative to workspace root"),
});

const executionInputSchema = inputSchema.extend({
  resolvedPath: z.string().optional(),
  realPath: z.string().optional(),
});

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read a file from the workspace",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { path, resolvedPath } = executionInputSchema.parse(input);

    let absPath: string;
    if (resolvedPath && context.permissionResolved) {
      absPath = resolvedPath;
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
            "read_file requires permission-resolved input for external/sensitive paths",
        };
      }
      absPath = pathInfo.absolutePath;
    }

    try {
      const content = await readFile(absPath, "utf-8");
      return { ok: true, output: content };
    } catch (err: any) {
      return { ok: false, output: `Failed to read file: ${err.message}` };
    }
  },
};
