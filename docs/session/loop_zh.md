# Session Loop

## 核心结构

`src/session/loop.ts` 驱动运行时：

- 从 registry 构建工具 schemas
- 流式接收模型输出
- 收集工具调用
- 运行权限检查
- 处理审批
- 执行工具
- 追加 transcript messages

主要入口：

- `runTurn(...)`
- `runSession(...)`

## Session state

```ts
type SessionState = {
  id: string;
  cwd: string;
  messages: Message[];
};
```

Session 只存储 transcript 状态。Providers 和 tool registries 由调用方注入。

## Turn events

Loop 会为实时观察者发出 `TurnEvent`：

- `assistant_text_delta`
- `tool_call`
- `assistant_message`
- `tool_approval_required`
- `tool_approval_decision`
- `tool_started`
- `tool_result`
- `turn_truncated`
- `turn_finished`

当 provider 以 `stop.reason = "length"` 结束一个 turn，并且后面没有工具调用时，会发出 `turn_truncated`。

## Permission outcomes

Loop 现在区分四种权限层结果：

- `allow`
- `ask`
- `deny`
- `invalid`

### `allow`

工具立即执行。

### `ask`

Loop 按顺序检查：

1. session approval memory
2. workspace approval memory
3. approval handler

如果审批通过，就用 `resolvedInput` 执行。

### `deny`

Loop 记录一个被阻止的 tool result：

```text
Tool call denied and was not executed: ...
```

### `invalid`

Loop 不进入审批流程，而是记录一个校验风格的 tool result：

```text
Patch validation failed before execution: ...
```

这当前用于 `apply_patch` preflight，因此 patch 校验失败不再和权限拒绝混淆。

## Apply-patch preflight

`apply_patch` 在审批或执行前使用内部 prepare/validation 阶段：

- 解析 patch
- 解析 patch paths
- dry-run hunk application
- 构建 diff metadata

Prepare result 是以下之一：

- invalid
- needs approval
- ready

Session loop 只会对有效 patch 请求审批。

## Checkpoints

Mutation tools 执行前，loop 会使用下面两个 helper 创建 checkpoint：

- `isMutationTool()`
- `getCheckpointPaths()`

覆盖的 mutation tools：

- `edit_file`
- `write_file`
- `apply_patch`

Checkpoint ids 只会追加到成功的 tool results 上。

## Approval memory

Loop 支持：

- one-shot approval
- session approval rules
- workspace approval rules

敏感请求永远不会持久化成可复用规则。

External-directory approvals 会被特殊处理：

- read-class tools 直接使用 external-directory rule
- read-only bash 需要同时满足：
  - external-directory path approval
  - bash command-family approval

## Persistence boundary

Session loop 本身不写 SQLite。CLI 或 harness 会在每个 turn 后持久化 `newMessages`。

全局 transcript store 仍然是：

```text
~/.myagent/myagent.sqlite
```
