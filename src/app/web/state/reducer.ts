import type { Message } from "../../../model/types.js";
import type { ServerMessage } from "../../protocol.js";
import type { TurnEvent } from "../../../session/loop.js";
import type { ToolDisplay } from "../../../session/tool-display.js";
import {
  buildToolInputDisplay,
  buildToolResultDisplay,
  mergeDiffFiles,
  stripCheckpointMarker,
  summarizeToolResult,
  toolDisplayKind,
  toolDisplayTitle,
  toolTarget,
} from "../../../session/tool-display.js";
import { isSensitiveReadPath } from "../../../permission/sensitive-paths.js";
import { computeDiff } from "../../../tools/file-mutation.js";
import type {
  AppState,
  MutationDiffFile,
  SessionSummary,
  TimelinePart,
  TimelineToolPart,
  TimelineToolStatus,
  TimelineTurn,
} from "./types.js";

export type AppAction =
  | { type: "config_loaded"; config: AppState["config"] }
  | { type: "sessions_loaded"; sessions: SessionSummary[] }
  | { type: "set_active_session"; sessionId: string | null }
  | { type: "timeline_loaded"; sessionId: string; messages: Message[] }
  | { type: "user_message_local"; sessionId: string; turnId: string; text: string }
  | {
      type: "status_local";
      sessionId: string;
      level: "info" | "warning" | "error";
      text: string;
    }
  | { type: "session_running"; sessionId: string; running: boolean }
  | { type: "ws_open"; open: boolean }
  | { type: "server_message"; message: ServerMessage }
  | { type: "approval_cleared" };

export const initialAppState: AppState = {
  config: null,
  sessions: [],
  activeSessionId: null,
  timelines: {},
  loadedSessionIds: [],
  runningSessionIds: [],
  wsOpen: false,
  pendingApproval: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "config_loaded":
      return { ...state, config: action.config };
    case "sessions_loaded":
      return { ...state, sessions: action.sessions };
    case "set_active_session":
      return { ...state, activeSessionId: action.sessionId };
    case "timeline_loaded": {
      const loadedSessionIds = state.loadedSessionIds.includes(action.sessionId)
        ? state.loadedSessionIds
        : [...state.loadedSessionIds, action.sessionId];
      return {
        ...state,
        loadedSessionIds,
        timelines: {
          ...state.timelines,
          [action.sessionId]: buildTimelineFromMessages(action.messages),
        },
      };
    }
    case "user_message_local":
      return {
        ...state,
        timelines: {
          ...state.timelines,
          [action.sessionId]: [
            ...(state.timelines[action.sessionId] ?? []),
            createTurn(action.turnId, action.text),
          ],
        },
      };
    case "status_local":
      return {
        ...state,
        timelines: {
          ...state.timelines,
          [action.sessionId]: appendStatus(
            state.timelines[action.sessionId] ?? [],
            action.level,
            action.text,
          ),
        },
      };
    case "session_running":
      return {
        ...state,
        runningSessionIds: action.running
          ? addUnique(state.runningSessionIds, action.sessionId)
          : state.runningSessionIds.filter((id) => id !== action.sessionId),
      };
    case "ws_open":
      return { ...state, wsOpen: action.open };
    case "approval_cleared":
      return { ...state, pendingApproval: null };
    case "server_message":
      return reduceServerMessage(state, action.message);
    default:
      return state;
  }
}

