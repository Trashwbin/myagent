# myagent

`myagent` is a small coding-agent runtime for learning and engineering practice.

It is not a Codex, Claude Code, or OpenCode competitor. The goal is to implement
the minimum runtime mechanics behind AI coding agents:

- model streaming
- OpenAI-compatible and Anthropic-compatible model adapters
- session loop
- tool registry
- read/search/edit/bash tools
- permission rules
- transcript persistence
- compaction
- workspace diff
- checkpoint and rewind

## Source References

Reference source is kept outside this project implementation:

- `/Users/zt-user/code/pre/myAgents/source/codex`
- `/Users/zt-user/code/pre/myAgents/source/opencode`
- `/Users/zt-user/code/pre/myAgents/source/claude-code`
- `/Users/zt-user/code/pre/myAgents/source/claude-code-yasas`

Use them for architecture study only. Do not copy implementation code into this
project.

## V0 Flow

```text
user task
  -> model stream
  -> tool call
  -> permission decision
  -> execute read/search/edit/bash
  -> persist message/tool result
  -> continue until final answer
  -> show workspace diff
```

The first useful demo should be:

```text
User: modify a function and run tests
Agent: reads files -> searches code -> edits file -> runs tests -> fixes failure -> prints diff
```

## Non-Goals

- no IDE
- no cloud task runner
- no GitHub issue auto-PR
- no multi-agent orchestration
- no MCP marketplace
- no GUI-use
- no plugin ecosystem
- no broad provider marketplace

## Design Notes

- `docs/source-study.md`
- `docs/tech-stack.md`
