# Tech Stack

## 决策

v0 使用 TypeScript。

这个项目是 coding-agent runtime kernel，目前还不是 backend service。最快路径是在一个本地 CLI 中打通 agent loop、tool calls、streaming、permissions、transcript store 和 checkpoint flow。

## Runtime

- Language: TypeScript
- Runtime: Node.js 22+
- Package manager: pnpm
- Module format: ESM
- CLI: commander
- Validation: zod
- Tests: vitest
- Formatting: prettier

v0 避免引入 frontend、server framework、Electron、TUI framework 和 plugin system。

## Model Layer

Provider/model selection 应该和 adapter、mode lowering/parsing 分开支持。Runtime 不应该依赖一个宽泛 compatibility layer 来硬吃每个 model family。

当前 adapters 和 modes：

- `@ai-sdk/openai-compatible`，OpenAI Chat-compatible mode，也就是 `mode: "chat"`
- `@ai-sdk/openai`，OpenAI Chat 或 Responses mode，也就是 `mode: "chat" | "responses"`
- `@ai-sdk/anthropic`，Anthropic Messages mode，也就是 `mode: "messages"`

实际模型调用使用 AI SDK provider packages，并用一个薄的本地 adapter 把 AI SDK `fullStream` parts 映射到 runtime 的 canonical `ModelEvent` stream。Transcript lowering 通过 AI SDK UI messages 和 `convertToModelMessages`，因此 tool calls 和 tool results 保持 SDK 期望的 part-shaped boundary。

```text
src/model/
  provider.ts
  types.ts
  ai-sdk-provider.ts
```

CLI 和 live scenario runner 使用 `AiSdkProvider`；provider-specific behavior 应该放在该 adapter 后面，而不是另起一条 parallel compatibility path。

Provider config：

Config files 是可选且分层的：

```text
~/.myagent/config.json                   global
<workspace>/.myagent/config.json         project
<workspace>/.myagent/config.local.json   local (gitignored)
```

Runtime model/provider settings 现在来自分层 config files。`MYAGENT_HOME` 仍然作为 storage/config root override 存在，但 provider credentials 和 base URLs 不再期望从 environment variables 提供。

支持字段：

```json
{
  "$schema": "https://myagent.dev/config.json",
  "model": "mimo/mimo-v2.5-pro",
  "approval": "auto" | "on-request",
  "provider": {
    "mimo": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "...",
        "apiKey": "...",
        "mode": "chat",
        "maxOutputTokens": 4096
      },
      "models": {
        "mimo-v2.5-pro": {
          "name": "mimo-v2.5-pro",
          "limit": {
            "output": 4096
          },
          "options": {
            "store": false
          }
        },
        "gpt-5.2": {
          "name": "GPT-5.2",
          "npm": "@ai-sdk/openai",
          "options": {
            "mode": "responses",
            "store": false
          }
        }
      }
    },
    "mimo-claude": {
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "...",
        "authToken": "...",
        "mode": "messages",
        "maxOutputTokens": 16384
      },
      "models": {
        "claude-sonnet-4-6": {
          "name": "Claude Sonnet 4.6"
        }
      }
    }
  }
}
```

Provider keys 是面向用户的 provider IDs，不是 SDK adapter names。`npm` 字段选择 SDK integration，`options.mode` 选择 request shape，供暴露多种 shape 的 adapters 使用。这允许 `mimo`、`abin`、`gateway-prod` 这样的 provider 暴露它支持的任意 SDK-compatible surface，而不用假装 provider ID 本身是 `openai` 或 `anthropic`。

Model profile IDs 使用 `provider-id/model-id`，例如 `mimo/mimo-v2.5-pro` 或 `mimo-claude/claude-sonnet-4-6`。Model map key 默认就是真实 model ID；`name` 只用于展示。对话期间，`/model` 仍然会列出或切换 profiles，Web composer 也通过 `POST /session/:id/model` 使用同样的 IDs。选中的 profile 会随 session 存储，因此 resume 和 compaction 使用同一个 active model。

Provider-level `npm`、credentials 和 `options` 会被嵌套的 `provider.<name>.models.<id>` entries 继承。当一个 provider 提供多个不兼容 model surfaces 或 endpoints 时，model entry 可以覆盖 `npm` 或 `options`。如果省略 `provider.<name>.models`，myAgent 会从 provider defaults 合成一个 profile。

