import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Message } from "../../model/types.js";
import type { ApprovalResponse } from "../../permission/approval.js";
import type { ServerMessage } from "../protocol.js";
import { ApprovalDock } from "./components/approval/ApprovalDock.js";
import type { SlashChoice } from "./components/composer/Composer.js";
import { Composer } from "./components/composer/Composer.js";
import { Sidebar } from "./components/layout/Sidebar.js";
import { Topbar } from "./components/layout/Topbar.js";
import { MessageTimeline } from "./components/session/MessageTimeline.js";
import { parseSlashCommand } from "./slash-commands.js";
import { appReducer, initialAppState } from "./state/reducer.js";
import { isNearScrollBottom } from "./timeline-scroll.js";
import type {
  AppState,
  ProviderConfig,
  ProjectSummary,
  SessionSummary,
  TimelineToolPart,
} from "./state/types.js";
import { sessionProjectPath } from "./components/layout/session-list.js";

const ACTIVE_SESSION_KEY = "myagent.activeSession";
const DRAFT_PROJECT_KEY = "myagent.draftProjectPath";
const DRAFT_MODEL_KEY = "myagent.draftModelProfileId";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      data && (data.error || data.message) ? data.error || data.message : "Request failed",
    );
  }
  return data as T;
}

function isActiveRunning(state: AppState) {
  return !!(
    state.activeSessionId &&
    state.runningSessionIds.includes(state.activeSessionId)
  );
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [input, setInput] = useState("");
  const [approvalIndex, setApprovalIndex] = useState(0);
  const [draftProjectPath, setDraftProjectPath] = useState<string | null>(null);
  const [draftModelProfileId, setDraftModelProfileId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const subscribed = useRef(new Set<string>());
  const timelineRef = useRef<HTMLElement | null>(null);
  const shouldFollowTimelineRef = useRef(true);

  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeSessionId) || null,
    [state.sessions, state.activeSessionId],
  );
  const activeTimeline = state.activeSessionId
    ? state.timelines[state.activeSessionId] ?? []
    : [];
  const selectedProjectPath =
    draftProjectPath ||
    (activeSession ? sessionProjectPath(activeSession) : null) ||
    state.projects[0]?.path ||
    null;
  const displayProjectPath = activeSession
    ? sessionProjectPath(activeSession)
    : selectedProjectPath || "";
  const selectedModelId =
    activeSession?.modelProfileId ||
    (activeSession?.provider && activeSession.model
      ? `${activeSession.provider}/${activeSession.model}`
      : null) ||
    draftModelProfileId ||
    state.providerConfig?.current ||
    state.providerConfig?.models[0]?.id ||
    "";
  const selectedModel = state.providerConfig?.models.find((model) => model.id === selectedModelId);
  const modelLabel = selectedModel
    ? `${selectedModel.providerID}/${selectedModel.modelID}`
    : selectedModelId || "model";
  const status = !state.wsOpen
    ? "connecting"
    : isActiveRunning(state)
      ? "running"
      : "connected";
  const slashChoices = useMemo(
    () => buildSlashChoices(state.providerConfig, selectedModelId, activeTimeline),
    [state.providerConfig, selectedModelId, activeTimeline],
  );

  useEffect(() => {
    setApprovalIndex(0);
  }, [state.pendingApproval?.approvalId]);

  useEffect(() => {
    shouldFollowTimelineRef.current = true;
    const timeline = timelineRef.current;
    if (timeline) timeline.scrollTop = timeline.scrollHeight;
  }, [state.activeSessionId]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !shouldFollowTimelineRef.current) return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [activeTimeline]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const updateFollowMode = () => {
      shouldFollowTimelineRef.current = isNearScrollBottom(timeline);
    };
    updateFollowMode();
    timeline.addEventListener("scroll", updateFollowMode, { passive: true });
    return () => timeline.removeEventListener("scroll", updateFollowMode);
  }, [state.activeSessionId]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const config = await fetchJson<ProviderConfig>("/config/providers");
      if (cancelled) return;
      dispatch({ type: "provider_config_loaded", config });

      const [projects, sessions] = await Promise.all([
        fetchJson<ProjectSummary[]>("/project"),
        fetchJson<SessionSummary[]>("/session"),
      ]);
      if (cancelled) return;
      dispatch({
        type: "projects_loaded",
        projects,
      });
      dispatch({ type: "sessions_loaded", sessions });

      const remembered = localStorage.getItem(ACTIVE_SESSION_KEY);
      const rememberedProject = localStorage.getItem(DRAFT_PROJECT_KEY);
      const rememberedModel = localStorage.getItem(DRAFT_MODEL_KEY);
      const fromUrl = new URL(location.href).searchParams.get("session");
      const ids = new Set(sessions.map((session) => session.id));
      const nextSessionId =
        (fromUrl && ids.has(fromUrl) && fromUrl) ||
        (remembered && ids.has(remembered) && remembered) ||
        sessions[0]?.id ||
        null;

      if (nextSessionId) {
        await selectSession(nextSessionId, sessions);
        return;
      }

      if (rememberedProject && projects.some((project) => project.path === rememberedProject)) {
        setDraftProjectPath(rememberedProject);
      }
      if (rememberedModel && config.models.some((model) => model.id === rememberedModel)) {
        setDraftModelProfileId(rememberedModel);
      }
    };

    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        dispatch({ type: "ws_open", open: true });
        if (state.activeSessionId) subscribe(state.activeSessionId);
      };

      socket.onclose = () => {
        dispatch({ type: "ws_open", open: false });
        subscribed.current.clear();
        reconnectTimer.current = window.setTimeout(connect, 1200);
      };

      socket.onerror = () => {
        dispatch({ type: "ws_open", open: false });
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          dispatch({ type: "server_message", message });
          if (message.type === "turn_finished" || message.type === "error") {
            void loadSessions();
          }
        } catch {
          // ignore malformed frames
        }
      };
    };

    void bootstrap();
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!state.wsOpen || !state.activeSessionId) return;
    subscribe(state.activeSessionId);
  }, [state.wsOpen, state.activeSessionId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!state.pendingApproval) return;
      if (event.key === "1") {
        event.preventDefault();
        setApprovalIndex(0);
        return;
      }
      if (event.key === "2") {
        event.preventDefault();
        setApprovalIndex(1);
        return;
      }
      if (event.key === "3") {
        event.preventDefault();
        setApprovalIndex(2);
        return;
      }
      if (event.key === "4") {
        event.preventDefault();
        setApprovalIndex(3);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setApprovalIndex((value) => (value + 1) % 4);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setApprovalIndex((value) => (value + 3) % 4);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void decideApproval(indexToDecision(approvalIndex));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        void decideApproval("abort");
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [state.pendingApproval, approvalIndex]);

  async function loadSessions() {
    const sessions = await fetchJson<SessionSummary[]>("/session");
    dispatch({ type: "sessions_loaded", sessions });
  }

  async function loadProjects() {
    const projects = await fetchJson<ProjectSummary[]>("/project");
    dispatch({
      type: "projects_loaded",
      projects,
    });
  }

  async function loadTimeline(sessionId: string) {
    const messages = await fetchJson<Message[]>(
      `/session/${encodeURIComponent(sessionId)}/message`,
    );
    dispatch({ type: "timeline_loaded", sessionId, messages });
  }

  async function selectSession(
    sessionId: string,
    sessionList: SessionSummary[] = state.sessions,
  ) {
    const session = sessionList.find((item) => item.id === sessionId);
    dispatch({ type: "set_active_session", sessionId });
    if (session) {
      const projectPath = sessionProjectPath(session);
      setDraftProjectPath(null);
      localStorage.setItem(DRAFT_PROJECT_KEY, projectPath);
    }
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    const url = new URL(location.href);
    url.searchParams.set("session", sessionId);
    history.replaceState(null, "", url);

    if (!state.loadedSessionIds.includes(sessionId)) {
      await loadTimeline(sessionId);
    }
    subscribe(sessionId);
  }

  async function createSession(
    projectPath = selectedProjectPath || state.projects[0]?.path,
    modelProfileId = selectedModelId,
  ) {
    const session = await fetchJson<{ id: string; projectPath: string }>("/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(projectPath ? { projectPath } : {}),
        ...(modelProfileId ? { modelProfileId } : {}),
      }),
    });
    await loadProjects();
    const sessions = await fetchJson<SessionSummary[]>("/session");
    dispatch({ type: "sessions_loaded", sessions });
    await selectSession(session.id, sessions);
    return session;
  }

  async function addProject() {
    const result = await fetchJson<ProjectSummary & { canceled?: boolean }>("/project/pick", {
      method: "POST",
    });
    if (result.canceled) return;
    await loadProjects();
    setDraftProjectPath(result.path);
    localStorage.setItem(DRAFT_PROJECT_KEY, result.path);
    dispatch({ type: "set_active_session", sessionId: null });
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    const url = new URL(location.href);
    url.searchParams.delete("session");
    history.replaceState(null, "", url);
  }

  async function selectModel(modelProfileId: string) {
    setDraftModelProfileId(modelProfileId);
    localStorage.setItem(DRAFT_MODEL_KEY, modelProfileId);

    if (!state.activeSessionId) return;
    const result = await fetchJson<{
      modelProfileId: string;
      provider: string;
      model: string;
    }>(`/session/${encodeURIComponent(state.activeSessionId)}/model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelProfileId }),
    });
    const sessions = state.sessions.map((session) =>
      session.id === state.activeSessionId
        ? {
            ...session,
            modelProfileId: result.modelProfileId,
            provider: result.provider,
            model: result.model,
          }
        : session,
    );
    dispatch({ type: "sessions_loaded", sessions });
  }

  async function rewindToCheckpoint(checkpointId: string) {
    if (!state.activeSessionId || !wsRef.current || isActiveRunning(state)) return;
    const sessionId = state.activeSessionId;
    dispatch({
      type: "status_local",
      sessionId,
      level: "info",
      text: `Restoring checkpoint ${checkpointId}...`,
    });
    dispatch({ type: "session_running", sessionId, running: true });
    wsRef.current.send(
      JSON.stringify({
        type: "rewind_session",
        sessionId,
        checkpointId,
      }),
    );
    setInput("");
  }

  async function handleSlashChoice(choice: SlashChoice) {
    if (choice.type === "model") {
      await selectModel(choice.id);
      setInput("");
      return;
    }
    await rewindToCheckpoint(choice.id);
  }

  function subscribe(sessionId: string) {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (subscribed.current.has(sessionId)) return;
    subscribed.current.add(sessionId);
    socket.send(JSON.stringify({ type: "subscribe_session", sessionId }));
  }

  async function decideApproval(decision: ApprovalResponse) {
    if (!state.pendingApproval || !wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({
        type: "approval_decision",
        approvalId: state.pendingApproval.approvalId,
        decision,
      }),
    );
    dispatch({ type: "approval_cleared" });
  }

  async function sendMessage() {
    const text = input.trim();
    let sessionId = state.activeSessionId;
    if (!text || !wsRef.current || isActiveRunning(state)) return;

    if (!sessionId) {
      const session = await createSession();
      sessionId = session.id;
    }
    const activeSessionId = sessionId;

    const slashCommand = parseSlashCommand(text);
    if (slashCommand.type !== "none") {
      if (slashCommand.type !== "valid") {
        dispatch({
          type: "status_local",
          sessionId: activeSessionId,
          level: "warning",
          text: slashCommand.message,
        });
        return;
      }

      const { command, args } = slashCommand;
      if (command.picker) {
        return;
      }
      dispatch({
        type: "status_local",
        sessionId: activeSessionId,
        level: "info",
        text: command.pendingMessage(args),
      });
      dispatch({ type: "session_running", sessionId: activeSessionId, running: true });

      if (command.id === "rewind") {
        wsRef.current.send(
          JSON.stringify({
            type: "rewind_session",
            sessionId: activeSessionId,
            checkpointId: args,
          }),
        );
      } else if (command.id === "revert-last") {
        wsRef.current.send(
          JSON.stringify({
            type: "revert_last",
            sessionId: activeSessionId,
          }),
        );
      } else if (command.id === "compact") {
        wsRef.current.send(
          JSON.stringify({
            type: "compact_session",
            sessionId: activeSessionId,
          }),
        );
      } else if (command.id === "model") {
        wsRef.current.send(
          JSON.stringify({
            type: "user_message",
            sessionId: activeSessionId,
            text,
          }),
        );
      }

      setInput("");
      return;
    }

    dispatch({
      type: "user_message_local",
      sessionId: activeSessionId,
      turnId: `local:${Date.now()}`,
      text,
    });
    dispatch({ type: "session_running", sessionId: activeSessionId, running: true });

    wsRef.current.send(
      JSON.stringify({
        type: "user_message",
        sessionId: activeSessionId,
        text,
      }),
    );
    setInput("");
  }

  async function copySessionId() {
    if (!state.activeSessionId) return;
    await navigator.clipboard.writeText(state.activeSessionId).catch(() => {});
  }

  return (
    <div className="app">
      <Sidebar
        projects={state.projects}
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        selectedProjectPath={selectedProjectPath}
        onSelect={(sessionId) => {
          void selectSession(sessionId);
        }}
        onSelectProject={(projectPath) => {
          setDraftProjectPath(projectPath);
          localStorage.setItem(DRAFT_PROJECT_KEY, projectPath);
        }}
        onNewSession={() => {
          const projectPath =
            draftProjectPath ||
            (activeSession ? sessionProjectPath(activeSession) : selectedProjectPath);
          if (projectPath) {
            setDraftProjectPath(projectPath);
            localStorage.setItem(DRAFT_PROJECT_KEY, projectPath);
          }
          dispatch({ type: "set_active_session", sessionId: null });
          localStorage.removeItem(ACTIVE_SESSION_KEY);
          const url = new URL(location.href);
          url.searchParams.delete("session");
          history.replaceState(null, "", url);
        }}
        onAddProject={() => {
          void addProject();
        }}
      />

      <main className="main">
        <Topbar
          sessionTitle={activeSession?.title || "No session"}
          sessionId={state.activeSessionId}
          projectPath={displayProjectPath}
          modelLabel={modelLabel}
          status={status}
          onCopySession={() => {
            void copySessionId();
          }}
        />

        <MessageTimeline turns={activeTimeline} timelineRef={timelineRef} />

        <div className="main-dock">
          {state.pendingApproval &&
          state.pendingApproval.sessionId === state.activeSessionId ? (
            <ApprovalDock
              request={state.pendingApproval.request}
              selectedIndex={approvalIndex}
              onSelect={setApprovalIndex}
              onSubmit={() => {
                void decideApproval(indexToDecision(approvalIndex));
              }}
            />
          ) : null}

          <Composer
            value={input}
            disabled={isActiveRunning(state)}
            onChange={setInput}
            onSend={() => {
              void sendMessage();
            }}
            providerConfig={state.providerConfig}
            selectedModelId={selectedModelId}
            onSelectModel={(modelProfileId) => {
              void selectModel(modelProfileId);
            }}
            slashChoices={slashChoices}
            onSlashChoice={(choice) => {
              void handleSlashChoice(choice);
            }}
            onCommandError={(message) => {
              if (!state.activeSessionId) return;
              dispatch({
                type: "status_local",
                sessionId: state.activeSessionId,
                level: "warning",
                text: message,
              });
            }}
          />
        </div>
      </main>
    </div>
  );
}

function buildSlashChoices(
  providerConfig: ProviderConfig | null,
  selectedModelId: string,
  timeline: AppState["timelines"][string],
): SlashChoice[] {
  return [
    ...modelChoices(providerConfig, selectedModelId),
    ...checkpointChoices(timeline),
  ];
}

function modelChoices(
  providerConfig: ProviderConfig | null,
  selectedModelId: string,
): SlashChoice[] {
  if (!providerConfig) return [];
  return providerConfig.models.map((model) => ({
    type: "model" as const,
    id: model.id,
    label: model.model || model.modelID || model.id,
    description: `${model.providerID || model.provider}${model.name ? ` · ${model.name}` : ""}`,
    active: model.id === selectedModelId,
  }));
}

function checkpointChoices(timeline: AppState["timelines"][string]): SlashChoice[] {
  const choices: SlashChoice[] = [];
  const seen = new Set<string>();
  for (const turn of [...timeline].reverse()) {
    for (const part of [...turn.assistantParts].reverse()) {
      if (part.kind !== "tool" || !part.checkpointId || seen.has(part.checkpointId)) {
        continue;
      }
      seen.add(part.checkpointId);
      choices.push({
        type: "checkpoint",
        id: part.checkpointId,
        label: checkpointLabel(part),
        description: checkpointDescription(part),
      });
    }
  }
  return choices;
}

function checkpointLabel(part: TimelineToolPart): string {
  return part.subtitle || part.title || part.toolName || part.checkpointId || "checkpoint";
}

function checkpointDescription(part: TimelineToolPart): string {
  const summary = part.summary ? ` · ${part.summary}` : "";
  return `${part.title}${summary}`;
}

function indexToDecision(index: number): ApprovalResponse {
  if (index === 1) return "allow_for_session";
  if (index === 2) return "allow_for_workspace";
  if (index === 3) return "abort";
  return "allow_once";
}
