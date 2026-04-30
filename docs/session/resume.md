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

## Why workspace_root is fixed

A session's messages reference files, checkpoints, and tool results relative to a specific workspace root. Resuming with a different working directory would cause file paths, checkpoint references, and diff output to resolve incorrectly.

The workspace root is captured at session creation and stored in the global database. Resume always uses this stored value — it never falls back to `process.cwd()`.

## Session listing

```bash
myagent --sessions
```

Lists all sessions from the global store, showing session ID, title, workspace root, provider, model, and last update time. This works from any directory.

## Session title

The title is automatically set from the first user message (first 60 characters). It is stored in the sessions table and shown by `--sessions`. Chat sessions that haven't received any input yet show as `(untitled)`.
