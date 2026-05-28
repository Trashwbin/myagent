import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
  Message,
  MessageLifecycleStatus,
  MessagePart,
  MessagePhase,
  ProviderMetadata,
} from "../model/types.js";
import type { ToolDisplay } from "../session/tool-display.js";
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
  startMessage(
    sessionId: string,
    input: {
      role: Message["role"];
      content?: string;
      status?: MessageLifecycleStatus;
    },
  ): string;
  finishMessage(messageId: string, message: Message): void;
  failMessage(messageId: string, input: { message: Message; error: string }): void;
  startMessagePart(input: {
    sessionId: string;
    messageId: string;
    type: MessagePart["type"];
    phase?: MessagePhase;
    status?: MessageLifecycleStatus;
    text?: string;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    display?: unknown;
    metadata?: ProviderMetadata;
  }): string;
  appendMessagePartDelta(partId: string, delta: string): void;
  finishMessagePart(
    partId: string,
    input?: {
      status?: MessageLifecycleStatus;
      phase?: MessagePhase;
      text?: string;
      output?: unknown;
      display?: unknown;
      metadata?: ProviderMetadata;
    },
  ): void;
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
    status: msg.status ?? "completed",
    error_json: msg.error ? JSON.stringify({ message: msg.error }) : null,
    tool_call_id: msg.toolCallId ?? null,
    tool_name: msg.toolName ?? null,
    tool_calls_json: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
    tool_display_json: msg.toolDisplay ? JSON.stringify(msg.toolDisplay) : null,
    // parts_json is kept only for legacy reads; new writes use message_parts.
    parts_json: null,
    usage_json: msg.usage ? JSON.stringify(msg.usage) : null,
    provider_metadata_json: msg.providerMetadata
      ? JSON.stringify(msg.providerMetadata)
      : null,
    provider_raw_json: msg.providerRaw ? JSON.stringify(msg.providerRaw) : null,
    checkpoint_id: msg.checkpointId ?? null,
    created_at: now(),
    completed_at: msg.status && msg.status !== "completed" ? null : now(),
  };
}

function deserializeMessage(
  row: Record<string, unknown>,
  hydratedParts?: MessagePart[],
): Message {
  const msg: Message = {
    role: row.role as Message["role"],
    content: row.content as string,
  };
  const status = row.status as MessageLifecycleStatus | null | undefined;
  if (status && status !== "completed") msg.status = status;
  if (row.error_json) {
    const parsed = JSON.parse(row.error_json as string) as { message?: unknown };
    if (typeof parsed.message === "string") msg.error = parsed.message;
  }
  if (row.tool_call_id) msg.toolCallId = row.tool_call_id as string;
  if (row.tool_name) msg.toolName = row.tool_name as string;
  if (row.tool_calls_json) msg.toolCalls = JSON.parse(row.tool_calls_json as string);
  if (row.tool_display_json)
    msg.toolDisplay = JSON.parse(row.tool_display_json as string);
  if (hydratedParts?.length) {
    msg.parts = hydratedParts;
  } else if (row.parts_json) {
    msg.parts = JSON.parse(row.parts_json as string);
  }
  if (!msg.toolCalls?.length && msg.parts?.length) {
    const toolCalls = msg.parts
      .filter(
        (part): part is Extract<MessagePart, { type: "tool-call" }> =>
          part.type === "tool-call",
      )
      .map((part) => ({
        id: part.id,
        name: part.name,
        input: part.input,
        display: part.display,
        providerMetadata: part.providerMetadata,
      }));
    if (toolCalls.length) msg.toolCalls = toolCalls;
  }
  if (row.usage_json) msg.usage = JSON.parse(row.usage_json as string);
  if (row.provider_metadata_json) {
    msg.providerMetadata = JSON.parse(row.provider_metadata_json as string);
  }
  if (row.provider_raw_json)
    msg.providerRaw = JSON.parse(row.provider_raw_json as string);
  if (row.checkpoint_id) msg.checkpointId = row.checkpoint_id as string;
  return msg;
}

function parseJson(value: unknown): unknown {
  if (!value) return undefined;
  return JSON.parse(value as string);
}

function stringifyJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function stripCompletedStatus<T extends MessagePart>(part: T): T {
  if (part.status !== "completed") return part;
  const { status: _status, ...rest } = part;
  return rest as T;
}

