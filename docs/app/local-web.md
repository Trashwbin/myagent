# myAgent Local Web App

## Quick Start

```bash
myagent app
```

This starts a local HTTP + WebSocket server on `127.0.0.1` (default port 43110).

Open the printed URL in a browser to use the local web UI.

The web app starts on the default project page. Projects are first-class objects
in the sidebar; sessions belong to projects, and runtime config, skills,
permissions, checkpoints, and diffs are resolved from each session's project
path. `--cwd` is only a fallback used to seed the project list and create draft
sessions when no project has been selected yet.

The browser remembers the active session and draft project target in `localStorage`.
Opening the page again restores the last selected session when it still exists;
it does not create a fresh session on every refresh. Use `New chat` to enter a
draft state under the selected project; the session is created only when the
first message is sent.

The embedded page follows the design guide in [DESIGN.md](DESIGN.md). The shell
is still served by the Node app server, but the browser client is bundled from
`src/app/web/entry.ts` with esbuild and served as `/assets/client.js`.

Assistant answers render through a small React markdown island:

- `react-markdown` parses markdown into React components.
- `remark-gfm` enables tables, task lists, strikethrough, and autolinks.
- `shiki` is loaded lazily for fenced code block highlighting.
- Raw HTML is not enabled; user and tool text still use text nodes.

## Architecture

- **Server** binds to `127.0.0.1` only — no remote access.
- **Browser** never executes tools directly. All tool execution happens in the Node.js server process via the existing `runTurn()` loop.
- **Project API** owns the project list; selected sessions own execution context, and browser draft state decides where the next new session will be created.
- **Approval** flows through WebSocket: the server sends `approval_required`, the browser shows buttons, and the user's choice is sent back as `approval_decision`.
- **Session shell** is browser-side: the sidebar lists projects with nested
  sessions, the header exposes session actions in a compact menu, and the active
  session can be selected without restarting the server.
- **Markdown rendering** is browser-side: the app server exposes the bundled
  client at `/assets/client.js`; the runtime loop still only exchanges plain
  text and structured tool events over WebSocket.

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Returns `{ ok: true }` |
| GET | `/assets/client.js` | Bundled browser client |
| GET | `/project` | List known projects |
| POST | `/project` | Create or update a project (body: `{ path, name? }`) |
| GET | `/config/providers` | Return public provider/model config (no secrets) |
| GET | `/session` | List all sessions |
| POST | `/session` | Create new session (body: `{ projectPath?: string }`) |
| GET | `/session/:id/message` | Get session message history |
| GET | `/session/:id/diff` | Get aggregated git diff for a session project |

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
