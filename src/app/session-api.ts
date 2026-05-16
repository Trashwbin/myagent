import type { ApprovalResponse, ApprovalRule } from "../permission/approval.js";
import type { ApprovalMode } from "../permission/policy.js";
import type { Provider } from "../model/provider.js";
import { formatProviderError, ProviderRuntimeError } from "../model/errors.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { TranscriptStore } from "../storage/store.js";
import type { SessionState, ApprovalRequest, TurnEvent } from "../session/loop.js";
import { runTurn } from "../session/loop.js";
import { ReadStateTracker } from "../tools/file-mutation.js";
import type { ServerMessage } from "./protocol.js";
import { randomUUID } from "node:crypto";
import type { Message } from "../model/types.js";
import type { SkillSummary } from "../skill/types.js";
import { compactSession } from "../session/compact.js";
import {
  formatRewindMessage,
  revertLast,
  rewindSession,
} from "../session/revert.js";
import type { ModelProfile } from "../config/config.js";
import { findModelProfile } from "../config/config.js";
import {
  formatModelList,
  formatModelSwitch,
  formatUnknownModel,
} from "../session/model-switch.js";

type PendingApproval = {
  id: string;
  sessionId: string;
  resolve: (response: ApprovalResponse) => void;
};

type ActiveSession = {
  session: SessionState;
  provider: Provider;
  modelProfiles: ModelProfile[];
  createProvider: (profile: ModelProfile) => Provider;
  registry: ToolRegistry;
  approval: ApprovalMode;
  availableSkills: SkillSummary[] | undefined;
  activeTurn: Promise<void> | null;
  pendingApprovals: Map<string, PendingApproval>;
  approvalRules: ApprovalRule[];
  readState: ReadStateTracker;
};

export type SessionRuntime = {
  provider: Provider;
  modelProfiles: ModelProfile[];
  createProvider: (profile: ModelProfile) => Provider;
  registry: ToolRegistry;
  approval: ApprovalMode;
  availableSkills?: SkillSummary[];
  modelProfileId?: string;
  providerName?: string;
  modelName?: string;
};

