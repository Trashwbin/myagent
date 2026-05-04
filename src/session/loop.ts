import type { Provider } from "../model/provider.js";
import type { ToolSchema } from "../model/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { checkToolPermission } from "../permission/policy.js";
import type { ApprovalMode } from "../permission/policy.js";
import {
  buildApprovalPattern,
  matchesApprovalRule,
  createSessionRule,
} from "../permission/approval.js";
import type {
  ApprovalResponse,
  ApprovalRule,
  PermissionStore,
} from "../permission/approval.js";
import { isExternalDirectoryCapable } from "../permission/external-directory.js";
import type { Message } from "./message.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createCheckpoint } from "../workspace/checkpoint.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { ReadStateTracker } from "../tools/file-mutation.js";
import { isMutationTool, getCheckpointPaths } from "../tools/mutation-policy.js";
import type { ApprovalDisplay } from "../permission/display.js";
import { buildApprovalDisplay } from "../permission/display.js";

export type ApprovalRequest = {
  toolName: string;
  input: unknown;
  reason: string;
  suggestedPattern?: string;
  metadata?: Record<string, unknown>;
  display?: ApprovalDisplay;
};

export type SessionState = {
  id: string;
  /** Canonical workspace root — not process.cwd(). All tools resolve paths relative to this. */
  cwd: string;
  messages: Message[];
};

export type TurnResult = {
  session: SessionState;
  newMessages: Message[];
  aborted?: boolean;
  stopReason?: "end_turn" | "tool_use" | "length";
};

export type SessionOptions = {
  cwd: string;
  approval: ApprovalMode;
  maxTurns?: number;
  approvalHandler?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  onEvent?: (event: TurnEvent) => void | Promise<void>;
  sessionApprovalRules?: ApprovalRule[];
  store?: PermissionStore;
  readState?: ReadStateTracker;
};

export type TurnOptions = {
  approval: ApprovalMode;
  maxTurns?: number;
  approvalHandler?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  onEvent?: (event: TurnEvent) => void | Promise<void>;
  sessionApprovalRules?: ApprovalRule[];
  store?: PermissionStore;
  readState?: ReadStateTracker;
};

export type SessionResult = {
  transcript: Message[];
  aborted?: boolean;
  stopReason?: "end_turn" | "tool_use" | "length";
};

