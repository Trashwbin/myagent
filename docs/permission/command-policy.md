# Command Policy

## Overview

`src/permission/command-policy.ts` is the policy layer for `bash`.

It does not treat bash as a pure string black box anymore. The current design is:

```text
shell string
  -> parseCommand()
  -> CommandIntent
  -> analyzeCommand()
  -> allow / ask / deny + metadata
```

## CommandIntent

`src/permission/command-intent.ts` currently recognizes:

- `file_discovery`
- `content_search`
- `partial_read`
- `fs_primitive`
- `git_read`
- `exec`
- `unknown`

This intent kind is threaded into:

- approval metadata
- CLI display (`bash (content_search)`, etc.)
- transcript capture

## Supported recognized patterns

### file discovery

- `rg --files`
- `rg --files <path>`
- `rg --files | head -n N`

### content search

- `rg -n ...`
- `rg -l ...`
- `grep -rn ...`

### partial read

- `sed -n '10,20p' file`
- `head -n 50 file`
- `tail -n 50 file`
- `wc -l file`
- `stat file`

### filesystem primitives

- `cp`
- `mv`
- `mkdir`

### git read

- `git status`
- `git diff`
- `git log`
- `git show`
- read-only `git branch`

### exec

Known execution-layer commands such as:

- `npm`
- `pnpm`
- `yarn`
- `node`
- `python`
- `make`
- `cargo`
- `go`
- common read-only shell utilities that are not elevated to a more specific intent

## Dangerous or downgraded patterns

These are intentionally not treated as safe recognized read operations:

- `find -exec`
- `find -delete`
- `rg --pre`
- `rg --hostname-bin`
- `rg --search-zip`
- `rg -z`
- `sed -i`
- output redirection (`>`, `>>`, etc.)
- command substitution
- piping into shells
- remote script execution patterns such as `curl | sh`

Depending on the exact command, these become `ask` or `deny`.

## Decision layers

`analyzeCommand()` applies these layers in order:

1. dangerous-pattern deny
2. command-substitution ask
3. output-redirect ask
4. controlled chain handling
5. pipeline/interpreter safety checks
6. unit classification
7. path containment and sensitivity checks

## `cd <dir> && <readonly-cmd>`

The one explicitly supported chained form is:

```bash
cd <dir> && <readonly-cmd>
```

If the second command is a supported read-only command, the policy:

- extracts `effectiveCwd`
- analyzes the second command
- derives `CommandIntent` from that second command

So for example:

- `cd repo && rg -n foo src` → `content_search`
- `cd repo && rg --files` → `file_discovery`

This keeps the intent label aligned with the actually supported path instead of falling back to `unknown`.

## External directory integration

Read-only bash can participate in external-directory approval when:

- the command is classified as read-only
- the resolved paths or effective cwd are outside the workspace

In that case command policy also emits:

- `effectiveCwd`
- `externalDirectoryPattern`
- `externalDirectoryRoot`
- `externalDirectoryReason`
- optional reusable `approvalPattern`

## Output budget

`src/tools/bash.ts` truncates stdout/stderr at:

- 20 KB characters
- or 500 lines

The truncation message tells the model to narrow the command rather than dumping more shell output into context.
