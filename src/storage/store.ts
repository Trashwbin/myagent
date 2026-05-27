import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Message } from "../model/types.js";
import type { SessionState } from "../session/loop.js";

export type ProjectRow = {
  path: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sessionCount: number;
  lastSessionId?: string;
  lastSessionUpdatedAt?: number;
};

export type SessionRow = {
  id: string;
  projectPath: string;
  workspaceRoot: string;
  modelProfileId?: string;
  provider?: string;
  model?: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
};

export type TranscriptStore = {
  upsertProject(input: { path: string; name?: string }): ProjectRow;
  getProject(path: string): ProjectRow | undefined;
  listProjects(): ProjectRow[];
  deleteProject(path: string): void;
  createSession(input: {
    workspaceRoot: string;
    modelProfileId?: string;
    provider?: string;
    model?: string;
  }): SessionState;
  getSession(id: string): SessionState | undefined;
  appendMessages(sessionId: string, messages: Message[]): void;
  replaceMessages(sessionId: string, messages: Message[]): void;
  listSessions(): SessionRow[];
  updateSessionTimestamp(sessionId: string): void;
  updateSessionModel(
    sessionId: string,
    input: { modelProfileId?: string; provider?: string; model?: string },
  ): void;
  addPermissionRule(input: {
    workspaceRoot: string;
    toolName: string;
    pattern: string;
  }): string;
  listPermissionRules(
    workspaceRoot: string,
  ): Array<{ id: string; toolName: string; pattern: string; createdAt: number }>;
  findMatchingRule(
    workspaceRoot: string,
    toolName: string,
    pattern: string,
  ): { toolName: string; pattern: string } | undefined;
  close(): void;
};

export type StoreOptions = {
  baseDir?: string;
};

type SqliteStatement = {
  run(...args: unknown[]): unknown;
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
};

type SqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
};

const require = createRequire(import.meta.url);

function now(): number {
  return Date.now();
}

function openSqliteDatabase(dbPath: string): SqliteDatabase {
  const BetterSqlite3 = require("better-sqlite3") as {
    new (path: string): SqliteDatabase;
  };
  return new BetterSqlite3(dbPath);
}

function serializeMessage(msg: Message): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: msg.role,
    content: msg.content,
    tool_call_id: msg.toolCallId ?? null,
    tool_name: msg.toolName ?? null,
    tool_calls_json: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
    tool_display_json: msg.toolDisplay ? JSON.stringify(msg.toolDisplay) : null,
    parts_json: msg.parts ? JSON.stringify(msg.parts) : null,
    usage_json: msg.usage ? JSON.stringify(msg.usage) : null,
    provider_metadata_json: msg.providerMetadata
      ? JSON.stringify(msg.providerMetadata)
      : null,
    provider_raw_json: msg.providerRaw ? JSON.stringify(msg.providerRaw) : null,
    checkpoint_id: msg.checkpointId ?? null,
    created_at: now(),
  };
}

function deserializeMessage(row: Record<string, unknown>): Message {
  const msg: Message = {
    role: row.role as Message["role"],
    content: row.content as string,
  };
  if (row.tool_call_id) msg.toolCallId = row.tool_call_id as string;
  if (row.tool_name) msg.toolName = row.tool_name as string;
  if (row.tool_calls_json) msg.toolCalls = JSON.parse(row.tool_calls_json as string);
  if (row.tool_display_json)
    msg.toolDisplay = JSON.parse(row.tool_display_json as string);
  if (row.parts_json) msg.parts = JSON.parse(row.parts_json as string);
  if (row.usage_json) msg.usage = JSON.parse(row.usage_json as string);
  if (row.provider_metadata_json) {
    msg.providerMetadata = JSON.parse(row.provider_metadata_json as string);
  }
  if (row.provider_raw_json)
    msg.providerRaw = JSON.parse(row.provider_raw_json as string);
  if (row.checkpoint_id) msg.checkpointId = row.checkpoint_id as string;
  return msg;
}

