import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolveWorkspacePath } from "../workspace/path.js";

const inputSchema = z.object({
  path: z.string().describe("File path relative to workspace root"),
  old_string: z.string().describe("Exact string to replace"),
  new_string: z.string().describe("Replacement string"),
});

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description: "Edit a file by replacing an exact string match",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { path, old_string, new_string } = inputSchema.parse(input);
    const absPath = resolveWorkspacePath(context.cwd, path);
    if (!absPath) {
      return { ok: false, output: "Path is outside workspace" };
    }
    try {
      const content = await readFile(absPath, "utf-8");
      if (!content.includes(old_string)) {
        return { ok: false, output: "old_string not found in file" };
      }
      const updated = content.replace(old_string, new_string);
      await writeFile(absPath, updated, "utf-8");
      return { ok: true, output: `Edited ${path}` };
    } catch (err: any) {
      return { ok: false, output: `Failed to edit file: ${err.message}` };
    }
  },
};
