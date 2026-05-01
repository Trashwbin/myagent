# Session Resume

## How resume works

`--resume <sessionId>` restores a previous session and continues the conversation in chat mode.

### Resume without --cwd

```bash
myagent --resume abc-123 --chat
```

Looks up the session in the global store (`~/.myagent/myagent.sqlite`), loads the full transcript, and uses the stored `workspace_root` as the working directory. This works from any terminal location.

### Resume with --cwd

```bash
myagent --resume abc-123 --cwd /path/to/repo --chat
```

Looks up the session, then validates that `--cwd` matches the session's stored `workspace_root`. If they differ, the command errors — a session's workspace root is fixed and should not be silently overridden.

This means:

- same `--cwd` as the stored workspace root: continue the session
- different `--cwd`: fail before starting the model
- no `--cwd`: use the stored workspace root

There is no "resume this conversation in another directory" behavior yet. That should be a future explicit fork operation, not an implicit side effect of passing a different `--cwd`.

## Why workspace_root is fixed

A session's messages reference files, checkpoints, and tool results relative to a specific workspace root. Resuming with a different working directory would cause file paths, checkpoint references, and diff output to resolve incorrectly.

The workspace root is captured at session creation and stored in the global database. Resume always uses this stored value — it never falls back to `process.cwd()`.

## Known path boundary

Workspace roots are canonicalized with `realpathSync.native(resolve(path))` when a new session starts and when an explicit `--cwd` is validated during resume. This means a symlink path and its real target should compare as the same workspace in the CLI path.

Future work:

- keep any non-CLI session construction paths aligned with the same canonicalization rule
- add regression tests for symlinked workspace paths in resume/listing flows

## Session listing

```bash
myagent --sessions
```

Lists all sessions from the global store, showing session ID, title, workspace root, provider, model, and last update time. This works from any directory.

## Session title

The title is automatically set from the first user message (first 60 characters). It is stored in the sessions table and shown by `--sessions`. Chat sessions that haven't received any input yet show as `(untitled)`.
