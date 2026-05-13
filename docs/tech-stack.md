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

Support provider/model selection separately from adapter and mode lowering/parsing. The
runtime should not rely on one broad compatibility layer to hard-eat every
model family.

Current adapters and modes:

- `@ai-sdk/openai-compatible` with OpenAI Chat-compatible mode (`mode: "chat"`)
- `@ai-sdk/openai` with OpenAI Chat or Responses mode (`mode: "chat" | "responses"`)
- `@ai-sdk/anthropic` with Anthropic Messages mode (`mode: "messages"`)

Use AI SDK provider packages for the actual model calls, with a thin local
adapter that maps AI SDK `fullStream` parts into the runtime's canonical
`ModelEvent` stream. Transcript lowering goes through AI SDK UI messages and
`convertToModelMessages`, so tool calls and tool results keep the same
part-shaped boundary that the SDK expects.

```text
src/model/
  provider.ts
  types.ts
  ai-sdk-provider.ts
```

The CLI and live scenario runner use `AiSdkProvider`; provider-specific behavior
belongs behind that adapter instead of a parallel compatibility path.

Provider config:

Config files (optional, layered):

```text
~/.myagent/config.json                   global
<workspace>/.myagent/config.json         project
<workspace>/.myagent/config.local.json   local (gitignored)
```

Runtime model/provider settings now come from layered config files. `MYAGENT_HOME`
still exists as a storage/config root override, but provider credentials and base
URLs are no longer expected from environment variables.

Supported fields:

```json
{
  "$schema": "https://myagent.dev/config.json",
  "model": "mimo/fast",
  "maxTurns": 10,
  "approval": "auto" | "on-request",
  "providers": {
    "mimo": {
      "adapter": "@ai-sdk/openai-compatible",
      "mode": "chat",
      "baseUrl": "...",
      "apiKey": "...",
      "maxOutputTokens": 4096,
      "models": {
        "fast": {
          "model": "gpt-4o-mini",
          "name": "Fast"
        },
        "accurate": {
          "model": "gpt-4o",
          "adapter": "@ai-sdk/openai",
          "mode": "responses"
        }
      }
    },
    "mimo-claude": {
      "adapter": "@ai-sdk/anthropic",
      "mode": "messages",
      "baseUrl": "...",
      "apiKey": "...",
      "authToken": "...",
      "maxOutputTokens": 16384,
      "models": {
        "sonnet": {
          "model": "claude-sonnet-4-5"
        }
      }
    }
  }
}
```

Provider keys are user-facing provider IDs, not SDK adapter names. The `adapter`
field selects the SDK integration, while `mode` selects the request shape for
adapters that expose more than one shape. This allows a provider such as `mimo`,
`abin`, or `gateway-prod` to expose whichever SDK-compatible surface it supports
without pretending that the provider ID itself is `openai` or `anthropic`.

Model profile IDs use `provider-id/model-id`, for example `mimo/fast` or
`mimo-claude/sonnet`. During a conversation, `/model` lists available profiles
and `/model <id>` switches the active model for that session. The selected
profile is stored with the session, so resume and compaction use the same active
model.

Provider-level `adapter`, `baseUrl`, credentials, `mode`, and `maxOutputTokens`
are inherited by nested `providers.<name>.models.<id>` entries. A model entry can
override endpoint/adapter/mode fields when one provider serves multiple incompatible
model surfaces or endpoints. If `providers.<name>.models` is omitted, myAgent
synthesizes a single profile from `providers.<name>.model`.

Top-level `provider`, `model`, `baseUrl`, `apiKey`, `authToken`, and
`maxOutputTokens` are still accepted as flat compatibility keys, but new configs
should prefer the nested provider/model profile form.

`maxOutputTokens` controls per-turn output length. When unset, OpenAI-compatible
requests omit `max_tokens` and let the upstream decide the default. Anthropic
requests still send a default of 16384.

Internal stream boundary:

```ts
type ModelEvent =
  | { type: "text"; id?: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: "reasoning"; id?: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: "tool-call"; id: string; name: string; input: unknown; providerMetadata?: ProviderMetadata }
  | { type: "tool-result"; id: string; name: string; result: unknown; isError?: boolean; providerMetadata?: ProviderMetadata }
  | { type: "finish"; reason: "stop" | "tool-calls" | "length" | "error"; usage?: ModelUsage; providerMetadata?: ProviderMetadata };
```

The session loop only depends on canonical `ModelEvent`. Each provider adapter
translates its native request, tool schema, stream delta, reasoning payload,
tool-call, usage, provider metadata, and stop-reason format. Provider-specific
IDs such as OpenAI Responses `response.id` and output item IDs are preserved in
`providerMetadata` so tool-result continuation can use the provider-native
conversation linkage instead of replaying incompatible raw history.

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

- `Read` — file content reading with offset/limit and line numbers
- `list_dir` — small-range directory browsing
- `grep` — file content search (uses ripgrep internally)
- `glob` — file discovery by name pattern (uses ripgrep internally)
- `find_up` — find nearest ancestor file/directory by name (e.g. package.json, tsconfig.json)
- `edit_file`
- `write_file`
- `apply_patch`
- `bash`

Implementation choices:

- file IO: Node `fs/promises`
- search: shell out to `rg` (ripgrep)
- glob: shell out to `rg --files` (ripgrep)
- find_up: Node `fs.existsSync` with parent directory walk
- shell execution: `execa`
- file mutation: `edit_file` for targeted replacement, `write_file` for whole-file writes, and `apply_patch` for structured multi-file changes

Recommended exploration workflow:

1. `find_up` — locate project boundary and config files by walking up
2. `glob` — find relevant files by name pattern within a subtree
3. `grep` — locate specific content within files
4. `Read` — read targeted sections with offset/limit

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

- `approval: "never"`: deny anything that needs approval
- `approval: "on-request"`: ask before risky tool execution
- `approval: "auto"`: allow safe read/search/test commands, ask for writes and
  risky commands

Current rules:

- reads inside workspace: allow
- project-root-scoped outside reads: ask, then reusable through `external_directory`
- sensitive reads: ask once only, never persisted as session/workspace rules
- read-only bash commands: classified by command-policy v2, including `cd <dir> && <cmd>` and `git -C <dir>` effective cwd handling
- bash has an internal `CommandIntent` semantic model: every command is parsed into an intent kind (`file_discovery`, `content_search`, `partial_read`, `fs_primitive`, `git_read`, `exec`, `unknown`) and this intent flows through policy/approval/transcript/CLI display
- reusable bash approval patterns: `git diff *`, `git status *`, `rg *`, `npm test *`, etc.
- file writes inside workspace: ask in interactive modes, deny in `approval: "never"`
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
ai
@ai-sdk/openai
@ai-sdk/anthropic
commander
zod
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
cd /path/to/repo && myagent
cd /path/to/repo && myagent resume <sessionId>
```

Both entry points should run through the same session loop and tool registry.
Only the model adapter selected by config should differ.