Top-level `provider`、`model`、`baseUrl`、`apiKey`、`authToken`、`maxOutputTokens`，以及旧的 `providers` map，仍然作为 compatibility keys 被接受，但新 configs 应该使用上面 OpenCode 风格的 `provider` map。

`maxOutputTokens` 控制每个 turn 的输出长度。未设置时，OpenAI-compatible requests 会省略 `max_tokens`，让上游决定默认值。Anthropic requests 仍然发送默认值 16384。

内部 stream boundary：

```ts
type ModelEvent =
  | { type: "text"; id?: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: "reasoning"; id?: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: "tool-call"; id: string; name: string; input: unknown; providerMetadata?: ProviderMetadata }
  | { type: "tool-result"; id: string; name: string; result: unknown; isError?: boolean; providerMetadata?: ProviderMetadata }
  | { type: "finish"; reason: "stop" | "tool-calls" | "length" | "error"; usage?: ModelUsage; providerMetadata?: ProviderMetadata };
```

Session loop 只依赖 canonical `ModelEvent`。每个 provider adapter 会转换自己的 native request、tool schema、stream delta、reasoning payload、tool-call、usage、provider metadata 和 stop-reason format。OpenAI Responses `response.id` 和 output item IDs 这类 provider-specific IDs 会保存在 `providerMetadata` 中，因此 tool-result continuation 可以使用 provider-native conversation linkage，而不是重放不兼容的 raw history。

## Provider Error Handling

Provider adapters 会在错误到达 CLI 前，把 SDK failures 规范化成 `ProviderRuntimeError`。CLI 打印简洁的 provider、kind、message、hint、status、request-id 字段，而不是泄露 raw SDK stack traces。

当前分类覆盖：

- auth failures：`401`、`403`、invalid key、missing Bearer token
- model failures：model not found、unsupported tool call format
- quota and rate limits：`429`、insufficient quota、provider throttling
- transient upstream failures：`500`、`502`、`503`、empty gateway body
- proxy compatibility：wrong base URL、missing custom headers、provider family mismatch
- stream failures：partial stream、malformed tool-call JSON、connection reset

CLI 应该打印简洁可执行的输出，例如：

```text
Provider error [openai/upstream]: 502 status code (no body)
Hint: gateway or upstream provider failed; retry or check upstream account health
Status: 502
```

v0 不实现 automatic retry 或 provider failover。下一步有用的工作是 transcript-safe error records、scoped retry policy，以及只有在用户配置时才启用的显式 failover。

## Tool Layer

只使用显式 built-in tools：

- `Read`：文件内容读取，支持 offset/limit 和行号
- `list_dir`：小范围目录浏览
- `grep`：文件内容搜索，内部使用 ripgrep
- `glob`：按名称 pattern 做文件发现，内部使用 ripgrep
- `find_up`：按名称查找最近祖先文件/目录，例如 package.json、tsconfig.json
- `edit_file`
- `write_file`
- `apply_patch`
- `bash`

实现选择：

- file IO: Node `fs/promises`
- search: shell out to `rg` (ripgrep)
- glob: shell out to `rg --files` (ripgrep)
- find_up: Node `fs.existsSync` with parent directory walk
- shell execution: `execa`
- file mutation: `edit_file` 用于 targeted replacement，`write_file` 用于 whole-file writes，`apply_patch` 用于 structured multi-file changes

推荐探索工作流：

1. `find_up`：通过向上查找定位项目边界和 config files
2. `glob`：在子树内按名称 pattern 找相关文件
3. `grep`：在文件中定位具体内容
4. `Read`：用 offset/limit 读取目标片段

Write/edit/patch tool plan 见 [tools/file-mutation.md](tools/file-mutation.md)。

每个工具应该暴露：

```ts
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
};
```

## Permission Layer

使用本地确定性 permission engine：

```text
allow | ask | deny
```

v0 可以运行在非交互模式：

- `approval: "never"`：拒绝任何需要审批的操作
- `approval: "on-request"`：在 risky tool execution 前询问
- `approval: "auto"`：允许安全 read/search/test commands，对 writes 和 risky commands 询问

