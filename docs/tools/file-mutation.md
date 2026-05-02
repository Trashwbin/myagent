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
  -> FileMutationPolicy (shared in mutation-policy.ts)
  -> edit permission family
  -> checkpoint before mutation (via isMutationTool + getCheckpointPaths)
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

## Tool positioning

Each tool has a distinct role and safety gate. Do not blur these boundaries:

- **`edit_file`**: Small surgical edits. Relies on `old_string` matching existing content for safety. Does **not** require `Read` before editing — the `old_string` match itself is the safety gate. Rejects empty `old_string` (directs to `write_file` instead).
- **`write_file`**: Whole-file creation or replacement. For existing files, requires a prior `Read` in the session and an mtime guard. This is the only tool that uses `ReadStateTracker` for read-before-write enforcement.
- **`apply_patch`**: Multi-file atomic operations. Relies on hunk context matching and preflight validation (dry-run hunk apply in the permission check). Does not require prior `Read`.

## Shared policy layer

`src/tools/mutation-policy.ts` provides shared infrastructure used by all three tools:

- **`validateMutationPath`**: Workspace path resolution + boundary check. Used by `edit_file` and `write_file` permission checks.
- **`pathMeta`**: Builds standardized path metadata (`inputPath`, `absolutePath`, `realPath`, `insideWorkspace`) for all mutation tool permission decisions.
- **`buildEditDiffMeta` / `buildWriteDiffMeta`**: Compute approval diff metadata (operation type, diff text, additions/deletions). Moved from `policy.ts` into the shared layer so they can be tested independently and reused.
- **`isSensitivePath`**: Thin wrapper around `isSensitiveReadPath`, used by all three tools to strip diff content from sensitive-path metadata.
- **`isMutationTool` / `getCheckpointPaths`**: Used by the session loop to decide whether to checkpoint and which paths to cover. Replaces the three-branch `if/else` that was hard-coded in `loop.ts`.

What was **not** extracted (and why):

- Tool execution logic: each tool has fundamentally different execution paths (edit replacement, whole-file write, multi-file patch with rollback).
- Read-state management: only `write_file` uses `ReadStateTracker`; extracting it would add indirection without reducing drift.
- Patch parsing / hunk application: only `apply_patch` uses these.

## Permission Model

`edit_file`, `write_file`, and `apply_patch` all use the same write permission family:

- Workspace path: ask in interactive modes, deny in `--approval never`.
- Outside workspace: deny.
- Sensitive path writes: ask like other writes; secret-read restrictions still apply to reading contents.

Approval metadata is consistent across all three tools:

| Field           | edit_file | write_file | apply_patch |
| --------------- | --------- | ---------- | ----------- |
| `operation`     | `"edit"`  | `"write"`/`"create"` | `"patch"` |
| `absolutePath`  | yes       | yes        | —           |
| `affectedPaths` | —         | —          | yes         |
| `diff`          | yes*      | yes*       | yes*        |
| `additions`     | yes*      | yes*       | yes*        |
| `deletions`     | yes*      | yes*       | yes*        |
| `sensitive`     | if needed | if needed  | if any path |
| `failures`      | —         | —          | on preflight failure |

\* Omitted when `sensitive` is true.

Session/workspace approval memory should match by tool and resolved path or by a future shared `edit` capability, but it must not bypass checkpoints.

## Checkpoints

Every successful mutation creates a checkpoint before writing, even when approval was auto-allowed by a session/workspace rule. The session loop uses `isMutationTool()` to detect mutation tools and `getCheckpointPaths()` to extract the paths to checkpoint:

- `edit_file` / `write_file`: single path from `resolvedPath ?? path`.
- `apply_patch`: all paths from `resolvedPaths` keys.

Failed mutations do not expose checkpoint IDs.

## `edit_file`

Current role: exact string replacement in a workspace file.

v1 behavior:

- Keep workspace-only restriction.
- Add `replace_all?: boolean` for deliberate multi-occurrence replacement.
- Preserve existing line ending style when applying replacements.
- Reject `old_string === new_string`.
- Treat `old_string === ""` conservatively. Prefer `write_file` for creating files; `edit_file` should not become the primary file creation tool.
- Return mutation metadata: `diff`, `additions`, `deletions`, and touched file path.
- **No read-before-write gate.** The `old_string` match is the safety mechanism.

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
- Existing files require a prior `Read` in the current session.
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

