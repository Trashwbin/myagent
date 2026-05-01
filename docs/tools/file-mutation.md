# File Mutation Tools

## Goal

File mutation is a core runtime surface, not a convenience wrapper around shell commands. The agent should modify files through structured tools so the session loop can enforce permissions, create checkpoints, show diffs, and prevent stale overwrites.

The tool set should grow in this order:

1. `edit_file` — replace known text in one file.
2. `write_file` — create or overwrite one whole file.
3. `apply_patch` — apply a multi-file structured patch.

These tools have different model ergonomics, but they must share one write policy and one checkpoint path.

```text
edit_file / write_file / apply_patch
  -> FileMutationPolicy
  -> edit permission
  -> checkpoint before mutation
  -> diff metadata for approval/result UI
```

## Why multiple tools

The tools overlap at the filesystem level, but not at the intent level:

| Tool          | Best for                             | Main safety property                  |
| ------------- | ------------------------------------ | ------------------------------------- |
| `edit_file`   | small targeted changes               | `old_string` must match existing text |
| `write_file`  | new files and whole-file replacement | existing files must be read first     |
| `apply_patch` | multi-file add/update/delete ops     | hunks must apply against context      |

Do not create separate permission systems for these tools. They all represent file modification and should be governed by the same `edit` permission family.

## `edit_file`

Current role: exact string replacement in a workspace file.

v1 behavior:

- Keep workspace-only restriction.
- Add `replace_all?: boolean` for deliberate multi-occurrence replacement.
- Preserve existing line ending style when applying replacements.
- Reject `old_string === new_string`.
- Treat `old_string === ""` conservatively. Prefer `write_file` for creating files; `edit_file` should not become the primary file creation tool.
- Return mutation metadata: `diff`, `additions`, `deletions`, and touched file path.

Failure should be explicit: no match, multiple matches when `replace_all` is false, directory target, outside workspace, or stale/unread file state if that guard is later shared with `write_file`.

## `write_file`

Purpose: create a new file or replace an entire file.

Input:

```ts
{
  path: string;
  content: string;
}
```

Rules:

- Path must resolve inside the workspace.
- Parent directories may be created.
- New files are allowed after normal write approval.
- Existing files require a prior `read_file` in the current session.
- Existing files require an mtime guard: if the file's current mtime is newer than the recorded read time, the write is rejected and the model must read again.
- Write approval should show a unified diff between previous content and new content.
- Execution should preserve BOM when replacing an existing file. Line endings should follow the provided content for new files and be explicit in tests.

The read-before-write requirement prevents blind overwrites. The mtime guard prevents clobbering user, formatter, or concurrent agent changes that happened after the model read the file.

## Read State

The session loop needs a small read-state map for stale-write checks:

```ts
type ReadFileState = {
  path: string;
  realPath: string;
  mtimeMs: number;
  readAt: number;
  partial: boolean;
};
```

`read_file` records state after successful reads. A partial read should not authorize a whole-file overwrite unless the implementation can prove the full file was loaded. Directory reads do not authorize file writes.

`write_file` checks state only for existing files. New file creation does not require a previous read.

## `apply_patch`

Purpose: apply structured multi-file changes.

This should follow the Codex/OpenCode patch envelope rather than raw shell `patch`:

```text
*** Begin Patch
*** Add File: path/to/new.ts
+content
*** Update File: src/app.ts
@@
-old
+new
*** Delete File: old.txt
*** End Patch
```

Rules:

- File paths are relative to the workspace. Absolute paths are rejected.
- Supported operations: add, update, delete.
- Move is deferred; use delete + add for now.
- Every affected path must resolve inside the workspace.
- `*** End Patch` is required so truncated patches do not execute.
- The patch is parsed and validated before approval.
- Approval shows the combined diff and per-file summary for non-sensitive paths.
- Sensitive paths still require approval, but approval metadata does not read or expose file contents.
- Checkpoint covers every affected path before mutation.
- If any hunk cannot apply, the tool fails without partial writes.

`apply_patch` is implemented as the structured multi-file mutation tool. It reuses the shared permission, diff metadata, and checkpoint flow used by `edit_file` and `write_file`.

## Permission Model

`edit_file`, `write_file`, and `apply_patch` should all use the same write permission family:

- Workspace path: ask in interactive modes, deny in `--approval never`.
- Outside workspace: deny.
- Sensitive path writes: ask like other writes; secret-read restrictions still apply to reading contents.
- Session/workspace approval memory should match by tool and resolved path or by a future shared `edit` capability, but it must not bypass checkpoints.

Approval metadata should include:

- resolved path or affected paths
- operation type (`edit`, `write`, `patch`)
- diff text or per-file diff metadata
- additions/deletions counts when available

## Checkpoints

Every successful mutation creates a checkpoint before writing, even when approval was auto-allowed by a session/workspace rule.

For `apply_patch`, the checkpoint includes all affected paths before any write occurs. This keeps add, update, and delete operations reversible.

## Initial Implementation Scope

Implemented:

1. Shared mutation metadata shape.
2. `edit_file` v1: `replace_all`, line-ending preservation, diff metadata.
3. `write_file` with read-before-write and mtime guard.
4. `apply_patch` with add/update/delete, required end marker, line-based hunk matching, approval metadata, checkpoint coverage, and rollback on execution failure.

Defer:

- move support
- LSP diagnostics
- automatic formatting
- hidden-git snapshot engine
