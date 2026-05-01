# External Directory Permission

## Overview

When `read_file`, `list_dir`, `search`, or read-only `bash` commands access a path outside the workspace root, the permission system generates an `external_directory` approval pattern scoped to the project root. Once approved (session or workspace scope), all subsequent reads, listings, searches, and read-only bash operations under that project are auto-allowed — without needing per-file or per-command approval.

## Project root detection

`src/workspace/project-root.ts` implements `findProjectRoot(startPath, isDirectory?)` which walks up from the given path looking for project markers. Returns `{ root, reason }` where `reason` is `"project_root"` (marker found) or `"parent_directory"` (no marker, conservative fallback).

Markers (in order of search): `.git`, `package.json`, `pnpm-workspace.yaml`, `yarn.lock`, `pnpm-lock.yaml`, `tsconfig.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`

The `isDirectory` hint is used for non-existent paths (e.g., `list_dir` target that hasn't been created yet) to correctly determine the starting directory.

## Pattern derivation

All patterns are scoped to the project root (or nearest parent directory if no markers exist):

- **read_file** `/ext/project/src/session/loop.ts` → `/ext/project/*` (project root has package.json)
- **list_dir** `/ext/project` → `/ext/project/*`
- **search** `/ext/project/src` → `/ext/project/*` (project root found at /ext/project)
- **bash** `cd ../project && git diff` → `/ext/project/*` (effectiveCwd resolved to project root)

This means approving once for any file in a project covers ALL files and subdirectories.

## How it works

1. Tool call targets a path outside the workspace.
2. `checkToolPermission()` returns "ask" with `externalDirectoryPattern`, `externalDirectoryRoot`, and `externalDirectoryReason` in metadata.
3. The session loop checks session rules, then workspace persisted rules, for any `external_directory` rule whose pattern covers the target path.
4. If a match is found and the path is not sensitive, the tool auto-executes.
5. If no match, the user is prompted with the directory scope.
6. On approval, a rule with `toolName: "external_directory"` is saved (session or workspace scope).

## Matching

An `external_directory` rule with pattern `/ext/project/*` covers:

- `read_file /ext/project/package.json`
- `read_file /ext/project/src/index.ts`
- `list_dir /ext/project`
- `list_dir /ext/project/src`
- `search /ext/project`
- `search /ext/project/src`
- `bash: cd /ext/project && git diff` (read-only, effectiveCwd matches)

It does NOT cover:

- `/ext/other-project/file.txt` (sibling directory)
- `/ext` (parent directory)
- `/ext/project-other/file.txt` (prefix but not a path boundary)
- `bash: cd /ext/project && git add .` (write effect)

## Bash two-layer approval

For bash commands with external directory metadata, the session loop checks TWO independent layers:

1. **Path layer**: an `external_directory` rule covering the effective cwd
2. **Command layer**: a `bash` rule with an `approvalPattern` covering the command family

Both must be satisfied for auto-allow. If only the path is covered, the user is still prompted for the command pattern. If only the command is covered, the user is still prompted for the path.

When the user approves, both rules are saved simultaneously.

### Tools covered by external_directory

| Tool        | `isExternalDirectoryCapable`  |
| ----------- | ----------------------------- |
| `read_file` | always                        |
| `list_dir`  | always                        |
| `search`    | always                        |
| `bash`      | only when `effect === "read"` |

`edit_file` is never covered — it's hard-restricted to workspace.

## Sensitive files

Sensitive files (`.env`, `*.pem`, `.ssh/`, etc.) are NOT auto-allowed by `external_directory` rules. Even if `/ext/project/*` is approved, reading `/ext/project/.env` still requires explicit approval. This is enforced in `matchesApprovalRule()` — sensitive paths are excluded from `external_directory` matching.

## Same-turn auto-resolution

When the model returns multiple tool calls in one assistant message, and the user approves the first with `allow_for_session` or `allow_for_workspace`, subsequent tool calls covered by the new rule are auto-resolved without prompting. This works because the session rules array is shared and mutable — rules pushed during iteration are visible to subsequent iterations.

Example: 4 `read_file` calls across `src/permission`, `src/session`, and `src/tools` in one turn. After the first is approved, the project-root scoped pattern covers all remaining files. Only one approval prompt is shown. If one of the files is `.env`, it still requires a separate approval (sensitive exclusion).

## Workspace isolation

- `permission_rules` rows include a `workspace_root` column.
- `external_directory` rules are only matched when `workspace_root` equals the session's canonical cwd.
- Different workspaces do not share external directory approvals.

## Scope

- **Session**: rules live in the CLI process memory, cleared on exit.
- **Workspace**: rules persist in `~/.myagent/myagent.sqlite`, scoped by `workspace_root`.

`external_directory` is a **read-only** capability. It does not grant write access. `edit_file` and write-effect bash operations are not affected by external directory rules.

## Not in this scope

- Global "allow all external paths" is not implemented.
- Sensitive file override within approved directories is not implemented.