`Read` records state after successful reads. A partial read should not authorize a whole-file overwrite unless the implementation can prove the full file was loaded. Directory reads do not authorize file writes.

`write_file` checks state only for existing files. New file creation does not require a previous read. `edit_file` and `apply_patch` do not use read state.

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
- `*** Move File` is explicitly rejected; use delete + add.
- `*** Move to:` is only valid after `*** Update File:` (see Move semantics below).
- Each file path (including move destinations) may appear at most once per patch.
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

### Patch authoring tips

These rules matter more than the choice between `@@ context @@` and `@@ -1,3 +1,4 @@`:

- `@@ context @@` is supported. A unified-style range header is optional, not required.
- Use `changeContext` to position the cursor near the target. Use `oldLines` to identify the exact lines to replace. They serve different roles.
- Do not make the `@@` context line the same line as the first deleted line unless you want the next match to start after it. The cursor advances after each matched context line.
- Prefer a stable surrounding marker for context: function name, class name, section title, or the line immediately above the change.
- When a file contains repeated text, add more `@@` context lines instead of relying on fuzzy matching.
- If a patch fails with a context error, the cursor never reached the intended block. Re-read the file and use a better anchor.
- If a patch fails with an old-lines error, the anchor likely matched but the exact body no longer does. Re-read the file and regenerate the hunk body from current content.
- If diagnostics mention whitespace drift, do not assume the header format is wrong. The content likely differs only in indentation, tabs, or spacing.

Recommended pattern:

```text
*** Begin Patch
*** Update File: some/file.txt
@@ section heading @@
 previous line
-old target
+new target
 next line
*** End Patch
```

### Matching strategy

`seekSequence` performs 4-level matching for each `oldLines` pattern:

1. Exact match.
2. `trimEnd()` match.
3. `trim()` match (full trim).
4. `collapseWhitespace` — collapses runs of `\s+` to a single space and trims. Handles tab/space mixing, inconsistent indentation, and multi-space formatting. **Ambiguity guard**: if multiple positions match at this level, the match is rejected and diagnostics report the ambiguity, prompting the model to add more `@@` context.

The cursor advances after each hunk so subsequent hunks match after prior matches.

### Failure diagnostics

When `seekSequence` returns no match, `applyHunks` runs diagnostics via `diagnoseSeekFailure` to produce actionable error messages. Diagnostics check the entire file (not just after the cursor) at the `collapseWhitespace` level to detect near-misses.

Failure categories:

| Category | Detection | Message hint |
|---|---|---|
| Content exists earlier | exact match found before cursor position | "exists earlier in the file — a prior hunk may have shifted the cursor" |
| Whitespace drift | fuzzy match found (collapseWhitespace level) but no exact match | "matches after whitespace normalization but differs in formatting" |
| Ambiguous | multiple fuzzy matches found | "partially matches at N locations — Add more @@ context lines" |
| Partial match | ≥50% of pattern lines match at some level | "partially matches near line X (N% of lines)" |
| No match | no near-miss found | "content may have changed — Re-read the file" |

All failure messages include actionable guidance (re-read file, add context, adjust patch order). Context failures and oldLines failures are reported separately — context failures identify the missing `@@` context line, while oldLines failures note where context was matched (if applicable).

### Line ending handling

On update, the existing file's line ending is detected (`lf` or `crlf`). Content is normalized to LF for matching, and the original line ending is restored on write. New files (add) always use LF.

### Rejected formats

- Standard unified diff headers (`---` / `+++`) inside `*** Update File` are detected and rejected with a clear error message directing the model to use `@@` hunks.
- `*** Move to:` outside of an `*** Update File:` block is rejected.

### Move semantics

`*** Move to: <new_path>` can appear immediately after `*** Update File:`. It renames the file and optionally applies content changes via hunks:

```text
*** Begin Patch
*** Update File: old/path.ts
*** Move to: new/path.ts
@@ class Foo @@
-  oldMethod()
+  newMethod()
*** End Patch
```

Behavior:

