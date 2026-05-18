# Relay 实现机制说明

这份文档把简历里的 Relay / AI Coding Agent Harness 描述，映射到当前代码实现。目标不是写宣传稿，而是让你能快速讲清楚：这个 runtime 怎么接模型、怎么跑工具、怎么管理 session、怎么做权限审批、怎么 checkpoint / rewind / compact，以及 Skills 为什么是渐进发现和按需加载。

Relay 当前是一个本地优先的 coding-agent runtime / harness。它不是单纯的 prompt wrapper，而是围绕模型流、工具调用、权限审批、运行工件落盘、checkpoint 恢复、context compact、Skills discovery 形成的一条闭环。

## 简历能力对照

| 简历表述                     | 当前实现                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 统一模型接入                 | `src/config/config.ts`, `src/model/provider-factory.ts`, `src/model/ai-sdk-provider.ts`, `src/model/provider-transform.ts`                                    |
| 工具执行链路                 | `src/tools/*`, `src/tools/registry.ts`, `src/session/loop.ts`                                                                                                 |
| 会话生命周期                 | `src/session/loop.ts`, `src/app/session-api.ts`, `src/cli.ts`                                                                                                 |
| ReAct / Workflow             | 当前是 ReAct-style step loop；没有独立 DAG workflow engine                                                                                                    |
| MCP                          | 当前没有 MCP transport/server；现在的扩展边界是 typed tool registry + filesystem Skills                                                                       |
| 运行工件落盘                 | `src/storage/store.ts`, `src/workspace/checkpoint.ts`, `src/workspace/shadow-git.ts`                                                                          |
| 权限审批与命令治理           | `src/permission/policy.ts`, `src/permission/command-policy.ts`, `src/permission/command-intent.ts`, `src/permission/approval.ts`, `src/permission/display.ts` |
| Checkpoint / rewind / revert | `src/workspace/checkpoint.ts`, `src/workspace/shadow-git.ts`, `src/session/revert.ts`                                                                         |
| 手动 compact                 | `src/session/compact.ts`, `src/app/protocol.ts`, `src/app/session-api.ts`, `src/cli.ts`                                                                       |
| Skills 渐进发现与按需调用    | `src/skill/discovery.ts`, `src/tools/skill.ts`, `src/session/system-prompt.ts`                                                                                |
| Web 会话区与审批 UI          | `src/app/server.ts`, `src/app/protocol.ts`, `src/app/web/*`                                                                                                   |

两个关键词需要讲清楚边界：

- `ReAct / Workflow`：当前实现是 ReAct 风格循环，即模型输出工具调用，runtime 执行工具，把结果回灌给模型，再继续下一步。它不是独立的 workflow DAG、planner graph 或 durable job scheduler。
- `MCP`：当前代码没有 MCP server/client transport。可以说 runtime 的内部抽象已经是 MCP 友好的工具边界，但不能说已经实现 MCP。

## 总体架构

Relay 分成四层：

1. 入口层：CLI、TUI、本地 Web app，主要在 `src/cli.ts`, `src/tui/*`, `src/app/*`。
2. Session runtime：`SessionManager` 和 `runTurn()` 负责会话状态、pending approval、模型切换、compact、rewind、persistence。
3. Agent loop：`runAgentLoop()` 是核心 ReAct 循环，负责接收模型流、聚合 assistant 消息、处理 tool call、执行工具、写回 tool result。
4. Provider / Tool adapter：provider 把不同模型 SDK 的流统一成 canonical event；tool 把具体文件读写、搜索、命令执行封装成 typed schema。

最重要的边界是 `src/model/types.ts` 里的 canonical `ModelEvent`。OpenAI、OpenAI-compatible、Anthropic 的差异在 provider adapter 层被消化，session loop 只处理统一事件：

- `text`
- `reasoning`
- `tool-call`
- `tool-result`
- `finish`
- usage / provider metadata

这样 session loop 不需要理解每个模型厂商的原始请求格式。

