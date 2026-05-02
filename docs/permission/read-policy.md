# Filesystem Policy

## Overview

`src/permission/policy.ts` is the unified permission entry point for built-in tools. It returns a `ToolPermissionDecision`:

```ts
type ToolPermissionDecision = {
  behavior: "allow" | "ask" | "deny" | "invalid";
  reason: string;
  resolvedInput?: unknown;
  metadata?: Record<string, unknown>;
};
```

`invalid` is currently used by `apply_patch` preflight and is not a permission state.

## Read-class tools

The current read-class tools are:

- `Read`
- `list_dir`
- `grep`
- `glob`
- `find_up`

All of them use `resolvePathInfo()` and/or `checkReadPolicy()` as the basis for path resolution and boundary checks.

## Shared read rules

For ordinary read targets:

| Condition | Decision | Reason |
| --- | --- | --- |
| path cannot be resolved | deny | path cannot be resolved |
| sensitive path | ask | sensitive file read requires approval |
| workspace path | allow | workspace read is safe |
| outside workspace | ask | file/path is outside workspace |

Outside-workspace non-sensitive reads also receive `externalDirectoryPattern` metadata for reusable project-scoped approvals.

## `Read`

`Read` is file-content reading with:

- `path`
- `offset`
- `limit`

Resolved input includes:

```ts
{ path, offset, limit, resolvedPath, realPath }
```

The tool itself still contains a defensive fallback: without `permissionResolved`, it refuses external or sensitive direct calls.

## `grep`

`grep` is file-content search, not file discovery.

Permission behavior:

- target path resolved with `checkReadPolicy`
- sensitive target search becomes `ask`
- non-sensitive external search becomes `ask` with external-directory metadata

Resolved input also carries:

- `include`
- `exclude`
- `before_context`
- `after_context`
- `max_results`
- `excludeSensitive`

Sensitive best-effort exclusion is implemented with:

- `rg --glob !...` exclusions
- `grep --exclude / --exclude-dir` exclusions

## `glob`

`glob` is file discovery by name pattern.

Permission behavior:

- path resolved with `checkReadPolicy`
- execution requires the resolved path to be a directory
- external non-sensitive directory globbing becomes `ask`
- sensitive paths still require approval

Implementation notes:

- uses `rg --files --hidden --glob <pattern>`
- returns matching file paths, not contents

## `find_up`

`find_up` performs ancestor-chain lookup:

- `name`
- `start_path`
- optional `stop`

Important policy details:

- `start_path` goes through `checkReadPolicy`
- `stop` goes through the same read-policy path
- an invalid or denied `stop` does not silently disappear
- a sensitive or external `stop` upgrades the whole call to `ask`
- approval metadata is keyed off the path that actually triggered approval (including external `stop`)

Execution starts from the parent directory when `start_path` points to a file.

## File mutation policy boundary

Mutation tools are documented separately in [../tools/file-mutation.md](../tools/file-mutation.md).

Current split:

- `edit_file`, `write_file`, `apply_patch` → mutation family
- read-class tools → read family

Mutation tools are workspace-only; read-class tools can read outside the workspace with approval.

## Sensitive path detection

`src/permission/sensitive-paths.ts` defines the path patterns used across:

- `Read`
- `grep`
- `glob`
- `find_up`
- mutation metadata redaction
- bash read-path sensitivity checks

Sensitive examples:

- `.env`, `.env.*`
- `*.pem`, `*.key`
- `id_rsa`, `id_ed25519`
- `.npmrc`, `.pypirc`, `.netrc`
- paths containing `secret`, `credential`, or `token`
- directories like `.ssh`, `.aws`, `.git`

Template files such as `.env.example` remain non-sensitive.

## Workspace boundary

- workspace is the default trust boundary, not the only readable boundary
- read-class tools may cross that boundary with approval
- mutation tools may not
- internal resolved-path fields are not part of the model-facing tool schema
- only the session loop can mark `ToolContext.permissionResolved`
