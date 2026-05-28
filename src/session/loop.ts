import type { Provider } from "../model/provider.js";
import type {
  CanonicalModelEvent,
  MessageLifecycleStatus,
  MessagePhase,
  ModelEvent,
  ModelUsage,
  ProviderMetadata,
  ToolSchema,
} from "../model/types.js";
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
import type { SkillSummary } from "../skill/types.js";
import { ReadStateTracker } from "../tools/file-mutation.js";
import { isMutationTool, getCheckpointPaths } from "../tools/mutation-policy.js";
import type { ApprovalDisplay } from "../permission/display.js";
import { buildApprovalDisplay } from "../permission/display.js";
import type { ToolDisplay } from "./tool-display.js";
import {
  buildToolInputDisplay,
  buildToolResultDisplay,
  withFallbackDiffFiles,
} from "./tool-display.js";

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
  modelProfileId?: string;
  provider?: string;
  model?: string;
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
  approvalHandler?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  onEvent?: (event: TurnEvent) => void | Promise<void>;
  sessionApprovalRules?: ApprovalRule[];
  store?: PermissionStore;
  readState?: ReadStateTracker;
  availableSkills?: SkillSummary[];
};

export type TurnOptions = {
  approval: ApprovalMode;
  approvalHandler?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  onEvent?: (event: TurnEvent) => void | Promise<void>;
  sessionApprovalRules?: ApprovalRule[];
  store?: PermissionStore;
  readState?: ReadStateTracker;
  availableSkills?: SkillSummary[];
  durableSink?: DurableTurnSink;
};

export type SessionResult = {
  transcript: Message[];
  aborted?: boolean;
  stopReason?: "end_turn" | "tool_use" | "length";
};

export type TurnEvent =
  | { type: "turn_started" }
  | {
      type: "message_started";
      messageId: string;
      role: Message["role"];
      status?: MessageLifecycleStatus;
    }
  | { type: "message_finished"; messageId: string; message: Message }
  | {
      type: "message_failed";
      messageId: string;
      message: Message;
      error: string;
    }
  | {
      type: "part_started";
      messageId: string;
      partId: string;
      partType: "text" | "reasoning" | "tool-call" | "tool-result";
      phase?: MessagePhase;
      status?: MessageLifecycleStatus;
      text?: string;
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      output?: unknown;
      display?: ToolDisplay;
      metadata?: ProviderMetadata;
    }
  | { type: "part_delta"; partId: string; delta: string }
  | {
      type: "part_finished";
      partId: string;
      status?: MessageLifecycleStatus;
      phase?: MessagePhase;
      text?: string;
      output?: unknown;
      display?: ToolDisplay;
      metadata?: ProviderMetadata;
    }
  | { type: "provider_stream_started" }
  | { type: "provider_step_started" }
  | { type: "provider_step_finished" }
  | { type: "provider_usage"; usage: ModelUsage }
  | { type: "assistant_text_started"; phase?: MessagePhase }
  | { type: "assistant_text_finished"; phase?: MessagePhase }
  | { type: "assistant_reasoning_started" }
  | { type: "assistant_reasoning_finished" }
  | { type: "assistant_text_delta"; text: string; phase?: MessagePhase }
  | { type: "tool_call"; id: string; name: string; input: unknown; display?: ToolDisplay }
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
  | {
      type: "tool_started";
      id: string;
      name: string;
      input: unknown;
      display?: ToolDisplay;
    }
  | { type: "tool_result"; message: Message; display?: ToolDisplay }
  | { type: "turn_truncated" }
  | { type: "turn_failed"; error: string }
  | { type: "turn_finished" };

