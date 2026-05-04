# Approval v2

## Overview

When `checkToolPermission()` returns `ask`, the session loop checks approval memory before prompting. Approved actions can be remembered at session or workspace scope unless the request is sensitive.

## Auto-allow in auto mode

In `approval: "auto"` mode, the following workspace-internal, non-sensitive mutations are auto-allowed without prompting:

- `edit_file`
- `write_file`
- `apply_patch`

Conditions for auto-allow:
- Path is inside the workspace
- Not a sensitive path (`.env`, `*.pem`, `*.key`, etc.)
- Validation succeeds (for `apply_patch`, preflight passes)

Sensitive file mutations, outside-workspace access, and bash commands follow their existing policies.

## Approval responses

| Input | Response | Effect |
| --- | --- | --- |
| Enter / y | `allow_once` | execute once, save nothing |
| a → s | `allow_for_session` | save in session memory |
| a → w | `allow_for_workspace` | save in SQLite for this workspace |
| n / Esc | `abort` | block tool and end the turn |

Sensitive prompts only support one-shot approval.

## Approval display contract

The `ApprovalDisplay` type (in `src/permission/display.ts`) provides structured, user-facing display data for approval UIs. It is built server-side and consumed by the web client without additional guessing.

### Variants

**`command`** — Shell command approval (bash):
```ts
{ kind: "command", prompt: "Create directory?", subject: "test-01/js", intent?: "filesystem" }
```

**`mutation`** — File mutation approval (edit_file, write_file, apply_patch):
```ts
{
  kind: "mutation",
  prompt: "Do you want to make these changes?",
  files: [
    { path: "index.html", additions: 1, deletions: 1, diff?: "..." },
    { path: "game.js", additions: 2, deletions: 2, diff?: "..." },
  ]
}
```
- Sensitive mutations set `sensitive: true` and omit `diff`.
- UI should show file names and +/- counts at first level, with diff behind an expandable section.

**`access`** — File/directory access outside workspace or to sensitive paths:
```ts
{ kind: "access", prompt: "Allow access outside the workspace?", subject: "/etc/passwd", scope?: "/ext/project/*" }
```

### Where display flows

1. `buildApprovalDisplay(toolName, input, decision)` in `src/permission/display.ts`
2. `ApprovalRequest.display` in `src/session/loop.ts`
3. `tool_approval_required` TurnEvent carries `display`
4. `approval_required` WebSocket message carries `request.display`
5. Web client renders from `request.display` directly

### UI rendering rules

| Display kind | Primary | Expandable |
| --- | --- | --- |
| `command` | prompt + subject | intent tag |
| `mutation` | prompt + file list with +/- counts | diff hunk per file |
| `access` | prompt + subject | scope label |

The four approval buttons are always: Allow once, Always this session, Always in workspace, Deny.

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

Sensitive mutations do not include diff content in the `ApprovalDisplay`. The UI only shows file name and `+N -M` counts.

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
