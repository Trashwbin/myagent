import type { ApprovalResponse, ApprovalRule } from "../permission/approval.js";
import type { ApprovalMode } from "../permission/policy.js";
import type { Provider } from "../model/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { TranscriptStore } from "../storage/store.js";
import type { SessionState, ApprovalRequest, TurnEvent } from "../session/loop.js";
import { runTurn } from "../session/loop.js";
import { ReadStateTracker } from "../tools/file-mutation.js";
import type { ServerMessage } from "./protocol.js";
import { randomUUID } from "node:crypto";
import type { Message } from "../model/types.js";
import type { SkillSummary } from "../skill/types.js";
import { revertLast, rewindSession } from "../session/revert.js";

type PendingApproval = {
  id: string;
  sessionId: string;
  resolve: (response: ApprovalResponse) => void;
};

type ActiveSession = {
  session: SessionState;
  activeTurn: Promise<void> | null;
  pendingApprovals: Map<string, PendingApproval>;
  approvalRules: ApprovalRule[];
  readState: ReadStateTracker;
};

export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private provider: Provider;
  private registry: ToolRegistry;
  private approval: ApprovalMode;
  private store: TranscriptStore;
  private availableSkills: SkillSummary[] | undefined;
  private maxTurns: number | undefined;
  private sendEvent: (sessionId: string, msg: ServerMessage) => void;

  constructor(deps: {
    provider: Provider;
    registry: ToolRegistry;
    approval: ApprovalMode;
    store: TranscriptStore;
    availableSkills?: SkillSummary[];
    maxTurns?: number;
    sendEvent: (sessionId: string, msg: ServerMessage) => void;
  }) {
    this.provider = deps.provider;
    this.registry = deps.registry;
    this.approval = deps.approval;
    this.store = deps.store;
    this.availableSkills = deps.availableSkills;
    this.maxTurns = deps.maxTurns;
    this.sendEvent = deps.sendEvent;
  }

  registerSession(session: SessionState): void {
    this.sessions.set(session.id, {
      session,
      activeTurn: null,
      pendingApprovals: new Map(),
      approvalRules: [],
      readState: new ReadStateTracker(),
    });
  }

  ensureSession(id: string): ActiveSession | undefined {
    const existing = this.sessions.get(id);
    if (existing) return existing;

    const restored = this.store.getSession(id);
    if (!restored) return undefined;
    this.registerSession(restored);
    return this.sessions.get(id);
  }

  getSession(id: string): ActiveSession | undefined {
    return this.ensureSession(id);
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.ensureSession(sessionId)?.activeTurn !== null;
  }

  resolveApproval(approvalId: string, decision: ApprovalResponse): boolean {
    for (const [, active] of this.sessions) {
      const pending = active.pendingApprovals.get(approvalId);
      if (pending) {
        pending.resolve(decision);
        active.pendingApprovals.delete(approvalId);
        return true;
      }
    }
    return false;
  }

  handleUserMessage(sessionId: string, text: string): { ok: boolean; error?: string } {
    const active = this.ensureSession(sessionId);
    if (!active) return { ok: false, error: "Session not found" };
    if (active.activeTurn) return { ok: false, error: "Turn already active for this session" };

    const persistedUserMessage: Message = { role: "user", content: text };
    const sessionForRun: SessionState = {
      ...active.session,
      messages: [...active.session.messages],
    };
    this.store.appendMessages(sessionId, [persistedUserMessage]);
    active.session.messages.push(persistedUserMessage);

    const approvalHandler = (request: ApprovalRequest): Promise<ApprovalResponse> => {
      return new Promise((resolve) => {
        const id = randomUUID();
        active.pendingApprovals.set(id, { id, sessionId, resolve });
        this.sendEvent(sessionId, {
          type: "approval_required",
          sessionId,
          approvalId: id,
          request,
        });
      });
    };

    const onEvent = (event: TurnEvent) => {
      this.sendEvent(sessionId, {
        type: "turn_event",
        sessionId,
        event,
      });
    };

    active.activeTurn = (async () => {
      try {
        const { session: updated, newMessages } = await runTurn(
          this.provider,
          this.registry,
          sessionForRun,
          text,
          {
            approval: this.approval,
            maxTurns: this.maxTurns,
            approvalHandler,
            onEvent,
            sessionApprovalRules: active.approvalRules,
            store: this.store,
            readState: active.readState,
            availableSkills: this.availableSkills,
          },
        );
        Object.assign(active.session, updated);
        const followupMessages = newMessages.slice(1);
        if (followupMessages.length > 0) {
          this.store.appendMessages(active.session.id, followupMessages);
        }
      } catch {
        this.sendEvent(sessionId, {
          type: "error",
          sessionId,
          message: "Turn failed",
          code: "TURN_ERROR",
        });
      } finally {
        active.activeTurn = null;
        this.sendEvent(sessionId, { type: "turn_finished", sessionId });
      }
    })();

    return { ok: true };
  }

  async rewindSession(
    sessionId: string,
    checkpointId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const active = this.ensureSession(sessionId);
    if (!active) return { ok: false, error: "Session not found" };
    if (active.activeTurn) return { ok: false, error: "Turn already active for this session" };

    const result = await rewindSession(active.session, checkpointId);
    const message = formatRewindMessage("rewind", result);
    const msg: Message = { role: "assistant", content: message };
    active.session.messages.push(msg);
    this.store.appendMessages(sessionId, [msg]);
    this.sendEvent(sessionId, {
      type: "session_rewound",
      sessionId,
      checkpointId: result.checkpointId,
      files: result.files,
      message,
    });
    return { ok: true };
  }

  async revertLast(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const active = this.ensureSession(sessionId);
    if (!active) return { ok: false, error: "Session not found" };
    if (active.activeTurn) return { ok: false, error: "Turn already active for this session" };

    const result = await revertLast(active.session);
    const message = formatRewindMessage("revert-last", result);
    const msg: Message = { role: "assistant", content: message };
    active.session.messages.push(msg);
    this.store.appendMessages(sessionId, [msg]);
    this.sendEvent(sessionId, {
      type: "session_rewound",
      sessionId,
      checkpointId: result.checkpointId,
      files: result.files,
      message,
    });
    return { ok: true };
  }
}

function formatRewindMessage(
  action: "rewind" | "revert-last",
  result: { checkpointId: string; files: Array<{ path: string; existed: boolean }> },
): string {
  const files = result.files
    .map((file) => `${file.existed ? "restored" : "deleted"} ${file.path}`)
    .join(", ");
  return `${action} restored checkpoint ${result.checkpointId}${files ? ` (${files})` : ""}`;
}