## 模型接入

模型配置采用“外层 provider id + 内层 SDK adapter”的结构。外层 provider 可以叫 `mimo`、`mimo-claude`、`gateway-prod`，不强行叫 `openai` 或 `anthropic`。真正决定 SDK 路径的是 `adapter` 和 `mode`。

示例：

```json
{
  "model": "mimo/openai",
  "providers": {
    "mimo": {
      "adapter": "@ai-sdk/openai-compatible",
      "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
      "apiKey": "...",
      "models": {
        "openai": {
          "model": "mimo-v2.5-pro",
          "mode": "chat"
        }
      }
    }
  }
}
```

`src/config/config.ts` 会把配置解析成 `ModelProfile`：

- `id`: `provider-id/model-id`，例如 `mimo/openai`。
- `provider`: 用户配置里的 provider id。
- `adapter`: `@ai-sdk/openai-compatible` / `@ai-sdk/openai` / `@ai-sdk/anthropic`。
- `mode`: `chat` / `responses` / `messages`。
- `baseUrl`, `apiKey`, `authToken`, `maxOutputTokens`。

`src/model/provider-factory.ts` 根据 profile 创建 provider。`src/model/ai-sdk-provider.ts` 真正调用 AI SDK：

- `@ai-sdk/openai-compatible` 走 compatible chat model。
- `@ai-sdk/openai` 可走 chat 或 responses。
- `@ai-sdk/anthropic` 走 messages。

`src/model/provider-transform.ts` 负责把 Relay 自己的 transcript 转成 AI SDK 的 UI/model messages。这里的关键点是：tool call 和 tool result 保留为 part-shaped 数据，而不是压扁成字符串。这也是修复 provider 兼容问题的基础。

OpenAI Responses 路径还会保留 `responseId`，并通过 provider options 设置 `previousResponseId`，让后续请求使用 provider-native continuation，而不是盲目 replay 不兼容历史。

## Session Loop

`src/session/loop.ts` 是整个 runtime 的核心。一次用户 turn 的流程是：

1. `runTurn()` 把用户输入追加成 `user` message。
2. `runAgentLoop()` 从 `ToolRegistry` 生成工具 JSON schema。
3. 构建 system prompt，其中会包含 workspace root 和 Skills summary。
4. provider 开始 stream canonical model events。
5. loop 聚合 assistant text、reasoning、tool calls。
6. 聚合完成后写入一条 assistant message。
7. 如果没有 tool call，本轮结束。
8. 如果有 tool call，逐个进入 permission check。
9. allow / approval 后执行工具。
10. 工具结果写成 `tool_result` message。
11. 如果模型需要继续，带着新 transcript 再进入下一 step。
12. 遇到 stop、abort 或 length 后结束。

`TurnEvent` 是 UI 和 CLI 消费的实时事件层：

- `assistant_text_delta`
- `assistant_message`
- `tool_call`
- `tool_started`
- `tool_result`
- `tool_approval_required`
- `tool_approval_decision`
- `turn_truncated`
- `turn_finished`

CLI、TUI、Web 都不重新实现 agent runtime。它们只是处理这些事件并渲染。

## SessionManager 与 Web 生命周期

Web app 这边由 `src/app/session-api.ts` 的 `SessionManager` 管理 session：

- 根据 session id 恢复 SQLite 里的 session。
- 保证同一个 session 同一时间只有一个 active turn。
- 用户消息先落库，再启动 provider turn。
- approval request 进入 `pendingApprovals` map，等 WebSocket 回传决策。
- turn 结束后追加 assistant/tool messages。
- 支持 `/model` 切换，并把 active model profile 写回 session。
- 支持 `rewindSession()`, `revertLast()`, `compactSession()`。

`src/app/server.ts` 提供 HTTP 和 WebSocket：

- `GET /project`
- `GET /config/providers`
- `GET /session`
- `POST /session`
- `GET /session/:id/message`
- `GET /session/:id/diff`
- WebSocket `/ws`

