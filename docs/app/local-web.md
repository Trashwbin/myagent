# myAgent Local Web App

## Quick Start

```bash
myagent app --cwd /path/to/workspace
```

This starts a local HTTP + WebSocket server on `127.0.0.1` (default port 43110).

Open the printed URL in a browser to use the minimal web UI.

The browser remembers the active session per workspace in `localStorage`. Opening
the page again restores the last selected session when it still exists; it does
not create a fresh session on every refresh. Use the `New` button to explicitly
start another session.

The embedded page follows the design guide in [DESIGN.md](DESIGN.md). The first
pass intentionally stays framework-free: HTML, CSS, and browser client logic are
split into small TypeScript modules under `src/app/web/`, but served as a single
local page.

## Architecture

- **Server** binds to `127.0.0.1` only — no remote access.
- **Browser** never executes tools directly. All tool execution happens in the Node.js server process via the existing `runTurn()` loop.
- **Approval** flows through WebSocket: the server sends `approval_required`, the browser shows buttons, and the user's choice is sent back as `approval_decision`.
- **Session shell** is browser-side: the sidebar lists persisted sessions, the
  header shows the full session id, and the active session can be selected
  without restarting the server.

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Returns `{ ok: true }` |
| GET | `/api/config` | Returns cwd, provider, model, approval mode (no secrets) |
| GET | `/api/sessions` | List all sessions |
| POST | `/api/sessions` | Create new session (body: `{ cwd?: string }`) |
| GET | `/api/sessions/:id/messages` | Get session message history |

## WebSocket Protocol

Connect to `/ws`. Messages are JSON.

### Client → Server

| Type | Fields | Description |
|------|--------|-------------|
| `subscribe_session` | `sessionId` | Subscribe to session events |
| `user_message` | `sessionId`, `text` | Send a user message (starts a turn) |
| `approval_decision` | `approvalId`, `decision` | Resolve a pending approval |
| `cancel_turn` | `sessionId` | Reserved (not yet implemented) |

### Server → Client

| Type | Fields | Description |
|------|--------|-------------|
| `ready` | `sessionId?` | Connection established |
| `turn_event` | `sessionId`, `event` | Forwarded `TurnEvent` from `runTurn()` |
| `approval_required` | `sessionId`, `approvalId`, `request` | Approval needed |
| `turn_finished` | `sessionId` | Turn completed |
| `error` | `message`, `code?` | Error notification |

## Security

- Server only listens on `127.0.0.1` (localhost).
- Config API filters out `apiKey` / `authToken`.
- No tool execution endpoints exposed to the browser.
- All mutations go through the existing permission/approval system.
- Unknown or malformed messages return structured errors, never crash the server.

## Relationship to TUI

The TUI (`myagent tui`) remains available but is no longer the primary direction for complex interactions. The web app shares the same session loop, tools, permissions, and storage.
