import type { Provider } from "../model/provider.js";
import type {
  CanonicalModelEvent,
  ModelEvent,
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
import { buildToolInputDisplay, buildToolResultDisplay } from "./tool-display.js";

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
  stopReason?: "end_turn" | "tool_use" | "length" | "max_turns";
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
  availableSkills?: SkillSummary[];
};

export type TurnOptions = {
  approval: ApprovalMode;
  maxTurns?: number;
  approvalHandler?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  onEvent?: (event: TurnEvent) => void | Promise<void>;
  sessionApprovalRules?: ApprovalRule[];
  store?: PermissionStore;
  readState?: ReadStateTracker;
  availableSkills?: SkillSummary[];
};

export type SessionResult = {
  transcript: Message[];
  aborted?: boolean;
  stopReason?: "end_turn" | "tool_use" | "length" | "max_turns";
};

export type TurnEvent =
  | { type: "provider_stream_started" }
  | { type: "provider_step_started" }
  | { type: "provider_step_finished" }
  | { type: "assistant_text_started" }
  | { type: "assistant_text_finished" }
  | { type: "assistant_reasoning_started" }
  | { type: "assistant_reasoning_finished" }
  | { type: "assistant_text_delta"; text: string }
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
  | { type: "turn_max_turns"; maxTurns: number }
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

function providerRawFromMetadata(metadata: ProviderMetadata | undefined): unknown {
  if (!metadata) return undefined;
  if ("raw" in metadata) return metadata.raw;
  if ("openaiCompatible" in metadata) return metadata.openaiCompatible;
  if ("anthropic" in metadata) return metadata.anthropic;
  return undefined;
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
  stopReason?: "end_turn" | "tool_use" | "length" | "max_turns";
}> {
  const maxTurns = options.maxTurns ?? 30;
  const toolSchemas = buildToolSchemas(registry);
  const systemPrompt = buildSystemPrompt(cwd, {
    availableSkills: options.availableSkills,
  });
  const onEvent = options.onEvent;
  const sessionRules = options.sessionApprovalRules ?? [];
  const store = options.store;
  const readState = options.readState ?? new ReadStateTracker();

  let lastStopReason: "end_turn" | "tool_use" | "length" | undefined;
  let exhaustedTurns = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    exhaustedTurns = turn === maxTurns - 1;
    let assistantText = "";
    let reasoningText = "";
    let reasoningMetadata: ProviderMetadata | undefined;
    let assistantRaw: unknown;
    let providerMetadata: ProviderMetadata | undefined;
    const toolCalls: Array<{
      id: string;
      name: string;
      input: unknown;
      display?: ToolDisplay;
      providerMetadata?: ProviderMetadata;
    }> = [];

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
          providerMetadata = canonical.providerMetadata;
          lastStopReason =
            canonical.reason === "tool-calls"
              ? "tool_use"
              : canonical.reason === "length"
                ? "length"
                : "end_turn";
          break;
        case "text-start":
          if (onEvent) await onEvent({ type: "assistant_text_started" });
          break;
        case "text":
          assistantText += canonical.delta;
          if (onEvent)
            await onEvent({ type: "assistant_text_delta", text: canonical.delta });
          break;
        case "text-end":
          if (onEvent) await onEvent({ type: "assistant_text_finished" });
          break;
        case "reasoning-start":
          if (onEvent) await onEvent({ type: "assistant_reasoning_started" });
          break;
        case "reasoning":
          reasoningText += canonical.delta;
          reasoningMetadata = {
            ...(reasoningMetadata ?? {}),
            ...(canonical.providerMetadata ?? {}),
          };
          if (!assistantRaw)
            assistantRaw = providerRawFromMetadata(canonical.providerMetadata);
          break;
        case "reasoning-end":
          if (onEvent) await onEvent({ type: "assistant_reasoning_finished" });
          break;
        case "tool-call":
          toolCalls.push({
            id: canonical.id,
            name: canonical.name,
            input: canonical.input,
            display: buildToolInputDisplay(canonical.name, canonical.input),
            providerMetadata: canonical.providerMetadata,
          });
          if (onEvent)
            await onEvent({
              type: "tool_call",
              id: canonical.id,
              name: canonical.name,
              input: canonical.input,
              display: buildToolInputDisplay(canonical.name, canonical.input),
            });
          break;
        case "tool-result":
          break;
        case "finish":
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

    const parts = [
      ...(reasoningText
        ? [
            {
              type: "reasoning" as const,
              text: reasoningText,
              providerMetadata: reasoningMetadata,
            },
          ]
        : []),
      ...(assistantText ? [{ type: "text" as const, text: assistantText }] : []),
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
      providerMetadata,
      providerRaw: assistantRaw ?? providerRawFromMetadata(providerMetadata),
    };
    messages.push(assistantMsg);
    newMessages.push(assistantMsg);
    if (onEvent) await onEvent({ type: "assistant_message", message: assistantMsg });

    if (toolCalls.length === 0) {
      exhaustedTurns = false;
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
      const toolDisplay = buildToolResultDisplay(tc.name, toolInput, content);

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
      if (onEvent)
        await onEvent({
          type: "tool_result",
          message: resultMsg,
          display: toolDisplay,
        });
    }
  }

  const stopReason =
    exhaustedTurns && lastStopReason === "tool_use" ? "max_turns" : lastStopReason;
  if (stopReason === "max_turns" && onEvent) {
    await onEvent({ type: "turn_max_turns", maxTurns });
  }
  if (onEvent) await onEvent({ type: "turn_finished" });
  return { aborted: false, stopReason };
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
