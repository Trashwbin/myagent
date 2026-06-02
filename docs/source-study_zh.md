# Source Study

用于设计研究的参考快照：

- Codex: `openai/codex`
- OpenCode: `anomalyco/opencode`
- Claude-code sourcemap mirror: `yasasbanukaofficial/claude-code`

## 当前借鉴策略

### 来自 Codex

我们采用的主要思路：

- 把 patch grammar 和 patch envelope 作为一等工具。
- 清晰拆分 command analysis/policy 和 execution。
- 把 shell safety 作为一个子系统，而不是几个临时字符串检查。
- 可复用的 command-family approval patterns。

### 来自 OpenCode

我们采用的主要思路：

- 带显式 descriptions 和 schemas 的 tool registry。
- 把文件探索拆成：
  - `Read`
  - `grep`
  - `glob`
  - `find_up`
- 分离 `edit_file`、`write_file` 和 `apply_patch`。
- 使用真实模型 live scenario harness，而不是只依赖单元测试。

### 来自 Claude 风格 agent 结构

我们采用的主要思路：

- 读取成本很重要。
- 工具特定 guidance 应该更靠近工具，而不是全部塞进一个 system prompt。
- file read/edit/write/patch surfaces 受益于不同的契约。

## 当前 runtime 形态

当前 runtime 已经不再是早期 v0 形态。现在它包括：

### Tools

- `Read`
- `list_dir`
- `grep`
- `glob`
- `find_up`
- `edit_file`
- `write_file`
- `apply_patch`
- `bash`

### Mutation model

- `edit_file` 用于外科手术式替换。
- `write_file` 用于整文件创建或替换。
- `apply_patch` 用于多文件原子修改。

三者共享：

- 一个 write permission family
- checkpoint integration
- diff/metadata conventions

### Permission model

- `allow`
- `ask`
- `deny`
- `invalid`

`invalid` 是较新的重要补充。它把工具校验失败和权限拒绝分开，尤其用于 `apply_patch` preflight。

### Bash model

`bash` 现在有内部语义层：

- `file_discovery`
- `content_search`
- `partial_read`
- `fs_primitive`
- `git_read`
- `exec`
- `unknown`

这个 intent 会流经：

- command policy
- approval metadata
- CLI labels
- transcripts

### Live scenario layer

Harness 现在有稳定的高价值 scenarios，覆盖：

- 简单 mutation happy path
- patch recovery
- sensitive path access
- 真实 multi-file patch happy path
- external-directory approval

Provider-side truncation 在 runtime 中可观察，但目前不作为稳定 live regression gate。

## 当前项目方向

最高价值工作已经不再是“增加更多工具”。

当前重点是：

1. 保持 tool contracts 和 docs 与实现一致
2. 保持 permission、approval 和 transcript semantics 连贯
3. 围绕真实 workflows 强化 real-model live scenarios

剩余工程杠杆主要在这些地方。
