import React, { useMemo, useState } from "react";
import type { ProjectSummary, SessionSummary } from "../../state/types.js";
import {
  CURRENT_WORKSPACE_VISIBLE,
  sessionMeta,
  sessionProjectPath,
  sessionTitle,
  visibleSessions,
  workspaceName,
} from "./session-list.js";

export function Sidebar({
  projects,
  sessions,
  activeSessionId,
  currentProject,
  onSelect,
  onSelectProject,
  onNewSession,
}: {
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  activeSessionId: string | null;
  currentProject: ProjectSummary | null;
  onSelect: (sessionId: string) => void;
  onSelectProject: (projectPath: string) => void;
  onNewSession: () => void;
}) {
  const [query, setQuery] = useState("");
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const projectPaths = new Set(projects.map((project) => project.path));
    const implicitProjects = sessions
      .filter((session) => !projectPaths.has(sessionProjectPath(session)))
      .map((session) => ({
        path: sessionProjectPath(session),
        name: workspaceName(sessionProjectPath(session)),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        sessionCount: 0,
      }));
    const allProjects = [...projects, ...implicitProjects];
    const needle = query.trim().toLowerCase();

    return allProjects
      .map((project) => {
        const projectSessions = sessions.filter(
          (session) => sessionProjectPath(session) === project.path,
        );
        const matchingSessions = needle
          ? projectSessions.filter((session) =>
              sessionTitle(session).toLowerCase().includes(needle),
            )
          : projectSessions;
        const matchesProject =
          !needle ||
          project.name.toLowerCase().includes(needle) ||
          project.path.toLowerCase().includes(needle);

        if (!matchesProject && matchingSessions.length === 0) return null;

        return {
          path: project.path,
          name: project.name,
          sessions: matchesProject ? projectSessions : matchingSessions,
          sessionCount: project.sessionCount || projectSessions.length,
          updatedAt: project.updatedAt,
        };
      })
      .filter((group): group is NonNullable<typeof group> => group !== null)
      .sort((a, b) => {
        if (a.path === currentProject?.path) return -1;
        if (b.path === currentProject?.path) return 1;
        return b.updatedAt - a.updatedAt || a.name.localeCompare(b.name);
      });
  }, [currentProject?.path, projects, query, sessions]);

  const toggleWorkspace = (path: string) => {
    setExpandedWorkspaces((value) => ({
      ...value,
      [path]: !value[path],
    }));
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button className="sidebar-action" onClick={onNewSession}>
          <span className="action-icon">+</span>
          <span>New chat</span>
        </button>
      </div>
      <div className="session-list" aria-label="Sessions">
        <div className="session-controls">
          <input
            className="session-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects or sessions"
            aria-label="Search sessions"
          />
        </div>
        {groups.length === 0 ? (
          <div className="empty-list">No projects yet</div>
        ) : (
          <>
            <div className="section-heading">Projects</div>
            {groups.map((group) => {
              const active = group.path === currentProject?.path;
              const expanded = active || !!expandedWorkspaces[group.path] || !!query.trim();
              const visible = visibleSessions(
                group,
                activeSessionId,
                CURRENT_WORKSPACE_VISIBLE,
                expanded,
              );
              return (
                <React.Fragment key={group.path}>
                  <div className="workspace-stack">
                    <button
                      className={`workspace-row workspace-toggle${expanded ? " expanded" : ""}${active ? " current" : ""}`}
                      title={group.path}
                      onClick={() => {
                        onSelectProject(group.path);
                        toggleWorkspace(group.path);
                      }}
                    >
                      <span className="workspace-chevron" aria-hidden="true">
                        {expanded ? "▾" : "▸"}
                      </span>
                      <span className="workspace-icon" aria-hidden="true" />
                      <span className="workspace-name">{group.name}</span>
                      <span className="workspace-count">{group.sessionCount}</span>
                    </button>
                    {expanded ? (
                      <>
                        {visible.sessions.length > 0 ? (
                          <div className="session-sublist">
                            {visible.sessions.map((session) => (
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
                        ) : (
                          <div className="empty-list nested">No sessions</div>
                        )}
                        {visible.hiddenCount > 0 ? (
                          <button
                            className="session-more"
                            onClick={() => toggleWorkspace(group.path)}
                          >
                            Show {visible.hiddenCount} more
                          </button>
                        ) : expanded &&
                          group.sessions.length > CURRENT_WORKSPACE_VISIBLE &&
                          !query.trim() ? (
                          <button
                            className="session-more"
                            onClick={() => toggleWorkspace(group.path)}
                          >
                            Show less
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
