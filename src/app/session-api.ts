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
  private maxTurns: number | undefined;
  private sendEvent: (sessionId: string, msg: ServerMessage) => void;

  constructor(deps: {
    provider: Provider;
    registry: ToolRegistry;
    approval: ApprovalMode;
    store: TranscriptStore;
    maxTurns?: number;
    sendEvent: (sessionId: string, msg: ServerMessage) => void;
  }) {
    this.provider = deps.provider;
    this.registry = deps.registry;
    this.approval = deps.approval;
    this.store = deps.store;
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
          active.session,
          text,
          {
            approval: this.approval,
            maxTurns: this.maxTurns,
            approvalHandler,
            onEvent,
            sessionApprovalRules: active.approvalRules,
            store: this.store,
            readState: active.readState,
          },
        );
        Object.assign(active.session, updated);
        this.store.appendMessages(active.session.id, newMessages);
      } catch {
        this.sendEvent(sessionId, {
          type: "error",
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
}
