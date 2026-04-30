# Storage Architecture

myagent uses a single global SQLite database for all session data.

## Global transcript store

Location: `~/.myagent/myagent.sqlite` (configurable via `MYAGENT_HOME`)

Owned by: `src/storage/store.ts` (`openStore`)

This is the sole store for session metadata and full transcripts. It lives outside any user project directory because sessions are myagent's own runtime state, not part of the user's codebase.

Tables:

- `sessions` — session metadata (id, workspace_root, provider, model, title, timestamps)
- `messages` — ordered transcript rows (seq, role, content, tool_call_id, tool_name, tool_calls_json)

## Workspace root

`workspace_root` is a field on the session record. It tells myagent which directory to resolve file paths and run commands in. It is not the database location.

A session's workspace root is set when the session is created (`--cwd`) and persisted in the sessions table. On resume, the stored workspace root is used, not the current terminal directory.

Current implementation stores the resolved path string. It does not yet canonicalize symlinks with `realpath`. If the same workspace is reached through both a symlink path and its real target, resume validation may treat them as different directories. This should be fixed in the workspace/session boundary, not in the storage schema.

## Checkpoints

Checkpoints (file snapshots before edits) are still stored under the workspace directory in `<workspace>/.myagent/checkpoints/`. This is intentional — checkpoints contain copies of the workspace's own files and should travel with the project.

## History

Earlier versions stored `myagent.sqlite` inside `<workspace>/.myagent/`. This was changed because session data is agent runtime state, not project state, and should not pollute user project directories. No automatic migration is provided.
