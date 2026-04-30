import type { ZodType } from "zod";

export type ToolContext = {
  cwd: string;
  permissionResolved?: boolean;
};

export type ToolResult = {
  ok: boolean;
  output: string;
  metadata?: Record<string, unknown>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: ZodType;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
};
