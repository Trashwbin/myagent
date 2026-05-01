# Command Policy

## Overview

`src/permission/command-policy.ts` implements `analyzeCommand(command, { cwd })` which classifies shell commands and returns `allow`, `ask`, or `deny` with a structured result including extracted paths and command names.

## Layers

1. **Dangerous patterns → deny**: `rm -rf`, `sudo`, `chmod -R`, `curl/wget | sh/bash/zsh/fish`
2. **Command substitution → ask**: `$()` and backticks prevent static analysis. Single-quoted `$()` is safe (literal). Double-quoted `$()` is detected because shell executes substitutions inside double quotes.
3. **Output redirect → ask**: `>`, `>>`, `2>`, `2>>`, `&>` (quote-aware: operators inside quotes are not redirects)
4. **Chain operators → ask**: `&&`, `||`, `;` — except `cd <dir> && <readonly-cmd>` (see below)
5. **Parse into command units**: split on `|`, `&&`, `||`, `;`
6. **Pipeline interpreter targets**:
   - **Shell targets (sh, bash, zsh, fish) → deny**: piping into a shell is always remote script execution
   - **Interpreter without eval flag + network source → deny**: `curl URL | python3` denies because remote content is piped as a script
   - **Interpreter with eval flag → ask**: `curl URL | python3 -c "..."` or `cat file | node -e "..."` — code execution requires approval
   - **Interpreter without eval flag, no network source → ask**: `cat file | python3` — stdin-as-script requires approval
7. **Classify each unit**: system info, read-only, write, network, unknown
8. **Path containment**: resolve paths (expand `~`, `$HOME`, `${HOME}`, `$PWD`, `${PWD}`) and check workspace containment using `realpath`

## What we parse

- Pipeline splitting on `|` (not `||`)
- Chain splitting on `&&`, `||`, `;` (quote-aware)
- Redirect detection (quote-aware: `>` inside quotes is not a redirect)
- Command substitution detection: single-quoted content stripped (literal), double-quoted content preserved (`$()` executes inside double quotes)
- Path extraction from file-class commands: `ls`, `cat`, `head`, `tail`, `grep`, `rg`, `find`, `wc`, `file`, `stat`, `sed`
- Path-taking flags for grep/rg (`-f`, `--file`, `--exclude-from`, `--ignore-file`), find (`-newer`, `-anewer`, `-cnewer`, `-samefile`, `-path`, `-wholename`, `-lname`, `-ilname`, `-ipath`, `-iwholename`), sed (`-f`, `--file`)
- Network output path extraction for curl (`-o`, `--output`, `--output=`, `-O`) and wget (`-O`, `--output-document`, `--output-document=`)
- Workspace path containment with symlink resolution and non-existent path ancestor checking

## Pipeline interpreter policy

| Scenario                                               | Decision | Reason                             |
| ------------------------------------------------------ | -------- | ---------------------------------- |
| `curl URL \| sh/bash/zsh/fish`                         | deny     | Remote script execution            |
| `wget URL \| sh/bash/zsh/fish`                         | deny     | Remote script execution            |
| `curl URL \| python3/python/node/perl/ruby` (no eval)  | deny     | Remote content piped as script     |
| `wget URL \| python3/python/node/perl/ruby` (no eval)  | deny     | Remote content piped as script     |
| `anything \| python3 -c / node -e / perl -e / ruby -e` | ask      | Interpreter eval requires approval |
| `cat file \| python3/node` (no eval, no network)       | ask      | Interpreter stdin-as-script        |
| `cat file \| awk/sort/uniq/tr/cut/column`              | allow    | Read-only pipeline tools           |

## Network output path policy

- `curl -o /tmp/file URL` → ask, reason mentions "outside workspace"
- `curl -o file URL` → ask, path recorded with `insideWorkspace: true`
- `curl -O URL` → ask, reason: "curl -O writes file using remote filename"
- `wget -O /tmp/file URL` → ask, reason mentions "outside workspace"
- `curl URL` (no output flag) → ask (network effect)

## System info commands (always allow)

`uname`, `sw_vers`, `hostname`, `whoami`, `id`, `date`, `pwd`, `sysctl -n`

