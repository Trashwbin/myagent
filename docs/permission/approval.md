# Approval v2

## Overview

When `checkToolPermission()` returns "ask", the session loop checks approval memory before prompting the user. Approved actions are remembered at session or workspace scope.

## Approval responses

| Input     | Response              | Effect                                                |
| --------- | --------------------- | ----------------------------------------------------- |
| Enter / y | `allow_once`          | Execute once. No rule saved.                          |
| a         | `allow_for_session`   | Save to in-memory rules. Auto-allow for this session. |
| a → w     | `allow_for_workspace` | Save to SQLite. Auto-allow for this workspace.        |
| n / Esc   | `abort`               | Block tool. Terminate turn. Return to user input.     |

## Three layers

1. **allow_once** — no persistence. The tool executes and the decision is forgotten.
2. **allow_for_session** — stored in a `ApprovalRule[]` array held by the chat loop. Lives for the lifetime of the CLI process. Not persisted across restarts.
3. **allow_for_workspace** — stored in `~/.myagent/myagent.sqlite` in the `permission_rules` table. Scoped by canonical `workspace_root`. Survives restarts. Resumed sessions in the same workspace inherit these rules.

## "No, and tell myagent what to do differently"

- The tool is not executed.
- The turn terminates immediately — the model does not get a chance to retry.
- A blocked `tool_result` is added to the transcript.
- Control returns to the user's chat prompt (or exits with code 1 in single-shot mode).
- The feedback does NOT become a permission rule. It's just a normal user correction in the next message.

## Approval pattern

`buildApprovalPattern(toolName, input, decision)` derives a stable pattern string for matching:

| Tool        | Pattern source                        |
| ----------- | ------------------------------------- |
| `bash`      | Full command string                   |
| `read_file` | `realPath` from decision metadata     |
| `search`    | `realPath` from decision metadata     |
| `edit_file` | `absolutePath` from decision metadata |

Matching is exact: `(toolName, pattern)` must match. Similar but different commands or paths require separate approval.

## Workspace isolation

- `permission_rules` rows include a `workspace_root` column.
- Rules are only matched when `workspace_root` equals the session's canonical realpath cwd.
- Resuming a session in a different workspace does not inherit rules from other workspaces.

## Important constraints

- Approval memory can only auto-convert "ask" → "allow". It cannot override "deny".
- `edit_file` always creates a checkpoint, even when auto-allowed by a session or workspace rule.
- The `approval=never` mode still converts "ask" to "deny" before any memory check.