export type TurnEvent =
  | { type: "assistant_text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "assistant_message"; message: Message }
  | {
      type: "tool_approval_required";
      id: string;
      name: string;
      input: unknown;
      reason: string;
      metadata?: Record<string, unknown>;
      display?: ApprovalDisplay;
    }
  | {
      type: "tool_approval_decision";
      id: string;
      name: string;
      decision: "allow" | "deny";
    }
  | { type: "tool_started"; id: string; name: string; input: unknown }
  | { type: "tool_result"; message: Message }
  | { type: "turn_truncated" }
  | { type: "turn_finished" };

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

async function runAgentLoop(
  provider: Provider,
  registry: ToolRegistry,
  messages: Message[],
  newMessages: Message[],
  cwd: string,
  options: TurnOptions,
): Promise<{ aborted: boolean; stopReason?: "end_turn" | "tool_use" | "length" }> {
  const maxTurns = options.maxTurns ?? 10;
  const toolSchemas = buildToolSchemas(registry);
  const systemPrompt = buildSystemPrompt(cwd);
  const onEvent = options.onEvent;
  const sessionRules = options.sessionApprovalRules ?? [];
  const store = options.store;
  const readState = options.readState ?? new ReadStateTracker();

  let lastStopReason: "end_turn" | "tool_use" | "length" | undefined;

  for (let turn = 0; turn < maxTurns; turn++) {
    let assistantText = "";
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];

    for await (const event of provider.stream([...messages], toolSchemas, {
      systemPrompt,
    })) {
      switch (event.type) {
        case "text_delta":
          assistantText += event.text;
          if (onEvent) await onEvent({ type: "assistant_text_delta", text: event.text });
          break;
        case "tool_call":
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          if (onEvent)
            await onEvent({
              type: "tool_call",
              id: event.id,
              name: event.name,
              input: event.input,
            });
          break;
        case "stop":
          lastStopReason = event.reason;
          break;
      }
    }

    const assistantMsg: Message = {
      role: "assistant",
      content: assistantText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    messages.push(assistantMsg);
    newMessages.push(assistantMsg);
    if (onEvent) await onEvent({ type: "assistant_message", message: assistantMsg });

    if (toolCalls.length === 0) {
      if (lastStopReason === "length" && onEvent) {
        await onEvent({ type: "turn_truncated" });
      }
      break;
    }

    for (const tc of toolCalls) {
      const decision = checkToolPermission(tc.name, tc.input, options.approval, cwd);
      const toolInput = decision.resolvedInput ?? tc.input;

      let shouldExecute = false;
      let blockReason = "";
      let validationResult = "";

      if (decision.behavior === "allow") {
        shouldExecute = true;
      } else if (decision.behavior === "invalid") {
        validationResult = decision.reason;
      } else if (decision.behavior === "deny") {
        blockReason = decision.reason;
      } else {
        // "ask" — check approval memory before prompting user
        const pattern = buildApprovalPattern(tc.name, tc.input, decision);
        const extDirPattern = decision.metadata?.externalDirectoryPattern as
          | string
          | undefined;

        const sessionMatch = sessionRules.find((r) =>
          matchesApprovalRule(tc.name, tc.input, decision, r),
        );

        let workspaceMatch: { toolName: string; pattern: string } | undefined;
        if (!sessionMatch && store) {
          if (pattern) {
            workspaceMatch = store.findMatchingRule(cwd, tc.name, pattern);
          }
          if (!workspaceMatch && isExternalDirectoryCapable(tc.name, decision.metadata)) {
            const extRules = store
              .listPermissionRules(cwd)
              .filter((r) => r.toolName === "external_directory");
            workspaceMatch = extRules.find((r) =>
              matchesApprovalRule(tc.name, tc.input, decision, r),
            );
          }
        }

        // Determine if auto-allowed by existing rules
        let autoAllowed = false;

        if (tc.name === "bash" && extDirPattern) {
          // Two-layer check: both external_directory (path) and bash approvalPattern (command) must be covered.
          const pathCovered =
            !!sessionRules.find(
              (r) =>
                matchesApprovalRule(tc.name, tc.input, decision, r) &&
                r.toolName === "external_directory",
            ) ||
            (store
              ? store
                  .listPermissionRules(cwd)
                  .filter((r) => r.toolName === "external_directory")
                  .some((r) => matchesApprovalRule(tc.name, tc.input, decision, r))
              : false);
          const cmdCovered =
            !!sessionRules.find((r) => r.toolName === "bash" && r.pattern === pattern) ||
            (store && pattern ? !!store.findMatchingRule(cwd, "bash", pattern) : false);
          autoAllowed = pathCovered && cmdCovered;
        } else {
          autoAllowed = !!(sessionMatch || workspaceMatch);
        }

        if (decision.metadata?.sensitive) autoAllowed = false;

        if (autoAllowed) {
          shouldExecute = true;
        } else if (!options.approvalHandler) {
          const msg: Message = {
            role: "tool_result",
            toolCallId: tc.id,
            toolName: tc.name,
            content: `Tool call requires approval and was not executed: ${decision.reason}`,
          };
          messages.push(msg);
          newMessages.push(msg);
          if (onEvent) await onEvent({ type: "tool_result", message: msg });
          continue;
        } else {
          const display = buildApprovalDisplay(tc.name, tc.input, decision);

          if (onEvent)
            await onEvent({
              type: "tool_approval_required",
              id: tc.id,
              name: tc.name,
              input: tc.input,
              reason: decision.reason,
              metadata: decision.metadata,
              display,
            });

          const response = await options.approvalHandler({
            toolName: tc.name,
            input: tc.input,
            reason: decision.reason,
            suggestedPattern: extDirPattern ?? pattern,
            metadata: decision.metadata,
            display,
          });

          const eventDecision = response === "abort" ? "deny" : "allow";
          if (onEvent)
            await onEvent({
              type: "tool_approval_decision",
              id: tc.id,
              name: tc.name,
              decision: eventDecision,
            });

          if (response === "abort") {
            const msg = blockedMsg(tc, decision.reason);
            messages.push(msg);
            newMessages.push(msg);
            if (onEvent) await onEvent({ type: "tool_result", message: msg });
            if (onEvent) await onEvent({ type: "turn_finished" });
            return { aborted: true };
          }

          shouldExecute = true;
          const approvalPat = decision.metadata?.approvalPattern as string | undefined;
          if (!decision.metadata?.sensitive) {
            // Save external_directory rule for path coverage
            if (extDirPattern) {
              if (response === "allow_for_session") {
                sessionRules.push(
                  createSessionRule(
                    "external_directory",
                    extDirPattern,
                    cwd,
                    decision.reason,
                  ),
                );
              }
              if (response === "allow_for_workspace" && store) {
                store.addPermissionRule({
                  workspaceRoot: cwd,
                  toolName: "external_directory",
                  pattern: extDirPattern,
                });
              }
            }
            // Save bash approvalPattern rule for command coverage
            if (tc.name === "bash" && approvalPat) {
              if (response === "allow_for_session") {
                sessionRules.push(
                  createSessionRule("bash", approvalPat, cwd, decision.reason),
                );
              }
              if (response === "allow_for_workspace" && store) {
                store.addPermissionRule({
                  workspaceRoot: cwd,
                  toolName: "bash",
                  pattern: approvalPat,
                });
              }
            }
            // Save non-bash tool rules (Read, list_dir, grep, glob, edit_file)
            if (tc.name !== "bash" && !extDirPattern && pattern) {
              if (response === "allow_for_session") {
                sessionRules.push(
                  createSessionRule(tc.name, pattern, cwd, decision.reason),
                );
              }
              if (response === "allow_for_workspace" && store) {
                store.addPermissionRule({
                  workspaceRoot: cwd,
                  toolName: tc.name,
                  pattern,
                });
              }
            }
          }
        }
      }

      if (validationResult) {
        const msg: Message = {
          role: "tool_result",
          toolCallId: tc.id,
          toolName: tc.name,
          content: `Patch validation failed before execution: ${validationResult}`,
        };
        messages.push(msg);
        newMessages.push(msg);
        if (onEvent) await onEvent({ type: "tool_result", message: msg });
        continue;
      }

      if (!shouldExecute) {
        const msg = blockedMsg(tc, blockReason);
        messages.push(msg);
        newMessages.push(msg);
        if (onEvent) await onEvent({ type: "tool_result", message: msg });
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
        newMessages.push(msg);
        if (onEvent) await onEvent({ type: "tool_result", message: msg });
        continue;
      }

      // Checkpoint before file mutation tools
      let checkpointId: string | undefined;
      if (isMutationTool(tc.name)) {
        const paths = getCheckpointPaths(tc.name, toolInput);
        if (paths.length > 0) {
          try {
            const cp = await createCheckpoint(cwd, paths);
            checkpointId = cp.id;
          } catch (err: any) {
            const msg: Message = {
              role: "tool_result",
              toolCallId: tc.id,
              toolName: tc.name,
              content: `Checkpoint failed, mutation not executed: ${err.message}`,
            };
            messages.push(msg);
            newMessages.push(msg);
            if (onEvent) await onEvent({ type: "tool_result", message: msg });
            continue;
          }
        }
      }

      if (onEvent)
        await onEvent({
          type: "tool_started",
          id: tc.id,
          name: tc.name,
          input: toolInput,
        });

      const result = await tool.execute(toolInput, {
        cwd,
        permissionResolved: decision.resolvedInput !== undefined,
        readState,
      });
      const content = result.ok ? result.output : `Error: ${result.output}`;

      const resultMsg: Message = {
        role: "tool_result",
        toolCallId: tc.id,
        toolName: tc.name,
        content,
        checkpointId: result.ok ? checkpointId : undefined,
      };
      messages.push(resultMsg);
      newMessages.push(resultMsg);
      if (onEvent) await onEvent({ type: "tool_result", message: resultMsg });
    }
  }

  if (onEvent) await onEvent({ type: "turn_finished" });
  return { aborted: false, stopReason: lastStopReason };
}

export async function runTurn(
  provider: Provider,
  registry: ToolRegistry,
  session: SessionState,
  userInput: string,
  options: TurnOptions,
): Promise<TurnResult> {
  const userMsg: Message = { role: "user", content: userInput };
  const messages = [...session.messages, userMsg];
  const newMessages: Message[] = [userMsg];

  const { aborted, stopReason } = await runAgentLoop(
    provider,
    registry,
    messages,
    newMessages,
    session.cwd,
    options,
  );

  return {
    session: { ...session, messages },
    newMessages,
    aborted: aborted || undefined,
    stopReason,
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

  const { aborted, stopReason } = await runAgentLoop(
    provider,
    registry,
    messages,
    transcript,
    options.cwd,
    options,
  );

  return { transcript, aborted: aborted || undefined, stopReason };
}