export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private defaultProvider: Provider;
  private modelProfiles: ModelProfile[];
  private createProvider: (profile: ModelProfile) => Provider;
  private registry: ToolRegistry;
  private approval: ApprovalMode;
  private store: TranscriptStore;
  private availableSkills: SkillSummary[] | undefined;
  private resolveRuntime:
    | ((session: SessionState) => SessionRuntime | Promise<SessionRuntime>)
    | undefined;
  private sendEvent: (sessionId: string, msg: ServerMessage) => void;

  constructor(deps: {
    provider: Provider;
    modelProfiles?: ModelProfile[];
    createProvider?: (profile: ModelProfile) => Provider;
    registry: ToolRegistry;
    approval: ApprovalMode;
    store: TranscriptStore;
    availableSkills?: SkillSummary[];
    resolveRuntime?: (session: SessionState) => SessionRuntime | Promise<SessionRuntime>;
    sendEvent: (sessionId: string, msg: ServerMessage) => void;
  }) {
    this.defaultProvider = deps.provider;
    this.modelProfiles = deps.modelProfiles ?? [];
    this.createProvider = deps.createProvider ?? (() => deps.provider);
    this.registry = deps.registry;
    this.approval = deps.approval;
    this.store = deps.store;
    this.availableSkills = deps.availableSkills;
    this.resolveRuntime = deps.resolveRuntime;
    this.sendEvent = deps.sendEvent;
  }

  registerSession(session: SessionState): void {
    const runtime = this.defaultRuntime();
    const profile = this.resolveSessionProfile(session, runtime.modelProfiles);
    this.sessions.set(session.id, {
      session,
      provider: profile ? runtime.createProvider(profile) : runtime.provider,
      modelProfiles: runtime.modelProfiles,
      createProvider: runtime.createProvider,
      registry: runtime.registry,
      approval: runtime.approval,
      availableSkills: runtime.availableSkills,
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

    const isModelCommand = isModelSwitchCommand(text);
    const persistedUserMessage: Message = { role: "user", content: text };
    const sessionForRun: SessionState | null = isModelCommand
      ? null
      : {
          ...active.session,
          messages: [...active.session.messages],
        };
    if (!isModelCommand) {
      this.store.appendMessages(sessionId, [persistedUserMessage]);
      active.session.messages.push(persistedUserMessage);
    }

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
        await this.refreshRuntime(active);

        const modelCommand = await this.handleModelCommand(active, text);
        if (modelCommand) return;

        const { session: updated, newMessages } = await runTurn(
          active.provider,
          active.registry,
          sessionForRun!,
          text,
          {
            approval: active.approval,
            approvalHandler,
            onEvent,
            sessionApprovalRules: active.approvalRules,
            store: this.store,
            readState: active.readState,
            availableSkills: active.availableSkills,
          },
        );
        Object.assign(active.session, updated);
        const followupMessages = newMessages.slice(1);
        if (followupMessages.length > 0) {
          this.store.appendMessages(active.session.id, followupMessages);
        }
      } catch (err) {
        const message = formatTurnError(err);
        this.sendEvent(sessionId, {
          type: "error",
          sessionId,
          message,
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

  async compactSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const active = this.ensureSession(sessionId);
    if (!active) return { ok: false, error: "Session not found" };
    if (active.activeTurn) return { ok: false, error: "Turn already active for this session" };

    await this.refreshRuntime(active);
    const result = await compactSession(active.provider, active.session);
    active.session.messages = result.messages;
    this.store.replaceMessages(sessionId, result.messages);
    const message = formatCompactMessage(result);
    this.sendEvent(sessionId, {
      type: "session_compacted",
      sessionId,
      compactedCount: result.compactedCount,
      retainedCount: result.retainedCount,
      message,
    });
    return { ok: true };
  }

  private handleModelCommand(
    active: ActiveSession,
    text: string,
  ): { ok: boolean; error?: string } | undefined {
    const trimmed = text.trim();
    if (trimmed !== "/model" && !trimmed.startsWith("/model ")) return undefined;

    if (active.modelProfiles.length === 0) {
      const message = "No model profiles configured.";
      this.sendEvent(active.session.id, {
        type: "error",
        sessionId: active.session.id,
        message,
        code: "MODEL_NOT_CONFIGURED",
      });
      return { ok: true };
    }

    const requestedId = trimmed.slice("/model".length).trim();
    if (!requestedId) {
      const message = formatModelList(active.modelProfiles, active.session.modelProfileId);
      this.appendAssistantStatus(active, message);
      this.sendEvent(active.session.id, {
        type: "turn_event",
        sessionId: active.session.id,
        event: { type: "assistant_message", message: { role: "assistant", content: message } },
      });
      return { ok: true };
    }

    const profile = findModelProfile(active.modelProfiles, requestedId);
    if (!profile) {
      const message = formatUnknownModel(requestedId, active.modelProfiles);
      this.appendAssistantStatus(active, message);
      this.sendEvent(active.session.id, {
        type: "turn_event",
        sessionId: active.session.id,
        event: { type: "assistant_message", message: { role: "assistant", content: message } },
      });
      return { ok: true };
    }

    active.provider = active.createProvider(profile);
    Object.assign(active.session, {
      modelProfileId: profile.id,
      provider: profile.provider,
      model: profile.model,
    });
    this.store.updateSessionModel(active.session.id, {
      modelProfileId: profile.id,
      provider: profile.provider,
      model: profile.model,
    });

    const message = formatModelSwitch(profile);
    this.appendAssistantStatus(active, message);
    this.sendEvent(active.session.id, {
      type: "session_model_changed",
      sessionId: active.session.id,
      modelProfileId: profile.id,
      provider: profile.provider,
      model: profile.model,
      message,
    });
    return { ok: true };
  }

  private appendAssistantStatus(active: ActiveSession, content: string): void {
    const message: Message = { role: "assistant", content };
    active.session.messages.push(message);
    this.store.appendMessages(active.session.id, [message]);
  }

  private defaultRuntime(): SessionRuntime {
    return {
      provider: this.defaultProvider,
      modelProfiles: this.modelProfiles,
      createProvider: this.createProvider,
      registry: this.registry,
      approval: this.approval,
      availableSkills: this.availableSkills,
    };
  }

  private async refreshRuntime(active: ActiveSession): Promise<void> {
    if (!this.resolveRuntime) return;
    const runtime = await this.resolveRuntime(active.session);
    const profile = this.resolveSessionProfile(active.session, runtime.modelProfiles);
    active.modelProfiles = runtime.modelProfiles;
    active.createProvider = runtime.createProvider;
    active.registry = runtime.registry;
    active.approval = runtime.approval;
    active.availableSkills = runtime.availableSkills;
    active.provider = profile ? runtime.createProvider(profile) : runtime.provider;
  }

  private resolveSessionProfile(
    session: SessionState,
    modelProfiles: ModelProfile[],
  ): ModelProfile | undefined {
    return (
      findModelProfile(modelProfiles, session.modelProfileId) ??
      findModelProfile(
        modelProfiles,
        session.provider && session.model ? `${session.provider}/${session.model}` : undefined,
      ) ??
      modelProfiles[0]
    );
  }
}

function formatTurnError(err: unknown): string {
  if (err instanceof ProviderRuntimeError) return formatProviderError(err);
  if (err instanceof Error && err.message.trim()) return `Turn failed: ${err.message}`;
  return "Turn failed";
}

function formatCompactMessage(result: {
  compactedCount: number;
  retainedCount: number;
}): string {
  return `Compacted ${result.compactedCount} messages; retained ${result.retainedCount} messages.`;
}

function isModelSwitchCommand(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "/model" || trimmed.startsWith("/model ");
}