function reduceServerMessage(state: AppState, message: ServerMessage): AppState {
  switch (message.type) {
    case "ready":
      return state;
    case "approval_required":
      return {
        ...state,
        pendingApproval: {
          sessionId: message.sessionId,
          approvalId: message.approvalId,
          request: message.request,
        },
      };
    case "turn_event":
      return {
        ...state,
        timelines: {
          ...state.timelines,
          [message.sessionId]: applyTurnEvent(
            state.timelines[message.sessionId] ?? [],
            message.event,
          ),
        },
      };
    case "turn_finished":
      return {
        ...state,
        pendingApproval:
          state.pendingApproval?.sessionId === message.sessionId
            ? null
            : state.pendingApproval,
        runningSessionIds: state.runningSessionIds.filter(
          (id) => id !== message.sessionId,
        ),
        timelines: {
          ...state.timelines,
          [message.sessionId]: finalizeStreamingText(
            state.timelines[message.sessionId] ?? [],
          ),
        },
      };
    case "session_rewound":
      return {
        ...state,
        runningSessionIds: state.runningSessionIds.filter(
          (id) => id !== message.sessionId,
        ),
        timelines: {
          ...state.timelines,
          [message.sessionId]: appendStatus(
            state.timelines[message.sessionId] ?? [],
            "info",
            message.message,
          ),
        },
      };
    case "session_compacted":
      return {
        ...state,
        runningSessionIds: state.runningSessionIds.filter(
          (id) => id !== message.sessionId,
        ),
        timelines: {
          ...state.timelines,
          [message.sessionId]: appendStatus(
            state.timelines[message.sessionId] ?? [],
            "info",
            message.message,
          ),
        },
      };
    case "session_model_changed":
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === message.sessionId
            ? {
                ...session,
                modelProfileId: message.modelProfileId,
                provider: message.provider,
                model: message.model,
              }
            : session,
        ),
        runningSessionIds: state.runningSessionIds.filter(
          (id) => id !== message.sessionId,
        ),
        timelines: {
          ...state.timelines,
          [message.sessionId]: appendStatus(
            state.timelines[message.sessionId] ?? [],
            "info",
            message.message,
          ),
        },
      };
    case "error":
      return {
        ...state,
        pendingApproval:
          state.pendingApproval?.sessionId === message.sessionId
            ? null
            : state.pendingApproval,
        runningSessionIds: message.sessionId
          ? state.runningSessionIds.filter((id) => id !== message.sessionId)
          : state.runningSessionIds,
        timelines: message.sessionId
          ? {
              ...state.timelines,
              [message.sessionId]: appendStatus(
                state.timelines[message.sessionId] ?? [],
                "error",
                message.message,
              ),
            }
          : state.timelines,
      };
    default:
      return state;
  }
}

export function buildTimelineFromMessages(messages: Message[]): TimelineTurn[] {
  let timeline: TimelineTurn[] = [];
  const toolInputs = new Map<string, unknown>();

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "user") {
      timeline = [...timeline, createTurn(`history:${index}`, message.content)];
      continue;
    }

    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        toolInputs.set(call.id, call.input);
      }
      timeline = appendAssistantMessage(timeline, message);
      continue;
    }

    if (message.role === "tool_result") {
      const display = replayDisplayFromToolInput(
        message,
        message.toolCallId ? toolInputs.get(message.toolCallId) : undefined,
      );
      timeline = appendToolResult(
        timeline,
        message.toolCallId,
        message.toolName,
        message.content,
        display,
      );
      continue;
    }

    if (message.role === "summary") {
      timeline = appendStatus(timeline, "info", "Conversation compacted.");
    }
  }

  return timeline;
}

function replayDisplayFromToolInput(
  message: Message,
  toolInput: unknown,
): ToolDisplay | undefined {
  if (message.role !== "tool_result") return message.toolDisplay;
  if (message.toolDisplay?.files?.length) {
    return message.toolDisplay;
  }
  const toolName = message.toolName ?? "tool";
  const parsedDisplay = buildToolResultDisplay(
    toolName,
    toolInput ?? {},
    message.content,
  );
  if (parsedDisplay.files?.length) {
    return message.toolDisplay
      ? {
          ...message.toolDisplay,
          kind: "mutation",
          subtitle: parsedDisplay.subtitle,
          summary: parsedDisplay.summary,
          details: parsedDisplay.details ?? message.toolDisplay.details,
          files: parsedDisplay.files,
        }
      : parsedDisplay;
  }
  if (toolName !== "write_file") return message.toolDisplay;
  if (!toolInput || typeof toolInput !== "object") return message.toolDisplay;
  const input = toolInput as Record<string, unknown>;
  if (!input || typeof input.path !== "string" || typeof input.content !== "string") {
    return message.toolDisplay;
  }
  if (isSensitiveReadPath(input.path)) {
    return message.toolDisplay;
  }
  const content = stripCheckpointMarker(message.content);
  if (content !== `Wrote ${input.path}`) {
    return message.toolDisplay;
  }
  const diff = computeDiff("", input.content, input.path);
  if (!diff.diff) return message.toolDisplay;
  return {
    ...(message.toolDisplay ?? buildToolResultDisplay("write_file", input, message.content)),
    kind: "mutation",
    title: message.toolDisplay?.title ?? toolDisplayTitle("write_file"),
    subtitle: input.path,
    summary: `+${diff.additions} -${diff.deletions}`,
    files: [
      {
        path: input.path,
        additions: diff.additions,
        deletions: diff.deletions,
        diff: diff.diff,
      },
    ],
  };
}

