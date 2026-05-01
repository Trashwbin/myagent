# Session Loop

## Core functions

### runTurn

`runTurn(provider, registry, session, userInput, options) → TurnResult`

Appends the user input as a message, runs the model+tool loop until the model stops emitting tool calls or `maxTurns` is reached, and returns the updated session state plus only the new messages from this turn.

Key behaviors:

- Builds the tool schema list from the registry for each provider call
- Injects the system prompt with the workspace root
- Handles permission checks (allow / ask / deny) for each tool call
- Creates checkpoints before `edit_file` operations
- Accumulates tool results and feeds them back to the model
- Emits `TurnEvent`s via `options.onEvent` for real-time UI feedback

### runSession

`runSession(provider, registry, initialMessages, options) → SessionResult`

Backward-compatible wrapper. Extracts the last user message from `initialMessages`, uses preceding messages as history, delegates to `runTurn`, and returns the full transcript.

## Session state

```ts
type SessionState = {
  id: string;
  cwd: string; // canonical workspace root, not process.cwd()
  messages: Message[];
};
```

The provider and registry are not part of session state — they are passed in by the caller. This keeps the session serializable for persistence.

## Multi-turn flow

In chat mode, the CLI creates a `SessionState` and calls `runTurn` for each user input. The returned session replaces the previous state, and `newMessages` is persisted to the global transcript store. Each turn's messages are appended independently, supporting crash recovery.

## TurnEvent

`TurnEvent` is the real-time observer interface. It decouples the session loop's execution from the CLI's presentation, allowing streaming text, approval prompts, and tool results to appear as they happen — not buffered until the turn ends.

```ts
type TurnEvent =
  | { type: "assistant_text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "assistant_message"; message: Message }
  | {
      type: "tool_approval_required";
      id: string;
      name: string;
      input: unknown;
      reason: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "tool_approval_decision";
      id: string;
      name: string;
      decision: "allow" | "deny";
    }
  | { type: "tool_started"; id: string; name: string; input: unknown }
  | { type: "tool_result"; message: Message }
  | { type: "turn_finished" };
```

### Emission order

Within a single model → tool → model cycle:

1. `assistant_text_delta` — each text chunk from the provider stream
2. `tool_call` — each tool call received during streaming
3. `assistant_message` — the complete assistant message (text + tool calls)
4. For each tool call:
   - `tool_approval_required` — if permission is "ask" and an approvalHandler exists
   - `tool_approval_decision` — after the handler resolves
   - `tool_started` — immediately before tool execution (only if approved)
   - `tool_result` — the tool result or blocked message
5. `turn_finished` — after all turns complete

### Message vs TurnEvent

- **`Message`** is the persistence structure. It's what gets stored in the transcript and survives across sessions.
- **`TurnEvent`** is the real-time observation structure. It's ephemeral — for the CLI/UI to react during execution.
- **`ToolPermissionDecision.resolvedInput`** is the secure handoff object between the permission layer and tool execution. It carries pre-resolved paths so tools don't re-interpret user input.
- **`ToolContext.permissionResolved`** marks that internal handoff as trusted. Direct tool callers cannot make `resolvedPath` trusted by merely passing it in input.

The `onEvent` callback is optional. When not provided, the loop runs identically but without streaming output. This keeps tests and non-interactive usage simple.

### Approval

Approval is a runtime decision point. When `checkToolPermission()` returns "ask":

1. If no `approvalHandler` is provided: the tool is not executed, a `tool_result` with a blocked message is emitted and persisted.
2. If an `approvalHandler` is provided: `tool_approval_required` is emitted with the tool name, reason, input, and `metadata` (path info, workspace status, sensitivity). The handler decides allow/deny. `tool_approval_decision` is emitted with the verdict.

When approved, the tool executes with `decision.resolvedInput` (not the original input) and `ToolContext.permissionResolved: true`. This ensures the tool uses the permission-resolved path without exposing that internal field as a normal model-controlled parameter.

The CLI's approval handler prints the tool info and metadata from the event, then prompts `Approve? [Enter/y once, a always, n abort]`. Empty input or `y` grants `allow_once`. `a` triggers a secondary prompt: `Always allow? [s session, w workspace, n cancel]`. `s` grants `allow_for_session`, `w` grants `allow_for_workspace`, and `n` returns to the primary prompt.