`src/app/protocol.ts` 定义客户端消息：

- `user_message`
- `approval_decision`
- `rewind_session`
- `revert_last`
- `compact_session`
- `subscribe_session`

## Message 与落盘

Relay 的 message 类型在 `src/model/types.ts`。核心角色有：

- `user`: 用户输入。
- `assistant`: assistant 文本、reasoning、tool-call parts。
- `tool_result`: 工具结果。
- `summary`: compact 后的摘要消息。

`src/storage/store.ts` 用 SQLite 落盘：

- `sessions`: workspace root、model profile、provider、model、title、时间戳。
- `messages`: role/content、tool call id/name、tool calls JSON、tool display JSON、parts JSON、provider metadata、provider raw、checkpoint id。
- `permission_rules`: workspace-scoped approval rules。

这个设计保证 resume 时不是恢复“字符串日志”，而是恢复结构化 transcript。模型历史、工具调用、工具结果、provider metadata、checkpoint id 都能继续被 runtime 使用。

workspace root 是 session 的一部分。`docs/session/resume.md` 也明确：session 不能随便换 cwd resume，因为文件路径、checkpoint、diff 都是 workspace-relative。

## Tool Registry 与工具链

工具注册在 `src/cli.ts` 的 `buildRegistry()`，Web/TUI/test 也复用同一批工具。当前 built-in tools：

- `Read`
- `list_dir`
- `grep`
- `glob`
- `find_up`
- `edit_file`
- `write_file`
- `apply_patch`
- `bash`
- `skill`，只有发现 skills 后才注册

每个 tool 都实现 `ToolDefinition`：

- `name`
- `description`
- `inputSchema`
- 可选 `preparePermissionInput()`
- `execute()`

模型看到的是由 Zod schema 转成的 JSON schema；runtime 看到的是强约束的工具输入和执行结果。

文件修改工具共享同一套 mutation surface：

- `edit_file`: 针对字符串替换，有 read-state / stale write 约束。
- `write_file`: 整文件写入，已有文件必须先 Read。
- `apply_patch`: 多文件 patch，带 preflight validation。

共享逻辑在 `src/tools/mutation-policy.ts`：

- path validation
- diff metadata
- sensitive path guard
- `isMutationTool()`
- `getCheckpointPaths()`

所以 `edit_file`、`write_file`、`apply_patch` 不是三套权限和 checkpoint 逻辑，而是统一进 mutation policy。

## 权限与审批

权限入口是 `src/permission/policy.ts` 的 `checkToolPermission()`。它返回四类结果：

- `allow`: 直接执行。
- `ask`: 需要审批，除非 approval memory 已覆盖。
- `deny`: 明确拒绝，返回 tool result。
- `invalid`: 工具输入或 patch preflight 无效，不进入审批。

`invalid` 很重要。比如 `apply_patch` 如果 hunk 对不上，runtime 会返回 validation failure，而不是让用户审批一个本来就不能执行的 patch。

approval mode 有三种：

- `auto`: 安全读、搜索、部分测试可以自动执行；写入和高风险操作需要审批。
- `on-request`: 更倾向于询问。
- `never`: 任何 ask 都转成 deny。

审批记忆有两层：

- session rule：当前 session 内存里的规则。
- workspace rule：SQLite `permission_rules` 表持久化。

敏感路径不会写入可复用 approval memory，只允许一次性批准。这避免一次敏感文件审批变成长期授权。

审批展示由 `src/permission/display.ts` 和 `src/session/tool-display.ts` 构建结构化 display。Web UI 消费的是 server 生成的 display，不需要靠前端猜字符串。

## 命令治理

`bash` 不是裸奔工具。命令治理分两层：

1. `src/permission/command-intent.ts` 做 command intent 分类。
2. `src/permission/command-policy.ts` 根据 intent、路径、危险模式做 allow/ask/deny。

