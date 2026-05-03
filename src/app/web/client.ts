export const APP_CLIENT_SCRIPT = String.raw`
const state = {
  config: null,
  sessions: [],
  activeSessionId: null,
  ws: null,
  wsOpen: false,
  running: false,
  pendingApprovalId: null,
  streamEl: null,
  activeTurnEl: null,
  activeAssistantBody: null,
  toolEls: new Map(),
  toolInputs: new Map(),
  subscribed: new Set(),
};

const els = {
  sessionList: document.getElementById("session-list"),
  sessionTitle: document.getElementById("session-title"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  modelPill: document.getElementById("model-pill"),
  sessionId: document.getElementById("session-id"),
  workspace: document.getElementById("workspace"),
  timeline: document.getElementById("timeline"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  newSession: document.getElementById("new-session"),
  copySession: document.getElementById("copy-session"),
  approvalPanel: document.getElementById("approval-panel"),
  approvalText: document.getElementById("approval-text"),
};

function activeSessionKey() {
  const cwd = state.config && state.config.cwd ? state.config.cwd : "default";
  return "myagent.activeSession." + cwd;
}

function setStatus(text, kind) {
  els.statusText.textContent = text;
  els.statusDot.className = "dot" + (kind ? " " + kind : "");
}

function sessionLabel(session) {
  return session.title || "New session";
}

function shortId(id) {
  return id ? id.slice(0, 8) : "";
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function relativeAge(value) {
  if (!value) return "";
  const delta = Math.max(0, Date.now() - Number(value));
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (delta < minute) return "now";
  if (delta < hour) return Math.floor(delta / minute) + "m";
  if (delta < day) return Math.floor(delta / hour) + "h";
  if (delta < week) return Math.floor(delta / day) + "d";
  return Math.floor(delta / week) + "w";
}

function workspaceName(path) {
  if (!path) return "Workspace";
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function workspacePath(session) {
  return session.workspaceRoot || state.config?.cwd || "Workspace";
}

function groupSessionsByWorkspace(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const path = workspacePath(session);
    let group = groups.get(path);
    if (!group) {
      group = { path, name: workspaceName(path), sessions: [] };
      groups.set(path, group);
    }
    group.sessions.push(session);
  }
  return Array.from(groups.values());
}

function appendSectionHeading(text) {
  const heading = document.createElement("div");
  heading.className = "section-heading";
  heading.textContent = text;
  els.sessionList.appendChild(heading);
}

function appendWorkspaceRow(group) {
  const row = document.createElement("div");
  row.className = "workspace-row";
  row.title = group.path;
  const icon = document.createElement("span");
  icon.className = "workspace-icon";
  icon.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "workspace-name";
  name.textContent = group.name;
  const count = document.createElement("span");
  count.className = "workspace-count";
  count.textContent = String(group.sessions.length);
  row.appendChild(icon);
  row.appendChild(name);
  row.appendChild(count);
  els.sessionList.appendChild(row);
}

function clearTimeline() {
  unmountMarkdownIn(els.timeline);
  state.streamEl = null;
  state.activeTurnEl = null;
  state.activeAssistantBody = null;
  state.toolEls.clear();
  state.toolInputs.clear();
  els.timeline.innerHTML = "";
}

function showEmpty() {
  els.timeline.innerHTML = "";
  const div = document.createElement("div");
  div.className = "empty";
  const title = document.createElement("h1");
  title.textContent = "Start working in this workspace";
  const body = document.createElement("p");
  body.textContent = "Send a message below, or choose a previous session from the left.";
  div.appendChild(title);
  div.appendChild(body);
  els.timeline.appendChild(div);
}

function scrollToBottom() {
  els.timeline.scrollTop = els.timeline.scrollHeight;
}

function beginTurn() {
  const turn = document.createElement("div");
  turn.className = "turn";
  els.timeline.appendChild(turn);
  state.activeTurnEl = turn;
  state.activeAssistantBody = null;
  state.streamEl = null;
  state.toolEls.clear();
  return turn;
}

function ensureTurn() {
  return state.activeTurnEl || beginTurn();
}

function messageBlock(kind, label, content, turn) {
  const target = turn || ensureTurn();
  const block = document.createElement("div");
  block.className = "message " + kind;
  const head = document.createElement("div");
  head.className = "label";
  head.textContent = label;
  const body = document.createElement("div");
  body.className = "content";
  if (kind === "assistant") {
    setAssistantContent(body, content || "");
  } else {
    body.textContent = content || "";
  }
  block.appendChild(head);
  block.appendChild(body);
  target.appendChild(block);
  scrollToBottom();
  return body;
}

function userBlock(content) {
  const turn = beginTurn();
  return messageBlock("user", "You", content, turn);
}

function ensureAssistantBody() {
  if (state.activeAssistantBody) return state.activeAssistantBody;
  state.activeAssistantBody = messageBlock("assistant", "myAgent", "", ensureTurn());
  return state.activeAssistantBody;
}

function assistantBlock(content) {
  const body = ensureAssistantBody();
  if (content) setAssistantContent(body, content);
  return body;
}

function markdownApi() {
  return globalThis.__myAgentMarkdown;
}

function setAssistantContent(body, content) {
  const text = content || "";
  body.dataset.markdownSource = text;
  const api = markdownApi();
  if (api && typeof api.renderAssistantMarkdown === "function") {
    api.renderAssistantMarkdown(body, text);
  } else {
    body.textContent = text;
  }
}

function getAssistantContent(body) {
  return body.dataset.markdownSource || body.textContent || "";
}

function unmountMarkdownIn(root) {
  const api = markdownApi();
  if (!api || typeof api.unmountAssistantMarkdown !== "function") return;
  for (const el of root.querySelectorAll(".message.assistant .content")) {
    api.unmountAssistantMarkdown(el);
  }
}

function truncate(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function summarizeInput(input) {
  if (!input || typeof input !== "object") return "";
  const obj = input;
  if (typeof obj.command === "string") return truncate(obj.command, 140);
  if (typeof obj.path === "string") return obj.path;
  if (typeof obj.pattern === "string") return obj.pattern;
  if (typeof obj.query === "string") return obj.query;
  if (typeof obj.name === "string") return obj.name;
  if (typeof obj.patch === "string") return summarizePatch(obj.patch);
  return "";
}

function toolTarget(name, input) {
  if (!input || typeof input !== "object") return "";
  const obj = input;
  if (name === "Read" || name === "read_file") return obj.path || obj.file || "";
  if (name === "grep") {
    const query = obj.query || obj.pattern || "";
    const path = obj.path || obj.include || "";
    return [query && '"' + query + '"', path && "in " + path].filter(Boolean).join(" ");
  }
  if (name === "glob") return [obj.pattern, obj.path && "in " + obj.path].filter(Boolean).join(" ");
  if (name === "find_up") return [obj.name, obj.start_path && "from " + obj.start_path].filter(Boolean).join(" ");
  if (name === "list_dir") return obj.path || ".";
  if (name === "bash") return truncate(obj.command || "", 180);
  if (name === "apply_patch") return summarizePatch(obj.patch || "");
  if (name === "edit_file" || name === "write_file") return obj.path || "";
  return summarizeInput(input);
}

function toolTitle(name, input) {
  const target = toolTarget(name, input);
  return target ? name + " " + target : name || "tool";
}

function summarizePatch(patch) {
  const lines = String(patch || "").split("\n");
  const files = [];
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (match) files.push(match[1]);
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  const fileText = files.length ? files.slice(0, 2).join(", ") : "patch";
  const more = files.length > 2 ? " +" + (files.length - 2) + " files" : "";
  return fileText + more + " (+" + added + " -" + removed + ")";
}

function resultStatus(content) {
  const text = String(content || "");
  if (text.startsWith("Patch validation failed before execution:")) return "invalid";
  if (text.startsWith("Tool call denied and was not executed:")) return "denied";
  if (text.startsWith("Error:")) return "failed";
  return "ok";
}

function summarizeToolResult(name, content, status) {
  const text = String(content || "").trim();
  const lines = text ? text.split("\n").filter(Boolean) : [];
  if (name === "Read" || name === "read_file") return lines.length + " lines";
  if (name === "grep") return lines.length + " matches";
  if (name === "glob") return lines.length + " files";
  if (name === "list_dir") return lines.length + " entries";
  if (name === "bash") return lines.length <= 1 ? truncate(text || "completed", 140) : lines.length + " lines";
  if (name === "apply_patch" || name === "edit_file" || name === "write_file") return "completed";
  return lines.length ? lines.length + " lines" : "completed";
}

function toolKey(id, name) {
  return id || "tool:" + (name || "tool") + ":" + state.toolEls.size;
}

function rememberToolInput(id, name, input) {
  state.toolInputs.set(toolKey(id, name), input);
}

function rememberedToolInput(id, name) {
  return state.toolInputs.get(toolKey(id, name));
}

function buildToolHeader(input) {
  const header = document.createElement("span");
  header.className = "tool-header";
  const titleEl = document.createElement("span");
  titleEl.className = "tool-title";
  titleEl.textContent = input.title || input.name || "tool";
  const summaryEl = document.createElement("span");
  summaryEl.className = "tool-summary";
  summaryEl.textContent = input.summary || "";
  header.appendChild(titleEl);
  header.appendChild(summaryEl);
  return header;
}

function upsertToolRow(input) {
  const key = toolKey(input.id, input.name);
  let row = state.toolEls.get(key);
  if (!row) {
    row = document.createElement("div");
    row.className = "tool-line";
    let stack = ensureTurn().querySelector(".tool-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "tool-stack";
      ensureTurn().appendChild(stack);
    }
    stack.appendChild(row);
    state.toolEls.set(key, row);
  }

  const status = input.status || "queued";
  row.className = "tool-line " + status;
  row.replaceChildren();

  if (input.detail) {
    const details = document.createElement("details");
    details.className = "tool-details";
    const s = document.createElement("summary");
    const caret = document.createElement("span");
    caret.className = "tool-caret";
    caret.textContent = ">";
    details.addEventListener("toggle", () => {
      caret.textContent = details.open ? "v" : ">";
    });
    s.appendChild(caret);
    s.appendChild(buildToolHeader(input));
    const pre = document.createElement("pre");
    pre.textContent = input.detail;
    details.appendChild(s);
    details.appendChild(pre);
    row.appendChild(details);
  } else {
    row.appendChild(buildToolHeader(input));
  }
  scrollToBottom();
  return row;
}

function toolQueued(id, name, input) {
  rememberToolInput(id, name, input);
  upsertToolRow({ id, name, status: "queued", title: toolTitle(name, input), summary: "", detail: "" });
}

function toolRunning(id, name, input) {
  rememberToolInput(id, name, input);
  upsertToolRow({ id, name, status: "running", title: toolTitle(name, input), summary: "running", detail: "" });
}

function toolApproval(id, name, input, reason) {
  rememberToolInput(id, name, input);
  upsertToolRow({ id, name, status: "approval", title: toolTitle(name, input), summary: reason || "approval required", detail: "" });
}

function toolDecision(id, name, decision) {
  const input = rememberedToolInput(id, name);
  upsertToolRow({ id, name, status: decision === "deny" ? "denied" : "queued", title: toolTitle(name, input), summary: decision === "deny" ? "not executed" : "" });
}

function toolResult(message) {
  const name = message.toolName || "tool";
  const status = resultStatus(message.content);
  const input = rememberedToolInput(message.toolCallId, name);
  upsertToolRow({
    id: message.toolCallId,
    name,
    status,
    title: toolTitle(name, input),
    summary: summarizeToolResult(name, message.content, status),
    detail: message.content,
  });
}

function statusBlock(text, kind = "info") {
  const turn = ensureTurn();
  const line = document.createElement("div");
  line.className = "status-line " + kind;
  line.textContent = text;
  turn.appendChild(line);
  scrollToBottom();
}

function errorBlock(text) {
  statusBlock(text, "error");
}

function renderSessions() {
  els.sessionList.innerHTML = "";
  if (!state.sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "No sessions yet";
    els.sessionList.appendChild(empty);
    return;
  }
  const groups = groupSessionsByWorkspace(state.sessions);
  const currentPath = state.config?.cwd || groups[0]?.path;
  const current = groups.find((group) => group.path === currentPath) || groups[0];
  if (current) {
    appendSectionHeading("Workspace");
    appendWorkspaceRow(current);
    appendSectionHeading("Recent");
    for (const session of current.sessions) {
      appendSessionRow(session);
    }
  }
  const otherGroups = groups.filter((group) => group !== current);
  if (otherGroups.length) {
    appendSectionHeading("Other workspaces");
    for (const group of otherGroups) {
      appendWorkspaceRow(group);
      for (const session of group.sessions) {
        appendSessionRow(session);
      }
    }
  }
}

function appendSessionRow(session) {
  const btn = document.createElement("button");
  btn.className = "session-item" + (session.id === state.activeSessionId ? " active" : "");
  btn.title = session.id;
  const title = document.createElement("div");
  title.className = "session-title";
  title.textContent = sessionLabel(session);
  const meta = document.createElement("div");
  meta.className = "session-meta";
  meta.textContent = relativeAge(session.updatedAt) || formatTime(session.updatedAt);
  btn.appendChild(title);
  btn.appendChild(meta);
  btn.addEventListener("click", () => selectSession(session.id));
  els.sessionList.appendChild(btn);
}

function renderHeader() {
  const session = state.sessions.find((s) => s.id === state.activeSessionId);
  els.sessionTitle.textContent = session ? sessionLabel(session) : "No session";
  els.copySession.disabled = !state.activeSessionId;
  els.copySession.title = state.activeSessionId || "";
  if (state.config) {
    els.modelPill.textContent = state.config.provider + "/" + state.config.model;
    els.workspace.textContent = state.config.cwd;
  }
  els.sessionId.textContent = state.activeSessionId || "session";
  els.sessionId.title = state.activeSessionId || "";
}

function renderMessages(messages) {
  clearTimeline();
  if (!messages.length) {
    showEmpty();
    return;
  }
  for (const msg of messages) {
    if (msg.role === "user") {
      userBlock(msg.content);
    } else if (msg.role === "assistant") {
      if (msg.content) assistantBlock(msg.content);
      if (Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls) {
          toolQueued(tc.id, tc.name, tc.input);
        }
      }
    } else if (msg.role === "tool_result") {
      toolResult(msg);
    }
  }
  state.activeTurnEl = null;
  state.activeAssistantBody = null;
  state.streamEl = null;
  state.toolEls.clear();
}

async function fetchJson(path, init) {
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data && (data.error || data.message) ? data.error || data.message : "Request failed");
  }
  return data;
}

async function loadSessions() {
  state.sessions = await fetchJson("/api/sessions");
  renderSessions();
  renderHeader();
}

async function loadMessages(sessionId) {
  const messages = await fetchJson("/api/sessions/" + encodeURIComponent(sessionId) + "/messages");
  renderMessages(messages);
}

async function createSession() {
  const session = await fetchJson("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  await loadSessions();
  await selectSession(session.id);
}

async function selectSession(sessionId) {
  state.activeSessionId = sessionId;
  localStorage.setItem(activeSessionKey(), sessionId);
  const url = new URL(location.href);
  url.searchParams.set("session", sessionId);
  history.replaceState(null, "", url);
  renderSessions();
  renderHeader();
  await loadMessages(sessionId);
  subscribe(sessionId);
  els.input.focus();
}

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(proto + "//" + location.host + "/ws");
  state.ws.onopen = () => {
    state.wsOpen = true;
    setStatus("Connected", "connected");
    if (state.activeSessionId) subscribe(state.activeSessionId);
  };
  state.ws.onclose = () => {
    state.wsOpen = false;
    state.subscribed.clear();
    setStatus("Disconnected", "");
    setTimeout(connect, 1200);
  };
  state.ws.onerror = () => setStatus("Connection error", "");
  state.ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleServerMessage(msg);
  };
}

function subscribe(sessionId) {
  if (!state.wsOpen || !state.ws) return;
  if (state.subscribed.has(sessionId)) return;
  state.subscribed.add(sessionId);
  state.ws.send(JSON.stringify({ type: "subscribe_session", sessionId }));
}

function handleServerMessage(msg) {
  if (msg.type === "ready") return;
  if (msg.type === "error") {
    errorBlock(msg.message);
    setRunning(false);
    return;
  }
  if (msg.sessionId && msg.sessionId !== state.activeSessionId) return;
  if (msg.type === "turn_event") {
    handleTurnEvent(msg.event);
  } else if (msg.type === "approval_required") {
    showApproval(msg);
  } else if (msg.type === "turn_finished") {
    setRunning(false);
    state.streamEl = null;
    state.activeTurnEl = null;
    state.activeAssistantBody = null;
    state.toolEls.clear();
    loadSessions().catch(() => {});
  }
}

function handleTurnEvent(ev) {
  switch (ev.type) {
    case "assistant_text_delta":
      if (!state.streamEl) state.streamEl = assistantBlock("");
      setAssistantContent(state.streamEl, getAssistantContent(state.streamEl) + ev.text);
      scrollToBottom();
      break;
    case "tool_call":
      toolQueued(ev.id, ev.name, ev.input);
      break;
    case "tool_approval_required":
      toolApproval(ev.id, ev.name, ev.input, ev.reason);
      break;
    case "assistant_message":
      if (state.streamEl) {
        setAssistantContent(state.streamEl, ev.message.content || getAssistantContent(state.streamEl));
        state.streamEl = null;
      } else if (ev.message.content) {
        assistantBlock(ev.message.content);
      }
      if (ev.message && Array.isArray(ev.message.toolCalls)) {
        for (const tc of ev.message.toolCalls) {
          toolQueued(tc.id, tc.name, tc.input);
        }
      }
      break;
    case "tool_started":
      toolRunning(ev.id, ev.name, ev.input);
      break;
    case "tool_result":
      toolResult(ev.message);
      break;
    case "tool_approval_decision":
      toolDecision(ev.id, ev.name, ev.decision);
      break;
    case "turn_truncated":
      statusBlock("Turn stopped because the model hit its output token limit.", "warning");
      break;
  }
}

function showApproval(msg) {
  state.pendingApprovalId = msg.approvalId;
  const request = msg.request || {};
  els.approvalText.textContent = (request.toolName || "tool") + "\n" + (request.reason || "") + "\n\n" + JSON.stringify(request.input ?? {}, null, 2);
  els.approvalPanel.classList.add("visible");
}

function decide(decision) {
  if (!state.pendingApprovalId || !state.ws) return;
  state.ws.send(JSON.stringify({
    type: "approval_decision",
    approvalId: state.pendingApprovalId,
    decision,
  }));
  state.pendingApprovalId = null;
  els.approvalPanel.classList.remove("visible");
}

function setRunning(value) {
  state.running = value;
  els.send.disabled = value;
  els.input.disabled = value;
  setStatus(value ? "Running" : state.wsOpen ? "Connected" : "Disconnected", value ? "running" : state.wsOpen ? "connected" : "");
}

function send() {
  const text = els.input.value.trim();
  if (!text || !state.activeSessionId || !state.wsOpen) return;
  els.timeline.querySelector(".empty")?.remove();
  userBlock(text);
  state.ws.send(JSON.stringify({
    type: "user_message",
    sessionId: state.activeSessionId,
    text,
  }));
  els.input.value = "";
  setRunning(true);
}

async function bootstrap() {
  state.config = await fetchJson("/api/config");
  renderHeader();
  await loadSessions();
  const fromUrl = new URL(location.href).searchParams.get("session");
  const remembered = localStorage.getItem(activeSessionKey());
  const ids = new Set(state.sessions.map((s) => s.id));
  const next = fromUrl && ids.has(fromUrl)
    ? fromUrl
    : remembered && ids.has(remembered)
      ? remembered
      : state.sessions[0] && state.sessions[0].id;
  connect();
  if (next) {
    await selectSession(next);
  } else {
    await createSession();
  }
}

els.newSession.addEventListener("click", () => createSession().catch((err) => errorBlock(err.message)));
els.send.addEventListener("click", send);
els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!state.running) send();
  }
});
els.copySession.addEventListener("click", async () => {
  if (!state.activeSessionId) return;
  await navigator.clipboard.writeText(state.activeSessionId).catch(() => {});
});
els.approvalPanel.addEventListener("click", (event) => {
  const target = event.target;
  if (target && target.dataset && target.dataset.decision) decide(target.dataset.decision);
});

bootstrap().catch((err) => {
  setStatus("Error", "");
  errorBlock(err.message || String(err));
});
`;