function deserializePart(row: Record<string, unknown>): MessagePart {
  const type = row.type as MessagePart["type"];
  const base = {
    status: row.status as MessageLifecycleStatus | undefined,
    providerMetadata: parseJson(row.metadata_json) as ProviderMetadata | undefined,
  };
  const text = (row.text as string | null) ?? "";
  const display = parseJson(row.display_json) as ToolDisplay | undefined;
  if (type === "text") {
    return stripCompletedStatus({
      type,
      text,
      phase: (row.phase as MessagePhase | null) ?? undefined,
      ...base,
    });
  }
  if (type === "reasoning") {
    return stripCompletedStatus({
      type,
      text,
      phase: (row.phase as MessagePhase | null) ?? undefined,
      ...base,
    });
  }
  if (type === "tool-call") {
    return stripCompletedStatus({
      type,
      id: (row.tool_call_id as string | null) ?? row.id as string,
      name: (row.tool_name as string | null) ?? "tool",
      input: parseJson(row.input_json),
      display,
      ...base,
    });
  }
  if (type === "tool-result") {
    const output = parseJson(row.output);
    return stripCompletedStatus({
      type,
      id: (row.tool_call_id as string | null) ?? row.id as string,
      name: (row.tool_name as string | null) ?? "tool",
      result: output ?? text,
      display,
      ...base,
    });
  }
  return stripCompletedStatus({
    type: "compaction",
    summary: text,
    ...((parseJson(row.metadata_json) as Record<string, unknown> | undefined) ?? {}),
    status: row.status as MessageLifecycleStatus | undefined,
  });
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
    parent_id TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT,
    tool_call_id TEXT,
    tool_name TEXT,
    tool_calls_json TEXT,
    tool_display_json TEXT,
    parts_json TEXT,
    usage_json TEXT,
    provider_metadata_json TEXT,
    provider_raw_json TEXT,
    checkpoint_id TEXT,
    error_json TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`);

  for (const statement of [
    "ALTER TABLE messages ADD COLUMN parent_id TEXT",
    "ALTER TABLE messages ADD COLUMN status TEXT",
    "ALTER TABLE messages ADD COLUMN error_json TEXT",
    "ALTER TABLE messages ADD COLUMN completed_at INTEGER",
  ]) {
    try {
      db.exec(statement);
    } catch {
      // Existing databases already have the column.
    }
  }

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

  db.exec(`CREATE TABLE IF NOT EXISTS message_parts (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    phase TEXT,
    status TEXT,
    text TEXT,
    tool_call_id TEXT,
    tool_name TEXT,
    input_json TEXT,
    output TEXT,
    display_json TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_message_parts_message_seq ON message_parts(message_id, seq)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_message_parts_session_seq ON message_parts(session_id, message_id, seq)`,
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
      "INSERT INTO messages (id, session_id, seq, role, content, status, tool_call_id, tool_name, tool_calls_json, tool_display_json, parts_json, usage_json, provider_metadata_json, provider_raw_json, checkpoint_id, error_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        r.status,
        r.tool_call_id,
        r.tool_name,
        r.tool_calls_json,
        r.tool_display_json,
        r.parts_json,
        r.usage_json,
        r.provider_metadata_json,
        r.provider_raw_json,
        r.checkpoint_id,
        r.error_json,
        r.created_at,
        r.completed_at,
      );
      insertMessageParts(sessionId, r.id as string, msg.parts ?? [], 0);
    }
  }

  function insertMessageParts(
    sessionId: string,
    messageId: string,
    parts: MessagePart[],
    startSeq: number,
  ) {
    if (parts.length === 0) return;
    let seq = startSeq;
    const stmt = db.prepare(
      `INSERT INTO message_parts
       (id, message_id, session_id, seq, type, phase, status, text, tool_call_id, tool_name, input_json, output, display_json, metadata_json, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ts = now();
    for (const part of parts) {
      seq++;
      const id = randomUUID();
      const status = part.status ?? "completed";
      stmt.run(
        id,
        messageId,
        sessionId,
        seq,
        part.type,
        "phase" in part ? part.phase ?? null : null,
        status,
        "text" in part
          ? part.text
          : part.type === "compaction"
            ? part.summary
            : null,
        "id" in part ? part.id : null,
        "name" in part ? part.name : null,
        "input" in part ? stringifyJson(part.input) : null,
        "result" in part ? stringifyJson(part.result) : null,
        "display" in part ? stringifyJson(part.display) : null,
        stringifyJson(
          part.type === "compaction"
            ? {
                compactedCount: part.compactedCount,
                retainedCount: part.retainedCount,
                previousSummaryUsed: part.previousSummaryUsed,
                transcriptTruncated: part.transcriptTruncated,
                beforeTokens: part.beforeTokens,
                afterTokens: part.afterTokens,
                createdAt: part.createdAt,
                providerMetadata: part.providerMetadata,
              }
            : part.providerMetadata,
        ),
        ts,
        status === "completed" ? ts : null,
      );
    }
  }

  function nextMessageSeq(sessionId: string): number {
    const maxRow = db
      .prepare("SELECT MAX(seq) AS ms FROM messages WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown>;
    return ((maxRow?.ms as number | null) ?? 0) + 1;
  }

  function nextPartSeq(messageId: string): number {
    const maxRow = db
      .prepare("SELECT MAX(seq) AS ms FROM message_parts WHERE message_id = ?")
      .get(messageId) as Record<string, unknown>;
    return ((maxRow?.ms as number | null) ?? 0) + 1;
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
      const partRows = db
        .prepare("SELECT * FROM message_parts WHERE session_id = ? ORDER BY message_id, seq")
        .all(id) as Record<string, unknown>[];
      const partsByMessage = new Map<string, MessagePart[]>();
      for (const partRow of partRows) {
        const messageId = partRow.message_id as string;
        const parts = partsByMessage.get(messageId) ?? [];
        parts.push(deserializePart(partRow));
        partsByMessage.set(messageId, parts);
      }

      return {
        id: row.id as string,
        cwd: row.workspace_root as string,
        modelProfileId: (row.model_profile_id as string) ?? undefined,
        provider: (row.provider as string) ?? undefined,
        model: (row.model as string) ?? undefined,
        messages: rows.map((messageRow) =>
          deserializeMessage(messageRow, partsByMessage.get(messageRow.id as string)),
        ),
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
        db.prepare("DELETE FROM message_parts WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
        insertMessages(sessionId, messages, 0);
      });

      replaceAll();
      updateTitleFromUserMsg(sessionId, messages);
      updateSessionTimestamp(sessionId);
    },

    startMessage(sessionId, input) {
      const id = randomUUID();
      const ts = now();
      const seq = nextMessageSeq(sessionId);
      db.prepare(
        `INSERT INTO messages
         (id, session_id, seq, role, content, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        sessionId,
        seq,
        input.role,
        input.content ?? "",
        input.status ?? "running",
        ts,
        input.status === "completed" ? ts : null,
      );
      if (input.role === "user" && input.content) {
        updateTitleFromUserMsg(sessionId, [{ role: "user", content: input.content }]);
      }
      updateSessionTimestamp(sessionId);
      return id;
    },

    finishMessage(messageId, message) {
      const ts = now();
      db.prepare(
        `UPDATE messages SET
           role = ?,
           content = ?,
           status = ?,
           tool_call_id = ?,
           tool_name = ?,
           tool_calls_json = ?,
           tool_display_json = ?,
           usage_json = ?,
           provider_metadata_json = ?,
           provider_raw_json = ?,
           checkpoint_id = ?,
           error_json = ?,
           completed_at = ?
         WHERE id = ?`,
      ).run(
        message.role,
        message.content,
        message.status ?? "completed",
        message.toolCallId ?? null,
        message.toolName ?? null,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.toolDisplay ? JSON.stringify(message.toolDisplay) : null,
        message.usage ? JSON.stringify(message.usage) : null,
        message.providerMetadata ? JSON.stringify(message.providerMetadata) : null,
        message.providerRaw ? JSON.stringify(message.providerRaw) : null,
        message.checkpointId ?? null,
        message.error ? JSON.stringify({ message: message.error }) : null,
        ts,
        messageId,
      );
      const row = db
        .prepare("SELECT session_id FROM messages WHERE id = ?")
        .get(messageId) as Record<string, unknown> | undefined;
      if (row) updateSessionTimestamp(row.session_id as string);
    },

    failMessage(messageId, input) {
      const ts = now();
      const message = input.message;
      db.prepare(
        `UPDATE messages SET
           role = ?,
           content = ?,
           status = 'failed',
           tool_call_id = ?,
           tool_name = ?,
           tool_calls_json = ?,
           tool_display_json = ?,
           usage_json = ?,
           provider_metadata_json = ?,
           provider_raw_json = ?,
           checkpoint_id = ?,
           error_json = ?,
           completed_at = ?
         WHERE id = ?`,
      ).run(
        message.role,
        message.content,
        message.toolCallId ?? null,
        message.toolName ?? null,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.toolDisplay ? JSON.stringify(message.toolDisplay) : null,
        message.usage ? JSON.stringify(message.usage) : null,
        message.providerMetadata ? JSON.stringify(message.providerMetadata) : null,
        message.providerRaw ? JSON.stringify(message.providerRaw) : null,
        message.checkpointId ?? null,
        JSON.stringify({ message: input.error }),
        ts,
        messageId,
      );
      db.prepare(
        `UPDATE message_parts
         SET status = 'interrupted',
             completed_at = COALESCE(completed_at, ?)
         WHERE message_id = ?`,
      ).run(ts, messageId);
      const row = db
        .prepare("SELECT session_id FROM messages WHERE id = ?")
        .get(messageId) as Record<string, unknown> | undefined;
      if (row) updateSessionTimestamp(row.session_id as string);
    },

    startMessagePart(input) {
      const id = randomUUID();
      const ts = now();
      const seq = nextPartSeq(input.messageId);
      const status = input.status ?? "running";
      db.prepare(
        `INSERT INTO message_parts
         (id, message_id, session_id, seq, type, phase, status, text, tool_call_id, tool_name, input_json, output, display_json, metadata_json, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.messageId,
        input.sessionId,
        seq,
        input.type,
        input.phase ?? null,
        status,
        input.text ?? null,
        input.toolCallId ?? null,
        input.toolName ?? null,
        stringifyJson(input.input),
        stringifyJson(input.output),
        stringifyJson(input.display),
        stringifyJson(input.metadata),
        ts,
        status === "completed" ? ts : null,
      );
      if (input.type === "text" && input.text) {
        db.prepare("UPDATE messages SET content = content || ? WHERE id = ?").run(
          input.text,
          input.messageId,
        );
      }
      updateSessionTimestamp(input.sessionId);
      return id;
    },

    appendMessagePartDelta(partId, delta) {
      db.prepare("UPDATE message_parts SET text = COALESCE(text, '') || ? WHERE id = ?")
        .run(delta, partId);
      const row = db
        .prepare(
          "SELECT message_id, session_id, type FROM message_parts WHERE id = ? LIMIT 1",
        )
        .get(partId) as Record<string, unknown> | undefined;
      if (!row) return;
      if (row.type === "text") {
        db.prepare("UPDATE messages SET content = content || ? WHERE id = ?").run(
          delta,
          row.message_id as string,
        );
      }
      updateSessionTimestamp(row.session_id as string);
    },

    finishMessagePart(partId, input) {
      const ts = now();
      const sets = [
        "status = ?",
        "completed_at = ?",
        input?.phase !== undefined ? "phase = ?" : undefined,
        input?.text !== undefined ? "text = ?" : undefined,
        input?.output !== undefined ? "output = ?" : undefined,
        input?.display !== undefined ? "display_json = ?" : undefined,
        input?.metadata !== undefined ? "metadata_json = ?" : undefined,
      ].filter((value): value is string => typeof value === "string");
      const params: unknown[] = [input?.status ?? "completed", ts];
      if (input?.phase !== undefined) params.push(input.phase);
      if (input?.text !== undefined) params.push(input.text);
      if (input?.output !== undefined) params.push(stringifyJson(input.output));
      if (input?.display !== undefined) params.push(stringifyJson(input.display));
      if (input?.metadata !== undefined) params.push(stringifyJson(input.metadata));
      params.push(partId);
      db.prepare(`UPDATE message_parts SET ${sets.join(", ")} WHERE id = ?`).run(
        ...params,
      );
      const row = db
        .prepare("SELECT session_id FROM message_parts WHERE id = ? LIMIT 1")
        .get(partId) as Record<string, unknown> | undefined;
      if (row) updateSessionTimestamp(row.session_id as string);
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
