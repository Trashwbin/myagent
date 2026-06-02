# External Directory Permission

## 概览

外部目录审批，是针对工作区外路径的可复用读取权限模型。

它适用于：

- `Read`
- `list_dir`
- `grep`
- `glob`
- `find_up`
- 只读 `bash`

一旦某个项目根目录被批准，之后访问该根目录下面的读取类路径，就可以自动允许，不需要每个文件都提示。

## 项目根目录检测

`src/workspace/project-root.ts` 实现了 `findProjectRoot(startPath, isDirectory?)`。

它会向上查找项目标记，例如：

- `.git`
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `go.mod`
- `Cargo.toml`
- `pyproject.toml`

如果没有找到标记，就回退到最近的父目录，并把原因标记为 `parent_directory`。

## Pattern 推导

审批会保存成：

```text
/external/project/*
```

例子：

- `Read ../project/src/session/loop.ts`
- `grep path=../project/src`
- `glob path=../project`
- `find_up start_path=../project/src/session/loop.ts`
- `bash: cd ../project && git diff`

如果这些路径最终落在同一个外部项目里，它们都会解析成同一个项目级外部目录 pattern。

## 匹配方式

一条 `external_directory` 规则覆盖已批准根目录下面的路径。它不覆盖：

- 兄弟项目
- 根目录上方的父目录
- 只有路径前缀相同的碰撞路径
- 有写入效果的 bash 命令

即使周围的项目根目录已经被批准，敏感路径也会被排除在外部目录自动允许之外。

## Bash 双层审批

工作区外的只读 bash 需要两层审批：

1. 通过 `external_directory` 做路径审批
2. 通过 `approvalPattern` 做命令族审批，例如 `git diff *`

两者都满足时，才会自动允许。

除了 bash 之外，其他读取类工具只需要路径层审批。

## `find_up` 说明

`find_up` 通过两种方式参与外部目录审批：

- `start_path` 本身可能是外部路径
- 可选的 `stop` 可能是触发审批的路径

当 `stop` 是触发审批的外部路径时，metadata 会基于这个 stop 边界生成，这样审批复用匹配的是实际约束，而不是 start path。

## 范围

- session 范围：只保存在内存
- workspace 范围：持久化保存在 `~/.myagent/myagent.sqlite`

规则始终按规范化后的工作区根目录隔离。不同工作区不会共享外部目录审批。
