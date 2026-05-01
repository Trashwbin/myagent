# Filesystem Policy

## Overview

`src/permission/policy.ts` implements `checkToolPermission(toolName, input, mode, cwd)` — the unified permission entry point for all tool access decisions. It returns a `ToolPermissionDecision` with behavior, reason, resolved input, and metadata.

## Architecture

```
model tool call input
  → resolvePathInfo()          (path resolution, symlink-aware)
  → checkToolPermission()      (policy decision + resolvedInput + metadata)
  → approvalHandler()          (runtime approval, if needed)
  → tool.execute(resolvedInput) (execution with defensive guard)
```

### Layer responsibilities

1. **Path resolution** (`src/workspace/path-info.ts`): `resolvePathInfo(cwd, inputPath)` resolves any path to a `WorkspacePathInfo`. Single source of truth for path resolution. Does not enforce boundaries — reports facts.

2. **Permission policy** (`src/permission/policy.ts`): `checkToolPermission()` resolves paths, applies sensitivity analysis, and returns allow/ask/deny with `resolvedInput` (for tool execution) and `metadata` (for approval UI).

3. **Tool execution** (`src/tools/*.ts`): Tools accept `resolvedPath`/`realPath` only when `ToolContext.permissionResolved` is true. They retain defensive guards for direct calls bypassing the session loop.

4. **Backward compat** (`src/permission/rules.ts`): Thin wrapper around `checkToolPermission()` returning only `{ behavior, reason }`.

`approval=never` is enforced in the unified policy layer: any decision that would require approval (`ask`) becomes `deny`. Already-safe `allow` decisions still run.

### Key types

```ts
type ToolPermissionDecision = {
  behavior: "allow" | "ask" | "deny";
  reason: string;
  resolvedInput?: unknown; // pre-resolved input for tool.execute()
  metadata?: Record<string, unknown>; // for approval UI
};
```

## read_file / list_dir policy

Uses `resolvePathInfo` via `checkReadPolicy`. Returns `resolvedInput`:

```ts
{ path: string, resolvedPath: string, realPath: string }
```

| Condition                       | Decision | Reason                                |
| ------------------------------- | -------- | ------------------------------------- |
| Path cannot be resolved         | deny     | path cannot be resolved               |
| Sensitive file (anywhere)       | ask      | sensitive file read requires approval |
| Inside workspace, not sensitive | allow    | workspace read is safe                |
| Outside workspace               | ask      | file is outside workspace             |

For outside-workspace non-sensitive paths, the decision metadata includes `externalDirectoryPattern` (e.g., `/ext/project/*`). See [external-directory.md](external-directory.md).

### Tool guard

If `resolvedPath` is not provided (direct tool call), the tool falls back to its own `resolvePathInfo` check and rejects external or sensitive paths.

## search policy

Similar to read_file but with additional semantics:

- Ordinary directory searches set `excludeSensitive: true` in `resolvedInput`
- If the search target itself is sensitive, approval is required and `excludeSensitive: false` is used so an approved search can actually inspect the requested path
- rg uses `--glob` exclusion for sensitive files/directories
- grep uses `--exclude`/`--exclude-dir` for best-effort exclusion
- Search-specific reason wording

Excluded patterns (rg `--glob '!'`):
`.git`, `.ssh`, `.aws`, `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `*secret*`, `*credential*`, `*token*`

## edit_file policy

Hard workspace restriction — outside-workspace edits are **deny**, not ask.

| Condition         | Decision |
| ----------------- | -------- |
| mode === "never"  | deny     |
| Outside workspace | deny     |
| Inside workspace  | ask      |

Returns `resolvedInput`:

```ts
{ path: string, resolvedPath: string, old_string: string, new_string: string }
```

## bash policy

Delegates to `analyzeCommand()` from command-policy. See [command-policy.md](command-policy.md).

## Sensitive file detection

`isSensitiveReadPath(realPath)` in `src/permission/sensitive-paths.ts` matches path segments against patterns. The same module also owns the rg/grep exclusion patterns used by `search`.

**Filenames:** `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `.npmrc`, `.pypirc`, `.netrc`, `*secret*`, `*credential*`, `*token*`

**Directories:** `.ssh`, `.aws`, `.git`

Normal dotfiles like `.gitignore`, `.prettierrc` are not sensitive.

## resolveWorkspacePath

`resolveWorkspacePath(cwd, inputPath)` is preserved as a thin wrapper over `resolvePathInfo`. Returns `pathInfo.absolutePath` for workspace-internal paths, `undefined` otherwise. Used by `edit_file` and `createCheckpoint` for hard workspace guard.

## Workspace boundary

- **Workspace is the default trust boundary, not the only readable boundary.**
- `read_file` and `search` can access outside-workspace paths with user approval.
- `edit_file` and `checkpoint` are hard-restricted to workspace.
- `resolvedInput` is the secure handoff object between permission and tool layers.
- Tool schemas exposed to the model do not include internal handoff fields such as `resolvedPath`, `realPath`, or `excludeSensitive`.
- Direct tool calls cannot activate `resolvedPath`, `realPath`, or `excludeSensitive: false` unless `ToolContext.permissionResolved` is set by the session loop after policy evaluation.
