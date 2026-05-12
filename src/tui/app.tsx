import React, { useState, useCallback, useRef, useEffect, useContext } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { ApprovalResponse } from "../permission/approval.js";
import type { ApprovalMode } from "../permission/policy.js";
import type { Provider } from "../model/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { TranscriptStore } from "../storage/store.js";
import type { SessionState, ApprovalRequest, TurnEvent } from "../session/loop.js";
import type { SkillSummary } from "../skill/types.js";
import { runTurn } from "../session/loop.js";
import {
  formatRewindMessage,
  revertLast,
  rewindSession,
} from "../session/revert.js";
import { ProviderRuntimeError, formatProviderError } from "../model/errors.js";
import { ReadStateTracker } from "../tools/file-mutation.js";
import {
  appendUserItem,
  reduceTimelineEvent,
} from "./timeline/reducer.js";
import type { TimelineItem } from "./timeline/types.js";
import {
  clampTimelineScrollOffset,
  selectTimelineViewport,
} from "./timeline/viewport.js";
import type { TimelineDisplayLine } from "./timeline/viewport.js";
import type { TuiPhase, ApprovalState, PastePart } from "./types.js";
import { expandPromptText } from "./prompt-input/paste.js";
import { DEFAULT_MAX_VISIBLE_LINES, PromptInput } from "./prompt-input/PromptInput.js";
import { PromptCursor } from "./prompt-input/cursor.js";
import { MouseInputContext } from "./mouse-input.js";

type AppProps = {
  session: SessionState;
  provider: Provider;
  providerName: string;
  modelName: string;
  registry: ToolRegistry;
  approval: ApprovalMode;
  store: TranscriptStore;
  availableSkills?: SkillSummary[];
  maxTurns?: number;
  onExit: () => void;
};

