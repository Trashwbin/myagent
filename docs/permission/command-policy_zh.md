# Command Policy

## 概览

`src/permission/command-policy.ts` 是 `bash` 的策略层。

它不再把 bash 当成纯字符串黑盒处理。当前设计是：

```text
shell string
  -> parseCommand()
  -> CommandIntent
  -> analyzeCommand()
  -> allow / ask / deny + metadata
```

## CommandIntent

`src/permission/command-intent.ts` 当前识别这些意图：

- `file_discovery`
- `content_search`
- `partial_read`
- `fs_primitive`
- `git_read`
- `exec`
- `unknown`

这个 intent 类型会贯穿到：

- 审批 metadata
- CLI 展示，例如 `bash (content_search)`
- transcript 捕获

## 支持识别的模式

### file discovery

- `rg --files`
- `rg --files <path>`
- `rg --files | head -n N`

### content search

- `rg -n ...`
- `rg -l ...`
- `grep -rn ...`

### partial read

- `sed -n '10,20p' file`
- `head -n 50 file`
- `tail -n 50 file`
- `wc -l file`
- `stat file`

### filesystem primitives

- `cp`
- `mv`
- `mkdir`

### git read

- `git status`
- `git diff`
- `git log`
- `git show`
- 只读的 `git branch`

### exec

已知的执行层命令，例如：

- `npm`
- `pnpm`
- `yarn`
- `node`
- `python`
- `make`
- `cargo`
- `go`
- 常见的只读 shell 工具，但它们不会被提升成更具体的 intent

## 危险模式或降级模式

这些模式不会被视为安全的已识别读取操作：

- `find -exec`
- `find -delete`
- `rg --pre`
- `rg --hostname-bin`
- `rg --search-zip`
- `rg -z`
- `sed -i`
- 输出重定向，也就是 `>`、`>>` 等
- 命令替换
- 管道进入 shell
- 远程脚本执行模式，例如 `curl | sh`

根据具体命令，它们会变成 `ask` 或 `deny`。

## 决策层级

`analyzeCommand()` 按下面顺序应用策略：

1. 危险模式 deny
2. 命令替换 ask
3. 输出重定向 ask
4. 受控链式命令处理
5. 管道和解释器安全检查
6. 单元分类
7. 路径边界和敏感性检查

## `cd <dir> && <readonly-cmd>`

明确支持的一种链式命令是：

```bash
cd <dir> && <readonly-cmd>
```

如果第二个命令是受支持的只读命令，策略会：

- 提取 `effectiveCwd`
- 分析第二个命令
- 从第二个命令推导 `CommandIntent`

例如：

- `cd repo && rg -n foo src` -> `content_search`
- `cd repo && rg --files` -> `file_discovery`

这样 intent 标签会和实际支持的路径保持一致，而不是退回到 `unknown`。

## 外部目录集成

只读 bash 在满足下面条件时，可以参与外部目录审批：

- 命令被分类为只读
- 解析出来的路径，或者有效工作目录，在工作区外部

这种情况下，command policy 也会输出：

- `effectiveCwd`
- `externalDirectoryPattern`
- `externalDirectoryRoot`
- `externalDirectoryReason`
- 可选的可复用 `approvalPattern`

## 输出预算

`src/tools/bash.ts` 会在下面限制处截断 stdout/stderr：

- 20 KB 字符
- 或 500 行

截断消息会告诉模型缩小命令范围，而不是把更多 shell 输出倒进上下文。
