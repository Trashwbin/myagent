import { z } from "zod";
import { readFile, writeFile, stat } from "node:fs/promises";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolveWorkspacePath } from "../workspace/path.js";
import {
  computeDiff,
  detectLineEnding,
  normalizeToLf,
  applyLineEnding,
  type LineEnding,
} from "./file-mutation.js";

const inputSchema = z.object({
  path: z.string().describe("File path relative to workspace root"),
  old_string: z.string().describe("Exact string to replace"),
  new_string: z.string().describe("Replacement string"),
  replace_all: z.boolean().default(false).describe("Replace all occurrences"),
});

const executionInputSchema = inputSchema.extend({
  resolvedPath: z.string().optional(),
});

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description: "Edit a file by replacing an exact string match",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { path, resolvedPath, old_string, new_string, replace_all } =
      executionInputSchema.parse(input);

    if (old_string === new_string) {
      return { ok: false, output: "old_string and new_string are identical" };
    }

    if (old_string === "") {
      return {
        ok: false,
        output:
          "old_string cannot be empty. Use write_file to create or overwrite files.",
      };
    }

    let absPath: string;
    if (resolvedPath && context.permissionResolved) {
      absPath = resolvedPath;
    } else {
      const resolved = resolveWorkspacePath(context.cwd, path);
      if (!resolved) {
        return { ok: false, output: "Path is outside workspace" };
      }
      absPath = resolved;
    }

    try {
      let content = await readFile(absPath, "utf-8");
      const lineEnding: LineEnding = detectLineEnding(content);

      const normalizedContent = normalizeToLf(content);
      const normalizedOld = normalizeToLf(old_string);
      const normalizedNew = normalizeToLf(new_string);

      const count = normalizedContent.split(normalizedOld).length - 1;
      if (count === 0) {
        return { ok: false, output: "old_string not found in file" };
      }

      if (!replace_all && count > 1) {
        return {
          ok: false,
          output: `old_string matches ${count} times. Use replace_all: true or provide a more specific old_string.`,
        };
      }

      let updated: string;
      if (replace_all) {
        updated = normalizedContent.split(normalizedOld).join(normalizedNew);
      } else {
        updated = normalizedContent.replace(normalizedOld, normalizedNew);
      }

      if (lineEnding === "crlf") {
        updated = applyLineEnding(updated, "crlf");
      }

      await writeFile(absPath, updated, "utf-8");

      const { diff, additions, deletions } = computeDiff(content, updated, path);

      if (context.readState) {
        try {
          const s = await stat(absPath);
          context.readState.updateAfterWrite(absPath, s.mtimeMs);
        } catch {
          // ignore stat failure after write
        }
      }

      let output = `Edited ${path} (${additions} additions, ${deletions} deletions)`;
      if (diff) output += `\n${diff}`;

      return { ok: true, output };
    } catch (err: any) {
      return { ok: false, output: `Failed to edit file: ${err.message}` };
    }
  },
};
