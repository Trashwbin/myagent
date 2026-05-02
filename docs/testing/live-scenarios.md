# Live Scenario Testing

Live scenarios are multi-turn regression tests that run against a real model API. They assert on **behavior boundaries** (tool usage, task completion, sensitive content handling), not on fixed output text.

## When to use

- Before releasing tool changes that affect the agent loop, permission system, or patch semantics
- When investigating whether a model provider handles a specific tool pattern correctly
- As a semi-automated quality gate alongside deterministic unit tests

Normal `pnpm test` runs only deterministic unit tests. Live scenarios require API credentials and are run separately.

## Running

```bash
# List available scenarios
pnpm exec tsx scripts/live-scenario.ts --list

# Run a single scenario
pnpm live:scenario --scenario file-mutation-happy

# Also works when your shell or package runner forwards an extra `--`
pnpm live:scenario -- --scenario file-mutation-happy

# Run all scenarios
pnpm live:scenario --all

# Specify provider/model overrides
pnpm live:scenario --scenario sensitive-path --provider openai --model gpt-4o
```

## Configuration

Set via CLI flags or environment variables:

| Flag | Env var | Description |
|------|---------|-------------|
| `--provider` | `MYAGENT_PROVIDER` | `openai` or `anthropic` (default: openai) |
| `--model` | `MYAGENT_MODEL` | Model name |
| `--base-url` | `MYAGENT_BASE_URL` | API base URL |
| `--max-turns` | `MYAGENT_MAX_TURNS` | Max agent turns per scenario |
| `--output-dir` | — | Transcript output directory (default: `.live-scenarios/`) |
| — | `MYAGENT_API_KEY` | API key (required) |
| — | `MYAGENT_AUTH_TOKEN` | Auth token (anthropic) |

`provider`, `model`, `baseUrl`, `maxTurns`, and `maxOutputTokens` are also resolved from `settings.json` (see docs/tech-stack.md). Most fields follow CLI flags > env vars > settings > defaults; `maxOutputTokens` has no CLI flag and resolves as env var > settings > provider default. API keys must be in env vars.

If no API key is provided, the harness exits with a clear error message instead of hanging.

## Scenarios

| Name | What it tests |
|------|---------------|
| `file-mutation-happy` | Basic read → edit flow, no unnecessary bash |
| `patch-recover` | apply_patch failure → re-read → retry |
| `sensitive-path` | Sensitive file triggers approval, file is accessed |
| `multi-file-patch-happy` | Real multi-file happy path with `glob` + `Read` + `apply_patch`, no bash fallback |
| `external-directory-approval` | External directory approval plus `find_up` boundary discovery |

## Expectation model

Scenarios assert on these dimensions:

- **success** — whether the task completes with a final assistant message
- **requiredTools** — tools that must be called at least once
- **forbiddenTools** — tools that must not be called
- **maxTurns** — upper bound on agent turns
- **mustReadFiles** — files that must appear in read_file calls
- **mustReachFiles** — files that must be accessed by any tool
- **mustMutateFiles** — files that must be modified (edit/write/patch)
- **mustContainToolErrors** — error patterns that must appear (for recovery testing)
- **mustNotLeakSensitive** — sensitive content must not appear in tool_started/approval events
- **requiredApprovalTools** — tools that must trigger at least one approval request

## Transcript format

Transcripts are written as JSON to the output directory. Each transcript contains:

```json
{
  "scenario": "file-mutation-happy",
  "provider": "openai",
  "model": "gpt-4o",
  "startedAt": "...",
  "finishedAt": "...",
  "entries": [
    {
      "turn": 1,
      "timestamp": 0.5,
      "event": {
        "type": "assistant_text",
        "text": "I'll read the file"
      }
    },
    {
      "turn": 1,
      "timestamp": 1.2,
      "event": {
        "type": "tool_call",
        "toolCall": { "id": "...", "name": "read_file", "input": { "path": "app.ts" } }
      }
    }
  ],
  "messages": [...]
}
```

Entry types: `assistant_text`, `tool_call`, `tool_started`, `tool_result`, `approval`.

## Architecture

```
src/testing/
  scenario-types.ts      Types: ScenarioDefinition, ScenarioExpectation, TranscriptEntry, ScenarioResult
  transcript-capture.ts   TranscriptCapture (event handler) + evaluateScenario (assertion engine)
  scenario-runner.ts      Orchestrator: provider setup, workspace isolation, session execution
  scenarios/
    index.ts              Scenario definitions and lookup

scripts/
  live-scenario.ts        CLI entry point

test/
  live-scenarios.test.ts  Unit tests for evaluator and capture (no API needed)
```

## Adding a new scenario

1. Add a `ScenarioDefinition` to `src/testing/scenarios/index.ts`
2. Define `setup.files` for workspace content, `prompt` for the task, and `expect` for assertions
3. Run it: `pnpm live:scenario --scenario your-new-scenario`
4. Verify the transcript in `.live-scenarios/`
