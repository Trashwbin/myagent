# Goal: Resume Alignment Features

当前优先补齐 3 个会被简历追问的能力：Skills 渐进发现与按需调用、compact、rewind/revert 用户入口。目标不是一次性做完整平台化能力，而是把 runtime 层、CLI/TUI/Web 入口和测试闭环补到可演示、可解释、不会露短板的状态。

## 1. Skills 渐进发现与按需调用

### 目标

实现 OpenCode/Codex 风格的 skill discovery -> available summary -> `skill` tool 按需加载 -> permission 过滤。

系统提示只暴露可用 skill 摘要，不把完整 `SKILL.md` 一次性塞进上下文。模型判断当前任务匹配某个 skill 时，调用 `skill` 工具加载完整内容和资源路径。

### 实现方案

- 新增 `src/skill/types.ts`
  - `SkillInfo`: `name`、`description`、`location`、`content`、`scope`、`baseDir`
  - `SkillSummary`: `name`、`description`、`scope`

- 新增 `src/skill/discovery.ts`
  - 扫描 workspace skill：
    - `<cwd>/.agents/skills/**/SKILL.md`
    - `<cwd>/.claude/skills/**/SKILL.md`
    - `<cwd>/.opencode/{skill,skills}/**/SKILL.md`
  - 扫描 global skill：
    - `$MYAGENT_HOME/skills/**/SKILL.md`
    - `~/.agents/skills/**/SKILL.md`
    - `~/.claude/skills/**/SKILL.md`
  - 解析 frontmatter，最小要求 `name` 和 `description`。
  - duplicate name 按 workspace 优先，其次 `$MYAGENT_HOME`，最后 home external；记录但不中断。
  - 无 frontmatter 或缺必填字段的 skill 跳过，不让坏 skill 破坏 agent 启动。

- 新增 `src/skill/format.ts`
  - `formatSkillSummary(skills)`：生成 system prompt 里的简短 available skills 列表。
  - `formatSkillContent(skill, files)`：生成工具输出：
    - `<skill_content name="...">`
    - skill 正文
    - base directory file URL
    - sampled file list

- 新增 `src/tools/skill.ts`
  - tool name: `skill`
  - input: `{ name: string }`
  - 校验 `name` 必须存在于当前 workspace discover 到的 available skills。
  - 输出完整 skill 内容和最多 10 个同目录资源文件路径。
  - metadata 记录 `skillName`、`baseDir`、`location`。

- 修改 `src/session/system-prompt.ts`
  - 从 `buildSystemPrompt(cwd)` 扩展为可接收 `availableSkills`。
  - system prompt 增加：
    - Skills 是专门工作流。
    - 只有任务匹配摘要时才调用 `skill` 工具。
    - 完整 skill 内容必须通过 `skill` 工具按需加载。

- 修改 tool registry 构建路径
  - `buildRegistry(cwd)` 或引入 `RuntimeContext`，把 discovered skills 注入 `skillTool`。
  - CLI、TUI、Web app 都走同一套 registry，避免只在一个入口可用。

- 修改 permission
  - 在 `src/permission/policy.ts` 增加 `skill` permission 分支。
  - `approval: "never"`：deny skill load。
  - `approval: "auto"`：workspace skill 可 allow；global/external skill 走 ask。
  - `approval: "on-request"`：所有 skill load 走 ask。
  - workspace/session rule pattern 使用 `skill:<name>` 或直接 `<name>`，但必须和普通工具 rule 隔离。
  - 敏感文件规则仍适用：SkillTool 只返回 skill 文件内容，不自动读取任意 reference 文件内容。

### 验收

- system prompt 能列出可用 skill 摘要，但不会包含完整 `SKILL.md` 正文。
- 模型可调用 `skill({ name })` 加载完整 skill。
- 不存在的 skill 返回清晰错误和 available names。
- `approval: never` 下 skill 不会被加载。
- `approval: on-request` 下加载 skill 会进入现有 approval 流。
- tests:
  - `test/skill-discovery.test.ts`
  - `test/skill-tool.test.ts`
  - `test/system-prompt.test.ts`
  - `test/session-loop.test.ts`