function createTurn(id: string, text: string): TimelineTurn {
  return {
    id,
    userMessage: {
      id: `${id}:user`,
      text,
    },
    assistantParts: [],
    mutationDiffs: [],
    completed: false,
  };
}

function appendAssistantMessage(
  timeline: TimelineTurn[],
  message: Message,
): TimelineTurn[] {
  return updateLastTurn(timeline, (turn) => {
    const nextParts = [...turn.assistantParts];
    if (message.content.trim()) {
      nextParts.push({
        id: `${turn.id}:assistant:${nextParts.length}`,
        kind: "text",
        text: message.content,
      });
    }

    for (const call of message.toolCalls ?? []) {
      nextParts.push(
        createToolPart(call.id, call.name, call.input, "queued", call.display),
      );
    }

    return { ...turn, assistantParts: nextParts };
  });
}

export function applyTurnEvent(
  timeline: TimelineTurn[],
  event: TurnEvent,
): TimelineTurn[] {
  switch (event.type) {
    case "provider_stream_started":
    case "provider_step_started":
      return ensureTimelineTurn(timeline);
    case "provider_step_finished":
      return timeline;
    case "assistant_text_started":
      return removeStatus(ensureTimelineTurn(timeline), "provider:reasoning");
    case "assistant_text_finished":
      return finalizeStreamingText(ensureTimelineTurn(timeline));
    case "assistant_reasoning_started":
      return appendOrReplaceStatus(
        ensureTimelineTurn(timeline),
        "info",
        "Thinking...",
        "provider:reasoning",
      );
    case "assistant_reasoning_finished":
      return removeStatus(ensureTimelineTurn(timeline), "provider:reasoning");
    case "assistant_text_delta":
      return updateLastTurn(ensureTimelineTurn(timeline), (turn) => {
        const parts = [...turn.assistantParts];
        const last = parts[parts.length - 1];
        if (last?.kind === "text" && last.streaming) {
          parts[parts.length - 1] = { ...last, text: last.text + event.text };
        } else {
          parts.push({
            id: `${turn.id}:stream`,
            kind: "text",
            text: event.text,
            streaming: true,
          });
        }
        return { ...turn, assistantParts: parts };
      });
    case "assistant_message":
      return updateLastTurn(ensureTimelineTurn(timeline), (turn) => {
        let parts = [...turn.assistantParts];
        const streamIndexes = parts
          .map((part, index) =>
            part.kind === "text" &&
            (part.streaming || part.id.startsWith(`${turn.id}:stream`))
              ? index
              : -1,
          )
          .filter((index) => index >= 0);
        if (event.message.content.trim()) {
          if (streamIndexes.length > 0) {
            const firstIndex = streamIndexes[0]!;
            const streamIndexSet = new Set(streamIndexes);
            parts = parts.filter((_, index) => !streamIndexSet.has(index));
            parts.splice(firstIndex, 0, {
              id: `${turn.id}:assistant:${firstIndex}`,
              kind: "text",
              text: event.message.content,
            });
          } else {
            parts.push({
              id: `${turn.id}:assistant:${parts.length}`,
              kind: "text",
              text: event.message.content,
            });
          }
        } else if (streamIndexes.length > 0) {
          const streamIndexSet = new Set(streamIndexes);
          parts = parts.filter((_, index) => !streamIndexSet.has(index));
        }

        for (const call of event.message.toolCalls ?? []) {
          parts = upsertToolPart(
            parts,
            createToolPart(call.id, call.name, call.input, "queued"),
          );
        }

        return { ...turn, assistantParts: parts };
      });
    case "tool_call":
      return updateLastTurn(ensureTimelineTurn(timeline), (turn) => ({
        ...turn,
        assistantParts: upsertToolPart(
          [...turn.assistantParts],
          createToolPart(event.id, event.name, event.input, "queued", event.display),
        ),
      }));
    case "tool_started":
      return updateLastTurn(ensureTimelineTurn(timeline), (turn) => ({
        ...turn,
        assistantParts: upsertToolPart(
          [...turn.assistantParts],
          createToolPart(event.id, event.name, event.input, "running", event.display),
        ),
      }));
    case "tool_approval_required":
      return updateLastTurn(ensureTimelineTurn(timeline), (turn) => ({
        ...turn,
        assistantParts: upsertToolPart([...turn.assistantParts], {
          ...createToolPart(
            event.id,
            event.name,
            event.input,
            "approval",
            buildToolInputDisplay(event.name, event.input),
          ),
          summary:
            event.display?.kind === "mutation"
              ? "approval required"
              : event.display?.prompt || event.reason,
        }),
      }));
    case "tool_approval_decision":
      return updateLastTurn(ensureTimelineTurn(timeline), (turn) => ({
        ...turn,
        assistantParts: upsertToolPartDecision(
          [...turn.assistantParts],
          event.id,
          event.name,
          event.decision === "deny" ? "denied" : "queued",
        ),
      }));
    case "tool_result":
      return appendToolResult(
        ensureTimelineTurn(timeline),
        event.message.toolCallId,
        event.message.toolName,
        event.message.content,
        event.display,
      );
    case "turn_truncated":
      return appendStatus(
        ensureTimelineTurn(timeline),
        "warning",
        "Turn stopped because the model hit its output token limit.",
      );
    case "turn_finished":
      return finalizeStreamingText(timeline);
    default:
      return timeline;
  }
}

