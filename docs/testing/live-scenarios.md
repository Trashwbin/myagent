# Live Scenario Testing

Live scenarios are multi-turn regression tests that run against a real model API. They assert on behavior boundaries rather than fixed wording.

## Purpose

Use live scenarios when a change affects:

- tool selection
- permission / approval behavior
- patch recovery
- external-directory reads
- session-loop completion behavior

Normal `pnpm test` remains deterministic and does not require API credentials. Live scenarios are a separate layer on top.

## Running

```bash
# List scenarios
pnpm exec tsx scripts/live-scenario.ts --list

# Run one scenario
pnpm live:scenario --scenario file-mutation-happy

# Also works when the package runner forwards an extra separator
pnpm live:scenario -- --scenario file-mutation-happy

# Run all scenarios
pnpm live:scenario --all
```

## Configuration

The harness resolves provider settings from:

1. CLI flags
2. env vars
3. layered `settings.json`
4. defaults

Supported live-scenario CLI flags:

| Flag | Env var | Meaning |
| --- | --- | --- |
| `--provider` | `MYAGENT_PROVIDER` | `openai` or `anthropic` |
| `--model` | `MYAGENT_MODEL` | model name |
| `--base-url` | `MYAGENT_BASE_URL` | custom provider base URL |
| `--max-turns` | `MYAGENT_MAX_TURNS` | max turns per scenario |
| `--output-dir` | — | transcript directory |

Secrets stay in env vars:

- `MYAGENT_API_KEY`
- `MYAGENT_AUTH_TOKEN`

`maxOutputTokens` is inherited from env/settings and can also be overridden per scenario through the scenario definition itself.

## Current scenarios

| Name | What it covers |
| --- | --- |
| `file-mutation-happy` | simple `Read` → `edit_file` success path |
| `patch-recover` | `apply_patch` validation failure → `Read` → corrected retry |
| `sensitive-path` | sensitive file access and approval/redaction behavior |
| `multi-file-patch-happy` | realistic `glob` + `Read` + `apply_patch` multi-file happy path |
| `external-directory-approval` | external-directory approval plus `find_up` boundary discovery |

The harness previously experimented with a truncation scenario. That is not part of the current regression gate because provider-side truncation behavior was not stable enough across real gateways/models.

## Expectation model

Current expectation fields:

- `success`
- `requiredTools`
- `forbiddenTools`
- `maxTurns`
- `mustReadFiles`
- `mustReachFiles`
- `mustMutateFiles`
- `mustContainToolErrors`
- `mustNotLeakSensitive`
- `mustNotTruncate`
- `requiredApprovalTools`

Important semantics:

- `success: true` means the scenario must end without a blocking tool error and without a final unfinished assistant tool call.
- `mustContainToolErrors` is how recovery scenarios assert that a failure actually happened before the model recovered.
- `requiredApprovalTools` is how approval scenarios assert that the runtime genuinely prompted, not that the model merely mentioned approval.

## Transcript format

Each run writes a JSON transcript into `.live-scenarios/`.

Structure:

```json
{
  "scenario": "multi-file-patch-happy",
  "provider": "openai",
  "model": "mimo-v2.5-pro",
  "startedAt": "...",
  "finishedAt": "...",
  "entries": [
    { "turn": 0, "timestamp": 0.2, "event": { "type": "tool_call", "toolCall": { "name": "glob" } } },
    { "turn": 1, "timestamp": 0.8, "event": { "type": "tool_result", "toolName": "glob", "content": "...", "ok": true } }
  ],
  "messages": []
}
```

Entry types:

- `assistant_text`
- `tool_call`
- `tool_started`
- `tool_result`
- `approval`
- `truncated`

Transcripts are redacted before being written, so secret-bearing content is not stored verbatim.

## Architecture

```text
src/testing/
  scenario-types.ts
  transcript-capture.ts
  scenario-runner.ts
  scenarios/index.ts

scripts/
  live-scenario.ts
```

- `scenario-types.ts` defines scenario input/output and expectation types.
- `transcript-capture.ts` turns `TurnEvent` into structured transcript entries and evaluates expectations.
- `scenario-runner.ts` builds an isolated workspace, registers tools, runs a real session, and writes the transcript.
- `scenarios/index.ts` contains the current scenario set.
- `scripts/live-scenario.ts` is the CLI entry point.

## Current gaps

The harness is strong enough to gate:

- multi-file happy path behavior
- patch recovery behavior
- external directory approval behavior

It is not yet a stable gate for provider-specific truncation behavior.
