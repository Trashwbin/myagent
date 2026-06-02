# myAgent 本地 Web 应用

## 快速开始

```bash
myagent app
```

这会在 `127.0.0.1` 上启动本地 HTTP + WebSocket 服务器，默认端口是 43110。

在浏览器中打开打印出来的 URL，即可使用本地 Web UI。

Web 应用会从默认项目页启动。项目是 sidebar 中的一等对象；session 属于项目，运行时配置、skills、权限、checkpoints 和 diffs 都会从每个 session 的项目路径解析。`--cwd` 只是 fallback，用于在还没有选择项目时初始化项目列表和创建草稿 session。

浏览器会在 `localStorage` 中记住当前激活 session 和草稿项目目标。再次打开页面时，如果上次选择的 session 仍然存在，就会恢复它；刷新页面不会每次都创建新 session。使用 `New chat` 可以进入所选项目下的草稿状态；只有发送第一条消息时才会创建 session。

嵌入页面遵循 [DESIGN.md](DESIGN.md) 中的设计指南。Shell 仍然由 Node app server 提供，但浏览器客户端从 `src/app/web/entry.ts` 通过 esbuild 打包，并作为 `/assets/client.js` 提供。

Assistant 回答通过一个小型 React markdown island 渲染：

- `react-markdown` 把 markdown 解析成 React 组件。
- `remark-gfm` 启用表格、任务列表、删除线和自动链接。
- `shiki` 会为 fenced code block 懒加载高亮。
- 不启用 raw HTML；用户文本和工具文本仍然使用 text nodes。

## 架构

- **Server** 只绑定到 `127.0.0.1`，不允许远程访问。
- **Browser** 永远不直接执行工具。所有工具执行都发生在 Node.js server 进程中，并复用现有 `runTurn()` loop。
- **Project API** 拥有项目列表；选中的 session 拥有执行上下文，浏览器草稿状态决定下一个新 session 会在哪里创建。
- **Approval** 通过 WebSocket 流转：server 发送 `approval_required`，browser 展示按钮，用户选择后以 `approval_decision` 发回。
- **Session shell** 在浏览器侧：sidebar 展示项目和嵌套 session，header 在紧凑菜单中暴露 session 操作，激活 session 可以在不重启 server 的情况下切换。
- **Markdown rendering** 在浏览器侧：app server 暴露打包后的客户端 `/assets/client.js`；runtime loop 仍然只通过 WebSocket 交换纯文本和结构化工具事件。

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | 返回 `{ ok: true }` |
| GET | `/assets/client.js` | 打包后的浏览器客户端 |
| GET | `/project` | 列出已知项目 |
| POST | `/project` | 创建或更新项目，body: `{ path, name? }` |
| GET | `/config/providers` | 返回公开 provider/model 配置，不含 secrets |
| GET | `/session` | 列出所有 sessions |
| POST | `/session` | 创建新 session，body: `{ projectPath?: string }` |
| GET | `/session/:id/message` | 获取 session 消息历史 |
| GET | `/session/:id/diff` | 获取 session 项目的聚合 git diff |

## WebSocket Protocol

连接到 `/ws`。消息是 JSON。

### Client -> Server

| Type | Fields | Description |
|------|--------|-------------|
| `subscribe_session` | `sessionId` | 订阅 session 事件 |
| `user_message` | `sessionId`, `text` | 发送用户消息，开始一个 turn |
| `approval_decision` | `approvalId`, `decision` | 解决一个 pending approval |
| `cancel_turn` | `sessionId` | 预留，尚未实现 |

### Server -> Client

| Type | Fields | Description |
|------|--------|-------------|
| `ready` | `sessionId?` | 连接已建立 |
| `turn_event` | `sessionId`, `event` | 从 `runTurn()` 转发的 `TurnEvent` |
| `approval_required` | `sessionId`, `approvalId`, `request` | 需要审批 |
| `turn_finished` | `sessionId` | Turn 已完成 |
| `error` | `message`, `code?` | 错误通知 |

## 安全

- Server 只监听 `127.0.0.1`，也就是 localhost。
- Config API 会过滤掉 `apiKey` / `authToken`。
- 不向浏览器暴露工具执行 endpoint。
- 所有 mutation 都走现有 permission/approval 系统。
- 未知或格式错误的消息返回结构化错误，不会让 server 崩溃。

## 与 TUI 的关系

TUI，也就是 `myagent tui`，仍然可用，但不再是复杂交互的主要方向。Web app 共享同一套 session loop、tools、permissions 和 storage。