function appendToolResult(
  timeline: TimelineTurn[],
  toolCallId: string | undefined,
  toolName: string | undefined,
  content: string,
  display?: ToolDisplay,
): TimelineTurn[] {
  const name = toolName || "tool";
  const status = resultStatus(content);
  const normalizedDisplay = display ?? buildToolResultDisplay(name, {}, content);
  const details = normalizedDisplay.details ?? stripCheckpointMarker(content);
  const diffFiles = normalizedDisplay.files ?? [];
  const summary = normalizedDisplay.summary ?? summarizeToolResult(name, content);

  return updateLastTurn(ensureTimelineTurn(timeline), (turn) => {
    const parts = upsertToolPart([...turn.assistantParts], {
      id: toolCallId || `${turn.id}:${name}:${turn.assistantParts.length}`,
      kind: "tool",
      toolName: name,
      displayKind: normalizedDisplay.kind,
      status,
      title: normalizedDisplay.title || toolDisplayTitle(name),
      subtitle: normalizedDisplay.subtitle,
      summary,
      details,
      diffFiles,
      display: normalizedDisplay,
    });
    const mutationDiffs = mergeDiffFiles(turn.mutationDiffs, diffFiles);
    return { ...turn, assistantParts: parts, mutationDiffs };
  });
}

function updateLastTurn(
  timeline: TimelineTurn[],
  update: (turn: TimelineTurn) => TimelineTurn,
): TimelineTurn[] {
  if (timeline.length === 0) return timeline;
  const next = [...timeline];
  next[next.length - 1] = update(next[next.length - 1]!);
  return next;
}

function ensureTimelineTurn(timeline: TimelineTurn[]): TimelineTurn[] {
  if (timeline.length > 0) return timeline;
  return [createTurn("synthetic:0", "")];
}

