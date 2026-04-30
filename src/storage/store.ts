import BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
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
  listSessions(): SessionRow[];
  updateSessionTimestamp(sessionId: string): void;
  close(): void;
};

function now(): number {
  return Date.now();
}

function serializeMessage(msg: Message): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: msg.role,
    content: msg.content,
    tool_call_id: msg.toolCallId ?? null,
    tool_name: msg.toolName ?? null,
    tool_calls_json: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
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
  return msg;
}

export function openStore(workspaceRoot: string): TranscriptStore {
  const dir = join(resolve(workspaceRoot), ".myagent");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "myagent.sqlite");
  const db = new BetterSqlite3(dbPath);

  db.pragma("journal_mode = WAL");

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
    created_at INTEGER NOT NULL
  )`);

  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq)`,
  );

  function updateSessionTimestamp(sessionId: string) {
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now(), sessionId);
  }

  return {
    createSession(input) {
      const id = randomUUID();
      const ts = now();
      const root = resolve(input.workspaceRoot);
      db.prepare(
        "INSERT INTO sessions (id, workspace_root, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, root, input.provider ?? null, input.model ?? null, ts, ts);
      return { id, cwd: root, messages: [] };
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
      let seq = (maxRow?.ms as number | null) ?? 0;

      const stmt = db.prepare(
        "INSERT INTO messages (id, session_id, seq, role, content, tool_call_id, tool_name, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );

      const insertAll = db.transaction(() => {
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
            r.created_at,
          );
        }
      });

      insertAll();
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

    close() {
      db.close();
    },
  };
}
