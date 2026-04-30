# Session Loop

## Core functions

### runTurn

`runTurn(provider, registry, session, userInput, options) → TurnResult`

Appends the user input as a message, runs the model+tool loop until the model stops emitting tool calls or `maxTurns` is reached, and returns the updated session state plus only the new messages from this turn.

Key behaviors:

- Builds the tool schema list from the registry for each provider call
- Injects the system prompt with the workspace root
- Handles permission checks (allow / ask / deny) for each tool call
- Creates checkpoints before `edit_file` operations
- Accumulates tool results and feeds them back to the model

### runSession

`runSession(provider, registry, initialMessages, options) → SessionResult`

Backward-compatible wrapper. Extracts the last user message from `initialMessages`, uses preceding messages as history, delegates to `runTurn`, and returns the full transcript.

## Session state

```ts
type SessionState = {
  id: string;
  cwd: string; // canonical workspace root, not process.cwd()
  messages: Message[];
};
```

The provider and registry are not part of session state — they are passed in by the caller. This keeps the session serializable for persistence.

## Multi-turn flow

In chat mode, the CLI creates a `SessionState` and calls `runTurn` for each user input. The returned session replaces the previous state, and `newMessages` is persisted to the global transcript store. Each turn's messages are appended independently, supporting crash recovery.

## Persistence

The session loop itself is unaware of SQLite. The CLI (or test harness) is responsible for calling `store.appendMessages()` after each turn. The store is a single global database at `~/.myagent/myagent.sqlite`.
