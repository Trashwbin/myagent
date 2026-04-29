import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolveWorkspacePath } from "../workspace/path.js";

const inputSchema = z.object({
  path: z.string().describe("File path relative to workspace root"),
});

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read a file from the workspace",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { path } = inputSchema.parse(input);
    const absPath = resolveWorkspacePath(context.cwd, path);
    if (!absPath) {
      return { ok: false, output: "Path is outside workspace" };
    }
    try {
      const content = await readFile(absPath, "utf-8");
      return { ok: true, output: content };
    } catch (err: any) {
      return { ok: false, output: `Failed to read file: ${err.message}` };
    }
  },
};