export function TuiApp(props: AppProps): React.ReactElement {
  const { stdout } = useStdout();
  const mouseBus = useContext(MouseInputContext);
  const columns = Math.max(20, stdout.columns ?? 80);
  const terminalRows = Math.max(12, stdout.rows ?? 24);
  const promptMaxLines = Math.min(
    DEFAULT_MAX_VISIBLE_LINES,
    Math.max(2, terminalRows - 8),
  );
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [phase, setPhase] = useState<TuiPhase>("idle");
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputState, setInputState] = useState({ value: "", cursor: 0 });
  const [pasteParts, setPasteParts] = useState<PastePart[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);

  const sensitiveSetRef = useRef(new Set<string>());
  const sessionApprovalRulesRef = useRef<
    import("../permission/approval.js").ApprovalRule[]
  >([]);
  const readStateRef = useRef(new ReadStateTracker());
  const followTailRef = useRef(true);

  const handleEvent = useCallback((event: TurnEvent) => {
    if (event.type === "tool_approval_required" && event.metadata?.sensitive) {
      sensitiveSetRef.current.add(event.id);
    }
    setTimeline((prev) =>
      reduceTimelineEvent(prev, event, {
        sensitiveSet: sensitiveSetRef.current,
      }),
    );
    if (event.type === "tool_approval_required") {
      setPhase("waiting_approval");
    } else if (event.type === "turn_finished") {
      setPhase("idle");
    }
  }, []);

  const handleSubmit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const expanded = expandPromptText({ input: text, parts: pasteParts });
      const command = expanded.trim();

      if (command.startsWith("/rewind ") || command === "/revert-last") {
        setPhase("running");
        setError(null);
        setInputState({ value: "", cursor: 0 });
        setPasteParts([]);

        const runCommand = async () => {
          try {
            const result = command.startsWith("/rewind ")
              ? await rewindSession(
                  props.session,
                  command.slice("/rewind ".length).trim(),
                )
              : await revertLast(props.session);
            const action = command.startsWith("/rewind ")
              ? "rewind"
              : "revert-last";
            const message = formatRewindMessage(action, result);
            const assistantMessage = { role: "assistant" as const, content: message };
            props.session.messages.push(assistantMessage);
            props.store.appendMessages(props.session.id, [assistantMessage]);
            setTimeline((prev) => [
              ...prev,
              { type: "status", level: "info", text: message },
            ]);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Command failed";
            setTimeline((prev) => [
              ...prev,
              { type: "status", level: "error", text: message },
            ]);
            setError(message);
          } finally {
            setPhase("idle");
          }
        };

        void runCommand();
        return;
      }

      if (command === "/rewind") {
        const message = "Usage: /rewind <checkpointId>";
        setTimeline((prev) => [
          ...prev,
          { type: "status", level: "warn", text: message },
        ]);
        setError(message);
        setInputState({ value: "", cursor: 0 });
        setPasteParts([]);
        return;
      }

      setTimeline((prev) => appendUserItem(prev, text));
      setPhase("running");
      setError(null);
      setInputState({ value: "", cursor: 0 });
      setPasteParts([]);

      const approvalHandler = async (
        request: ApprovalRequest,
      ): Promise<ApprovalResponse> => {
        return new Promise<ApprovalResponse>((resolve) => {
          const meta = request.metadata;
          const details: string[] = [];
          if (meta?.realPath) details.push(`path: ${meta.realPath as string}`);
          if (meta?.sensitive) details.push("[sensitive]");

          const state: ApprovalState = {
            toolName: request.toolName,
            reason: request.reason,
            details,
            allowAlways: meta?.sensitive !== true,
            resolve,
          };
          setApproval(state);
        });
      };

      const runAsync = async () => {
        try {
          const {
            session: updated,
            newMessages,
            aborted,
          } = await runTurn(props.provider, props.registry, props.session, expanded, {
            approval: props.approval,
            maxTurns: props.maxTurns,
            approvalHandler,
            onEvent: handleEvent,
            sessionApprovalRules: sessionApprovalRulesRef.current,
            store: props.store,
            readState: readStateRef.current,
            availableSkills: props.availableSkills,
          });
          Object.assign(props.session, updated);
          props.store.appendMessages(props.session.id, newMessages);
          if (aborted) {
            setTimeline((prev) => [
              ...prev,
              { type: "status", level: "info", text: "Turn aborted." },
            ]);
          }
        } catch (err) {
          if (err instanceof ProviderRuntimeError) {
            const msg = formatProviderError(err);
            setTimeline((prev) => [
              ...prev,
              { type: "status", level: "error", text: msg },
            ]);
            setError(msg);
            setPhase("idle");
          } else {
            throw err;
          }
        }
      };
      void runAsync();
    },
    [props, pasteParts, handleEvent],
  );

  const resolveApproval = useCallback(
    (response: ApprovalResponse) => {
      const state = approval;
      if (state) {
        state.resolve(response);
        setApproval(null);
        setPhase("running");
      }
    },
    [approval],
  );

  useInput((input, key) => {
    if (approval) {
      if (key.return || input === "y") {
        resolveApproval("allow_once");
      } else if ((input === "a" || input === "s") && approval.allowAlways) {
        resolveApproval("allow_for_session");
      } else if (input === "w" && approval.allowAlways) {
        resolveApproval("allow_for_workspace");
      } else if (input === "n" || key.escape) {
        resolveApproval("abort");
      }
      return;
    }

    if (key.ctrl && input === "c") {
      props.onExit();
      return;
    }
  });

  const promptVisibleLines = visiblePromptLineCount(inputState.value, columns - 6);
  const promptFrameHeight = promptVisibleLines + 2;
  const transcriptHeight = Math.max(1, terminalRows - promptFrameHeight - 3);
  const chatFrameHeight = Math.max(3, transcriptHeight - 1);
  const chatViewportHeight = Math.max(1, chatFrameHeight - 2);

  useEffect(() => {
    setScrollOffset((current) =>
      followTailRef.current
        ? 0
        : clampTimelineScrollOffset(timeline, chatViewportHeight, current),
    );
  }, [timeline, chatViewportHeight]);

  const scrollBy = useCallback(
    (delta: number) => {
      setScrollOffset((current) => {
        const next = clampTimelineScrollOffset(
          timeline,
          chatViewportHeight,
          current + delta,
        );
        followTailRef.current = next === 0;
        return next;
      });
    },
    [timeline, chatViewportHeight],
  );

  const jumpToBottom = useCallback(() => {
    followTailRef.current = true;
    setScrollOffset(0);
  }, []);

  useInput((input, key) => {
    if (approval) return;
    if (key.pageUp) {
      scrollBy(Math.max(1, chatViewportHeight - 1));
    } else if (key.pageDown) {
      scrollBy(-Math.max(1, chatViewportHeight - 1));
    } else if (key.escape) {
      jumpToBottom();
    }
  });

  useEffect(() => {
    return mouseBus.subscribe((event) => {
      if (event.type !== "wheel") return;
      scrollBy(event.direction === "up" ? 3 : -3);
    });
  }, [mouseBus, scrollBy]);

  return (
    <Box flexDirection="column" width="100%" height={terminalRows}>
      <HeaderBar
        providerName={props.providerName}
        modelName={props.modelName}
        approval={props.approval}
        cwd={props.session.cwd}
        sessionId={props.session.id}
      />
      <TimelinePane
        timeline={timeline}
        height={transcriptHeight}
        frameHeight={chatFrameHeight}
        viewportHeight={chatViewportHeight}
        scrollOffset={scrollOffset}
      />
      {approval && <ApprovalModal state={approval} onResolve={resolveApproval} />}
      <ComposerFrame
        value={inputState.value}
        cursor={inputState.cursor}
        onChange={(value, cursor) => setInputState({ value, cursor })}
        onSubmit={handleSubmit}
        pasteParts={pasteParts}
        onPastePartsChange={setPasteParts}
        focus={phase === "idle" && !approval}
        columns={columns}
        maxLines={promptMaxLines}
        visibleLines={promptVisibleLines}
        disabled={phase !== "idle"}
      />
      <StatusBar phase={phase} error={error} />
    </Box>
  );
}

