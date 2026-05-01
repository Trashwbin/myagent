# Tech Stack

## Decision

Use TypeScript for v0.

This project is a coding-agent runtime kernel, not a backend service yet. The
fastest path is to make the agent loop, tool calls, streaming, permissions,
transcript store, and checkpoint flow work in one local CLI.

## Runtime

- Language: TypeScript
- Runtime: Node.js 22+
- Package manager: pnpm
- Module format: ESM
- CLI: commander
- Validation: zod
- Tests: vitest
- Formatting: prettier

Avoid frontend, server framework, Electron, TUI framework, and plugin system in
v0.

## Model Layer

Support two first-class provider formats:

- OpenAI-compatible
- Anthropic-compatible

Use native adapters instead of a broad provider gateway.

```text
src/model/
  provider.ts
  types.ts
  openai-compatible.ts
  anthropic-compatible.ts
```

Provider config:

```text
MYAGENT_PROVIDER=openai | anthropic
MYAGENT_MODEL=...
MYAGENT_BASE_URL=...
MYAGENT_API_KEY=...
```

Internal stream boundary:

```ts
type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "stop"; reason: "end_turn" | "tool_use" | "length" };
```

The session loop only depends on `ModelEvent`. Each provider adapter translates
its native request, tool schema, stream delta, tool-call, and stop-reason format.

## Provider Error Handling

The provider adapters normalize SDK failures into `ProviderRuntimeError` before
they reach the CLI. The CLI prints concise provider, kind, message, hint, status,
and request-id fields instead of leaking raw SDK stack traces.

Current classification covers:

- auth failures: `401`, `403`, invalid key, missing Bearer token
- model failures: model not found, unsupported tool call format
- quota and rate limits: `429`, insufficient quota, provider throttling
- transient upstream failures: `500`, `502`, `503`, empty gateway body
- proxy compatibility: wrong base URL, missing custom headers, provider family
  mismatch
- stream failures: partial stream, malformed tool-call JSON, connection reset

The CLI should print concise actionable output, for example:

```text
Provider error [openai/upstream]: 502 status code (no body)
Hint: gateway or upstream provider failed; retry or check upstream account health
Status: 502
```

Do not implement automatic retry or provider failover in v0. The next useful
steps are transcript-safe error records, scoped retry policy, and explicit
failover only when the user configures it.

## Tool Layer

Use explicit built-in tools only:

- `read_file`
- `list_dir`
- `search`
- `edit_file`
- `write_file`
- `apply_patch`
- `bash`

Implementation choices:

- file IO: Node `fs/promises`
- search: shell out to `rg`
- shell execution: `execa`
- file mutation: `edit_file` for targeted replacement, `write_file` for whole-file writes, and `apply_patch` for structured multi-file changes

See [tools/file-mutation.md](tools/file-mutation.md) for the write/edit/patch tool plan.

Each tool should expose:

```ts
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
};
```

## Permission Layer

Use a local deterministic permission engine:

```text
allow | ask | deny
```

v0 can run in non-interactive modes:

- `--approval never`: deny anything that needs approval
- `--approval on-request`: ask before risky tool execution
- `--approval auto`: allow safe read/search/test commands, ask for writes and
  risky commands

Current rules:

- reads inside workspace: allow
- project-root-scoped outside reads: ask, then reusable through `external_directory`
- sensitive reads: ask once only, never persisted as session/workspace rules
- read-only bash commands: classified by command-policy v2, including `cd <dir> && <cmd>` and `git -C <dir>` effective cwd handling
- reusable bash approval patterns: `git diff *`, `git status *`, `rg *`, `npm test *`, etc.
- file writes inside workspace: ask in interactive modes, deny in `--approval never`
- destructive commands: deny by default
- write/network/unknown commands: ask or deny based on policy and approval mode

## Persistence

Use SQLite.

Library:

- `better-sqlite3`

Current tables:

```text
sessions
messages
permission_rules
```

The `messages` table stores assistant tool calls and tool result metadata inline.
Checkpoint snapshots are stored under `<workspace>/.myagent/checkpoints/`, not in
SQLite.

The store exists so the project can demonstrate real agent runtime behavior,
not just a prompt wrapper. Future schema work may split tool calls, permission
decisions, and checkpoints into first-class tables if the CLI needs richer
inspection or replay.

## Workspace Layer

Use local filesystem plus git commands:

- checkpoint: copy touched files before write
- rewind: restore checkpointed files
- diff: `git diff --stat` and `git diff`

Do not require the target workspace to be a git repo for v0, but if it is a git
repo, use git diff as the primary output.

## Compaction

Implement simple local compaction after the base loop works.

Status: not implemented yet. File mutation tools v1 (`write_file`, stronger
`edit_file`, `apply_patch`, shared mutation policy) came first because
compaction should not be built on top of a thin write surface.

v0 strategy:

- keep latest user message
- keep latest assistant final answer
- keep recent tool results
- summarize older turns through the active provider
- replace older messages with one summary-bearing message or equivalent internal
  transcript entry

Do not implement remote compaction, background memory, or long-term memory in
v0.

## Why Not Go For V0

Go is a good later choice for a sandbox executor, provider gateway, remote task
runner, or serviceized runtime. It is not the best first implementation for
this local agent kernel because the early complexity is model streaming,
tool-call JSON, schema conversion, and CLI iteration.

Use Go later only when a component has a stable boundary.

## V0 Package Dependencies

Expected dependencies:

```text
@anthropic-ai/sdk
openai
commander
zod
execa
better-sqlite3
```

Expected dev dependencies:

```text
typescript
tsx
vitest
prettier
@types/node
```

## First Repository Milestone

The first repository milestone is not a polished CLI. It is this:

```text
myagent --provider openai --cwd /path/to/repo "modify a function and run tests"
myagent --provider anthropic --cwd /path/to/repo "modify a function and run tests"
```

Both commands should run through the same session loop and tool registry. Only
the model adapter should differ.
