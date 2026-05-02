import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { ApprovalResponse } from "../permission/approval.js";
import type { ApprovalMode } from "../permission/policy.js";
import type { Provider } from "../model/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { TranscriptStore } from "../storage/store.js";
import type { SessionState, ApprovalRequest, TurnEvent } from "../session/loop.js";
import { runTurn } from "../session/loop.js";
import { ProviderRuntimeError, formatProviderError } from "../model/errors.js";
import { ReadStateTracker } from "../tools/file-mutation.js";
import { eventToRows } from "./mapping.js";
import type { TranscriptRow, TuiPhase, ApprovalState, PastePart } from "./types.js";
import { expandPromptText } from "./prompt-input/paste.js";
import { PromptInput } from "./prompt-input/PromptInput.js";

type AppProps = {
  session: SessionState;
  provider: Provider;
  providerName: string;
  modelName: string;
  registry: ToolRegistry;
  approval: ApprovalMode;
  store: TranscriptStore;
  maxTurns?: number;
  onExit: () => void;
};

export function TuiApp(props: AppProps): React.ReactElement {
  const [rows, setRows] = useState<TranscriptRow[]>([]);
  const [phase, setPhase] = useState<TuiPhase>("idle");
  const [streamingText, setStreamingText] = useState("");
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [inputCursor, setInputCursor] = useState(0);
  const [pasteParts, setPasteParts] = useState<PastePart[]>([]);

  const sensitiveSetRef = useRef(new Set<string>());
  const sessionApprovalRulesRef = useRef<import("../permission/approval.js").ApprovalRule[]>([]);
  const readStateRef = useRef(new ReadStateTracker());

  const handleEvent = useCallback((event: TurnEvent) => {
    if (event.type === "tool_approval_required" && event.metadata?.sensitive) {
      sensitiveSetRef.current.add(event.id);
    }
    const sensitive =
      event.type === "tool_started" && sensitiveSetRef.current.has(event.id);
    const newRows = eventToRows(event, { sensitive });
    if (event.type === "assistant_text_delta") {
      setStreamingText((prev) => prev + event.text);
    } else if (event.type === "assistant_message") {
      setRows((prev) => {
        const text =
          typeof event.message.content === "string" ? event.message.content : "";
        if (!text) return prev;
        return [...prev, { type: "assistant", text }];
      });
      setStreamingText("");
    }
    if (event.type === "tool_approval_required") {
      setPhase("waiting_approval");
    } else if (event.type === "turn_finished") {
      setPhase("idle");
    }
    if (newRows.length > 0) {
      setRows((prev) => [...prev, ...newRows]);
    }
  }, []);

  const handleSubmit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const expanded = expandPromptText({ input: text, parts: pasteParts });
      setRows((prev) => [...prev, { type: "user", text }]);
      setPhase("running");
      setStreamingText("");
      setError(null);
      setInputValue("");
      setInputCursor(0);
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
          const { session: updated, newMessages, aborted } = await runTurn(
            props.provider,
            props.registry,
            props.session,
            expanded,
            {
              approval: props.approval,
              maxTurns: props.maxTurns,
              approvalHandler,
              onEvent: handleEvent,
              sessionApprovalRules: sessionApprovalRulesRef.current,
              store: props.store,
              readState: readStateRef.current,
            },
          );
          Object.assign(props.session, updated);
          props.store.appendMessages(props.session.id, newMessages);
          if (aborted) {
            setRows((prev) => [
              ...prev,
              { type: "status", kind: "aborted", text: "Turn aborted." },
            ]);
          }
        } catch (err) {
          if (err instanceof ProviderRuntimeError) {
            const msg = formatProviderError(err);
            setRows((prev) => [
              ...prev,
              { type: "status", kind: "error", text: msg },
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

  return (
    <Box flexDirection="column" width="100%">
      <HeaderBar
        providerName={props.providerName}
        modelName={props.modelName}
        approval={props.approval}
        cwd={props.session.cwd}
        sessionId={props.session.id}
      />
      <TranscriptPane rows={rows} streamingText={streamingText} />
      {approval && (
        <ApprovalModal
          state={approval}
          onResolve={resolveApproval}
        />
      )}
      <PromptInput
        value={inputValue}
        cursor={inputCursor}
        onChange={(v, c) => {
          setInputValue(v);
          setInputCursor(c);
        }}
        onSubmit={handleSubmit}
        pasteParts={pasteParts}
        onPastePartsChange={setPasteParts}
        focus={phase === "idle" && !approval}
        columns={80}
        placeholder="Type a message..."
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
    <Box flexDirection="row" gap={1} paddingLeft={1}>
      <Text color="cyan">
        {props.providerName}/{props.modelName}
      </Text>
      <Text color="gray">| approval:{props.approval}</Text>
      <Text color="gray">| {props.cwd}</Text>
      <Text color="gray">| session:{props.sessionId.slice(0, 8)}</Text>
    </Box>
  );
}

function TranscriptPane(props: {
  rows: TranscriptRow[];
  streamingText: string;
}): React.ReactElement {
  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      {props.rows.map((row, i) => (
        <TranscriptRowView key={i} row={row} />
      ))}
      {props.streamingText.length > 0 && <Text>{props.streamingText}</Text>}
    </Box>
  );
}

function TranscriptRowView(props: {
  row: TranscriptRow;
}): React.ReactElement {
  const { row } = props;
  switch (row.type) {
    case "user":
      return (
        <Text>
          <Text color="cyan">{"> "}</Text>
          {row.text}
        </Text>
      );
    case "assistant":
      return <Text>{row.text}</Text>;
    case "tool_started":
      return (
        <Text color="gray">
          [tool:{row.tool}] {row.summary}
        </Text>
      );
    case "tool_result":
      return (
        <Text color="gray">
          [{row.tool}] {row.content.slice(0, 500)}
        </Text>
      );
    case "approval":
      return (
        <Box flexDirection="column">
          <Text color="yellow">
            [approval] {row.tool}: {row.reason}
          </Text>
          {row.details.map((d, i) => (
            <Text key={i} color="gray">
              {"  "}
              {d}
            </Text>
          ))}
        </Box>
      );
    case "approval_decision":
      return (
        <Text color={row.decision === "allow" ? "green" : "red"}>
          [{row.tool}] {row.decision}
        </Text>
      );
    case "status":
      return (
        <Text color={row.kind === "error" ? "red" : "yellow"}>{row.text}</Text>
      );
  }
}

function ApprovalModal(props: {
  state: ApprovalState;
  onResolve: (response: ApprovalResponse) => void;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="bold"
      borderColor="yellow"
      paddingLeft={1}
    >
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

function StatusBar(props: {
  phase: TuiPhase;
  error: string | null;
}): React.ReactElement {
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
