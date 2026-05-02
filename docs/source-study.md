# Source Study

Reference snapshots used for design study:

- Codex: `openai/codex`
- OpenCode: `anomalyco/opencode`
- Claude-code sourcemap mirror: `yasasbanukaofficial/claude-code`

## Current borrowing strategy

### From Codex

Main ideas we adopted:

- patch grammar and patch envelope as a first-class tool
- clear split between command analysis/policy and execution
- shell safety as a subsystem, not a few ad hoc string checks
- reusable command-family approval patterns

### From OpenCode

Main ideas we adopted:

- tool registry with explicit descriptions and schemas
- split file exploration into:
  - `Read`
  - `grep`
  - `glob`
  - `find_up`
- separate `edit_file`, `write_file`, and `apply_patch`
- real-model live scenario harness instead of only unit tests

### From Claude-style agent structure

Main ideas we adopted:

- reading costs matter
- tool-specific guidance should live closer to the tool, not all in one system prompt
- file read/edit/write/patch surfaces benefit from distinct contracts

## Current runtime shape

The current runtime is no longer the early v0 shape. At this point it includes:

### Tools

- `Read`
- `list_dir`
- `grep`
- `glob`
- `find_up`
- `edit_file`
- `write_file`
- `apply_patch`
- `bash`

### Mutation model

- `edit_file` for surgical replacements
- `write_file` for whole-file creation/replacement
- `apply_patch` for multi-file atomic changes

All three share:

- one write permission family
- checkpoint integration
- diff/metadata conventions

### Permission model

- `allow`
- `ask`
- `deny`
- `invalid`

`invalid` is the important newer addition. It separates tool validation failure from permission denial, especially for `apply_patch` preflight.

### Bash model

`bash` now has an internal semantic layer:

- `file_discovery`
- `content_search`
- `partial_read`
- `fs_primitive`
- `git_read`
- `exec`
- `unknown`

This intent flows through:

- command policy
- approval metadata
- CLI labels
- transcripts

### Live scenario layer

The harness now has stable high-value scenarios for:

- simple mutation happy path
- patch recovery
- sensitive path access
- real multi-file patch happy path
- external-directory approval

Provider-side truncation is observable in the runtime, but is not currently used as a stable live regression gate.

## Current project direction

The highest-value work is no longer “add more tools”.

The current focus is:

1. keep tool contracts and docs aligned with implementation
2. keep permission, approval, and transcript semantics coherent
3. strengthen real-model live scenarios around actual workflows

That is where the remaining engineering leverage is.