export type DurableTurnSink = {
  messageStarted(input: {
    role: Message["role"];
    content?: string;
    status?: MessageLifecycleStatus;
  }): Promise<string> | string;
  messageFinished(
    messageId: string,
    message: Message,
  ): Promise<void> | void;
  messageFailed(
    messageId: string,
    input: { message: Message; error: string },
  ): Promise<void> | void;
  partStarted(input: {
    messageId: string;
    type: "text" | "reasoning" | "tool-call" | "tool-result";
    phase?: MessagePhase;
    status?: MessageLifecycleStatus;
    text?: string;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    display?: unknown;
    metadata?: ProviderMetadata;
  }): Promise<string> | string;
  partDelta(partId: string, delta: string): Promise<void> | void;
  partFinished(
    partId: string,
    input?: {
      status?: MessageLifecycleStatus;
      phase?: MessagePhase;
      text?: string;
      output?: unknown;
      display?: unknown;
      metadata?: ProviderMetadata;
    },
  ): Promise<void> | void;
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

function blockedMsg(
  tc: { id: string; name: string; providerMetadata?: ProviderMetadata },
  reason: string,
): Message {
  return {
    role: "tool_result",
    toolCallId: tc.id,
    toolName: tc.name,
    content: `Tool call denied and was not executed: ${reason}`,
    providerMetadata: tc.providerMetadata,
  };
}

function interruptedToolResult(
  tc: {
    id: string;
    name: string;
    input: unknown;
    providerMetadata?: ProviderMetadata;
  },
  reason: string,
): Message {
  const content = `Tool call interrupted before execution: ${reason}`;
  return {
    role: "tool_result",
    toolCallId: tc.id,
    toolName: tc.name,
    content,
    toolDisplay: buildToolResultDisplay(tc.name, tc.input, content),
    providerMetadata: tc.providerMetadata,
    parts: [
      {
        type: "tool-result",
        id: tc.id,
        name: tc.name,
        result: content,
        isError: true,
        display: buildToolResultDisplay(tc.name, tc.input, content),
        status: "interrupted",
        providerMetadata: tc.providerMetadata,
      },
    ],
    status: "interrupted",
    error: reason,
  };
}

function providerRawFromMetadata(metadata: ProviderMetadata | undefined): unknown {
  if (!metadata) return undefined;
  if ("raw" in metadata) return metadata.raw;
  if ("openaiCompatible" in metadata) return metadata.openaiCompatible;
  if ("anthropic" in metadata) return metadata.anthropic;
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error || "Turn failed");
}

function mutationDisplayFiles(
  toolName: string,
  input: unknown,
  decision: ReturnType<typeof checkToolPermission>,
): ToolDisplay["files"] {
  if (!isMutationTool(toolName) || decision.metadata?.sensitive) return undefined;
  const display = buildApprovalDisplay(toolName, input, decision);
  return display.kind === "mutation" ? display.files : undefined;
}

