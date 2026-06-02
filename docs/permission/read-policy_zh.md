# Filesystem Policy

## 概览

`src/permission/policy.ts` 是内置工具的统一权限入口。它返回一个 `ToolPermissionDecision`：

```ts
type ToolPermissionDecision = {
  behavior: "allow" | "ask" | "deny" | "invalid";
  reason: string;
  resolvedInput?: unknown;
  metadata?: Record<string, unknown>;
};
```

`invalid` 当前用于 `apply_patch` 预检查，它不是一种权限状态。

## 读取类工具

当前读取类工具包括：

- `Read`
- `list_dir`
- `grep`
- `glob`
- `find_up`

它们都使用 `resolvePathInfo()` 和/或 `checkReadPolicy()` 作为路径解析和边界检查的基础。

## 共享读取规则

对于普通读取目标：

| 条件 | 决策 | 原因 |
| --- | --- | --- |
| path 无法解析 | deny | path cannot be resolved |
| 敏感路径 | ask | sensitive file read requires approval |
| 工作区路径 | allow | workspace read is safe |
| 工作区外路径 | ask | file/path is outside workspace |

工作区外的非敏感读取，也会收到 `externalDirectoryPattern` metadata，用于可复用的项目级审批。

## `Read`

`Read` 是读取文件内容，参数包括：

- `path`
- `offset`
- `limit`

解析后的输入包括：

```ts
{ path, offset, limit, resolvedPath, realPath }
```

工具本身仍然包含防御性 fallback：如果没有 `permissionResolved`，它会拒绝外部路径或敏感路径的直接调用。

## `grep`

`grep` 是文件内容搜索，不是文件发现。

权限行为：

- 目标路径通过 `checkReadPolicy` 解析
- 搜索敏感目标会变成 `ask`
- 搜索外部非敏感目标会变成 `ask`，并附带外部目录 metadata

解析后的输入还携带：

- `include`
- `exclude`
- `before_context`
- `after_context`
- `max_results`
- `excludeSensitive`

敏感内容的 best-effort 排除通过下面方式实现：

- `rg --glob !...` 排除
- `grep --exclude / --exclude-dir` 排除

## `glob`

`glob` 是按文件名模式做文件发现。

权限行为：

- 路径通过 `checkReadPolicy` 解析
- 执行时要求解析后的路径是目录
- 对工作区外非敏感目录做 glob 会变成 `ask`
- 敏感路径仍然需要审批

实现说明：

- 使用 `rg --files --hidden --glob <pattern>`
- 返回匹配的文件路径，不返回内容

## `find_up`

`find_up` 执行祖先链查找：

- `name`
- `start_path`
- 可选 `stop`

重要策略细节：

- `start_path` 走 `checkReadPolicy`
- `stop` 也走同样的读取策略路径
- 无效或被拒绝的 `stop` 不会被静默忽略
- 敏感或外部的 `stop` 会把整个调用升级成 `ask`
- 审批 metadata 会基于真正触发审批的路径生成，包括外部 `stop`

当 `start_path` 指向文件时，执行会从它的父目录开始。

## 文件修改策略边界

修改类工具单独记录在 [../tools/file-mutation.md](../tools/file-mutation.md)。

当前划分：

- `edit_file`、`write_file`、`apply_patch` -> 修改类
- 读取类工具 -> 读取类

修改类工具只能操作工作区内部。读取类工具可以在审批后读取工作区外路径。

## 敏感路径检测

`src/permission/sensitive-paths.ts` 定义了这些地方共用的敏感路径模式：

- `Read`
- `grep`
- `glob`
- `find_up`
- mutation metadata 脱敏
- bash 读取路径敏感性检查

敏感例子：

- `.env`、`.env.*`
- `*.pem`、`*.key`
- `id_rsa`、`id_ed25519`
- `.npmrc`、`.pypirc`、`.netrc`
- 路径中包含 `secret`、`credential` 或 `token`
- `.ssh`、`.aws`、`.git` 这类目录

模板文件，例如 `.env.example`，仍然不是敏感路径。

## 工作区边界

- 工作区是默认信任边界，但不是唯一可读边界
- 读取类工具可以通过审批跨过这个边界
- 修改类工具不能跨过这个边界
- 内部解析后的路径字段，不属于面向模型的工具 schema
- 只有会话循环可以标记 `ToolContext.permissionResolved`