## 2. compact

### 目标

补 `/compact` 或 CLI command，把旧 transcript 压成 summary message。先做手动 compact，不做自动上下文溢出 compact。

compact 不能作为普通用户消息交给模型理解；它是会话控制命令。

### 实现方案

- 新增 `src/session/compact.ts`
  - `compactSession(provider, session, options)`：
    - 输入完整 `session.messages`。
    - 保留最近 tail，默认保留最近 1 个 user turn 及其 assistant/tool 结果。
    - 老消息通过 active provider 生成 summary。
    - summary message 用内部结构存回 transcript。

- 扩展 `Message` 类型
  - 最小实现：新增 `role: "assistant"` + `metadata.kind = "compaction"` 风险较小但需要 schema 迁移。
  - 更干净实现：新增 `role: "summary"` 或 `role: "system"`，provider adapter 在请求模型时把它转换为 assistant/system 上下文。
  - 本项目当前 `Message.role` 只有 `user | assistant | tool_result`，推荐先新增 `role: "summary"`，避免 UI 把 compaction 当普通 assistant 回复渲染。

- 存储层改动
  - `messages.role` 已是 TEXT，不需要 SQLite 结构变更。
  - `deserializeMessage` 和类型校验接收 `summary`。
  - `appendMessages` 可写入 summary message。

- compact summary prompt
  - 总结用户目标、已完成修改、关键文件、重要决策、未完成事项、最近错误/约束、可恢复 checkpoint ids。
  - 不保留大段 tool output，不保留敏感内容原文。
  - 输出必须是可继续对话的上下文摘要，不要说“我正在总结”。

- CLI 入口
  - interactive chat 内支持 `/compact`。
  - 新增非交互 command：`myagent compact <sessionId>`。
  - 成功后打印 compacted message count 和 retained tail count。

- TUI/Web 入口
  - TUI prompt 识别 `/compact`，不调用 `runTurn`。
  - Web protocol 增加 `compact_session` client message 和 `session_compacted` server event。
  - Web composer 输入 `/compact` 时走 protocol 控制事件。

### 验收

- `/compact` 后 session.messages 数量减少，旧上下文被一条 summary message 替代。
- compact 后继续提问，provider 能收到 summary + retained tail + 新用户消息。
- 不会把 `/compact` 作为用户消息落库。
- compact 失败不会破坏原 transcript。
- tests:
  - `test/session-compact.test.ts`
  - `test/storage-store.test.ts`
  - `test/cli-dispatch.test.ts`
  - `test/app-server.test.ts`
  - `test/web-reducer.test.ts`

## 3. rewind / revert 用户入口

### 目标

底层 `restoreCheckpoint(cwd, checkpointId)` 已存在。需要补用户可用入口：

- `/rewind <checkpointId>`：恢复指定 checkpoint。
- `/revert-last`：恢复最近一次成功 mutation tool 的 checkpoint。

先做 file-system revert，不做完整 OpenCode message range revert。也就是说，这一阶段恢复文件状态，并记录一个状态消息；是否裁剪历史 transcript 留到后续版本。

### 实现方案

- 新增 `src/session/revert.ts`
  - `findLastCheckpoint(messages)`：从后往前找最近 `tool_result.checkpointId`。
  - `rewindSession(session, checkpointId)`：调用 `restoreCheckpoint(session.cwd, checkpointId)`，返回恢复文件列表/状态。
  - `revertLast(session)`：找到最近 checkpoint 后调用 rewind。

- 存储层补查询
  - 可以先基于 `store.getSession(sessionId).messages` 查找，不新增 SQL。
  - 后续再加 `listCheckpoints(sessionId)` 或 first-class checkpoint table。