function projectName(path: string): string {
  const parts = String(path || "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts[parts.length - 1] || path || "Project";
}

export function openStore(options?: StoreOptions): TranscriptStore {
  const baseDir =
    options?.baseDir ?? process.env.MYAGENT_HOME ?? join(homedir(), ".myagent");
  mkdirSync(baseDir, { recursive: true });
  const dbPath = join(baseDir, "myagent.sqlite");
  const db = openSqliteDatabase(dbPath);

  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`CREATE TABLE IF NOT EXISTS projects (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_root TEXT NOT NULL,
    model_profile_id TEXT,
    provider TEXT,
    model TEXT,
    title TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  try {
    db.exec("ALTER TABLE sessions ADD COLUMN model_profile_id TEXT");
  } catch {
    // Existing databases already have the column.
  }

  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_call_id TEXT,
    tool_name TEXT,
    tool_calls_json TEXT,
    tool_display_json TEXT,
    parts_json TEXT,
    usage_json TEXT,
    provider_metadata_json TEXT,
    provider_raw_json TEXT,
    checkpoint_id TEXT,
    created_at INTEGER NOT NULL
  )`);

  try {
    db.exec("ALTER TABLE messages ADD COLUMN checkpoint_id TEXT");
  } catch {
    // Existing databases already have the column.
  }

  try {
    db.exec("ALTER TABLE messages ADD COLUMN tool_display_json TEXT");
  } catch {
    // Existing databases already have the column.
  }

  try {
    db.exec("ALTER TABLE messages ADD COLUMN provider_raw_json TEXT");
  } catch {
    // Existing databases already have the column.
  }

  try {
    db.exec("ALTER TABLE messages ADD COLUMN parts_json TEXT");
  } catch {
    // Existing databases already have the column.
  }

  try {
    db.exec("ALTER TABLE messages ADD COLUMN usage_json TEXT");
  } catch {
    // Existing databases already have the column.
  }

  try {
    db.exec("ALTER TABLE messages ADD COLUMN provider_metadata_json TEXT");
  } catch {
    // Existing databases already have the column.
  }

  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq)`,
  );

  db.exec(`CREATE TABLE IF NOT EXISTS permission_rules (
    id TEXT PRIMARY KEY,
    workspace_root TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    pattern TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'allow',
    created_at INTEGER NOT NULL
  )`);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_permission_rules_lookup ON permission_rules(workspace_root, tool_name, pattern)`,
  );

  function updateSessionTimestamp(sessionId: string) {
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now(), sessionId);
  }

  function projectRows(): ProjectRow[] {
    const explicitRows = db.prepare("SELECT * FROM projects").all() as Record<
      string,
      unknown
    >[];
    const sessionRows = db
      .prepare(
        `SELECT
          workspace_root,
          COUNT(*) AS session_count,
          MAX(updated_at) AS last_session_updated_at
        FROM sessions
        GROUP BY workspace_root`,
      )
      .all() as Record<string, unknown>[];

    const rows = new Map<string, ProjectRow>();

    for (const row of explicitRows) {
      const path = row.path as string;
      rows.set(path, {
        path,
        name: row.name as string,
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number,
        sessionCount: 0,
      });
    }

    for (const row of sessionRows) {
      const path = row.workspace_root as string;
      const lastSession = db
        .prepare(
          "SELECT id, updated_at FROM sessions WHERE workspace_root = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .get(path) as Record<string, unknown> | undefined;
      const existing = rows.get(path);
      const lastSessionUpdatedAt = row.last_session_updated_at as number;
      rows.set(path, {
        path,
        name: existing?.name ?? projectName(path),
        createdAt: existing?.createdAt ?? lastSessionUpdatedAt,
        updatedAt: Math.max(existing?.updatedAt ?? 0, lastSessionUpdatedAt),
        sessionCount: row.session_count as number,
        lastSessionId: (lastSession?.id as string) ?? undefined,
        lastSessionUpdatedAt,
      });
    }

    return [...rows.values()].sort((a, b) => {
      return b.updatedAt - a.updatedAt || a.name.localeCompare(b.name);
    });
  }

  function getProjectRow(path: string): ProjectRow | undefined {
    return projectRows().find((project) => project.path === path);
  }

  function upsertProject(input: { path: string; name?: string }): ProjectRow {
    const ts = now();
    const requestedName = input.name?.trim() || null;
    const name = requestedName ?? projectName(input.path);
    db.prepare(
      `INSERT INTO projects (path, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         name = COALESCE(?, projects.name),
         updated_at = ?`,
    ).run(input.path, name, ts, ts, requestedName, ts);
    return getProjectRow(input.path)!;
  }

  function updateSessionModel(
    sessionId: string,
    input: { modelProfileId?: string; provider?: string; model?: string },
  ) {
    db.prepare(
      "UPDATE sessions SET model_profile_id = ?, provider = ?, model = ?, updated_at = ? WHERE id = ?",
    ).run(
      input.modelProfileId ?? null,
      input.provider ?? null,
      input.model ?? null,
      now(),
      sessionId,
    );
  }

  function updateTitleFromUserMsg(sessionId: string, messages: Message[]) {
    for (const msg of messages) {
      if (msg.role === "user" && msg.content) {
        db.prepare("UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL").run(
          msg.content.slice(0, 60),
          sessionId,
        );
        break;
      }
    }
  }

  function insertMessages(sessionId: string, messages: Message[], startSeq: number) {
    let seq = startSeq;
    const stmt = db.prepare(
      "INSERT INTO messages (id, session_id, seq, role, content, tool_call_id, tool_name, tool_calls_json, tool_display_json, parts_json, usage_json, provider_metadata_json, provider_raw_json, checkpoint_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );

    for (const msg of messages) {
      seq++;
      const r = serializeMessage(msg);
      stmt.run(
        r.id,
        sessionId,
        seq,
        r.role,
        r.content,
        r.tool_call_id,
        r.tool_name,
        r.tool_calls_json,
        r.tool_display_json,
        r.parts_json,
        r.usage_json,
        r.provider_metadata_json,
        r.provider_raw_json,
        r.checkpoint_id,
        r.created_at,
      );
    }
  }

  return {
    upsertProject,

    getProject(path) {
      return getProjectRow(path);
    },

    listProjects() {
      return projectRows();
    },

    deleteProject(path) {
      db.prepare("DELETE FROM projects WHERE path = ?").run(path);
    },

    createSession(input) {
      const id = randomUUID();
      const ts = now();
      upsertProject({ path: input.workspaceRoot });
      db.prepare(
        "INSERT INTO sessions (id, workspace_root, model_profile_id, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        input.workspaceRoot,
        input.modelProfileId ?? null,
        input.provider ?? null,
        input.model ?? null,
        ts,
        ts,
      );
      return {
        id,
        cwd: input.workspaceRoot,
        modelProfileId: input.modelProfileId,
        provider: input.provider,
        model: input.model,
        messages: [],
      };
    },

    getSession(id) {
      const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      if (!row) return undefined;

      const rows = db
        .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY seq")
        .all(id) as Record<string, unknown>[];

      return {
        id: row.id as string,
        cwd: row.workspace_root as string,
        modelProfileId: (row.model_profile_id as string) ?? undefined,
        provider: (row.provider as string) ?? undefined,
        model: (row.model as string) ?? undefined,
        messages: rows.map(deserializeMessage),
      };
    },

    appendMessages(sessionId, messages) {
      const maxRow = db
        .prepare("SELECT MAX(seq) AS ms FROM messages WHERE session_id = ?")
        .get(sessionId) as Record<string, unknown>;
      const seq = (maxRow?.ms as number | null) ?? 0;

      const insertAll = db.transaction(() => {
        insertMessages(sessionId, messages, seq);
      });

      insertAll();
      updateTitleFromUserMsg(sessionId, messages);
      updateSessionTimestamp(sessionId);
    },

    replaceMessages(sessionId, messages) {
      const replaceAll = db.transaction(() => {
        db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
        insertMessages(sessionId, messages, 0);
      });

      replaceAll();
      updateTitleFromUserMsg(sessionId, messages);
      updateSessionTimestamp(sessionId);
    },

    listSessions() {
      const rows = db
        .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
        .all() as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r.id as string,
        projectPath: r.workspace_root as string,
        workspaceRoot: r.workspace_root as string,
        modelProfileId: (r.model_profile_id as string) ?? undefined,
        provider: (r.provider as string) ?? undefined,
        model: (r.model as string) ?? undefined,
        title: (r.title as string) ?? undefined,
        createdAt: r.created_at as number,
        updatedAt: r.updated_at as number,
      }));
    },

    updateSessionTimestamp,

    updateSessionModel,

    addPermissionRule(input: {
      workspaceRoot: string;
      toolName: string;
      pattern: string;
    }): string {
      const id = randomUUID();
      const createdAt = now();
      const existing = db
        .prepare(
          "SELECT id FROM permission_rules WHERE workspace_root = ? AND tool_name = ? AND pattern = ? AND action = 'allow' LIMIT 1",
        )
        .get(input.workspaceRoot, input.toolName, input.pattern) as
        | { id: string }
        | undefined;
      if (existing) return existing.id;

      db.prepare(
        "INSERT INTO permission_rules (id, workspace_root, tool_name, pattern, action, created_at) VALUES (?, ?, ?, ?, 'allow', ?)",
      ).run(id, input.workspaceRoot, input.toolName, input.pattern, createdAt);
      return id;
    },

    listPermissionRules(workspaceRoot: string) {
      const rows = db
        .prepare(
          "SELECT * FROM permission_rules WHERE workspace_root = ? ORDER BY created_at DESC",
        )
        .all(workspaceRoot) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r.id as string,
        toolName: r.tool_name as string,
        pattern: r.pattern as string,
        createdAt: r.created_at as number,
      }));
    },

    findMatchingRule(workspaceRoot: string, toolName: string, pattern: string) {
      const row = db
        .prepare(
          "SELECT * FROM permission_rules WHERE workspace_root = ? AND tool_name = ? AND pattern = ? AND action = 'allow' LIMIT 1",
        )
        .get(workspaceRoot, toolName, pattern) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        toolName: row.tool_name as string,
        pattern: row.pattern as string,
      };
    },

    close() {
      db.close();
    },
  };
}
