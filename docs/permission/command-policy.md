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

`intentKind` is descriptive metadata. The final permission decision still comes from `analyzeCommand()` after dangerous-pattern, chain, pipeline, path, and sensitivity checks.

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

These are recognized as `fs_primitive` intent, but the policy still treats them as write-effect commands and asks for approval.

### git read

- `git status`
- `git diff`
- `git log`
- `git show`
- `git rev-parse`
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
- `dotnet`
- common read-only shell utilities that are not elevated to a more specific intent

Package-manager test commands such as `npm test`, `pnpm test`, `yarn test`, and `npm run test` are treated as read-only test commands unless they also include install/add behavior. Package installs remain write-effect commands.

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
- piping remote content into interpreters such as `python` or `node`
- interpreter eval forms such as `node -e`, `python -c`, `perl -e`, and `ruby -e`
- remote script execution patterns such as `curl | sh`

Depending on the exact command, these become `ask` or `deny`.

Write-effect and network-effect commands such as `touch`, `mkdir`, `mv`, `cp`, `rm`, `chmod`, `chown`, `tee`, `curl`, and `wget` generally become `ask`. Some dangerous forms, such as `rm -rf`, `sudo`, recursive `chmod -R`, piping into shells, and remote script execution are denied.

## Decision layers

`analyzeCommand()` applies these layers in order:

1. controlled `cd <dir> && <readonly-cmd>` handling
2. dangerous-pattern deny
3. command-substitution ask
4. output-redirect ask
5. unsupported chain ask
6. pipeline/interpreter safety checks
7. unit classification
8. path containment and sensitivity checks
9. external effective cwd checks for read-only commands

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

Supported reusable bash approval patterns are currently generated for:

- `git <subcommand> *`
- `rg *`
- `grep *`
- package-manager command families such as `npm test *`

External read-only bash requires both the external-directory rule and the bash command-family rule before approval memory can auto-allow it.

## Output budget

`src/tools/bash.ts` truncates stdout/stderr at:

- 20 KB characters
- or 500 lines

The truncation message tells the model to narrow the command rather than dumping more shell output into context.