- Source file must exist. Destination must not exist (neither file nor directory).
- Both paths must resolve inside the workspace. Absolute paths and `..` are rejected.
- Hunks are applied to the source content, then the result is written to the destination and the source is deleted.
- If the patch contains no content changes, the file is moved as-is.
- Permission metadata includes `moves: [{ from, to }]`. `affectedPaths` contains both source and destination.
- Checkpoint covers both source and destination before mutation.
- Rollback on failure: delete destination (if written), restore source content.
- Result summary shows `moved old/path.ts -> new/path.ts (+N -N)`.
- Read state: destination is tracked as written; source entry is removed.

`*** Move File:` (standalone, without hunks) remains rejected — use delete + add for a plain rename.

### Validation and execution

- All operations are parsed and validated before any filesystem writes.
- If any hunk fails to match, the tool fails without partial writes.
- If a filesystem write fails mid-patch, all previously applied operations are rolled back (reverse-iterate, restore original content or delete newly-created files).
- The permission system parses the patch, resolves paths, and builds combined diff metadata for approval display.
- `apply_patch` performs a **preflight validation** (parse, path resolution, dry-run hunk application) before any approval or execution.
- **Preflight failures are validation errors, not permission denials.** Hunk mismatch, update target not found, move destination conflict, and parse errors are all reported as `Patch validation failed` — they never enter the approval flow.
- True permission denials (outside workspace, `--approval never`) remain distinct from validation failures.
- For non-sensitive paths, the permission system performs a dry-run hunk application before approval. If any hunk cannot apply or the target file does not exist, the patch is reported as a validation failure — the user sees the specific file and hunk that would fail.
- Sensitive paths cannot be validated (content is not accessible to the permission system), so they still require approval and may fail at execution time.
- Both the approval metadata path and the execution path use the same `tryApplyHunks` helper for hunk application, ensuring consistent line-ending handling and matching semantics.
- Checkpoint covers every affected path before mutation.
- On validation failure, the model should re-read the affected files and regenerate the patch rather than requesting approval.

### Failure recovery

When `apply_patch` returns a validation failure (hunk mismatch, context not found, file changed), the error message includes actionable guidance like "Re-read the file". The expected recovery sequence is:

1. `Read` the affected file(s) to gather updated context.
2. Regenerate a new patch based on the current file content.
3. Retry `apply_patch` with the corrected patch.

After a `Read` triggered by patch failure, the model is expected to continue the modification or explicitly explain why it cannot continue. This constraint is encoded in both the tool description guidance and the system prompt.

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

1. Shared mutation policy layer (`mutation-policy.ts`): path validation, diff metadata builders, sensitive-path guard, checkpoint helpers.
2. `edit_file` v1: `replace_all`, line-ending preservation, diff metadata. No read-before-write gate.
3. `write_file` with read-before-write and mtime guard (only tool using `ReadStateTracker`).
4. `apply_patch` with Codex/OpenCode-aligned grammar:
   - Patch envelope (`*** Begin Patch` / `*** End Patch`) with strict parsing.
   - Add File with `+` prefix enforcement.
   - Update File with `@@` hunks, context navigation, EOF anchor, insertion-only hunks.
   - Unified-style range headers (`@@ -1,3 +1,4 @@`) parsed and range info ignored.
   - `@@ context @@` form supported (trailing `@@` stripped); ambiguous mid-line `@@` rejected.
   - 4-level line matching (exact → trimEnd → trim → collapseWhitespace) with cursor progression.
	   - Structured failure diagnostics: context/oldLines separation, whitespace drift detection, ambiguous match detection, partial match percentage, actionable re-read hints.
   - CRLF preservation on update files via shared `tryApplyHunks` helper.
   - Move File rejected; `*** Move to:` supported after `*** Update File:` with hunk application.
   - Standard unified diff (`---`/`+++`) detected and rejected with clear guidance.
   - Atomic pre-flight validation, rollback on execution failure.
   - Approval-stage hunk dry-run: non-sensitive path failures are denied before user approval.
   - Approval metadata with combined diff, checkpoint coverage for all affected paths.
5. Unified session-loop checkpoint via `isMutationTool` / `getCheckpointPaths`.

Defer:

- LSP diagnostics
- automatic formatting
- hidden-git snapshot engine
