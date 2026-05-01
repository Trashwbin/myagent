# Approval v2

## Overview

When `checkToolPermission()` returns "ask", the session loop checks approval memory before prompting the user. Approved actions can be remembered at session or workspace scope unless the request is sensitive.

## Approval responses

| Input     | Response              | Effect                                                |
| --------- | --------------------- | ----------------------------------------------------- |
| Enter / y | `allow_once`          | Execute once. No rule saved.                          |
| a -> s    | `allow_for_session`   | Save to in-memory rules. Auto-allow for this session. |
| a -> w    | `allow_for_workspace` | Save to SQLite. Auto-allow for this workspace.        |
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

| Tool                     | Pattern source                                                           |
| ------------------------ | ------------------------------------------------------------------------ |
| `bash`                   | `decision.metadata.approvalPattern` when present; otherwise full command |
| `read_file` / `list_dir` | `realPath` from decision metadata                                        |
| `search`                 | `realPath` from decision metadata                                        |
| `edit_file`              | `absolutePath` from decision metadata                                    |

Matching is exact: `(toolName, pattern)` must match. Similar but different commands or paths require separate approval. For bash, command-policy v2 can return reusable command-family patterns such as `git diff *`, `git status *`, or `rg *`.

## Sensitive requests

Sensitive reads are ask, not hard-deny, but they cannot be remembered.

- The CLI prompt is `Approve sensitive request? [Enter/y once, n abort]`.
- `a` / `always` is disabled for sensitive requests.
- If a lower layer still returns `allow_for_session` or `allow_for_workspace`, the session loop executes the tool once but skips all rule persistence.
- Existing session, workspace, `external_directory`, or bash approval-pattern rules cannot auto-allow sensitive reads.

Sensitive requests are identified through `decision.metadata.sensitive === true`. This covers direct file reads/searches and bash commands that the command policy can statically recognize as reading sensitive paths.

## Workspace isolation

- `permission_rules` rows include a `workspace_root` column.
- Rules are only matched when `workspace_root` equals the session's canonical realpath cwd.
- Resuming a session in a different workspace does not inherit rules from other workspaces.

## Important constraints

- Approval memory can only auto-convert "ask" → "allow". It cannot override "deny".
- Approval memory cannot auto-allow sensitive requests.
- `edit_file` always creates a checkpoint, even when auto-allowed by a session or workspace rule.
- The `approval=never` mode still converts "ask" to "deny" before any memory check.
