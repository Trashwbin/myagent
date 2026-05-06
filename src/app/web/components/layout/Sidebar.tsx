import React, { useState } from "react";
import type { SessionSummary } from "../../state/types.js";
import {
  CURRENT_WORKSPACE_VISIBLE,
  OTHER_WORKSPACE_VISIBLE,
  filterSessions,
  groupSessions,
  SessionScope,
  sessionMeta,
  sessionTitle,
  visibleSessions,
} from "./session-list.js";

export function Sidebar({
  sessions,
  activeSessionId,
  currentWorkspace,
  onSelect,
  onNewSession,
}: {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  currentWorkspace: string;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
}) {
  const [scope, setScope] = useState<SessionScope>("current");
  const [query, setQuery] = useState("");
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
  const filtered = filterSessions(sessions, currentWorkspace, scope, query);
  const groups = groupSessions(filtered);
  const current = groups.find((group) => group.path === currentWorkspace) ?? groups[0];
  const others = groups.filter((group) => group !== current);

  const toggleWorkspace = (path: string) => {
    setExpandedWorkspaces((value) => ({
      ...value,
      [path]: !value[path],
    }));
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div>
          <div className="brand-title">myAgent</div>
          <div className="brand-subtitle">Local coding workspace</div>
        </div>
        <button className="primary" onClick={onNewSession}>
          New
        </button>
      </div>
      <div className="session-list" aria-label="Sessions">
        <div className="session-controls">
          <div className="session-scope" role="tablist" aria-label="Session scope">
            <button
              className={`scope-pill${scope === "current" ? " active" : ""}`}
              onClick={() => setScope("current")}
            >
              Current
            </button>
            <button
              className={`scope-pill${scope === "all" ? " active" : ""}`}
              onClick={() => setScope("all")}
            >
              All
            </button>
          </div>
          <input
            className="session-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="empty-list">No sessions yet</div>
        ) : (
          <>
            {current ? (
              <>
                <div className="section-heading">Current workspace</div>
                <div className="workspace-stack">
                  <div className="workspace-row current" title={current.path}>
                    <span className="workspace-icon" aria-hidden="true" />
                    <span className="workspace-name">{current.name}</span>
                    <span className="workspace-count">{current.sessions.length}</span>
                  </div>
                  <div className="session-sublist">
                    {visibleSessions(
                      current,
                      activeSessionId,
                      CURRENT_WORKSPACE_VISIBLE,
                      !!expandedWorkspaces[current.path],
                    ).sessions.map((session) => (
                      <button
                        key={session.id}
                        className={`session-item nested${session.id === activeSessionId ? " active" : ""}`}
                        title={session.id}
                        onClick={() => onSelect(session.id)}
                      >
                        <div className="session-title">{sessionTitle(session)}</div>
                        <div className="session-meta">{sessionMeta(session)}</div>
                      </button>
                    ))}
                  </div>
                  {visibleSessions(
                    current,
                    activeSessionId,
                    CURRENT_WORKSPACE_VISIBLE,
                    !!expandedWorkspaces[current.path],
                  ).hiddenCount > 0 ? (
                    <button
                      className="session-more"
                      onClick={() => toggleWorkspace(current.path)}
                    >
                      Show{" "}
                      {visibleSessions(
                        current,
                        activeSessionId,
                        CURRENT_WORKSPACE_VISIBLE,
                        !!expandedWorkspaces[current.path],
                      ).hiddenCount}{" "}
                      more
                    </button>
                  ) : current.sessions.length > CURRENT_WORKSPACE_VISIBLE ? (
                    <button className="session-more" onClick={() => toggleWorkspace(current.path)}>
                      Show less
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
            {others.length > 0 ? (
              <>
                <div className="section-heading">Other workspaces</div>
                {others.map((group) => (
                  <React.Fragment key={group.path}>
                    <div className="workspace-stack">
                      <button
                        className={`workspace-row workspace-toggle${expandedWorkspaces[group.path] ? " expanded" : ""}`}
                        title={group.path}
                        onClick={() => toggleWorkspace(group.path)}
                      >
                        <span className="workspace-chevron" aria-hidden="true">
                          {expandedWorkspaces[group.path] ? "▾" : "▸"}
                        </span>
                        <span className="workspace-icon" aria-hidden="true" />
                        <span className="workspace-name">{group.name}</span>
                        <span className="workspace-count">{group.sessions.length}</span>
                      </button>
                      {expandedWorkspaces[group.path] ? (
                        <div className="session-sublist">
                          {visibleSessions(
                            group,
                            activeSessionId,
                            OTHER_WORKSPACE_VISIBLE,
                            !!expandedWorkspaces[group.path],
                          ).sessions.map((session) => (
                            <button
                              key={session.id}
                              className={`session-item nested${session.id === activeSessionId ? " active" : ""}`}
                              title={session.id}
                              onClick={() => onSelect(session.id)}
                            >
                              <div className="session-title">{sessionTitle(session)}</div>
                              <div className="session-meta">{sessionMeta(session)}</div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </React.Fragment>
                ))}
              </>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