当前 command intent 包括：

- `file_discovery`
- `content_search`
- `partial_read`
- `fs_primitive`
- `git_read`
- `exec`
- `unknown`

命令策略覆盖的风险包括：

- output redirect
- command substitution
- command chain
- pipeline 中 interpreter eval
- remote script execution
- dangerous delete / chmod / sudo
- network command
- git write subcommand
- sensitive path read
- external directory read

对于外部目录 bash read，runtime 使用双层审批：

1. `external_directory` 路径授权。
2. `bash` command-family 授权，例如 `git diff *`。

这样用户批准某个外部目录，不等于批准所有 shell 命令都能在这个目录执行。

## Checkpoint / Rewind / Revert

所有成功的 mutation tool 执行前，session loop 会先创建 checkpoint：

1. `isMutationTool()` 判断是否是 `edit_file` / `write_file` / `apply_patch`。
2. `getCheckpointPaths()` 计算需要覆盖的文件路径。
3. `createCheckpoint()` 在写入前保存文件级快照。
4. 工具执行成功后，`checkpointId` 写入 `tool_result` message。

默认 checkpoint backend 是 Shadow Git：

- `src/workspace/checkpoint.ts` 构建 checkpoint metadata。
- `src/workspace/shadow-git.ts` 使用 bare git repo 存 blob/tree/commit。
- 每个 checkpoint 生成 tree 和 commit。
- commit 通过 `parentCommitHash` 串成链。
- metadata 保存 workspace hash、tree hash、commit hash、文件是否存在、mode、blob hash。

restore 是文件级：

- checkpoint 时文件存在：恢复 blob 内容和 mode。
- checkpoint 时文件不存在：删除当前文件。
- checkpoint workspace hash 不匹配：拒绝恢复。

`/rewind <checkpointId>` 和 `/revert-last` 在 `src/session/revert.ts`：

- `/rewind <checkpointId>` 恢复指定 checkpoint。
- `/revert-last` 从 transcript 倒序找到最近的 `tool_result.checkpointId` 并恢复。

这两个入口同时暴露给 CLI、WebSocket protocol 和 Web slash command。它们不是让模型“猜怎么回滚”，而是 runtime 用 checkpoint 恢复文件。

## Compact

`/compact` 在 `src/session/compact.ts`。它做的是 session continuation summary，不是长期记忆：

1. 默认保留最近 2 个用户 turn。
2. 用 `preserveRecentChars` 预算约束尾部上下文；如果尾部过大，会继续向后移动 tail 起点，避免 compact 后马上再次超限。
3. 如果历史里已有 `summary`，新 compact 会把它作为 anchored previous summary 更新，而不是把 summary 当普通 transcript 再总结一遍。
4. 把旧 transcript 序列化成 bounded prompt；普通消息和 tool output 有独立上限，旧工具输出会被裁剪，疑似 secret/token 会被脱敏。
5. 调用当前 provider 生成 summary，compaction 期间不传工具，且拒绝 provider 发起 tool call。
6. 用一条 `summary` message 替换旧消息前缀，并在 metadata 里记录 compacted/retained count、tail start、是否复用 previous summary、是否截断 transcript。
7. 保留尾部原始消息继续对话。

summary prompt 要求包含：

- 用户目标和约束。
- 已完成改动和关键文件。
- 关键决策和假设。
- 待办、错误、测试状态。
- 可能需要恢复的 checkpoint id。

所以 compact 后仍能继续当前任务，同时减少上下文长度。

这条路径对齐的是 OpenCode 的本地 compaction 思路：选择要压缩的 head、保留最近 tail、把上一轮 summary 作为 anchor、裁剪旧工具输出，然后通过普通模型调用产出 continuation summary。当前没有接 Codex 那种 provider remote compact endpoint。

## Skills 渐进发现与按需调用

Skills 不是启动时全部塞进 prompt。流程是：

