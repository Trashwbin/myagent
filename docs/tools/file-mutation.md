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

Purpose: apply structured multi-file changes in one atomic operation.

Uses the Codex/OpenCode patch envelope rather than raw shell `patch`:

```text
*** Begin Patch
*** Add File: path/to/new.ts
+line one
+line two
*** Update File: src/app.ts
@@ -1,3 +1,4 @@
 context line
-old line
+new line
+extra line
 context line
*** End of File
*** Delete File: old.txt
*** End Patch
```

### Patch envelope

- Must start with `*** Begin Patch` and end with `*** End Patch`.
- Supported operations: `*** Add File`, `*** Update File`, `*** Delete File`.
- `*** Move File` and `*** Move to:` are explicitly rejected; use delete + add.
- Each file path may appear at most once per patch.
- File paths are relative to the workspace. Absolute paths and `..` are rejected.

### Add File

- Content lines must be prefixed with `+`.
- Blank lines within content do not need a prefix.
- Fails if the file already exists.

### Update File hunks

Hunk data structure:

```ts
type PatchHunk = {
  changeContexts: string[];  // context lines from @@ markers
  oldLines: string[];       // lines prefixed with - or space
  newLines: string[];       // lines prefixed with + or space
  isEndOfFile?: boolean;    // set when *** End of File appears
};
```

Context navigation:

- `@@` — bare marker, no context.
- `@@ functionName` — context string for disambiguation.
- `@@ functionName @@` — same as above; trailing `@@` is stripped.
- `@@ -1,3 +1,4 @@` — unified-style range header, range info is ignored, no context.
- `@@ -1,3 +1,4 @@ fn greet` — unified-style range header with context.
- Multiple `@@` lines before a hunk body are seeked sequentially to narrow the match position.
- If `@@` appears in the middle of context text without a trailing closing `@@`, the line is rejected as ambiguous.

Hunk body lines:

- `-` prefix: old line to match.
- `+` prefix: new line to insert.
- ` ` (space) prefix or no prefix: context line, goes into both `oldLines` and `newLines`.

EOF anchor:

- `*** End of File` inside a hunk body sets `isEndOfFile`, causing the match to be attempted from the end of the file.

Insertion-only hunks:

- When `oldLines` is empty and `newLines` is non-empty, lines are inserted after the last context match position (or at end of file).

### Matching strategy

`seekSequence` performs 3-level matching for each `oldLines` pattern:

1. Exact match.
2. `trimEnd()` match.
3. `trim()` match (full trim).

The cursor advances after each hunk so subsequent hunks match after prior matches.

### Line ending handling

On update, the existing file's line ending is detected (`lf` or `crlf`). Content is normalized to LF for matching, and the original line ending is restored on write. New files (add) always use LF.

### Rejected formats

- Standard unified diff headers (`---` / `+++`) inside `*** Update File` are detected and rejected with a clear error message directing the model to use `@@` hunks.

### Validation and execution

- All operations are parsed and validated before any filesystem writes.
- If any hunk fails to match, the tool fails without partial writes.
- If a filesystem write fails mid-patch, all previously applied operations are rolled back (reverse-iterate, restore original content or delete newly-created files).
- The permission system parses the patch, resolves paths, and builds combined diff metadata for approval display.
- For non-sensitive paths, the permission system performs a dry-run hunk application before approval. If any hunk cannot apply or the target file does not exist, the patch is denied at the permission stage — the user sees the specific file and hunk that would fail.
- Sensitive paths cannot be validated (content is not accessible to the permission system), so they still require approval and may fail at execution time.
- Both the approval metadata path and the execution path use the same `tryApplyHunks` helper for hunk application, ensuring consistent line-ending handling and matching semantics.
- Checkpoint covers every affected path before mutation.

`apply_patch` reuses the shared permission, diff metadata, and checkpoint flow used by `edit_file` and `write_file`.

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

## Implementation Status

Implemented:

1. Shared mutation metadata shape.
2. `edit_file` v1: `replace_all`, line-ending preservation, diff metadata.
3. `write_file` with read-before-write and mtime guard.
4. `apply_patch` with Codex/OpenCode-aligned grammar:
   - Patch envelope (`*** Begin Patch` / `*** End Patch`) with strict parsing.
   - Add File with `+` prefix enforcement.
   - Update File with `@@` hunks, context navigation, EOF anchor, insertion-only hunks.
   - Unified-style range headers (`@@ -1,3 +1,4 @@`) parsed and range info ignored.
   - `@@ context @@` form supported (trailing `@@` stripped); ambiguous mid-line `@@` rejected.
   - 3-level line matching (exact → trimEnd → trim) with cursor progression.
   - CRLF preservation on update files via shared `tryApplyHunks` helper.
   - Move File / Move to: explicitly rejected.
   - Standard unified diff (`---`/`+++`) detected and rejected with clear guidance.
   - Atomic pre-flight validation, rollback on execution failure.
   - Approval-stage hunk dry-run: non-sensitive path failures are denied before user approval.
   - Approval metadata with combined diff, checkpoint coverage for all affected paths.

Defer:

- move support
- LSP diagnostics
- automatic formatting
- hidden-git snapshot engine