async function runAgentLoop(
  provider: Provider,
  registry: ToolRegistry,
  messages: Message[],
  newMessages: Message[],
  cwd: string,
  options: TurnOptions,
): Promise<{
  aborted: boolean;
  stopReason?: "end_turn" | "tool_use" | "length";
}> {
  const toolSchemas = buildToolSchemas(registry);
  const systemPrompt = buildSystemPrompt(cwd, {
    availableSkills: options.availableSkills,
  });
  const onEvent = options.onEvent;
  const sessionRules = options.sessionApprovalRules ?? [];
  const store = options.store;
  const readState = options.readState ?? new ReadStateTracker();
  if (options.durableSink && onEvent) await onEvent({ type: "turn_started" });
  const persistDurableToolResult = async (msg: Message, display?: ToolDisplay) => {
    const durableSink = options.durableSink;
    if (!durableSink || msg.role !== "tool_result") return;
    const messageId = await durableSink.messageStarted({
      role: "tool_result",
      content: msg.content,
      status: msg.status ?? "completed",
    });
    const partId = await durableSink.partStarted({
      messageId,
      type: "tool-result",
      status: msg.status ?? "completed",
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      output: msg.content,
      display: display ?? msg.toolDisplay,
      metadata: msg.providerMetadata,
    });
    await durableSink.partFinished(partId, { status: msg.status ?? "completed" });
    await durableSink.messageFinished(messageId, msg);
  };

  let lastStopReason: "end_turn" | "tool_use" | "length" | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let assistantText = "";
    let reasoningText = "";
    let reasoningMetadata: ProviderMetadata | undefined;
    let assistantRaw: unknown;
    let providerMetadata: ProviderMetadata | undefined;
    let latestUsage: ModelUsage | undefined;
    const toolCalls: Array<{
      id: string;
      name: string;
      input: unknown;
      display?: ToolDisplay;
      providerMetadata?: ProviderMetadata;
    }> = [];
    const durableSink = options.durableSink;
    let assistantMessageId: string | undefined;
    let activeTextPartId: string | undefined;
    let activeReasoningPartId: string | undefined;

    const ensureDurableAssistantMessage = async () => {
      if (!durableSink) return undefined;
      if (!assistantMessageId) {
        assistantMessageId = await durableSink.messageStarted({
          role: "assistant",
          content: "",
          status: "running",
        });
      }
      return assistantMessageId;
    };

    const startDurableTextPart = async (phase: MessagePhase) => {
      if (!durableSink || activeTextPartId) return;
      const messageId = await ensureDurableAssistantMessage();
      if (!messageId) return;
      activeTextPartId = await durableSink.partStarted({
        messageId,
        type: "text",
        phase,
        status: "running",
        text: "",
      });
    };

    const startDurableReasoningPart = async () => {
      if (!durableSink || activeReasoningPartId) return;
      const messageId = await ensureDurableAssistantMessage();
      if (!messageId) return;
      activeReasoningPartId = await durableSink.partStarted({
        messageId,
        type: "reasoning",
        phase: "commentary",
        status: "running",
        text: "",
      });
    };

    try {
      for await (const canonical of provider.stream([...messages], toolSchemas, {
        systemPrompt,
      })) {
        switch (canonical.type) {
        case "start":
          if (onEvent) await onEvent({ type: "provider_stream_started" });
          break;
        case "step-start":
          if (onEvent) await onEvent({ type: "provider_step_started" });
          break;
        case "step-finish":
          if (onEvent) await onEvent({ type: "provider_step_finished" });
          if (onEvent && canonical.usage) {
            latestUsage = canonical.usage;
            await onEvent({ type: "provider_usage", usage: canonical.usage });
          }
          providerMetadata = canonical.providerMetadata;
          lastStopReason =
            canonical.reason === "tool-calls"
              ? "tool_use"
              : canonical.reason === "length"
                ? "length"
                : "end_turn";
          break;
        case "text-start":
          await startDurableTextPart("commentary");
          if (onEvent)
            await onEvent({ type: "assistant_text_started", phase: "commentary" });
          break;
        case "text":
          await startDurableTextPart("commentary");
          assistantText += canonical.delta;
          if (durableSink && activeTextPartId) {
            await durableSink.partDelta(activeTextPartId, canonical.delta);
          }
          if (onEvent)
            await onEvent({
              type: "assistant_text_delta",
              text: canonical.delta,
              phase: "commentary",
            });
          break;
        case "text-end":
          if (durableSink && activeTextPartId) {
            await durableSink.partFinished(activeTextPartId, {
              status: "completed",
              phase: "commentary",
            });
          }
          if (onEvent)
            await onEvent({ type: "assistant_text_finished", phase: "commentary" });
          break;
        case "reasoning-start":
          await startDurableReasoningPart();
          if (onEvent) await onEvent({ type: "assistant_reasoning_started" });
          break;
        case "reasoning":
          await startDurableReasoningPart();
          reasoningText += canonical.delta;
          if (durableSink && activeReasoningPartId) {
            await durableSink.partDelta(activeReasoningPartId, canonical.delta);
          }
          reasoningMetadata = {
            ...(reasoningMetadata ?? {}),
            ...(canonical.providerMetadata ?? {}),
          };
          if (!assistantRaw)
            assistantRaw = providerRawFromMetadata(canonical.providerMetadata);
          break;
        case "reasoning-end":
          if (durableSink && activeReasoningPartId) {
            await durableSink.partFinished(activeReasoningPartId, {
              status: "completed",
              metadata: reasoningMetadata,
            });
          }
          if (onEvent) await onEvent({ type: "assistant_reasoning_finished" });
          break;
        case "tool-call":
          {
            const display = buildToolInputDisplay(canonical.name, canonical.input);
            toolCalls.push({
              id: canonical.id,
              name: canonical.name,
              input: canonical.input,
              display,
              providerMetadata: canonical.providerMetadata,
            });
            if (durableSink) {
              const messageId = await ensureDurableAssistantMessage();
              if (messageId) {
                const partId = await durableSink.partStarted({
                  messageId,
                  type: "tool-call",
                  status: "completed",
                  toolCallId: canonical.id,
                  toolName: canonical.name,
                  input: canonical.input,
                  display,
                  metadata: canonical.providerMetadata,
                });
                await durableSink.partFinished(partId, { status: "completed" });
              }
            }
            if (onEvent)
              await onEvent({
                type: "tool_call",
                id: canonical.id,
                name: canonical.name,
                input: canonical.input,
                display,
              });
            break;
          }
        case "tool-result":
          break;
        case "finish":
          if (onEvent && canonical.usage) {
            latestUsage = canonical.usage;
            await onEvent({ type: "provider_usage", usage: canonical.usage });
          }
          providerMetadata = canonical.providerMetadata;
          lastStopReason =
            canonical.reason === "tool-calls"
              ? "tool_use"
              : canonical.reason === "length"
                ? "length"
                : "end_turn";
          break;
        case "abort":
          lastStopReason = "end_turn";
          break;
        }
      }
    } catch (err) {
      const failure = errorMessage(err);
      const interruptedParts = [
        ...(reasoningText
          ? [
              {
                type: "reasoning" as const,
                text: reasoningText,
                phase: "commentary" as const,
                status: "interrupted" as const,
                providerMetadata: reasoningMetadata,
              },
            ]
          : []),
        ...(assistantText
          ? [
              {
                type: "text" as const,
                text: assistantText,
                phase: "commentary" as const,
                status: "interrupted" as const,
              },
            ]
          : []),
        ...toolCalls.map((tc) => ({
          type: "tool-call" as const,
          id: tc.id,
          name: tc.name,
          input: tc.input,
          display: tc.display,
          status: "interrupted" as const,
          providerMetadata: tc.providerMetadata,
        })),
      ];
      if (durableSink && activeTextPartId) {
        await durableSink.partFinished(activeTextPartId, {
          status: "interrupted",
          phase: "commentary",
        });
      }
      if (durableSink && activeReasoningPartId) {
        await durableSink.partFinished(activeReasoningPartId, {
          status: "interrupted",
          metadata: reasoningMetadata,
        });
      }
      if (assistantMessageId || interruptedParts.length > 0) {
        const failedMessage: Message = {
          role: "assistant",
          content: assistantText,
          status: "failed",
          error: failure,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          parts: interruptedParts.length > 0 ? interruptedParts : undefined,
          usage: latestUsage,
          providerMetadata,
          providerRaw: assistantRaw ?? providerRawFromMetadata(providerMetadata),
        };
        messages.push(failedMessage);
        newMessages.push(failedMessage);
        if (durableSink) {
          const messageId =
            assistantMessageId ?? (await durableSink.messageStarted({
              role: "assistant",
              content: assistantText,
              status: "failed",
            }));
          await durableSink.messageFailed(messageId, {
            message: failedMessage,
            error: failure,
          });
        }
        if (onEvent)
          await onEvent({ type: "assistant_message", message: failedMessage });
      }
      for (const tc of toolCalls) {
        const synthetic = interruptedToolResult(tc, failure);
        messages.push(synthetic);
        newMessages.push(synthetic);
        await persistDurableToolResult(synthetic, synthetic.toolDisplay);
        if (onEvent)
          await onEvent({
            type: "tool_result",
            message: synthetic,
            display: synthetic.toolDisplay,
          });
      }
      if (onEvent) await onEvent({ type: "turn_failed", error: failure });
      throw err;
    }

    const messagePhase: MessagePhase = toolCalls.length > 0 ? "commentary" : "final";
    const parts = [
      ...(reasoningText
        ? [
            {
              type: "reasoning" as const,
              text: reasoningText,
              phase: "commentary" as const,
              providerMetadata: reasoningMetadata,
            },
          ]
        : []),
      ...(assistantText
        ? [{ type: "text" as const, text: assistantText, phase: messagePhase }]
        : []),
      ...toolCalls.map((tc) => ({
        type: "tool-call" as const,
        id: tc.id,
        name: tc.name,
        input: tc.input,
        display: tc.display,
        providerMetadata: tc.providerMetadata,
      })),
    ];

    const assistantMsg: Message = {
      role: "assistant",
      content: assistantText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      parts: parts.length > 0 ? parts : undefined,
      usage: latestUsage,
      providerMetadata,
      providerRaw: assistantRaw ?? providerRawFromMetadata(providerMetadata),
    };
    if (durableSink) {
      if (activeTextPartId) {
        await durableSink.partFinished(activeTextPartId, {
          status: "completed",
          phase: messagePhase,
          text: assistantText,
        });
      }
      if (activeReasoningPartId) {
        await durableSink.partFinished(activeReasoningPartId, {
          status: "completed",
          text: reasoningText,
          metadata: reasoningMetadata,
        });
      }
      if (assistantMessageId) {
        await durableSink.messageFinished(assistantMessageId, assistantMsg);
      } else if (parts.length > 0 || assistantText) {
        const messageId = await durableSink.messageStarted({
          role: "assistant",
          content: assistantText,
          status: "completed",
        });
        await durableSink.messageFinished(messageId, assistantMsg);
      }
    }
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
      const tool = registry.get(tc.name);
      if (!tool) {
        const toolDisplay = buildToolResultDisplay(
          tc.name,
          tc.input,
          `Tool not found: ${tc.name}`,
        );
        const msg: Message = {
          role: "tool_result",
          toolCallId: tc.id,
          toolName: tc.name,
          content: `Tool not found: ${tc.name}`,
          toolDisplay,
          providerMetadata: tc.providerMetadata,
        };
        messages.push(msg);
        newMessages.push(msg);
        await persistDurableToolResult(msg, toolDisplay);
        if (onEvent)
          await onEvent({
            type: "tool_result",
            message: msg,
            display: toolDisplay,
          });
        continue;
      }

      const permissionInput =
        tool.preparePermissionInput?.(tc.input, { cwd, readState }) ?? tc.input;
      const decision = checkToolPermission(
        tc.name,
        permissionInput,
        options.approval,
        cwd,
      );
      const toolInput = decision.resolvedInput ?? tc.input;
      const plannedDiffFiles = mutationDisplayFiles(tc.name, permissionInput, decision);

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
          const toolDisplay = buildToolResultDisplay(
            tc.name,
            tc.input,
            `Tool call requires approval and was not executed: ${decision.reason}`,
          );
          const msg: Message = {
            role: "tool_result",
            toolCallId: tc.id,
            toolName: tc.name,
            content: `Tool call requires approval and was not executed: ${decision.reason}`,
            toolDisplay,
            providerMetadata: tc.providerMetadata,
          };
          messages.push(msg);
          newMessages.push(msg);
          await persistDurableToolResult(msg, toolDisplay);
          if (onEvent)
            await onEvent({
              type: "tool_result",
              message: msg,
              display: toolDisplay,
            });
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
            const toolDisplay = buildToolResultDisplay(
              tc.name,
              tc.input,
              `Tool call denied and was not executed: ${decision.reason}`,
            );
            const msg = blockedMsg(tc, decision.reason);
            msg.toolDisplay = toolDisplay;
            messages.push(msg);
            newMessages.push(msg);
            await persistDurableToolResult(msg, toolDisplay);
            if (onEvent)
              await onEvent({
                type: "tool_result",
                message: msg,
                display: toolDisplay,
              });
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
        const toolDisplay = buildToolResultDisplay(
          tc.name,
          tc.input,
          `Patch validation failed before execution: ${validationResult}`,
        );
        const msg: Message = {
          role: "tool_result",
          toolCallId: tc.id,
          toolName: tc.name,
          content: `Patch validation failed before execution: ${validationResult}`,
          toolDisplay,
          providerMetadata: tc.providerMetadata,
        };
        messages.push(msg);
        newMessages.push(msg);
        await persistDurableToolResult(msg, toolDisplay);
        if (onEvent)
          await onEvent({
            type: "tool_result",
            message: msg,
            display: toolDisplay,
          });
        continue;
      }

      if (!shouldExecute) {
        const toolDisplay = buildToolResultDisplay(
          tc.name,
          tc.input,
          `Tool call denied and was not executed: ${blockReason}`,
        );
        const msg = blockedMsg(tc, blockReason);
        msg.toolDisplay = toolDisplay;
        messages.push(msg);
        newMessages.push(msg);
        await persistDurableToolResult(msg, toolDisplay);
        if (onEvent)
          await onEvent({
            type: "tool_result",
            message: msg,
            display: toolDisplay,
          });
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
            const failure = `Checkpoint failed, mutation not executed: ${err.message}`;
            const toolDisplay = buildToolResultDisplay(tc.name, toolInput, failure);
            const msg: Message = {
              role: "tool_result",
              toolCallId: tc.id,
              toolName: tc.name,
              content: failure,
              toolDisplay,
              providerMetadata: tc.providerMetadata,
            };
            messages.push(msg);
            newMessages.push(msg);
            await persistDurableToolResult(msg, toolDisplay);
            if (onEvent)
              await onEvent({
                type: "tool_result",
                message: msg,
                display: toolDisplay,
              });
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
          display: buildToolInputDisplay(tc.name, toolInput),
        });

      const result = await tool.execute(toolInput, {
        cwd,
        permissionResolved: decision.resolvedInput !== undefined,
        readState,
      });
      const content = result.ok ? result.output : `Error: ${result.output}`;
      const toolDisplay = result.ok
        ? withFallbackDiffFiles(
            buildToolResultDisplay(tc.name, toolInput, content),
            plannedDiffFiles,
          )
        : buildToolResultDisplay(tc.name, toolInput, content);

      const resultMsg: Message = {
        role: "tool_result",
        toolCallId: tc.id,
        toolName: tc.name,
        content,
        toolDisplay,
        providerMetadata: tc.providerMetadata,
        checkpointId: result.ok ? checkpointId : undefined,
      };
      messages.push(resultMsg);
      newMessages.push(resultMsg);
      await persistDurableToolResult(resultMsg, toolDisplay);
      if (onEvent)
        await onEvent({
          type: "tool_result",
          message: resultMsg,
          display: toolDisplay,
        });
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