function HeaderBar(props: {
  providerName: string;
  modelName: string;
  approval: string;
  cwd: string;
  sessionId: string;
}): React.ReactElement {
  return (
    <Box paddingLeft={1} width="100%">
      <Text wrap="truncate-end">
        <Text color="cyan">
          {props.providerName}/{props.modelName}
        </Text>
        <Text color="gray"> | approval:{props.approval}</Text>
        <Text color="gray"> | {props.cwd}</Text>
        <Text color="gray"> | session:{props.sessionId.slice(0, 8)}</Text>
      </Text>
    </Box>
  );
}

function TimelinePane(props: {
  timeline: TimelineItem[];
  height: number;
  frameHeight: number;
  viewportHeight: number;
  scrollOffset: number;
}): React.ReactElement {
  const { timeline, height, frameHeight, viewportHeight, scrollOffset } = props;
  const viewport = selectTimelineViewport(timeline, viewportHeight, scrollOffset);
  const hiddenBelow = viewport.scrollOffset > 0;
  const hiddenAbove = viewport.startLine > 0;
  return (
    <Box flexDirection="column" height={height} overflow="hidden" paddingTop={1}>
      <Box
        flexDirection="column"
        height={frameHeight}
        overflow="hidden"
        borderStyle="single"
        borderColor={hiddenAbove || hiddenBelow ? "cyan" : "gray"}
        paddingX={1}
      >
        {viewport.lines.map((line, i) => (
          <TimelineLineView key={`line-${viewport.startLine + i}`} line={line} />
        ))}
      </Box>
      <TimelineScrollHint
        hiddenAbove={hiddenAbove}
        hiddenBelow={hiddenBelow}
        scrollOffset={viewport.scrollOffset}
      />
    </Box>
  );
}

