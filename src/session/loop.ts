import type { Provider } from "../model/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import { checkPermission } from "../permission/rules.js";
import type { ApprovalMode } from "../permission/rules.js";
import type { Message } from "./message.js";

export type SessionResult = {
  transcript: Message[];
};

export async function runSession(
  provider: Provider,
  registry: ToolRegistry,
  initialMessages: Message[],
  options: { cwd: string; approval: ApprovalMode; maxTurns?: number },
): Promise<SessionResult> {
  const messages = [...initialMessages];
  const transcript = [...initialMessages];
  const maxTurns = options.maxTurns ?? 10;

  for (let turn = 0; turn < maxTurns; turn++) {
    let assistantText = "";
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];

    for await (const event of provider.stream(messages)) {
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

      if (decision.behavior === "allow") {
        const tool = registry.get(tc.name);
        if (!tool) {
          const resultMsg: Message = {
            role: "tool_result",
            toolCallId: tc.id,
            toolName: tc.name,
            content: `Tool not found: ${tc.name}`,
          };
          messages.push(resultMsg);
          transcript.push(resultMsg);
          continue;
        }
        const result = await tool.execute(tc.input, { cwd: options.cwd });
        const resultMsg: Message = {
          role: "tool_result",
          toolCallId: tc.id,
          toolName: tc.name,
          content: result.ok ? result.output : `Error: ${result.output}`,
        };
        messages.push(resultMsg);
        transcript.push(resultMsg);
      } else {
        const resultMsg: Message = {
          role: "tool_result",
          toolCallId: tc.id,
          toolName: tc.name,
          content: `Blocked (${decision.behavior}): ${decision.reason}`,
        };
        messages.push(resultMsg);
        transcript.push(resultMsg);
      }
    }
  }

  return { transcript };
}
