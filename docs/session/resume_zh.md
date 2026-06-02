# Session Resume

## Resume 如何工作

`myagent resume <sessionId>` 会恢复之前的 session，并以交互式 chat 模式继续对话。

### 不带 --cwd resume

```bash
myagent resume abc-123
```

这会在全局 store，也就是 `~/.myagent/myagent.sqlite` 中查找 session，加载完整 transcript，并使用已存储的 `workspace_root` 作为工作目录。这个命令可以从任何终端位置运行。

### 带 --cwd resume

```bash
myagent resume abc-123 --cwd /path/to/repo
```

这会查找 session，然后校验 `--cwd` 是否和 session 存储的 `workspace_root` 匹配。如果二者不同，命令会报错。Session 的 workspace root 是固定的，不应该被静默覆盖。

这意味着：

- `--cwd` 和已存储 workspace root 相同：继续该 session
- `--cwd` 不同：在启动模型前失败
- 不传 `--cwd`：使用已存储 workspace root

目前还没有“把这个 conversation resume 到另一个目录”的行为。那应该是未来显式的 fork 操作，而不是传入不同 `--cwd` 后产生的隐式副作用。

## 为什么 workspace_root 是固定的

一个 session 的 messages 会引用相对于特定 workspace root 的文件、checkpoints 和 tool results。如果用另一个工作目录 resume，会导致文件路径、checkpoint 引用和 diff 输出解析错误。

Workspace root 在 session 创建时捕获，并存储到全局数据库中。Resume 始终使用这个已存储值，永远不会 fallback 到 `process.cwd()`。

## 已知路径边界

当新 session 启动、以及显式 `--cwd` 在 resume 期间被校验时，workspace roots 会通过 `realpathSync.native(resolve(path))` 规范化。这意味着 symlink 路径和真实目标路径在 CLI 路径比较中应该被视为同一个 workspace。

未来工作：

- 让所有非 CLI session 构造路径也遵循同样的 canonicalization 规则
- 为 resume/listing 流程中的 symlinked workspace paths 增加回归测试

## Session listing

```bash
myagent sessions
```

从全局 store 列出所有 sessions，展示 session ID、title、workspace root、provider、model 和最后更新时间。这个命令可以从任何目录运行。

## Session title

Title 会自动从第一条用户消息生成，取前 60 个字符。它存储在 sessions 表中，并显示在 `myagent sessions` 中。还没有收到输入的 chat session 会显示为 `(untitled)`。