- CLI 入口
  - interactive chat 支持：
    - `/rewind <checkpointId>`
    - `/revert-last`
  - 非交互 command：
    - `myagent rewind <sessionId> <checkpointId>`
    - `myagent revert-last <sessionId>`
  - 执行成功后追加一条 status/summary message，避免用户恢复后历史完全无记录。

- TUI/Web 入口
  - TUI prompt 识别 slash command，直接调用 revert service。
  - Web protocol 增加：
    - client: `rewind_session`
    - client: `revert_last`
    - server: `session_rewound`
  - Web UI 可以先只支持 composer slash command，不必先做按钮。

- 安全边界
  - checkpoint id 必须 basename 校验，沿用 `restoreCheckpoint`。
  - 只能恢复 session.cwd 下的 checkpoint。
  - active turn 运行中拒绝 rewind/revert，避免和 tool mutation 并发写文件。
  - 恢复前不自动创建二次 checkpoint；后续可以补 `unrevert`。

### 验收

- `/rewind <checkpointId>` 能恢复指定 mutation 前的文件状态。
- `/revert-last` 能恢复最近一次成功 `edit_file | write_file | apply_patch` 的 checkpoint。
- 无 checkpoint 时给出清晰错误。
- active turn 中调用返回 busy 错误。
- 恢复不会把 checkpoint id 暴露进普通 tool result 内容。
- tests:
  - `test/session-revert.test.ts`
  - `test/checkpoint.test.ts`
  - `test/cli-dispatch.test.ts`
  - `test/app-server.test.ts`

### 当前 MVP 评估

已完成的第一版是 file-copy checkpoint：

- mutation tool 执行前，把受影响文件复制到 `<workspace>/.myagent/checkpoints/<checkpointId>/`。
- `metadata.json` 记录文件是否原本存在。
- `/rewind <checkpointId>` 和 `/revert-last` 只恢复文件状态，并追加一条状态消息。

这个版本满足入口和基础恢复能力，但不对齐 OpenCode/Gemini 的 checkpoint 设计。主要差距：

- checkpoint 数据存放在 workspace 内，容易被误删、误提交或被 agent 修改。
- 逐文件 copy 没有 shadow git 的对象去重、树快照和恢复能力。
- 恢复不是事务级；多文件恢复中途失败会留下半恢复状态。
- rewind/revert 没有裁剪或重写 transcript，文件状态和会话历史可能不一致。
- 没有 unrevert/redo 基础。

## 4. Shadow git checkpoint 对齐

### 目标

把当前 file-copy checkpoint backend 升级为 OpenCode/Gemini 风格的 shadow git checkpoint：

- checkpoint 数据移出 workspace，放到 agent data 目录。
- 使用 shadow git object store 保存快照，利用 git tree/blob 去重。
- 保留现有 `createCheckpoint(cwd, files)` / `restoreCheckpoint(cwd, checkpointId)` 对外 API，CLI/TUI/Web 入口不先大改。
- 新 checkpoint 默认走 shadow git；旧 file-copy checkpoint 保留只读兼容。
- 为后续 message-range rewind、unrevert/redo、checkpoint list 打基础。

### 对齐参考

- OpenCode：使用 shadow git snapshot，turn/step 级生成 patch part，revert 时按 message/part 定位并支持 unrevert。
- Gemini CLI：checkpoint 记录 shadow git snapshot、conversation history、tool call；`/restore` 能恢复文件和历史，并重新提出原 tool call。
- Codex：thread rollback 只回滚会话历史，不负责文件恢复；本项目目标更接近 OpenCode/Gemini。

### 存储设计

- 新增 `src/workspace/checkpoint-store.ts`
  - 负责 checkpoint root、workspace hash、metadata 读写。
  - 默认 root：`$MYAGENT_HOME/checkpoints/<workspaceHash>/`。
  - fallback：`~/.myagent/checkpoints/<workspaceHash>/`。

