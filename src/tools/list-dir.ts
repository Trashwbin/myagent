import { z } from "zod";
import { readdir } from "node:fs/promises";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolvePathInfo } from "../workspace/path-info.js";
import { isSensitiveReadPath } from "../permission/sensitive-paths.js";

const inputSchema = z.object({
  path: z.string().describe("Directory path, absolute or relative to workspace root"),
  limit: z.number().int().min(1).optional().default(200),
  offset: z.number().int().min(1).optional().default(1),
});

const executionInputSchema = inputSchema.extend({
  resolvedPath: z.string().optional(),
  realPath: z.string().optional(),
});

export const listDirTool: ToolDefinition = {
  name: "list_dir",
  description: "List directory contents",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = executionInputSchema.parse(input);
    const { limit, offset } = parsed;

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
            "list_dir requires permission-resolved input for external/sensitive paths",
        };
      }
      absPath = pathInfo.absolutePath;
    }

    try {
      const entries = await readdir(absPath, { withFileTypes: true });
      const items = entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).sort();

      const start = Math.max(0, offset - 1);
      const page = items.slice(start, start + limit);

      if (page.length === 0) {
        return {
          ok: true,
          output: `Empty page (offset=${offset}, limit=${limit}, total=${items.length})`,
        };
      }

      const header = `${absPath} (${items.length} entries, showing ${start + 1}-${start + page.length})\n`;
      return { ok: true, output: header + page.join("\n") };
    } catch (err: any) {
      return { ok: false, output: `Failed to list directory: ${err.message}` };
    }
  },
};