function finalizeStreamingText(timeline: TimelineTurn[]): TimelineTurn[] {
  return updateLastTurn(timeline, (turn) => ({
    ...turn,
    completed: true,
    assistantParts: turn.assistantParts.map((part) =>
      part.kind === "text" && part.streaming ? { ...part, streaming: false } : part,
    ),
  }));
}

function appendStatus(
  timeline: TimelineTurn[],
  level: "info" | "warning" | "error",
  text: string,
): TimelineTurn[] {
  return updateLastTurn(ensureTimelineTurn(timeline), (turn) => ({
    ...turn,
    assistantParts: [
      ...turn.assistantParts,
      {
        id: `${turn.id}:status:${turn.assistantParts.length}`,
        kind: "status",
        level,
        text,
      },
    ],
  }));
}

function appendOrReplaceStatus(
  timeline: TimelineTurn[],
  level: "info" | "warning" | "error",
  text: string,
  id: string,
): TimelineTurn[] {
  return updateLastTurn(ensureTimelineTurn(timeline), (turn) => {
    const statusId = `${turn.id}:status:${id}`;
    const parts = turn.assistantParts.map((part) =>
      part.kind === "status" && part.id === statusId ? { ...part, level, text } : part,
    );
    const exists = parts.some((part) => part.kind === "status" && part.id === statusId);
    return {
      ...turn,
      assistantParts: exists
        ? parts
        : [
            ...parts,
            {
              id: statusId,
              kind: "status",
              level,
              text,
            },
          ],
    };
  });
}

function removeStatus(timeline: TimelineTurn[], id: string): TimelineTurn[] {
  return updateLastTurn(ensureTimelineTurn(timeline), (turn) => ({
    ...turn,
    assistantParts: turn.assistantParts.filter(
      (part) => !(part.kind === "status" && part.id === `${turn.id}:status:${id}`),
    ),
  }));
}

function upsertToolPart(
  parts: TimelinePart[],
  incoming: TimelineToolPart,
): TimelinePart[] {
  const next = [...parts];
  const index = next.findIndex((part) => part.kind === "tool" && part.id === incoming.id);
  if (index >= 0) {
    const existing = next[index] as TimelineToolPart;
    next[index] = {
      ...existing,
      ...incoming,
      details: incoming.details ?? existing.details,
      diffFiles: incoming.diffFiles ?? existing.diffFiles,
      summary: incoming.summary ?? existing.summary,
      subtitle: incoming.subtitle ?? existing.subtitle,
    };
    return next;
  }
  next.push(incoming);
  return next;
}

function upsertToolPartDecision(
  parts: TimelinePart[],
  id: string,
  toolName: string,
  status: TimelineToolStatus,
): TimelinePart[] {
  const next = [...parts];
  const index = next.findIndex((part) => part.kind === "tool" && part.id === id);
  if (index >= 0) {
    next[index] = { ...(next[index] as TimelineToolPart), status };
    return next;
  }
  next.push(createToolPart(id, toolName, {}, status));
  return next;
}

function createToolPart(
  id: string,
  toolName: string,
  input: unknown,
  status: TimelineToolStatus,
  display?: ToolDisplay,
): TimelineToolPart {
  const nextDisplay = display ?? buildToolInputDisplay(toolName, input);
  return {
    id,
    kind: "tool",
    toolName,
    displayKind: nextDisplay.kind,
    status,
    title: nextDisplay.title || toolDisplayTitle(toolName),
    subtitle: nextDisplay.subtitle,
    summary:
      status === "running" ? "running" : status === "approval" ? "approval required" : "",
    details: nextDisplay.details,
    diffFiles: nextDisplay.files,
    display: nextDisplay,
  };
}

function addUnique(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value];
}

function resultStatus(content: string): TimelineToolStatus {
  if (content.startsWith("Patch validation failed before execution:")) return "invalid";
  if (content.startsWith("Tool call denied and was not executed:")) return "denied";
  if (content.startsWith("Error:")) return "failed";
  return "ok";
}