- 新增 `src/workspace/shadow-git.ts`
  - 负责 shadow git repo 初始化和 git 命令封装。
  - repo path：`<checkpointRoot>/repo.git`。
  - metadata path：`<checkpointRoot>/checkpoints/<checkpointId>.json`。
  - 所有 git 命令显式传 `--git-dir=<repo.git>` 和 `--work-tree=<cwd>`，不污染用户项目 `.git`。
  - 使用独立 `GIT_INDEX_FILE`，避免 checkout/add 操作影响用户仓库 index。

- 扩展 checkpoint metadata：
  - `version: 2`
  - `backend: "shadow-git"`
  - `id`
  - `createdAt`
  - `cwd`
  - `workspaceHash`
  - `treeHash`
  - `commitHash`
  - `parentCommitHash?`
  - `files: [{ path, existed, mode?, blobHash? }]`
  - `toolName?`
  - `toolCallId?`
  - `sessionId?`

- 保留 legacy metadata：
  - `backend` 缺失时视为 `copy-v1`。
  - `restoreCheckpoint()` 先查 shadow metadata，找不到再查 `<workspace>/.myagent/checkpoints/<id>/metadata.json`。
  - 新写入不再生成 workspace 内 `.myagent/checkpoints`。

### Snapshot 语义

第一阶段 shadow git 仍保持当前对外语义：恢复 mutation 前的受影响文件。

- mutation 执行前创建 checkpoint。
- `files` 来自 `getCheckpointPaths(toolName, input)`。
- snapshot 写入 shadow git，但 metadata 只把这些 affected paths 标成可恢复范围。
- 对于原本存在的文件，记录该 path 在 snapshot tree 中的 blob/mode。
- 对于原本不存在的文件，记录 `existed: false`，restore 时删除该 path。
- 二进制文件也由 git blob 保存，不再自己 copy。

第二阶段再升级为 message-range rewind：

- 每个 assistant turn 记录 turn-start snapshot。
- 每个 mutation tool result 记录 checkpoint id 和 patch summary。
- `/rewind <messageId | checkpointId>` 可以恢复文件并隐藏或裁剪目标之后的 transcript。
- `/unrevert` 使用恢复前 snapshot 回到 rewind 前状态。

### Git 操作策略

- 创建 checkpoint：
  - 初始化 shadow repo。
  - 从最近 parent commit/tree 构建独立 index。
  - `git add -A -- <affected paths>` 捕获修改和删除。
  - 对 mutation 明确涉及但被 `.gitignore` 忽略的路径，使用 `git add -f -- <path>`。
  - `git write-tree` 生成 tree。
  - `git commit-tree` 生成 checkpoint commit，parent 指向上一个 checkpoint commit。

- 恢复 checkpoint：
  - active turn 中拒绝恢复。
  - 读取 metadata，校验 `checkpointId` basename、workspaceHash、cwd。
  - 对 `existed: true` 的 path，从 `treeHash` checkout 单文件到 workspace。
  - 对 `existed: false` 的 path，删除 workspace 中对应文件。
  - 恢复前可选创建 pre-restore checkpoint，后续给 `/unrevert` 使用；第一阶段先不默认暴露。

- 失败处理：
  - restore 前先校验所有目标 path 都在 workspace 内。
  - checkout 到临时目录或临时文件，全部准备成功后再替换，避免半恢复。
  - 失败时返回清晰错误，不追加成功状态消息。

### API 迁移

- 保持现有函数名：
  - `createCheckpoint(cwd, files, options?)`
  - `restoreCheckpoint(cwd, checkpointId, options?)`

- 新增能力：
  - `listCheckpoints(cwd, options?)`
  - `getCheckpoint(cwd, checkpointId)`
  - `createRestorePoint(cwd, reason)`：为 unrevert/redo 预留。

- `tool_result.checkpointId` 保持内部字段，不塞进用户可见 tool result content。
- compact summary 可以继续保留 checkpoint ids，但要明确它们是恢复控制信息。

### UI/入口策略

- 第一批只替换 backend，不改用户命令：
  - `/rewind <checkpointId>`
  - `/revert-last`
  - `myagent rewind <sessionId> <checkpointId>`
  - `myagent revert-last <sessionId>`

