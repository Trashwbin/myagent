import type { Provider } from "../model/provider.js";
import type { ToolSchema } from "../model/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { checkPermission } from "../permission/rules.js";
import type { ApprovalMode } from "../permission/rules.js";
import type { Message } from "./message.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createCheckpoint } from "../workspace/checkpoint.js";

export type ApprovalRequest = {
  toolName: string;
  input: unknown;
  reason: string;
};

export type SessionOptions = {
  cwd: string;
  approval: ApprovalMode;
  maxTurns?: number;
  approvalHandler?: (request: ApprovalRequest) => Promise<"allow" | "deny">;
};

export type SessionResult = {
  transcript: Message[];
};

function buildToolSchemas(registry: ToolRegistry): ToolSchema[] {
  return registry.list().map((t) => {
    const { $schema, ...parameters } = zodToJsonSchema(t.inputSchema) as Record<
      string,
      unknown
    >;
    return {
      name: t.name,
      description: t.description,
      parameters,
    };
  });
}

function blockedMsg(tc: { id: string; name: string }, reason: string): Message {
  return {
    role: "tool_result",
    toolCallId: tc.id,
    toolName: tc.name,
    content: `Tool call denied and was not executed: ${reason}`,
  };
}

export async function runSession(
  provider: Provider,
  registry: ToolRegistry,
  initialMessages: Message[],
  options: SessionOptions,
): Promise<SessionResult> {
  const messages = [...initialMessages];
  const transcript = [...initialMessages];
  const maxTurns = options.maxTurns ?? 10;
  const toolSchemas = buildToolSchemas(registry);

  for (let turn = 0; turn < maxTurns; turn++) {
    let assistantText = "";
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];

    for await (const event of provider.stream(messages, toolSchemas)) {
      switch (event.type) {
        case "text_delta":
          assistantText += event.text;
          break;
        case "tool_call":
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          break;
        case "stop":
          break;
      }
    }

    const assistantMsg: Message = {
      role: "assistant",
      content: assistantText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    messages.push(assistantMsg);
    transcript.push(assistantMsg);

    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      const decision = checkPermission(tc.name, tc.input, options.approval);

      let shouldExecute = false;
      let blockReason = "";

      if (decision.behavior === "allow") {
        shouldExecute = true;
      } else if (decision.behavior === "deny") {
        blockReason = decision.reason ?? "denied";
      } else {
        if (!options.approvalHandler) {
          const msg: Message = {
            role: "tool_result",
            toolCallId: tc.id,
            toolName: tc.name,
            content: `Tool call requires approval and was not executed: ${decision.reason}`,
          };
          messages.push(msg);
          transcript.push(msg);
          continue;
        }

        const verdict = await options.approvalHandler({
          toolName: tc.name,
          input: tc.input,
          reason: decision.reason,
        });

        if (verdict === "allow") {
          shouldExecute = true;
        } else {
          blockReason = decision.reason;
        }
      }

      if (!shouldExecute) {
        const msg = blockedMsg(tc, blockReason);
        messages.push(msg);
        transcript.push(msg);
        continue;
      }

      const tool = registry.get(tc.name);
      if (!tool) {
        const msg: Message = {
          role: "tool_result",
          toolCallId: tc.id,
          toolName: tc.name,
          content: `Tool not found: ${tc.name}`,
        };
        messages.push(msg);
        transcript.push(msg);
        continue;
      }

      // Checkpoint before edit_file
      let checkpointId: string | undefined;
      if (tc.name === "edit_file") {
        const filePath = (tc.input as { path: string }).path;
        try {
          const cp = await createCheckpoint(options.cwd, [filePath]);
          checkpointId = cp.id;
        } catch (err: any) {
          const msg: Message = {
            role: "tool_result",
            toolCallId: tc.id,
            toolName: tc.name,
            content: `Checkpoint failed, edit not executed: ${err.message}`,
          };
          messages.push(msg);
          transcript.push(msg);
          continue;
        }
      }

      const result = await tool.execute(tc.input, { cwd: options.cwd });
      let content = result.ok ? result.output : `Error: ${result.output}`;
      if (checkpointId) {
        content += `\n[checkpoint: ${checkpointId}]`;
      }

      const resultMsg: Message = {
        role: "tool_result",
        toolCallId: tc.id,
        toolName: tc.name,
        content,
      };
      messages.push(resultMsg);
      transcript.push(resultMsg);
    }
  }

  return { transcript };
}
