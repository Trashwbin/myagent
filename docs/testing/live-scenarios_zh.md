# Live Scenario Testing

Live scenarios 是多轮回归测试，会调用真实模型 API。它们断言行为边界，而不是固定措辞。

## 目的

当改动影响下面内容时，使用 live scenarios：

- tool selection
- permission / approval behavior
- patch recovery
- external-directory reads
- session-loop completion behavior

普通 `pnpm test` 仍然是确定性的，不需要 API credentials。Live scenarios 是在它之上的单独测试层。

## 运行

```bash
# 列出 scenarios
pnpm exec tsx scripts/live-scenario.ts --list

# 运行一个 scenario
pnpm live:scenario --scenario file-mutation-happy

# 当 package runner 转发额外分隔符时也可用
pnpm live:scenario -- --scenario file-mutation-happy

# 运行所有 scenarios
pnpm live:scenario --all
```

## 配置

Harness 按下面顺序解析 provider settings：

1. 分层 `config.json`
2. per-scenario run overrides
3. defaults

支持的 live-scenario CLI flags：

| Flag | Meaning |
| --- | --- |
| `--scenario` | 运行一个指定 scenario |
| `--all` | 运行完整 scenario set |
| `--list` | 列出可用 scenarios |
| `--output-dir` | transcript 目录 |

Secrets 现在放在分层 config files 中，通常是：

```text
~/.myagent/config.json
<workspace>/.myagent/config.local.json
```

`maxOutputTokens` 来自 config，仍然可以在 scenario definition 自身中被覆盖。

## 当前 scenarios

| Name | What it covers |
| --- | --- |
| `file-mutation-happy` | 简单 `Read` -> `edit_file` 成功路径 |
| `patch-recover` | `apply_patch` validation failure -> `Read` -> corrected retry |
| `sensitive-path` | sensitive file access 和 approval/redaction behavior |
| `multi-file-patch-happy` | 真实的 `glob` + `Read` + `apply_patch` 多文件 happy path |
| `external-directory-approval` | external-directory approval 加 `find_up` boundary discovery |

Harness 之前试验过 truncation scenario。它不是当前 regression gate 的一部分，因为 provider-side truncation behavior 在真实 gateways/models 之间还不够稳定。

## Expectation model

当前 expectation fields：

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

重要语义：

- `success: true` 表示 scenario 必须在没有 blocking tool error、并且最后没有未完成 assistant tool call 的情况下结束。
- `mustContainToolErrors` 用于 recovery scenarios，断言模型恢复前确实发生过失败。
- `requiredApprovalTools` 用于 approval scenarios，断言 runtime 确实提示过审批，而不是模型只是提到了审批。

## Transcript format

每次运行会把 JSON transcript 写入 `.live-scenarios/`。

结构：

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

Entry types：

- `assistant_text`
- `tool_call`
- `tool_started`
- `tool_result`
- `approval`
- `truncated`

Transcripts 写入前会被 redacted，因此含 secret 的内容不会被原样存储。

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

- `scenario-types.ts` 定义 scenario input/output 和 expectation types。
- `transcript-capture.ts` 把 `TurnEvent` 转成结构化 transcript entries，并评估 expectations。
- `scenario-runner.ts` 构建隔离 workspace，注册 tools，运行真实 session，并写入 transcript。
- `scenarios/index.ts` 包含当前 scenario set。
- `scripts/live-scenario.ts` 是 CLI 入口。

## 当前 gaps

Harness 已经足够强，可以 gate：

- multi-file happy path behavior
- patch recovery behavior
- external directory approval behavior

它目前还不是 provider-specific truncation behavior 的稳定 gate。
