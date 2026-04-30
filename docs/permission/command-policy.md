# Command Policy

## Overview

`src/permission/command-policy.ts` implements `analyzeCommand(command, { cwd })` which classifies shell commands and returns `allow`, `ask`, or `deny` with a structured result including extracted paths and command names.

## Layers

1. **Dangerous patterns → deny**: `rm -rf`, `sudo`, `chmod -R`, `curl/wget | sh/bash/zsh/fish`
2. **Command substitution → ask**: `$()` and backticks prevent static analysis. Single-quoted `$()` is safe (literal). Double-quoted `$()` is detected because shell executes substitutions inside double quotes.
3. **Output redirect → ask**: `>`, `>>`, `2>`, `2>>`, `&>` (quote-aware: operators inside quotes are not redirects)
4. **Chain operators → ask**: `&&`, `||`, `;` — blanket ask for now; future: analyze pure read-only chains
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
- Read-only chain auto-allow (`uname -a && sw_vers && hostname` still asks)
- Sandbox or isolation
- ML classifier or pattern learning
- Persistent allow/deny rules or hooks
- MCP or external policy sources

## References

- **OpenCode**: main reference for command-unit parsing, path extraction, and workspace containment
- **Codex**: separation of policy decision from execution
- **Claude Code**: test cases for security boundaries
