# Storage Architecture

myagent uses a single global SQLite database for all session data.

## Global transcript store

Location: `~/.myagent/myagent.sqlite` (configurable via `MYAGENT_HOME`)

Owned by: `src/storage/store.ts` (`openStore`)

This is the sole store for session metadata and full transcripts. It lives outside any user project directory because sessions are myagent's own runtime state, not part of the user's codebase.

Tables:

- `sessions` — session metadata (id, workspace_root, provider, model, title, timestamps)
- `messages` — ordered transcript rows and durable message lifecycle data, including role/content, status, tool calls, tool display data, message parts, usage, provider metadata/raw payloads, checkpoint id, errors, and timestamps
- `message_parts` — durable normalized message parts for text, reasoning, tool calls, and tool results
- `permission_rules` — workspace-scoped reusable approval rules

## Workspace root

`workspace_root` is a field on the session record. It tells myagent which directory to resolve file paths and run commands in. It is not the database location.

A session's workspace root is set when the session is created (`--cwd`) and persisted in the sessions table. The CLI canonicalizes this path with `realpathSync.native(resolve(path))` before storing it. On resume, the stored workspace root is used, not the current terminal directory.

The store persists the path it is given; canonicalization belongs to the workspace/session boundary. CLI-created sessions pass canonical workspace roots into `openStore()`. Direct test harnesses or future API callers should do the same if they construct sessions without the CLI.

## Permission rules

Workspace-scoped approvals are stored in the same SQLite database in `permission_rules`:

- `workspace_root` — canonical workspace root that owns the rule
- `tool_name` — tool or capability name, such as `bash`, `edit_file`, or `external_directory`
- `pattern` — exact approval pattern used for matching
- `action` — currently only `allow`
- `created_at` — insertion timestamp

Rules are scoped by `workspace_root`. A rule created in one workspace does not apply when another workspace is active, even if the tool name and pattern match.

## Checkpoints

Checkpoints (file snapshots before edits) are stored outside the workspace by default under:

```text
$MYAGENT_HOME/checkpoints/<workspaceHash>/
```

If `MYAGENT_HOME` is unset, this resolves to `~/.myagent/checkpoints/<workspaceHash>/`. `MYAGENT_CHECKPOINT_HOME` can override only the checkpoint root.

The default backend is `shadow-git`:

- `<checkpointRoot>/repo.git` stores git objects and commits for snapshots.
- `<checkpointRoot>/checkpoints/<checkpointId>.json` stores checkpoint metadata.
- `workspaceHash` is derived from the resolved workspace path, so checkpoint metadata is scoped to one workspace.
- New checkpoints do not write into `<workspace>/.myagent/checkpoints/`.

Legacy `copy-v1` checkpoints under `<workspace>/.myagent/checkpoints/` are still readable for restore compatibility. They are only written when `MYAGENT_CHECKPOINT_BACKEND=copy-v1`, which is primarily useful for tests or explicit fallback.

## History

Earlier versions stored `myagent.sqlite` inside `<workspace>/.myagent/`. This was changed because session data is agent runtime state, not project state, and should not pollute user project directories. No automatic migration is provided.

Earlier checkpoint snapshots also used `<workspace>/.myagent/checkpoints/`. The current shadow-git backend moved new checkpoint data into the agent data directory for the same reason: runtime recovery state should not be committed, deleted, or modified as part of the user's project files.
