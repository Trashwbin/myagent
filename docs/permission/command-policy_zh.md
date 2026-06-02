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

`intentKind` 是描述性 metadata。最终权限决策仍然由 `analyzeCommand()` 在危险模式、链式命令、管道、路径和敏感性检查之后给出。

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

这些会被识别成 `fs_primitive` intent，但策略仍然把它们视为有写入效果的命令，需要审批。

### git read

- `git status`
- `git diff`
- `git log`
- `git show`
- `git rev-parse`
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
- `dotnet`
- 常见的只读 shell 工具，但它们不会被提升成更具体的 intent

`npm test`、`pnpm test`、`yarn test`、`npm run test` 这类包管理器测试命令会被视为只读测试命令，除非它们同时包含 install/add 行为。包安装仍然是有写入效果的命令。

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
- 把远程内容通过管道传给 `python` 或 `node` 这类解释器
- 解释器 eval 形式，例如 `node -e`、`python -c`、`perl -e`、`ruby -e`
- 远程脚本执行模式，例如 `curl | sh`

根据具体命令，它们会变成 `ask` 或 `deny`。

`touch`、`mkdir`、`mv`、`cp`、`rm`、`chmod`、`chown`、`tee`、`curl`、`wget` 这类有写入效果或网络效果的命令通常会变成 `ask`。某些危险形式会直接 `deny`，例如 `rm -rf`、`sudo`、递归 `chmod -R`、管道进入 shell、远程脚本执行。

## 决策层级

`analyzeCommand()` 按下面顺序应用策略：

1. 受控的 `cd <dir> && <readonly-cmd>` 处理
2. 危险模式 deny
3. 命令替换 ask
4. 输出重定向 ask
5. 不支持的链式命令 ask
6. 管道和解释器安全检查
7. 单元分类
8. 路径边界和敏感性检查
9. 只读命令的外部有效工作目录检查

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

当前支持生成的可复用 bash 审批 pattern 包括：

- `git <subcommand> *`
- `rg *`
- `grep *`
- 包管理器命令族，例如 `npm test *`

外部只读 bash 需要同时满足外部目录规则和 bash 命令族规则，审批记忆才会自动允许。

## 输出预算

`src/tools/bash.ts` 会在下面限制处截断 stdout/stderr：

- 20 KB 字符
- 或 500 行

截断消息会告诉模型缩小命令范围，而不是把更多 shell 输出倒进上下文。