1. `discoverSkills()` 扫描 skill roots。
2. system prompt 只展示 skill `name`、`description`、`scope`。
3. 模型判断任务匹配某个 skill 后，调用 `skill` tool。
4. `skill` tool 才返回完整 `SKILL.md` 内容和少量资源文件列表。

skill roots：

- workspace: `.agents/skills`, `.claude/skills`, `.opencode/skill`, `.opencode/skills`
- myagent home: `$MYAGENT_HOME/skills` 或 `~/.myagent/skills`
- global: `~/.agents/skills`, `~/.claude/skills`

`src/tools/skill.ts` 实现 `skill` tool。权限策略会按 scope 控制：

- workspace skill 在 `auto` 下可自动加载。
- myagent/global skill 在 `auto` 下需要审批。
- `on-request` 总是询问。
- `never` 拒绝 skill load。

这对应简历里的“渐进发现与按需调用”：模型先看到能力摘要，只有需要时才加载完整 instruction。

## Web UI 与 Review Surface

Web 不是另一套 runtime。`src/app/web/*` 只是消费同一个 server protocol 和 session events。

当前 Web 会话区已经从命令式 DOM 迁到 React + reducer：

- `src/app/web/entry.tsx`
- `src/app/web/App.tsx`
- `src/app/web/state/reducer.ts`
- `src/app/web/components/session/*`
- `src/app/web/components/approval/*`
- `src/app/web/components/diff/*`
- `src/app/web/components/review/*`

状态层把 server message / turn event 归并成 timeline：

- user message
- assistant text part
- tool part
- context tool group
- mutation diff
- approval state
- turn-level review

工具展示优先消费 server 生成的 `ToolDisplay`。因此文件 diff、shell summary、context grouping 不再主要依赖前端字符串猜测。

这也是对齐 OpenCode desktop 思路的部分：壳只是壳，会话语义应该来自共享 runtime 和组件化 session UI。

## 一个典型文件修改 turn

以模型调用 `edit_file` 为例：

1. provider stream 出 `tool-call`。
2. session loop 把 assistant text / reasoning / tool call 组成 assistant message。
3. permission policy 解析路径并生成 diff metadata。
4. 如果需要审批，Web/CLI 收到结构化 approval display。
5. 用户批准或 approval memory 命中后，loop 创建 Shadow Git checkpoint。
6. `edit_file` 使用 resolved input 执行修改。
7. result message 写入 SQLite，包含 `toolDisplay` 和 `checkpointId`。
8. Web UI 用 `toolDisplay.files` 渲染文件级 inline diff。
9. 后续 `/revert-last` 可以直接根据最近的 `checkpointId` 恢复。

## 恢复与可追溯性

Relay 的可恢复性来自三类持久化数据：

- SQLite transcript：结构化 messages、tool calls、tool results、provider metadata、checkpoint ids。
- Shadow Git checkpoint store：文件级 blob/tree/commit 快照。
- Workspace permission rules：可复用审批规则。

resume 时，runtime 会：

1. 从 SQLite 读取 session。
2. 使用 session 绑定的 workspace root。
3. 根据 active model profile 重建 provider。
4. 保留 AI SDK 需要的 tool-call/tool-result part shape。
5. 继续同一条 session lifecycle。

rewind/revert 时，runtime 走 checkpoint store 恢复文件，不依赖模型重新生成内容。

## 当前边界

这些边界要主动讲清楚，避免面试时被追问露馅：

- MCP transport/server 当前没有实现。
- Workflow 目前是 ReAct-style loop，不是 DAG workflow engine。
- `cancel_turn` 在 protocol 里有入口，但当前返回 unsupported。
- 没有自动 provider failover。
- 没有 remote background memory。
- Skills 是本地 filesystem discovery，不是远程 marketplace。

更准确的表述是：Relay 当前实现了本地 coding-agent harness 的核心执行闭环；MCP 和 DAG workflow 可以作为未来接入层或扩展方向，但不是当前已完成能力。
