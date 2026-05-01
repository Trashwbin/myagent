import { z } from "zod";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolveWorkspacePath } from "../workspace/path.js";
import { computeDiff } from "./file-mutation.js";

const inputSchema = z.object({
  path: z.string().describe("File path relative to workspace root"),
  content: z.string().describe("File content to write"),
});

const executionInputSchema = inputSchema.extend({
  resolvedPath: z.string().optional(),
  realPath: z.string().optional(),
});

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Create or overwrite a file in the workspace",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const {
      path,
      content,
      resolvedPath,
      realPath: inputRealPath,
    } = executionInputSchema.parse(input);

    let absPath: string;
    let realPath: string;
    if (resolvedPath && context.permissionResolved) {
      absPath = resolvedPath;
      realPath = inputRealPath ?? absPath;
    } else {
      const resolved = resolveWorkspacePath(context.cwd, path);
      if (!resolved) {
        return { ok: false, output: "Path is outside workspace" };
      }
      absPath = resolved;
      realPath = absPath;
    }
    let existingContent: string | undefined;

    try {
      await stat(absPath);
      existingContent = await readFile(absPath, "utf-8");
    } catch {
      // File doesn't exist — new file
    }

    if (existingContent !== undefined) {
      if (!context.readState?.hasFullRead(realPath)) {
        return {
          ok: false,
          output: `File ${path} must be read with read_file before writing. Read the file first.`,
        };
      }

      const currentState = await stat(absPath);
      const readState = context.readState.get(realPath)!;
      if (currentState.mtimeMs > readState.mtimeMs) {
        return {
          ok: false,
          output: `File ${path} has been modified since it was last read. Read it again before writing.`,
        };
      }
    }

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, "utf-8");

    if (context.readState) {
      try {
        const newStat = await stat(absPath);
        context.readState.updateAfterWrite(realPath, newStat.mtimeMs);
      } catch {
        // ignore stat failure after write
      }
    }

    let output = `Wrote ${path}`;
    if (existingContent !== undefined) {
      const { diff, additions, deletions } = computeDiff(existingContent, content, path);
      output += ` (${additions} additions, ${deletions} deletions)`;
      if (diff) output += `\n${diff}`;
    }

    return { ok: true, output };
  },
};