- 第二批补更接近 OpenCode 的入口：
  - `/undo`：恢复最近 user turn 前状态，并隐藏后续 turn。
  - `/redo` 或 `/unrevert`：恢复到 undo 前状态。
  - Web turn diff/review 区显示“Revert this turn”按钮。
  - TUI 在 turn 或 checkpoint 列表里选择恢复点。

### 安全边界

- checkpoint root 必须在 agent data 目录，不允许由 session 输入覆盖。
- checkpoint id 只能是 basename。
- metadata 的 `workspaceHash` 必须和当前 cwd 重新计算结果一致。
- restore path 必须通过 `resolveWorkspacePath(cwd, path)`。
- shadow git 默认不加入 `.git/`、`.myagent/`、checkpoint root、自身 repo。
- 敏感文件如果被 mutation 明确修改，可以 checkpoint，但不在 UI diff 中泄露内容。
- git 不可用时：
  - 默认返回清晰错误，提示需要 git。
  - 可以通过配置开启 legacy copy backend fallback，但不能静默降级。

### 测试计划

- `test/checkpoint.test.ts`
  - shadow git 创建和恢复普通文件。
  - 恢复新建文件时删除目标。
  - 恢复删除文件时重建目标。
  - 多文件 checkpoint 全部恢复。
  - binary 文件恢复。
  - ignored 文件被 mutation 明确涉及时仍能恢复。
  - checkpoint id path traversal 被拒绝。
  - metadata workspaceHash 不匹配被拒绝。
  - legacy copy-v1 checkpoint 仍可恢复。
  - 新 checkpoint 不写入 `<workspace>/.myagent/checkpoints`。

- `test/session-loop.test.ts`
  - `edit_file` / `write_file` / `apply_patch` 继续创建 checkpoint。
  - checkpoint 创建失败时 mutation 不执行。
  - tool result 只保存 `checkpointId` 字段，不把 id 塞进 content。

- `test/session-revert.test.ts`
  - `/rewind` 恢复指定 shadow checkpoint。
  - `/revert-last` 找最近 mutation checkpoint。
  - active turn 中拒绝恢复。

- `test/storage-store.test.ts`
  - checkpoint id 仍能随 tool_result 持久化。
  - 后续 checkpoint table/list 接入后补 query 测试。

### 验收标准

- 新 mutation checkpoint 不再在 workspace 内创建 `.myagent/checkpoints`。
- 删除 workspace 里的 legacy `.myagent/checkpoints` 不影响新 shadow checkpoint。
- 同一个文件多次修改，`/revert-last` 能准确恢复到最近一次 mutation 前。
- `apply_patch` 涉及新增、删除、修改、rename 时，恢复结果正确。
- 当前 CLI/TUI/Web rewind/revert 入口行为不退化。
- 所有现有测试通过，并新增 shadow git backend 覆盖。

## 建议实施顺序

1. Skills
   - 这是简历里最明确、当前缺口最大的能力。
   - 先完成 discovery + system prompt summary + `skill` tool + permission + tests。

2. Rewind/Revert
   - 底层 checkpoint 已经存在，补入口收益高、风险低。
   - 先文件恢复，不做 OpenCode 完整 message-range revert。

3. Compact
   - 需要动 transcript 形态和 provider prompt 组装，风险比 revert 高。
   - 先手动 `/compact`，不做 auto compact。

4. Shadow git checkpoint
   - 当前 file-copy checkpoint 只作为 MVP。
   - 先替换 backend，保持入口/API 不变。
   - 再做 message-range rewind 和 unrevert/redo。

## 非目标

- 不做 marketplace skill 下载。
- 不做后台自动 compact。
- 不一次性做完整时间线分支 UI。
- 不做多 agent/plugin 权限矩阵。
- 不把 skill reference 文件全文自动塞入上下文。
- 不把 rewind/revert 伪装成普通模型消息。
