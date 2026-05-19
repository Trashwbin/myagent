import React, { useMemo, useRef, useState } from "react";
import type { ProjectSummary, SessionSummary } from "../../state/types.js";
import {
  CURRENT_WORKSPACE_VISIBLE,
  sessionMeta,
  sessionProjectPath,
  sessionTitle,
  visibleSessions,
  workspaceName,
} from "./session-list.js";
import { Icon } from "../icons/Icon.js";

export function Sidebar({
  projects,
  sessions,
  activeSessionId,
  selectedProjectPath,
  onSelect,
  onSelectProject,
  onNewSession,
  onAddProject,
}: {
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  activeSessionId: string | null;
  selectedProjectPath: string | null;
  onSelect: (sessionId: string) => void;
  onSelectProject: (projectPath: string) => void;
  onNewSession: () => void;
  onAddProject: () => void;
}) {
  const [query, setQuery] = useState("");
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
  const [expandedSessionLists, setExpandedSessionLists] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement | null>(null);
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
        return b.updatedAt - a.updatedAt || a.name.localeCompare(b.name);
      });
  }, [projects, query, sessions]);

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button className="sidebar-action" onClick={onNewSession}>
          <Icon name="plus-square" className="sidebar-icon" />
          <span>New chat</span>
        </button>
        <button className="sidebar-action" type="button" onClick={onAddProject}>
          <Icon name="folder-plus" className="sidebar-icon" />
          <span>New project</span>
        </button>
        <button className="sidebar-action" type="button" onClick={() => searchRef.current?.focus()}>
          <Icon name="search" className="sidebar-icon" />
          <span>Search</span>
        </button>
      </div>
      <div className="session-list" aria-label="Sessions">
        <div className="session-controls">
          <input
            ref={searchRef}
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
              const selected = group.path === selectedProjectPath;
              const hasExplicitExpandedState = Object.prototype.hasOwnProperty.call(
                expandedWorkspaces,
                group.path,
              );
              const expanded =
                !!query.trim() ||
                (hasExplicitExpandedState ? !!expandedWorkspaces[group.path] : selected);
              const showAllSessions = !!query.trim() || !!expandedSessionLists[group.path];
              const visible = visibleSessions(
                group,
                activeSessionId,
                CURRENT_WORKSPACE_VISIBLE,
                showAllSessions,
              );
              return (
                <React.Fragment key={group.path}>
                  <div className="workspace-stack">
                    <button
                      className={`workspace-row workspace-toggle${expanded ? " expanded" : ""}${selected ? " selected" : ""}`}
                      title={group.path}
                      onClick={() => {
                        onSelectProject(group.path);
                        setExpandedWorkspaces((value) => ({
                          ...value,
                          [group.path]: hasExplicitExpandedState ? !value[group.path] : !selected,
                        }));
                      }}
                    >
                      <Icon
                        name={expanded ? "chevron-down" : "chevron-right"}
                        className="workspace-chevron"
                      />
                      <Icon
                        name={expanded ? "folder-open" : "folder"}
                        className="workspace-icon"
                      />
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
                                title={sessionTitle(session)}
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
                            onClick={() =>
                              setExpandedSessionLists((value) => ({
                                ...value,
                                [group.path]: true,
                              }))
                            }
                          >
                            Show {visible.hiddenCount} more
                          </button>
                        ) : expanded &&
                          group.sessions.length > CURRENT_WORKSPACE_VISIBLE &&
                          !query.trim() &&
                          showAllSessions ? (
                          <button
                            className="session-more"
                            onClick={() =>
                              setExpandedSessionLists((value) => ({
                                ...value,
                                [group.path]: false,
                              }))
                            }
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
