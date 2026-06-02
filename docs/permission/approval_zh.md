# Approval v2

## 概览

当 `checkToolPermission()` 返回 `ask` 时，会话循环会先检查审批记忆，然后再决定是否提示用户确认。已经批准过的操作可以被记住，记忆范围可以是当前会话，也可以是当前工作区。但敏感请求不能被记住。

当审批模式是 `never` 时，`checkToolPermission()` 会把每个 `ask` 决策转换成 `deny`，原因会保留原始原因并追加 `approval mode is never`。`invalid` 仍然是单独状态，会作为校验失败上报，而不是作为被拒绝的审批请求。

## auto 模式下的自动允许

在 `approval: "auto"` 模式下，下面这些发生在工作区内部、并且不敏感的修改操作，会自动允许，不弹确认：

- `edit_file`
- `write_file`
- `apply_patch`

自动允许需要满足这些条件：

- 路径在工作区内部
- 不是敏感路径，例如 `.env`、`*.pem`、`*.key` 等
- 校验通过。对于 `apply_patch`，需要预检查通过

敏感文件修改、工作区外访问、bash 命令，仍然遵循它们原有的策略。

## 审批响应

| 输入 | 响应 | 效果 |
| --- | --- | --- |
| Enter / y | `allow_once` | 只执行这一次，不保存规则 |
| a -> s | `allow_for_session` | 保存到当前会话记忆 |
| a -> w | `allow_for_workspace` | 保存到当前工作区的 SQLite 数据库 |
| n / Esc | `abort` | 阻止工具执行，并结束这一轮 |

敏感提示只支持一次性批准。

## 审批展示契约

`ApprovalDisplay` 类型位于 `src/permission/display.ts`，它给审批 UI 提供结构化的、面向用户的展示数据。这些数据在服务端构建，Web 客户端直接消费，不需要额外猜测。

### 变体

**`command`**：Shell 命令审批，也就是 bash：

```ts
{
  kind: "command",
  prompt: "Create directory?",
  subject: "test-01/js",
  intent?: "filesystem",
  allowPatternLabel?: "git diff *"
}
```

**`mutation`**：文件修改审批，包括 `edit_file`、`write_file`、`apply_patch`：

```ts
{
  kind: "mutation",
  prompt: "Do you want to make these changes?",
  files: [
    { path: "index.html", additions: 1, deletions: 1, diff?: "..." },
    { path: "game.js", additions: 2, deletions: 2, diff?: "..." },
  ]
}
```

- 敏感修改会设置 `sensitive: true`，并且省略 `diff`。
- UI 第一层应该展示文件名以及增加/删除行数，diff 放到可展开区域里。

**`access`**：访问工作区外路径，或者访问敏感路径：

```ts
{ kind: "access", prompt: "Allow access outside the workspace?", subject: "/etc/passwd", scope?: "/ext/project/*" }
```

`skill` 工具也会渲染成 `access`，提示文案是 `Load skill?`。

### 展示数据流向

1. `src/permission/display.ts` 中的 `buildApprovalDisplay(toolName, input, decision)`
2. `src/session/loop.ts` 中的 `ApprovalRequest.display`
3. `tool_approval_required` 这个 `TurnEvent` 携带 `display`
4. `approval_required` WebSocket 消息携带 `request.display`
5. Web 客户端直接根据 `request.display` 渲染

### UI 渲染规则

| 展示类型 | 主要内容 | 可展开内容 |
| --- | --- | --- |
| `command` | prompt + subject | intent 标签 |
| `mutation` | prompt + 文件列表和 +/- 行数 | 每个文件的 diff hunk |
| `access` | prompt + subject | scope 标签 |

四个审批按钮始终是：Allow once、Always this session、Always in workspace、Deny。

## 审批模式来源

`buildApprovalPattern()` 会生成可复用的匹配 key：

| 工具 | Pattern 来源 |
| --- | --- |
| `bash` | metadata 中的 `approvalPattern`，如果没有则使用原始命令 |
| `Read` / `list_dir` / `grep` / `glob` / `find_up` | metadata 中的 `realPath` |
| `edit_file` / `write_file` | metadata 中的 `absolutePath` |
| `apply_patch` | 排序后的 `affectedPaths` |
| `skill` | metadata 中的 `approvalPattern`，如果没有则使用 skill 名称 |

匹配使用 `(toolName, pattern)` 精确匹配。

对于同时请求外部目录访问的 bash 命令，审批记忆是双层的：

- `external_directory` 覆盖路径或项目根目录
- `bash` 覆盖命令族 pattern，例如 `git diff *`

两个规则都匹配时，后续同类外部只读 bash 命令才会被自动允许。

## 敏感请求

敏感读取和敏感路径修改可以被显式批准，但永远不会被记成可复用规则。

也就是说：

- 不会有会话规则
- 不会有工作区规则
- 不会有外部目录自动允许

敏感修改不会在 `ApprovalDisplay` 里包含 diff 内容。UI 只展示文件名和 `+N -M` 行数。

即使已经存在匹配的会话规则或工作区规则，敏感请求也不会通过审批记忆自动允许。

## invalid 和 denied 的区别

审批只适用于 `ask`。

- `deny` 表示真实的权限或策略阻止
- `invalid` 表示工具输入在结构或语义上无效

`invalid` 不属于审批记忆，也永远不会提示用户。

当前例子：

- `apply_patch` 预检查失败 -> `invalid`
- CLI 或工具结果中的措辞会变成校验失败，而不是权限拒绝

## 工作区隔离

工作区级规则保存在 `~/.myagent/myagent.sqlite`，并用规范化后的工作区根目录作为 key。

恢复会话时，会从该会话自己存储的工作区根目录继承工作区规则，而不是从启动 resume 命令时所在的 shell 目录继承。