当前规则：

- workspace 内读取：allow
- project-root-scoped 外部读取：ask，之后可通过 `external_directory` 复用
- sensitive reads：只 ask once，永不持久化成 session/workspace rules
- read-only bash commands：由 command-policy v2 分类，包括 `cd <dir> && <cmd>` 和 `git -C <dir>` effective cwd handling
- bash 有内部 `CommandIntent` semantic model：每条命令会被解析成 intent kind，也就是 `file_discovery`、`content_search`、`partial_read`、`fs_primitive`、`git_read`、`exec`、`unknown`，这个 intent 会流经 policy/approval/transcript/CLI display
- reusable bash approval patterns：`git diff *`、`git status *`、`rg *`、`npm test *` 等
- workspace 内文件写入：非敏感写入在 `approval: "auto"` 下自动允许，在 `approval: "on-request"` 下询问，在 `approval: "never"` 下拒绝
- destructive commands：默认 deny
- write/network/unknown commands：根据 policy 和 approval mode ask 或 deny

## Persistence

使用 SQLite。

Library：

- `better-sqlite3`

当前 tables：

```text
sessions
messages
message_parts
permission_rules
```

`messages` 表 inline 存储 assistant tool calls 和 tool result metadata。`message_parts` 存储 text、reasoning、tool calls 和 tool results 的 durable normalized parts。Checkpoint ids 存储在成功的 tool-result messages 上；checkpoint snapshot data 本身不存储在 SQLite 中。

Default checkpoints 使用 shadow-git backend，位于：

```text
$MYAGENT_HOME/checkpoints/<workspaceHash>/
```

该目录包含 `repo.git` 和 per-checkpoint JSON metadata。Legacy `copy-v1` checkpoints 位于 `<workspace>/.myagent/checkpoints/`，仍然可读用于 restore 兼容，并且可以通过 `MYAGENT_CHECKPOINT_BACKEND=copy-v1` 显式写入；但新的默认 checkpoints 不再污染 workspace。

Store 存在的目的，是让项目能展示真实 agent runtime behavior，而不只是 prompt wrapper。未来 schema 工作可能会把 tool calls、permission decisions 和 checkpoints 拆成 first-class tables，以支持 CLI 更丰富的 inspection 或 replay。

## Workspace Layer

使用本地 filesystem 加 git commands：

- checkpoint：用 shadow-git backend 在写入前 snapshot touched files
- rewind：恢复 checkpointed files
- diff：`git diff --stat` 和 `git diff`

目标 workspace 不需要是 git repo。Shadow-git checkpoint backend 在 workspace 外维护自己的 bare repo，并用显式 `--git-dir` / `--work-tree` 参数运行 git。如果用户 workspace 是 git repo，普通 `git diff` 仍然是主要 workspace diff output。

## Compaction

Manual 和 automatic compaction 已在 `src/session/compact.ts` 和 `src/session/auto-compact.ts` 中实现。App/session 层根据 context usage 决定何时 compact，而 slash-command/manual entry points 可以显式请求 compaction。

v0 strategy：

- 保留最新 user message
- 保留最新 assistant final answer
- 保留最近 tool results
- 通过 active provider 总结更旧 turns
- 用一条 summary-bearing message 或等价 internal transcript entry 替换旧 messages

v0 不实现 remote compaction、background memory 或 long-term memory。

## Why Not Go For V0

Go 是 sandbox executor、provider gateway、remote task runner 或 serviceized runtime 的好选择，但不是这个 local agent kernel 第一版的最佳实现语言。早期复杂点在 model streaming、tool-call JSON、schema conversion 和 CLI iteration。

只有当某个组件有稳定边界后，再使用 Go。

## V0 Package Dependencies

预期 dependencies：

```text
ai
@ai-sdk/openai
@ai-sdk/anthropic
commander
zod
better-sqlite3
```

预期 dev dependencies：

```text
typescript
tsx
vitest
prettier
@types/node
```

## First Repository Milestone

第一个 repository milestone 不是 polished CLI，而是：

```text
cd /path/to/repo && myagent
cd /path/to/repo && myagent resume <sessionId>
```

两个入口都应该通过同一个 session loop 和 tool registry。只有 config 选择的 model adapter 应该不同。
