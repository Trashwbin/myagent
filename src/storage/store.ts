import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Message } from "../model/types.js";
import type { SessionState } from "../session/loop.js";

export type SessionRow = {
  id: string;
  workspaceRoot: string;
  provider?: string;
  model?: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
};

export type TranscriptStore = {
  createSession(input: {
    workspaceRoot: string;
    provider?: string;
    model?: string;
  }): SessionState;
  getSession(id: string): SessionState | undefined;
  appendMessages(sessionId: string, messages: Message[]): void;
  replaceMessages(sessionId: string, messages: Message[]): void;
  listSessions(): SessionRow[];
  updateSessionTimestamp(sessionId: string): void;
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
  if (row.tool_display_json) msg.toolDisplay = JSON.parse(row.tool_display_json as string);
  if (row.provider_raw_json) msg.providerRaw = JSON.parse(row.provider_raw_json as string);
  if (row.checkpoint_id) msg.checkpointId = row.checkpoint_id as string;
  return msg;
}

export function openStore(options?: StoreOptions): TranscriptStore {
  const baseDir =
    options?.baseDir ?? process.env.MYAGENT_HOME ?? join(homedir(), ".myagent");
  mkdirSync(baseDir, { recursive: true });
  const dbPath = join(baseDir, "myagent.sqlite");
  const db = openSqliteDatabase(dbPath);

  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_root TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    title TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

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
      "INSERT INTO messages (id, session_id, seq, role, content, tool_call_id, tool_name, tool_calls_json, tool_display_json, provider_raw_json, checkpoint_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        r.provider_raw_json,
        r.checkpoint_id,
        r.created_at,
      );
    }
  }

  return {
    createSession(input) {
      const id = randomUUID();
      const ts = now();
      db.prepare(
        "INSERT INTO sessions (id, workspace_root, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, input.workspaceRoot, input.provider ?? null, input.model ?? null, ts, ts);
      return { id, cwd: input.workspaceRoot, messages: [] };
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
        workspaceRoot: r.workspace_root as string,
        provider: (r.provider as string) ?? undefined,
        model: (r.model as string) ?? undefined,
        title: (r.title as string) ?? undefined,
        createdAt: r.created_at as number,
        updatedAt: r.updated_at as number,
      }));
    },

    updateSessionTimestamp,

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
