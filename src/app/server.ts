import { existsSync, realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { Provider } from "../model/provider.js";
import type { ModelProfile } from "../config/config.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { TranscriptStore } from "../storage/store.js";
import type { ApprovalMode } from "../permission/policy.js";
import type { ServerMessage } from "./protocol.js";
import type { SkillSummary } from "../skill/types.js";
import { parseClientMessage } from "./protocol.js";
import { SessionManager } from "./session-api.js";
import { EMBEDDED_HTML } from "./html.js";
import { getAppClientAsset } from "./web/bundle.js";
import { publicModelProfile } from "../model/provider-factory.js";
import { getGitDiff } from "../workspace/diff.js";
import { parseUnifiedDiffFiles } from "../diff/unified.js";

type AppServerDeps = {
  provider: Provider;
  providerName: string;
  modelName: string;
  modelProfileId?: string;
  modelProfiles?: ModelProfile[];
  createProvider?: (profile: ModelProfile) => Provider;
  registry: ToolRegistry;
  approval: ApprovalMode;
  store: TranscriptStore;
  availableSkills?: SkillSummary[];
  cwd: string;
};

function canonicalProjectPath(input: string): string {
  const resolved = resolve(input);
  return existsSync(resolved) ? realpathSync.native(resolved) : resolved;
}

function publicProviders(profiles: ModelProfile[]) {
  const providers = new Map<
    string,
    {
      id: string;
      name: string;
      adapters: string[];
      models: ReturnType<typeof publicModelProfile>[];
    }
  >();

  for (const profile of profiles) {
    const provider = providers.get(profile.provider) ?? {
      id: profile.provider,
      name: profile.provider,
      adapters: [],
      models: [],
    };
    if (!provider.adapters.includes(profile.adapter)) {
      provider.adapters.push(profile.adapter);
    }
    provider.models.push(publicModelProfile(profile));
    providers.set(profile.provider, provider);
  }

  return [...providers.values()];
}

export function createAppServer(deps: AppServerDeps): Server {
  const subscribers = new Map<string, Set<WebSocket>>();

  const sendEvent = (sessionId: string, msg: ServerMessage) => {
    const subs = subscribers.get(sessionId);
    if (!subs) return;
    const data = JSON.stringify(msg);
    for (const ws of subs) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  };

  const manager = new SessionManager({
    provider: deps.provider,
    modelProfiles: deps.modelProfiles,
    createProvider: deps.createProvider,
    registry: deps.registry,
    approval: deps.approval,
    store: deps.store,
    availableSkills: deps.availableSkills,
    sendEvent,
  });

  const json = (res: ServerResponse, data: unknown, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  const readBody = (req: IncomingMessage): Promise<string> => {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  };

  const createSessionFromBody = async (req: IncomingMessage) => {
    const body = await readBody(req);
    const parsed = body ? JSON.parse(body) : {};
    const cwd =
      typeof parsed.projectPath === "string"
        ? canonicalProjectPath(parsed.projectPath)
        : typeof parsed.cwd === "string"
          ? canonicalProjectPath(parsed.cwd)
          : deps.store.getCurrentProject()?.path ?? deps.cwd;
    const session = deps.store.createSession({
      workspaceRoot: cwd,
      modelProfileId: deps.modelProfileId,
      provider: deps.providerName,
      model: deps.modelName,
    });
    manager.registerSession(session);
    return session;
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1`);
    const path = url.pathname;

    try {
      if (path === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(EMBEDDED_HTML);
        return;
      }

      if (path.startsWith("/assets/") && req.method === "GET") {
        const asset = await getAppClientAsset(path);
        if (!asset) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Asset not found" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": asset.contentType,
          "Cache-Control": "no-store",
        });
        res.end(asset.content);
        return;
      }

      if (path === "/api/health" && req.method === "GET") {
        json(res, { ok: true });
        return;
      }

      if (path === "/project" && req.method === "GET") {
        json(res, deps.store.listProjects());
        return;
      }

      if (path === "/project" && req.method === "POST") {
        const body = await readBody(req);
        const parsed = body ? JSON.parse(body) : {};
        if (typeof parsed.path !== "string" || parsed.path.trim() === "") {
          json(res, { error: "Project path is required" }, 400);
          return;
        }
        const project = deps.store.upsertProject({
          path: canonicalProjectPath(parsed.path),
          name: typeof parsed.name === "string" ? parsed.name : undefined,
          setCurrent: parsed.current === true,
        });
        json(res, project, 201);
        return;
      }

      if (path === "/project/current" && req.method === "GET") {
        const current = deps.store.getCurrentProject();
        json(res, current ?? null);
        return;
      }

      if (path === "/project/current" && req.method === "PUT") {
        const body = await readBody(req);
        const parsed = body ? JSON.parse(body) : {};
        if (typeof parsed.path !== "string" || parsed.path.trim() === "") {
          json(res, { error: "Project path is required" }, 400);
          return;
        }
        const project = deps.store.setCurrentProject(canonicalProjectPath(parsed.path));
        json(res, project);
        return;
      }

      if (path.startsWith("/project/") && req.method === "DELETE") {
        const encodedPath = decodeURIComponent(path.slice("/project/".length));
        if (!encodedPath) {
          json(res, { error: "Project path is required" }, 400);
          return;
        }
        deps.store.deleteProject(canonicalProjectPath(encodedPath));
        json(res, { ok: true });
        return;
      }

      if (path === "/api/config" && req.method === "GET") {
        json(res, {
          cwd: deps.cwd,
          provider: deps.providerName,
          model: deps.modelName,
          models: (deps.modelProfiles ?? []).map(publicModelProfile),
          approval: deps.approval,
        });
        return;
      }

      if (path === "/provider" && req.method === "GET") {
        json(res, publicProviders(deps.modelProfiles ?? []));
        return;
      }

      if (path === "/provider/auth" && req.method === "GET") {
        json(
          res,
          publicProviders(deps.modelProfiles ?? []).map((provider) => ({
            id: provider.id,
            authenticated: true,
          })),
        );
        return;
      }

      if (path === "/config/providers" && req.method === "GET") {
        json(res, {
          current: deps.modelProfileId ?? `${deps.providerName}/${deps.modelName}`,
          providers: publicProviders(deps.modelProfiles ?? []),
          models: (deps.modelProfiles ?? []).map(publicModelProfile),
        });
        return;
      }

      if (path === "/session" && req.method === "GET") {
        json(res, deps.store.listSessions());
        return;
      }

      if (path === "/session" && req.method === "POST") {
        const session = await createSessionFromBody(req);
        json(res, {
          id: session.id,
          workspaceRoot: session.cwd,
          cwd: session.cwd,
          modelProfileId: session.modelProfileId,
          provider: session.provider,
          model: session.model,
        }, 201);
        return;
      }

      if (path === "/session/status" && req.method === "GET") {
        json(
          res,
          deps.store.listSessions().map((session) => ({
            id: session.id,
            status: manager.hasActiveTurn(session.id) ? "busy" : "idle",
          })),
        );
        return;
      }

      if (path.startsWith("/session/")) {
        const parts = path.split("/");
        const sessionId = parts[2];
        const leaf = parts[3];
        if (!sessionId) {
          json(res, { error: "Missing session id" }, 400);
          return;
        }

        if (!leaf && req.method === "GET") {
          const summary = deps.store.listSessions().find((session) => session.id === sessionId);
          if (!summary) {
            json(res, { error: "Session not found" }, 404);
            return;
          }
          json(res, {
            ...summary,
            status: manager.hasActiveTurn(sessionId) ? "busy" : "idle",
          });
          return;
        }

        if (leaf === "message" && req.method === "GET") {
          const session = deps.store.getSession(sessionId);
          if (!session) {
            json(res, { error: "Session not found" }, 404);
            return;
          }
          json(res, session.messages);
          return;
        }

        if (leaf === "diff" && req.method === "GET") {
          const session = deps.store.getSession(sessionId);
          if (!session) {
            json(res, { error: "Session not found" }, 404);
            return;
          }
          const diff = await getGitDiff(session.cwd);
          json(res, {
            sessionId,
            files: diff ? parseUnifiedDiffFiles(diff) : [],
            diff,
          });
          return;
        }

        if (leaf === "abort" && req.method === "POST") {
          json(res, { error: "Abort not supported yet" }, 501);
          return;
        }
      }

      if (path === "/api/sessions" && req.method === "GET") {
        const sessions = deps.store.listSessions();
        json(res, sessions);
        return;
      }

      if (path === "/api/sessions" && req.method === "POST") {
        const session = await createSessionFromBody(req);
        json(res, { id: session.id, cwd: session.cwd }, 201);
        return;
      }

      if (path.startsWith("/api/sessions/") && path.endsWith("/messages") && req.method === "GET") {
        const parts = path.split("/");
        const sessionId = parts[3];
        if (!sessionId) { json(res, { error: "Missing session id" }, 400); return; }
        const session = deps.store.getSession(sessionId);
        if (!session) { json(res, { error: "Session not found" }, 404); return; }
        json(res, session.messages);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      json(res, { error: "Internal server error" }, 500);
    }
  };

  const server = createServer(handleRequest);

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      const msg = parseClientMessage(parsed);
      if (msg.type === "error") {
        ws.send(JSON.stringify(msg));
        return;
      }

      switch (msg.type) {
        case "subscribe_session": {
          if (!manager.getSession(msg.sessionId)) {
            ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
            return;
          }
          let subs = subscribers.get(msg.sessionId);
          if (!subs) {
            subs = new Set();
            subscribers.set(msg.sessionId, subs);
          }
          subs.add(ws);
          ws.send(JSON.stringify({ type: "ready", sessionId: msg.sessionId }));
          ws.on("close", () => subs!.delete(ws));
          break;
        }

        case "user_message": {
          const result = manager.handleUserMessage(msg.sessionId, msg.text);
          if (!result.ok) {
            ws.send(JSON.stringify({ type: "error", sessionId: msg.sessionId, message: result.error, code: "TURN_REJECTED" }));
          }
          break;
        }

        case "approval_decision": {
          const found = manager.resolveApproval(msg.approvalId, msg.decision);
          if (!found) {
            ws.send(JSON.stringify({ type: "error", message: "Unknown approval id", code: "APPROVAL_NOT_FOUND" }));
          }
          break;
        }

        case "rewind_session": {
          void manager.rewindSession(msg.sessionId, msg.checkpointId).then((result) => {
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: "error",
                sessionId: msg.sessionId,
                message: result.error,
                code: "REWIND_REJECTED",
              }));
            }
          }).catch((err) => {
            ws.send(JSON.stringify({
              type: "error",
              sessionId: msg.sessionId,
              message: err instanceof Error ? err.message : "Rewind failed",
              code: "REWIND_ERROR",
            }));
          });
          break;
        }

        case "revert_last": {
          void manager.revertLast(msg.sessionId).then((result) => {
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: "error",
                sessionId: msg.sessionId,
                message: result.error,
                code: "REVERT_REJECTED",
              }));
            }
          }).catch((err) => {
            ws.send(JSON.stringify({
              type: "error",
              sessionId: msg.sessionId,
              message: err instanceof Error ? err.message : "Revert failed",
              code: "REVERT_ERROR",
            }));
          });
          break;
        }

        case "compact_session": {
          void manager.compactSession(msg.sessionId).then((result) => {
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: "error",
                sessionId: msg.sessionId,
                message: result.error,
                code: "COMPACT_REJECTED",
              }));
            }
          }).catch((err) => {
            ws.send(JSON.stringify({
              type: "error",
              sessionId: msg.sessionId,
              message: err instanceof Error ? err.message : "Compact failed",
              code: "COMPACT_ERROR",
            }));
          });
          break;
        }

        case "cancel_turn": {
          ws.send(JSON.stringify({ type: "error", sessionId: msg.sessionId, message: "Cancel not supported yet", code: "UNSUPPORTED" }));
          break;
        }
      }
    });
  });

  return server;
}

export function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const testServer = createServer();
      testServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port < startPort + 100) {
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      testServer.listen(port, "127.0.0.1", () => {
        const addr = testServer.address();
        testServer.close(() => {
          resolve(typeof addr === "object" && addr ? addr.port : port);
        });
      });
    };
    tryPort(startPort);
  });
}