For sensitive requests (`metadata.sensitive === true`), the prompt is `Approve sensitive request? [Enter/y once, n abort]`. Session/workspace reuse is disabled. Even if a custom approval handler returns `allow_for_session` or `allow_for_workspace`, the loop treats the request as one-shot for persistence purposes and does not save any approval rule.

## Persistence

The session loop itself is unaware of SQLite. The CLI (or test harness) is responsible for calling `store.appendMessages()` after each turn. The store is a single global database at `~/.myagent/myagent.sqlite`.

The `TurnEvent` system does not affect persistence — the final `Message[]` is identical whether or not events were observed.

## Approval memory

When `checkToolPermission()` returns "ask", the session loop checks approval memory before prompting the user:

1. **Session rules** — `sessionApprovalRules: ApprovalRule[]` passed via `TurnOptions`. In-memory, process-scoped.
2. **Workspace rules** — `permission_rules` table in `~/.myagent/myagent.sqlite`, queried via `store.findMatchingRule()`.

If a matching rule is found, the tool auto-executes without triggering the approval handler. No `tool_approval_required` or `tool_approval_decision` events are emitted for auto-approved calls.

If no matching rule exists and an approval handler is provided, the handler returns an `ApprovalResponse`:

- `allow_once` — execute, no rule saved.
- `allow_for_session` — push to `sessionApprovalRules`, execute.
- `allow_for_workspace` — insert into `permission_rules` via store, execute.
- `abort` — block tool, terminate turn.

The `sessionApprovalRules` array is passed by reference from the chat loop. Rules added by `allow_for_session` accumulate across turns within the same CLI session.

Sensitive requests are excluded from approval memory. They can execute after an explicit approval, but no session rule or workspace rule is created, and existing broad rules cannot auto-allow them.

## Abort

When the user chooses abort:

1. A blocked `tool_result` message is added to the transcript.
2. `turn_finished` is emitted.
3. `runAgentLoop` returns `{ aborted: true }`.
4. `runTurn` returns `{ session, newMessages, aborted: true }`.
5. In chat mode: the loop prints "Turn aborted. Tell myagent what to do differently." and returns to the `>` prompt.
6. In single-shot mode: the process exits with code 1.

The model does not get a second chance to respond within an aborted turn. The blocked tool_result is persisted as part of the transcript.

Approval memory (session or workspace rules) cannot convert a "deny" decision into "allow". It only applies to "ask" decisions.

## Same-turn auto-resolution

When the model returns multiple tool calls in a single assistant message, they are processed sequentially. After the user approves one with `allow_for_session` or `allow_for_workspace`, the new rule is immediately visible to subsequent iterations because `sessionApprovalRules` is a shared mutable array. This means:

- 4 `read_file` calls to an external project: only the first triggers the approval handler; the rest are auto-allowed by the `external_directory` rule saved after the first approval.
- A `bash` read-only command followed by `read_file` in the same external project: after the bash approval saves both `external_directory` and `bash` approvalPattern rules, the `read_file` is auto-allowed by the `external_directory` rule.
- Sensitive files (`.env`, etc.) are still excluded from `external_directory` matching and will always require separate approval.

## Bash two-layer approval

For bash commands with external directory metadata, the session loop requires two independent approvals:

1. **Path layer** — an `external_directory` rule covering the effective cwd or project root
2. **Command layer** — a `bash` rule with `approvalPattern` matching the command family (e.g., `git diff *`)

Both must be present for auto-allow. On approval, both rules are saved simultaneously. This means `git diff` and `git status` in the same external project each need their own command-pattern approval, but share the path approval.

For all other tools (read_file, list_dir, search), only the `external_directory` layer applies — a single rule covers all reads under the approved directory.

## Output budget

Bash tool output is truncated at 20KB characters or 500 lines. Truncated output includes a message suggesting narrower commands (`--stat`, `head/tail`, focused paths). This prevents large outputs (e.g., 71KB `git diff`) from filling the transcript. Truncation happens in `src/tools/bash.ts` via `truncateOutput()` and applies to both stdout and stderr.