function TimelineLineView(props: {
  line: TimelineDisplayLine;
}): React.ReactElement {
  const { line } = props;
  switch (line.kind) {
    case "user":
      return <Text color="cyan">{line.text}</Text>;
    case "assistant":
      return <Text>{line.text}</Text>;
    case "tool":
      return (
        <Text color={line.important ? toolStatusColor(line.status) : "gray"}>
          {line.text}
        </Text>
      );
    case "status":
      return <StatusLine level={line.level ?? "info"} text={line.text} />;
    case "indicator":
    case "blank":
      return <Text color="gray">{line.text}</Text>;
  }
}

function toolStatusColor(status?: string): string {
  switch (status) {
    case "ok":
      return "green";
    case "failed":
      return "red";
    case "denied":
      return "red";
    case "invalid":
      return "yellow";
    case "approval":
      return "yellow";
    case "running":
      return "cyan";
    default:
      return "gray";
  }
}

function TimelineScrollHint(props: {
  hiddenAbove: boolean;
  hiddenBelow: boolean;
  scrollOffset: number;
}): React.ReactElement {
  const { hiddenAbove, hiddenBelow, scrollOffset } = props;
  if (!hiddenAbove && !hiddenBelow) return <Box height={1} />;

  const parts: string[] = [];
  if (hiddenAbove) parts.push("PageUp for older");
  if (hiddenBelow) parts.push(`${scrollOffset} lines below; PageDown or Esc to bottom`);

  return (
    <Box height={1} paddingLeft={1}>
      <Text color="gray">{parts.join(" | ")}</Text>
    </Box>
  );
}

function StatusLine(props: {
  level: string;
  text: string;
}): React.ReactElement {
  const color = props.level === "error" ? "red" : props.level === "warn" ? "yellow" : "gray";
  return <Text color={color}>{props.text}</Text>;
}

function ApprovalModal(props: {
  state: ApprovalState;
  onResolve: (response: ApprovalResponse) => void;
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="bold" borderColor="yellow" paddingLeft={1}>
      <Text color="yellow">Approval required: {props.state.toolName}</Text>
      <Text>{props.state.reason}</Text>
      {props.state.details.map((d, i) => (
        <Text key={i} color="gray">
          {d}
        </Text>
      ))}
      <Text color="gray">
        [Enter/y] allow once
        {props.state.allowAlways ? " | [a/s] session | [w] workspace |" : " |"}
        {" [n/Esc] abort"}
      </Text>
    </Box>
  );
}

function ComposerFrame(props: {
  value: string;
  cursor: number;
  onChange: (value: string, cursor: number) => void;
  onSubmit: (value: string) => void;
  pasteParts: PastePart[];
  onPastePartsChange: (parts: PastePart[]) => void;
  focus: boolean;
  columns: number;
  maxLines: number;
  visibleLines: number;
  disabled: boolean;
}): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor={props.focus ? "cyan" : "gray"}
      paddingLeft={1}
      paddingRight={1}
      height={props.visibleLines + 2}
      width="100%"
    >
      <PromptInput
        value={props.value}
        cursor={props.cursor}
        onChange={props.onChange}
        onSubmit={props.onSubmit}
        pasteParts={props.pasteParts}
        onPastePartsChange={props.onPastePartsChange}
        focus={props.focus}
        columns={props.columns - 4}
        maxLines={props.maxLines}
        placeholder="Type a message..."
        disabled={props.disabled}
      />
    </Box>
  );
}

function visiblePromptLineCount(value: string, columns: number): number {
  if (!value) return 1;
  const editor = PromptCursor.from(value, Math.max(columns, 10), value.length);
  return editor.getViewport(DEFAULT_MAX_VISIBLE_LINES).lines.length || 1;
}

function StatusBar(props: { phase: TuiPhase; error: string | null }): React.ReactElement {
  return (
    <Box paddingLeft={1} height={1}>
      {props.phase === "running" && <Text color="green">● running</Text>}
      {props.phase === "waiting_approval" && (
        <Text color="yellow">● waiting for approval</Text>
      )}
      {props.phase === "idle" &&
        (props.error ? (
          <Text color="red">✗ {props.error}</Text>
        ) : (
          <Text color="gray">● idle</Text>
        ))}
    </Box>
  );
}
