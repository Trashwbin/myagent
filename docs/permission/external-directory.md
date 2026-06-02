# External Directory Permission

## Overview

External-directory approval is the reusable read permission model for paths outside the workspace.

It applies to:

- `Read`
- `list_dir`
- `grep`
- `glob`
- `find_up`
- read-only `bash`

Once approved for a project root, later read-class access under that root can auto-allow without per-file prompts.

Approval mode still applies. In `approval: "never"` mode, requests that would ask for external-directory approval are denied instead.

## Project root detection

`src/workspace/project-root.ts` implements `findProjectRoot(startPath, isDirectory?)`.

It walks upward looking for project markers such as:

- `.git`
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `go.mod`
- `Cargo.toml`
- `pyproject.toml`

If no marker is found, it falls back to the nearest parent directory and marks the reason as `parent_directory`.

## Pattern derivation

Approvals are stored as:

```text
/external/project/*
```

Examples:

- `Read ../project/src/session/loop.ts`
- `grep path=../project/src`
- `glob path=../project`
- `find_up start_path=../project/src/session/loop.ts`
- `bash: cd ../project && git diff`

All resolve to the same project-scoped external-directory pattern when they land in the same external project.

## How matching works

An `external_directory` rule covers paths under the approved root. It does not cover:

- sibling projects
- parent directories above the root
- prefix-only path collisions
- write-effect bash commands

Sensitive paths are excluded from external-directory auto-allow even if the surrounding project root is already approved.

## Bash two-layer approval

Read-only bash outside the workspace needs two layers:

1. path approval through `external_directory`
2. command-family approval through `approvalPattern` (for example `git diff *`)

Both must be satisfied for auto-allow.

Read-class tools other than bash only need the path layer.

Sensitive paths never use external-directory auto-allow. If a sensitive file lives under an already approved external project, it still prompts again and the sensitive approval is not remembered.

## `find_up` note

`find_up` participates in external-directory approval in two ways:

- `start_path` may itself be external
- optional `stop` may be the thing that triggers approval

When `stop` is the external path that triggered approval, metadata is keyed off that stop boundary so approval reuse matches the real constraint, not the start path.

## Scope

- session scope: in-memory only
- workspace scope: persisted in `~/.myagent/myagent.sqlite`

Rules are always scoped by canonical workspace root. Different workspaces do not share external-directory approvals.