## Read-only pipeline support

A pipeline is allowed when every command unit is read-only and no unit references a path outside the workspace. For example:

- `sysctl -n hw.memsize | awk '{print $1}'` → allow
- `cat README.md | grep workspace` → allow
- `ls . | head` → allow

## Write-effect commands (always ask)

`touch`, `mkdir`, `mv`, `cp`, `rm`, `chmod`, `chown`, `tee`, `curl`, `wget`

## Path-taking flags coverage

Flags whose argument is a file path, checked against workspace containment:

- **grep/rg**: `-f`, `--file`, `--exclude-from`, `--ignore-file` (rg)
- **find**: `-newer`, `-anewer`, `-cnewer`, `-samefile`, `-path`, `-wholename`, `-lname`, `-ilname`, `-ipath`, `-iwholename`
- **sed**: `-f`, `--file`

Both `--flag VALUE` and `--flag=VALUE` forms are handled.

## Not yet implemented

- Full shell grammar / AST parsing (tree-sitter or otherwise)
- Safe Python/JQ semantic whitelist (e.g., `json.load(sys.stdin)` detection)
- Complex chain auto-allow (`cd dir && cmd && cmd` still asks)
- Sandbox or isolation
- ML classifier or pattern learning
- MCP or external policy sources

## v2: effective cwd and external directory

### `cd <dir> && <readonly-cmd>`

A simple two-unit chain where the first unit is `cd <dir>` and the second is a read-only command is treated as a single command with `effectiveCwd` set to the resolved cd target. All other chains (`;`, `||`, multi-`&&`) still ask.

### `git -C <dir> <subcommand>`

The `-C` flag extracts `effectiveCwd` from the argument. Combined with the readonly git classifier, this allows `git -C ../repo diff` to be classified as a read operation in an external directory rather than a generic bash ask.

### Readonly git classifier

| Subcommand                           | Classification |
| ------------------------------------ | -------------- |
| `git status`                         | read           |
| `git diff`                           | read           |
| `git log`                            | read           |
| `git show`                           | read           |
| `git branch`                         | read           |
| `git remote`                         | read           |
| `git rev-parse`                      | read           |
| `git add/commit/checkout/switch/...` | write (ask)    |
| `git push/pull/merge/rebase/...`     | write (ask)    |
| `git stash/clean/tag`                | write (ask)    |

Readonly git with `effectiveCwd` outside workspace returns `ask` with external directory metadata and `approvalPattern`.

### External directory metadata

When `effectiveCwd` is outside the workspace and the command is read-only, `analyzeCommand` returns:

- `effectiveCwd`: the resolved directory
- `externalDirectoryPattern`: project-root scoped pattern (e.g., `/path/to/project/*`)
- `externalDirectoryRoot`: the project root directory
- `externalDirectoryReason`: `"project_root"` or `"parent_directory"`

See [external-directory.md](external-directory.md) for project root detection.

### Approval pattern

`approvalPattern` provides a reusable pattern for the command family:

| Command                        | Pattern           |
| ------------------------------ | ----------------- |
| `git diff` / `git -C dir diff` | `git diff *`      |
| `git status --short`           | `git status *`    |
| `rg TODO src`                  | `rg *`            |
| `npm test`                     | `npm test *`      |
| `pnpm run test`                | `pnpm run test *` |

Patterns are not generated for pipelines or write-effect commands. Write/deny decisions cannot be overridden by approval patterns.

## v2: Bash reuses external_directory

Bash read-only commands with external `effectiveCwd` can match existing `external_directory` rules. See [external-directory.md](external-directory.md) for the two-layer approval model.

## Output budget

`src/tools/bash.ts` truncates stdout/stderr output at 20KB characters or 500 lines, whichever is hit first. Truncated output includes a message suggesting narrower commands. This prevents large diffs (e.g., 71KB `git diff`) from polluting the transcript.

## References

- **OpenCode**: main reference for command-unit parsing, path extraction, and workspace containment
- **Codex**: separation of policy decision from execution
- **Claude Code**: test cases for security boundaries
