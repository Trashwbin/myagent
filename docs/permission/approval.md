# Approval v2

## Overview

When `checkToolPermission()` returns `ask`, the session loop checks approval memory before prompting. Approved actions can be remembered at session or workspace scope unless the request is sensitive.

## Approval responses

| Input | Response | Effect |
| --- | --- | --- |
| Enter / y | `allow_once` | execute once, save nothing |
| a → s | `allow_for_session` | save in session memory |
| a → w | `allow_for_workspace` | save in SQLite for this workspace |
| n / Esc | `abort` | block tool and end the turn |

Sensitive prompts only support one-shot approval.

## Approval pattern sources

`buildApprovalPattern()` derives the reusable match key:

| Tool | Pattern source |
| --- | --- |
| `bash` | `approvalPattern` from metadata when present; otherwise raw command |
| `Read` / `list_dir` / `grep` / `glob` / `find_up` | `realPath` from metadata |
| `edit_file` / `write_file` | `absolutePath` from metadata |
| `apply_patch` | sorted `affectedPaths` |

Matching is exact by `(toolName, pattern)`.

## Sensitive requests

Sensitive reads and sensitive-path mutations can be explicitly approved, but they are never remembered as reusable rules.

That means:

- no session rule
- no workspace rule
- no external-directory auto-allow

## Invalid vs denied

Approval only applies to `ask`.

- `deny` means a real permission/policy block
- `invalid` means the tool input is structurally or semantically invalid

`invalid` is not part of approval memory and never prompts the user.

Current example:

- `apply_patch` preflight failure → `invalid`
- CLI/tool result wording becomes validation failure, not permission denial

## Workspace isolation

Workspace-scoped rules live in `~/.myagent/myagent.sqlite` and are keyed by canonical workspace root.

Resumed sessions inherit workspace rules from their own stored workspace root, not from the shell directory used to launch the resume command.
