import type { SessionSummary } from "../../state/types.js";

export const CURRENT_WORKSPACE_VISIBLE = 12;
export const OTHER_WORKSPACE_VISIBLE = 6;
export type SessionScope = "current" | "all";

export type SessionGroup = {
  path: string;
  name: string;
  sessions: SessionSummary[];
};

export function workspaceName(path: string) {
  const parts = String(path || "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts[parts.length - 1] || path || "Workspace";
}

export function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const path = session.workspaceRoot;
    const group = groups.get(path) ?? {
      path,
      name: workspaceName(path),
      sessions: [],
    };
    group.sessions.push(session);
    groups.set(path, group);
  }
  return Array.from(groups.values());
}

export function relativeAge(value: number) {
  const delta = Math.max(0, Date.now() - Number(value));
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (delta < minute) return "now";
  if (delta < hour) return `${Math.floor(delta / minute)}m`;
  if (delta < day) return `${Math.floor(delta / hour)}h`;
  if (delta < week) return `${Math.floor(delta / day)}d`;
  return `${Math.floor(delta / week)}w`;
}

export function shortSessionId(id: string) {
  return id.slice(0, 8);
}

export function sessionTitle(session: SessionSummary) {
  return session.title || "New session";
}

export function sessionMeta(session: SessionSummary) {
  const age = relativeAge(session.updatedAt);
  if (!session.title || session.title === "New session") {
    return `${shortSessionId(session.id)} · ${age}`;
  }
  return age;
}

export function visibleSessions(
  group: SessionGroup,
  activeSessionId: string | null,
  limit: number,
  expanded: boolean,
) {
  if (expanded) {
    return {
      sessions: group.sessions,
      hiddenCount: 0,
    };
  }

  let count = Math.min(group.sessions.length, limit);
  const activeIndex = group.sessions.findIndex((session) => session.id === activeSessionId);
  if (activeIndex >= count) count = activeIndex + 1;

  return {
    sessions: group.sessions.slice(0, count),
    hiddenCount: Math.max(0, group.sessions.length - count),
  };
}

export function filterSessions(
  sessions: SessionSummary[],
  currentWorkspace: string,
  scope: SessionScope,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  return sessions.filter((session) => {
    if (scope === "current" && session.workspaceRoot !== currentWorkspace) return false;
    if (!needle) return true;
    const title = sessionTitle(session).toLowerCase();
    return title.includes(needle);
  });
}
