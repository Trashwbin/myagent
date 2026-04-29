# Source Study

Reference snapshots:

- Codex: `openai/codex` at `d92c909ee`
- OpenCode: `anomalyco/opencode` at `65ba1f6`
- Claude-Code reference: `codeaashu/claude-code` at `6a25909`
- Claude-Code sourcemap mirror: `yasasbanukaofficial/claude-code` at `a371abb`

## Judgment

Use OpenCode as the main structural reference, Codex as the safety and execution
reference, and the Claude-Code sourcemap mirror as a product-structure reference.
Do not copy code from the Claude-Code mirror into this project.

The reason is simple:

- OpenCode has the clearest TypeScript module boundaries for a small runtime:
  `session`, `tool`, `permission`, `snapshot`, `storage`, `provider`.
- Codex has the strongest engineering examples for command approval, sandbox
  policy, patch flow, compaction semantics, and context assembly.
- `yasasbanukaofficial/claude-code` is closer to the Claude Code source shape
  because it is presented as an npm sourcemap recovery. It is still not an
  official open-source release, has no license, and its README says the original
  code is proprietary.
- `codeaashu/claude-code` is now secondary; keep it only as a comparison copy.

## What To Borrow

### From Codex

Relevant files:

- `codex-rs/core/src/exec_policy.rs`
- `codex-rs/core/src/compact.rs`
- `codex-rs/core/src/apply_patch.rs`
- `codex-rs/core/src/context/*`
- `codex-rs/core/src/session/*`

Borrow the ideas:

- command approval is separate from command execution
- policy decisions should return explicit `allow`, `ask`, or `deny`
- safe command detection needs both allow rules and danger heuristics
- compaction is a history replacement operation, not just a summary string
- patches should be structured operations with clear failure output

Do not borrow yet:

- full sandbox implementation
- plugin system
- MCP integration
- app server protocol
- subagents

### From OpenCode

Relevant files:

- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/tool/registry.ts`
- `packages/opencode/src/tool/read.ts`
- `packages/opencode/src/tool/edit.ts`
- `packages/opencode/src/tool/bash.ts`
- `packages/opencode/src/permission/*`
- `packages/opencode/src/snapshot/*`
- `packages/opencode/src/storage/*`

Borrow the ideas:

- tools are registered definitions with name, schema, description, and execute
- session owns messages, permission state, compaction status, and revert data
- snapshots are first-class data, not an afterthought
- persistence should model sessions and message parts separately
- built-in tools should be enough before custom tools exist

Do not borrow yet:

- plugin tools
- LSP tools
- web fetch/search
- task/subagent tool
- desktop/app/server layers

### From Claude-Code Sourcemap Mirror

Relevant files:

- `source/claude-code-yasas/src/QueryEngine.ts`
- `source/claude-code-yasas/src/query.ts`
- `source/claude-code-yasas/src/Tool.ts`
- `source/claude-code-yasas/src/tools.ts`
- `source/claude-code-yasas/src/tools/BashTool/*`
- `source/claude-code-yasas/src/tools/FileReadTool/*`
- `source/claude-code-yasas/src/tools/FileEditTool/*`
- `source/claude-code-yasas/src/tools/FileWriteTool/*`
- `source/claude-code-yasas/src/utils/fileHistory.ts`
- `source/claude-code-yasas/src/utils/sessionStorage.ts`
- `source/claude-code-yasas/src/services/compact/*`
- `source/claude-code-yasas/src/services/SessionMemory/*`

Borrow the ideas:

- a query engine can be a single conversation owner
- permissions can be injected as a callback into tool execution
- file history snapshots can be attached to tool turns
- transcript recording should happen during the loop, not only at the end
- bash safety is its own subsystem, not a few string checks
- file read/edit/write tools have separate prompts, UI/result rendering, and
  validation layers

Be careful:

- this repository is a leaked-source mirror, not an official open-source release
- there is no license, so use it for design study only
- many UI, bridge, analytics, remote, MCP, and companion modules are not useful
  for this project

## V0 Architecture

```text
src/
  cli.ts
  config.ts
  model/
    provider.ts
    openai-compatible.ts
    anthropic-compatible.ts
    types.ts
  session/
    loop.ts
    message.ts
    transcript-store.ts
    compaction.ts
  tools/
    tool.ts
    registry.ts
    read.ts
    search.ts
    edit.ts
    bash.ts
  permission/
    decision.ts
    rules.ts
  workspace/
    diff.ts
    checkpoint.ts
    patch.ts
```

## V0 Implementation Order

1. CLI accepts `--cwd`, `--provider`, `--model`, and a user prompt.
2. OpenAI-compatible and Anthropic-compatible clients support streaming text and
   tool calls.
3. Tool registry exposes only `read_file`, `search`, `edit_file`, and `bash`.
4. Permission engine returns `allow`, `ask`, or `deny`.
5. Session loop persists every message and tool result to SQLite.
6. Workspace layer captures a checkpoint before edits and can rewind.
7. Final output prints summary plus `git diff --stat` and full diff path.

## Provider Boundary

Support two first-class formats in v0:

- OpenAI-compatible: OpenAI SDK, custom `baseURL`, tool calls, streaming chunks.
- Anthropic-compatible: Anthropic Messages format, custom `baseURL`, tool use,
  streaming events.

Do not build a provider marketplace. The internal boundary should be small:

```ts
type ProviderKind = "openai" | "anthropic";

type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "stop"; reason: "end_turn" | "tool_use" | "length" };
```

The session loop should only understand `ModelEvent`. Each provider adapter is
responsible for translating its native request and stream format.

## First Hard Boundary

The project should become impressive by being small and complete. If a feature
does not help the basic edit-test-diff loop, it stays out of v0.
