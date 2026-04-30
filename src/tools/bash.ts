import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";

const execAsync = promisify(exec);

const inputSchema = z.object({
  command: z.string().describe("Shell command to execute"),
});

export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Execute a shell command",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { command } = inputSchema.parse(input);
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.cwd,
        timeout: 30_000,
      });
      return {
        ok: true,
        output: stdout || stderr || `Command completed with no output: ${command}`,
      };
    } catch (err: any) {
      return {
        ok: false,
        output: err.stdout || err.stderr || err.message,
      };
    }
  },
};
