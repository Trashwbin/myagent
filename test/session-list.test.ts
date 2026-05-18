import { describe, expect, it } from "vitest";
import {
  CURRENT_WORKSPACE_VISIBLE,
  filterSessions,
  groupSessions,
  sessionMeta,
  SessionScope,
  sessionTitle,
  shortSessionId,
  visibleSessions,
} from "../src/app/web/components/layout/session-list.js";

describe("session list helpers", () => {
  it("groups sessions by workspace in input order", () => {
    const groups = groupSessions([
      { id: "a", workspaceRoot: "/tmp/a", createdAt: 1, updatedAt: 3 },
      { id: "b", workspaceRoot: "/tmp/b", createdAt: 1, updatedAt: 2 },
      { id: "c", workspaceRoot: "/tmp/a", createdAt: 1, updatedAt: 1 },
    ]);

    expect(groups.map((group) => group.path)).toEqual(["/tmp/a", "/tmp/b"]);
    expect(groups[0]?.sessions.map((session) => session.id)).toEqual(["a", "c"]);
  });

  it("does not expose session id in untitled session meta", () => {
    const session = {
      id: "12345678-abcd",
      workspaceRoot: "/tmp/a",
      createdAt: 0,
      updatedAt: Date.now() - 2 * 60 * 60 * 1000,
    };

    expect(shortSessionId(session.id)).toBe("12345678");
    expect(sessionTitle(session)).toBe("New session");
    expect(sessionMeta(session)).toBe("2h");
  });

  it("keeps active session visible when beyond the default cap", () => {
    const group = {
      path: "/tmp/a",
      name: "a",
      sessions: Array.from({ length: CURRENT_WORKSPACE_VISIBLE + 3 }, (_, index) => ({
        id: `s-${index}`,
        workspaceRoot: "/tmp/a",
        title: `Session ${index}`,
        createdAt: index,
        updatedAt: index,
      })),
    };

    const result = visibleSessions(group, "s-14", CURRENT_WORKSPACE_VISIBLE, false);

    expect(result.sessions.at(-1)?.id).toBe("s-14");
    expect(result.sessions).toHaveLength(CURRENT_WORKSPACE_VISIBLE);
    expect(result.hiddenCount).toBe(3);
  });

  it("shows all sessions only when explicitly requested", () => {
    const group = {
      path: "/tmp/a",
      name: "a",
      sessions: Array.from({ length: CURRENT_WORKSPACE_VISIBLE + 3 }, (_, index) => ({
        id: `s-${index}`,
        workspaceRoot: "/tmp/a",
        title: `Session ${index}`,
        createdAt: index,
        updatedAt: index,
      })),
    };

    const result = visibleSessions(group, null, CURRENT_WORKSPACE_VISIBLE, true);

    expect(result.sessions).toHaveLength(CURRENT_WORKSPACE_VISIBLE + 3);
    expect(result.hiddenCount).toBe(0);
  });

  it("filters by scope and title query", () => {
    const sessions = [
      { id: "a", workspaceRoot: "/tmp/a", title: "Alpha", createdAt: 1, updatedAt: 1 },
      { id: "b", workspaceRoot: "/tmp/a", title: "Beta", createdAt: 1, updatedAt: 1 },
      { id: "c", workspaceRoot: "/tmp/b", title: "Alpha other", createdAt: 1, updatedAt: 1 },
    ];

    expect(filterSessions(sessions, "/tmp/a", "current" satisfies SessionScope, "alpha")).toEqual([
      sessions[0],
    ]);
    expect(filterSessions(sessions, "/tmp/a", "all" satisfies SessionScope, "alpha")).toEqual([
      sessions[0],
      sessions[2],
    ]);
  });
});
