# Storage Architecture

myagent 对所有 session 数据使用单一全局 SQLite 数据库。

## Global transcript store

位置：`~/.myagent/myagent.sqlite`，可通过 `MYAGENT_HOME` 配置。

归属：`src/storage/store.ts`，也就是 `openStore`。

这是 session metadata 和完整 transcripts 的唯一 store。它位于所有用户项目目录之外，因为 sessions 是 myagent 自己的运行时状态，不属于用户代码库。

表：

- `sessions`：session metadata，包括 id、workspace_root、provider、model、title、timestamps。
- `messages`：有序 transcript rows 和 durable message lifecycle data，包括 role/content、status、tool calls、tool display data、message parts、usage、provider metadata/raw payloads、checkpoint id、errors、timestamps。
- `message_parts`：持久化的规范化 message parts，用于 text、reasoning、tool calls 和 tool results。
- `permission_rules`：workspace-scoped reusable approval rules。

## Workspace root

`workspace_root` 是 session record 上的一个字段。它告诉 myagent 应该在哪个目录下解析文件路径和运行命令。它不是数据库位置。

Session 的 workspace root 在 session 创建时设置，也就是 `--cwd`，并持久化到 sessions 表。CLI 会在存储前通过 `realpathSync.native(resolve(path))` 规范化这个路径。Resume 时使用已存储的 workspace root，而不是当前终端目录。

Store 会持久化调用方传入的路径；canonicalization 属于 workspace/session 边界。CLI 创建的 sessions 会把 canonical workspace roots 传给 `openStore()`。直接 test harness 或未来 API 调用方如果绕过 CLI 构造 sessions，也应该这样做。

## Permission rules

Workspace-scoped approvals 存储在同一个 SQLite 数据库的 `permission_rules` 表中：

- `workspace_root`：拥有该规则的 canonical workspace root。
- `tool_name`：工具或 capability 名称，例如 `bash`、`edit_file`、`external_directory`。
- `pattern`：用于匹配的精确 approval pattern。
- `action`：当前只有 `allow`。
- `created_at`：插入时间戳。

规则按 `workspace_root` 隔离。一个 workspace 中创建的规则不会应用到另一个 workspace，即使 tool name 和 pattern 相同。

## Checkpoints

Checkpoints，也就是编辑前的文件快照，默认存储在 workspace 外部：

```text
$MYAGENT_HOME/checkpoints/<workspaceHash>/
```

如果没有设置 `MYAGENT_HOME`，会解析为 `~/.myagent/checkpoints/<workspaceHash>/`。`MYAGENT_CHECKPOINT_HOME` 只能覆盖 checkpoint root。

默认 backend 是 `shadow-git`：

- `<checkpointRoot>/repo.git` 存储快照用的 git objects 和 commits。
- `<checkpointRoot>/checkpoints/<checkpointId>.json` 存储 checkpoint metadata。
- `workspaceHash` 从已解析的 workspace path 推导，因此 checkpoint metadata 只属于一个 workspace。
- 新 checkpoints 不会写入 `<workspace>/.myagent/checkpoints/`。

位于 `<workspace>/.myagent/checkpoints/` 下的 legacy `copy-v1` checkpoints 仍然可读，用于 restore 兼容。只有设置 `MYAGENT_CHECKPOINT_BACKEND=copy-v1` 时才会写入它们，这主要用于测试或显式 fallback。

## History

早期版本把 `myagent.sqlite` 存储在 `<workspace>/.myagent/` 内。现在改成全局 store，因为 session 数据是 agent runtime state，不是项目状态，不应该污染用户项目目录。当前不提供自动迁移。

早期 checkpoint snapshots 也使用 `<workspace>/.myagent/checkpoints/`。当前 shadow-git backend 把新的 checkpoint 数据移到了 agent data directory，理由相同：运行时恢复状态不应该被作为用户项目文件提交、删除或修改。
