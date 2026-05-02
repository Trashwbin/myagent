# Session Loop

## Core structure

`src/session/loop.ts` drives the runtime:

- builds tool schemas from the registry
- streams model output
- collects tool calls
- runs permission checks
- handles approval
- executes tools
- appends transcript messages

Main entry points:

- `runTurn(...)`
- `runSession(...)`

## Session state

```ts
type SessionState = {
  id: string;
  cwd: string;
  messages: Message[];
};
```

The session stores transcript state only. Providers and tool registries are injected by the caller.

## Turn events

The loop emits `TurnEvent` for real-time observers:

- `assistant_text_delta`
- `tool_call`
- `assistant_message`
- `tool_approval_required`
- `tool_approval_decision`
- `tool_started`
- `tool_result`
- `turn_truncated`
- `turn_finished`

`turn_truncated` is emitted when the provider ends a turn with `stop.reason = "length"` and no tool call follows.

## Permission outcomes

The loop now distinguishes four permission-layer outcomes:

- `allow`
- `ask`
- `deny`
- `invalid`

### `allow`
Tool executes immediately.

### `ask`
The loop checks:

1. session approval memory
2. workspace approval memory
3. approval handler

If approved, execution proceeds with `resolvedInput`.

### `deny`
The loop records a blocked tool result:

```text
Tool call denied and was not executed: ...
```

### `invalid`
The loop does **not** enter approval. Instead it records a validation-style tool result:

```text
Patch validation failed before execution: ...
```

This is currently used by `apply_patch` preflight so patch validation failure is no longer confused with permission denial.

## Apply-patch preflight

`apply_patch` uses an internal prepare/validation stage before approval or execution:

- parse patch
- resolve patch paths
- dry-run hunk application
- build diff metadata

The prepare result is one of:

- invalid
- needs approval
- ready

The session loop only asks for approval on valid patches.

## Checkpoints

Before mutation tools execute, the loop creates a checkpoint using:

- `isMutationTool()`
- `getCheckpointPaths()`

Covered mutation tools:

- `edit_file`
- `write_file`
- `apply_patch`

Checkpoint ids are only appended to successful tool results.

## Approval memory

The loop supports:

- one-shot approval
- session approval rules
- workspace approval rules

Sensitive requests are never persisted as reusable rules.

External-directory approvals are handled specially:

- read-class tools use the external-directory rule directly
- read-only bash requires both:
  - external-directory path approval
  - bash command-family approval

## Persistence boundary

The session loop itself does not write SQLite. The CLI or harness persists `newMessages` after each turn.

The global transcript store remains:

```text
~/.myagent/myagent.sqlite
```
