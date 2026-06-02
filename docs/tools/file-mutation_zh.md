# File Mutation Tools

## 目标

File mutation 是核心 runtime surface，不是 shell commands 的便利包装。Agent 应该通过结构化工具修改文件，这样 session loop 才能执行权限控制、创建 checkpoints、展示 diffs，并防止陈旧覆盖。

工具集应该按下面顺序增长：

1. `edit_file`：替换一个文件中的已知文本。
2. `write_file`：创建或覆盖一个完整文件。
3. `apply_patch`：应用多文件结构化 patch。

这些工具在模型使用体验上不同，但必须共享一个 write policy 和一个 checkpoint path。

```text
edit_file / write_file / apply_patch
  -> FileMutationPolicy (shared in mutation-policy.ts)
  -> edit permission family
  -> checkpoint before mutation (via isMutationTool + getCheckpointPaths)
  -> diff metadata for approval/result UI
```

## 为什么需要多个工具

这些工具在 filesystem 层面有重叠，但在 intent 层面不同：

| Tool | Best for | Main safety property |
| --- | --- | --- |
| `edit_file` | 小型目标修改 | `old_string` 必须匹配现有文本 |
| `write_file` | 新文件和整文件替换 | 现有文件必须先读取 |
| `apply_patch` | 多文件 add/update/delete 操作 | hunks 必须基于 context 应用 |

不要为这些工具创建不同的权限系统。它们都代表文件修改，应该由同一个 `edit` permission family 管理。

## Tool positioning

每个工具都有不同角色和 safety gate。不要混淆这些边界：

- **`edit_file`**：小型外科手术式编辑。依赖 `old_string` 匹配现有内容来保证安全。编辑前**不需要** `Read`，因为 `old_string` 匹配本身就是 safety gate。拒绝空 `old_string`，并引导改用 `write_file`。
- **`write_file`**：整文件创建或替换。对于现有文件，需要当前 session 中先前的 `Read` 和 mtime guard。它是唯一使用 `ReadStateTracker` 执行 read-before-write 的工具。
- **`apply_patch`**：多文件原子操作。依赖 hunk context matching 和 preflight validation，也就是 permission check 中的 dry-run hunk apply。不需要先前 `Read`。

## Shared policy layer

`src/tools/mutation-policy.ts` 提供三个工具共用的基础设施：

- **`validateMutationPath`**：workspace path resolution + boundary check。用于 `edit_file` 和 `write_file` permission checks。
- **`pathMeta`**：为所有 mutation tool permission decisions 构建标准化 path metadata，包括 `inputPath`、`absolutePath`、`realPath`、`insideWorkspace`。
- **`buildEditDiffMeta` / `buildWriteDiffMeta`**：计算 approval diff metadata，包括 operation type、diff text、additions/deletions。它们从 `policy.ts` 移到 shared layer，方便独立测试和复用。
- **`isSensitivePath`**：`isSensitiveReadPath` 的薄包装，所有三个工具都用它从 sensitive-path metadata 中移除 diff content。
- **`isMutationTool` / `getCheckpointPaths`**：session loop 用它们判断是否需要 checkpoint，以及要覆盖哪些 paths。它替代了 `loop.ts` 中硬编码的三分支 `if/else`。

没有抽取的内容以及原因：

- Tool execution logic：每个工具有本质不同的执行路径，包括 edit replacement、whole-file write、multi-file patch with rollback。
- Read-state management：只有 `write_file` 使用 `ReadStateTracker`；抽取它只会增加间接层，不能减少漂移。
- Patch parsing / hunk application：只有 `apply_patch` 使用这些。

## Permission Model

`edit_file`、`write_file` 和 `apply_patch` 都使用同一个 write permission family：

- Workspace path：非敏感写入在 `approval: "auto"` 下自动允许，在 `approval: "on-request"` 下询问，在 `approval: "never"` 下拒绝。
- Outside workspace：deny。
- Sensitive path writes：像其他 writes 一样 ask；secret-read restrictions 仍然适用于读取内容。

三个工具的 approval metadata 保持一致：

| Field | edit_file | write_file | apply_patch |
| --- | --- | --- | --- |
| `operation` | `"edit"` | `"write"`/`"create"` | `"patch"` |
| `absolutePath` | yes | yes | - |
| `affectedPaths` | - | - | yes |
| `diff` | yes* | yes* | yes* |
| `additions` | yes* | yes* | yes* |
| `deletions` | yes* | yes* | yes* |
| `sensitive` | if needed | if needed | if any path |
| `failures` | - | - | on preflight failure |

\* 当 `sensitive` 为 true 时省略。

Session/workspace approval memory 应该按 tool 和 resolved path 匹配，或者未来按共享 `edit` capability 匹配，但它绝不能绕过 checkpoints。

## Checkpoints

每次成功 mutation 都会在写入前创建 checkpoint，即使该操作是通过 session/workspace rule 自动允许的。Session loop 使用 `isMutationTool()` 检测 mutation tools，并使用 `getCheckpointPaths()` 提取要 checkpoint 的 paths：

- `edit_file` / `write_file`：来自 `resolvedPath ?? path` 的单一路径。
- `apply_patch`：来自 `resolvedPaths` keys 的所有路径。

对于 moves，`resolvedPaths` 包含 source 和 destination path，因此 checkpoint 会覆盖 rename 两边。

失败的 mutations 不暴露 checkpoint IDs。

## `edit_file`

当前角色：在 workspace 文件中执行精确字符串替换。

v1 行为：

- 保持 workspace-only restriction。
- 增加 `replace_all?: boolean`，用于有意的多处替换。
- 应用替换时保留现有 line ending style。
- 拒绝 `old_string === new_string`。
- 保守处理 `old_string === ""`。创建文件优先使用 `write_file`；`edit_file` 不应该成为主要文件创建工具。
- 返回 mutation metadata：`diff`、`additions`、`deletions` 和 touched file path。
- **没有 read-before-write gate。** `old_string` 匹配是 safety mechanism。

失败应该明确：无匹配、`replace_all` 为 false 时有多处匹配、directory target、outside workspace，或者如果未来与 `write_file` 共享该 guard，则包括 stale/unread file state。

## `write_file`

目的：创建新文件或替换整个文件。

Input：

```ts
{
  path: string;
  content: string;
}
```

规则：

- Path 必须解析到 workspace 内部。
- Parent directories 可以被创建。
- New files 在普通 write approval 后允许。
- Existing files 需要当前 session 中先前的 `Read`。
- Existing files 需要 mtime guard：如果文件当前 mtime 比记录的 read time 更新，则拒绝 write，模型必须重新读取。
- Write approval 应展示 previous content 和 new content 之间的 unified diff。
- 替换现有文件时 execution 应保留 BOM。新文件 line endings 应跟随提供的 content，并在测试中显式覆盖。

Read-before-write requirement 防止 blind overwrites。Mtime guard 防止覆盖用户、formatter 或并发 agent 在模型读取后做出的修改。

## Read State

Session loop 需要一个小型 read-state map，用于 stale-write checks：

```ts
type ReadFileState = {
  path: string;
  realPath: string;
  mtimeMs: number;
  readAt: number;
  partial: boolean;
};
```

`Read` 在成功读取后记录 state。Partial read 不应该授权 whole-file overwrite，除非实现可以证明完整文件已加载。Directory reads 不授权 file writes。

`write_file` 只对 existing files 检查 state。New file creation 不需要先前 read。`edit_file` 和 `apply_patch` 不使用 read state。

## `apply_patch`

目的：在一个原子操作中应用结构化多文件修改。

使用 Codex/OpenCode patch envelope，而不是 raw shell `patch`：

```text
*** Begin Patch
*** Add File: path/to/new.ts
+line one
+line two
*** Update File: src/app.ts
@@ -1,3 +1,4 @@
 context line
-old line
+new line
+extra line
 context line
*** End of File
*** Delete File: old.txt
*** End Patch
```

### Patch envelope

- 必须以 `*** Begin Patch` 开始，并以 `*** End Patch` 结束。
- 支持的操作：`*** Add File`、`*** Update File`、`*** Delete File`。
- `*** Move File` 会被明确拒绝；使用 delete + add。
- `*** Move to:` 只在 `*** Update File:` 之后有效，见 Move semantics。
- 每个 file path，包括 move destinations，在每个 patch 中最多出现一次。
- File paths 相对于 workspace。Absolute paths 和 `..` 会被拒绝。

### Add File

- Content lines 必须以 `+` 为前缀。
- 内容中的 blank lines 不需要前缀。
- 如果文件已存在，则失败。

### Update File hunks

Hunk data structure：

```ts
type PatchHunk = {
  changeContexts: string[];  // context lines from @@ markers
  oldLines: string[];       // lines prefixed with - or space
  newLines: string[];       // lines prefixed with + or space
  isEndOfFile?: boolean;    // set when *** End of File appears
};
```

Context navigation：

- `@@`：bare marker，没有 context。
- `@@ functionName`：用于 disambiguation 的 context string。
- `@@ functionName @@`：同上，trailing `@@` 会被剥离。
- `@@ -1,3 +1,4 @@`：unified-style range header，range info 被忽略，没有 context。
- `@@ -1,3 +1,4 @@ fn greet`：带 context 的 unified-style range header。
- hunk body 前的多个 `@@` lines 会被顺序 seek，用于缩小匹配位置。
- 如果 `@@` 出现在 context text 中间，且没有 trailing closing `@@`，该行会因 ambiguous 被拒绝。

Hunk body lines：

- `-` prefix：要匹配的 old line。
- `+` prefix：要插入的 new line。
- ` ` 空格 prefix 或无 prefix：context line，同时进入 `oldLines` 和 `newLines`。

EOF anchor：

- Hunk body 内的 `*** End of File` 会设置 `isEndOfFile`，导致从文件末尾尝试匹配。

Insertion-only hunks：

- 当 `oldLines` 为空且 `newLines` 非空时，lines 会插入到最后一个 context match position 之后，或者文件末尾。

### Patch authoring tips

这些规则比选择 `@@ context @@` 还是 `@@ -1,3 +1,4 @@` 更重要：

- 支持 `@@ context @@`。Unified-style range header 是可选的，不是必需的。
- 使用 `changeContext` 把 cursor 定位到 target 附近。使用 `oldLines` 识别要替换的精确行。它们职责不同。
- 不要让 `@@` context line 和第一条 deleted line 是同一行，除非你希望下一个匹配从它之后开始。Cursor 会在每个 matched context line 后前进。
- 优先使用稳定的 surrounding marker 作为 context：function name、class name、section title，或 change 正上方的 line。
- 当文件包含重复文本时，添加更多 `@@` context lines，而不是依赖 fuzzy matching。
- 如果 patch 因 context error 失败，说明 cursor 从未到达预期 block。重新读取文件并使用更好的 anchor。
- 如果 patch 因 old-lines error 失败，anchor 可能匹配了，但 exact body 已经不匹配。重新读取文件，并基于当前内容重新生成 hunk body。
- 如果 diagnostics 提到 whitespace drift，不要假设 header format 错了。内容很可能只是在 indentation、tabs 或 spacing 上不同。

推荐 pattern：

```text
*** Begin Patch
*** Update File: some/file.txt
@@ section heading @@
 previous line
-old target
+new target
 next line
*** End Patch
```

### Matching strategy

`seekSequence` 对每个 `oldLines` pattern 执行 4 级匹配：

1. Exact match。
2. `trimEnd()` match。
3. `trim()` match，也就是 full trim。
4. `collapseWhitespace`：把连续 `\s+` 折叠成单个空格并 trim。处理 tab/space 混用、不一致缩进和多空格格式。**Ambiguity guard**：如果该级别有多个位置匹配，会拒绝匹配，并通过 diagnostics 报告歧义，提示模型添加更多 `@@` context。

每个 hunk 后 cursor 会前进，因此后续 hunks 会在之前 matches 之后匹配。

### Failure diagnostics

当 `seekSequence` 没有返回 match 时，`applyHunks` 会通过 `diagnoseSeekFailure` 运行 diagnostics，生成可执行错误消息。Diagnostics 会在 `collapseWhitespace` 级别检查整个文件，而不仅是 cursor 后面，用于发现 near-misses。

Failure categories：

| Category | Detection | Message hint |
|---|---|---|
| Content exists earlier | 在 cursor position 前找到 exact match | "exists earlier in the file — a prior hunk may have shifted the cursor" |
| Whitespace drift | 找到 fuzzy match，也就是 collapseWhitespace level，但没有 exact match | "matches after whitespace normalization but differs in formatting" |
| Ambiguous | 找到多个 fuzzy matches | "partially matches at N locations — Add more @@ context lines" |
| Partial match | pattern lines 中至少 50% 在某个级别匹配 | "partially matches near line X (N% of lines)" |
| No match | 没有 near-miss | "content may have changed — Re-read the file" |

所有 failure messages 都包含可执行 guidance，例如 re-read file、add context、adjust patch order。Context failures 和 oldLines failures 会分开报告：context failures 识别缺失的 `@@` context line，而 oldLines failures 会说明 context 在哪里匹配了，如果有的话。

### Line ending handling

Update 时会检测现有文件 line ending，也就是 `lf` 或 `crlf`。Content 会 normalize 到 LF 用于匹配，写入时恢复原 line ending。新文件 add 始终使用 LF。

### Rejected formats

- `*** Update File` 内的标准 unified diff headers，也就是 `---` / `+++`，会被检测并拒绝，同时给出清晰错误，要求模型使用 `@@` hunks。
- `*** Update File:` block 外的 `*** Move to:` 会被拒绝。

### Move semantics

`*** Move to: <new_path>` 可以紧跟在 `*** Update File:` 之后。它会 rename 文件，并且可以通过 hunks 可选地应用内容修改：

```text
*** Begin Patch
*** Update File: old/path.ts
*** Move to: new/path.ts
@@ class Foo @@
-  oldMethod()
+  newMethod()
*** End Patch
```

行为：

- Source file 必须存在。Destination 必须不存在，既不是文件也不是目录。
- 两个 paths 都必须解析到 workspace 内部。Absolute paths 和 `..` 会被拒绝。
- Hunks 应用到 source content，然后结果写入 destination，并删除 source。
- 如果 patch 不包含内容修改，文件会原样移动。
- Permission metadata 包含 `moves: [{ from, to }]`。`affectedPaths` 同时包含 source 和 destination。
- Checkpoint 在 mutation 前覆盖 source 和 destination。
- 失败 rollback：删除 destination，如果已写入；恢复 source content。
- Result summary 显示 `moved old/path.ts -> new/path.ts (+N -N)`。
- Read state：destination 被记录为 written；source entry 被移除。

`*** Move File:`，也就是没有 hunks 的 standalone move，仍然会被拒绝。普通 rename 使用 delete + add。

### Validation and execution

- 所有 operations 在任何 filesystem writes 前都会被解析和校验。
- 如果任意 hunk 无法匹配，工具失败且不会产生 partial writes。
- 如果 patch 执行到中途 filesystem write 失败，所有已经应用的 operations 会 rollback，按逆序恢复原 content 或删除 newly-created files。
- Permission system 会解析 patch、解析 paths，并构建 approval display 用的 combined diff metadata。
- `apply_patch` 在任何 approval 或 execution 前执行 **preflight validation**，包括 parse、path resolution、dry-run hunk application。
- **Preflight failures 是 validation errors，不是 permission denials。** Hunk mismatch、update target not found、move destination conflict、parse errors 都会报告为 `Patch validation failed`，它们不会进入 approval flow。
- 真正的 permission denials，例如 outside workspace、`approval: "never"`，仍然和 validation failures 区分。
- 对于非敏感 paths，permission system 会在 approval 前执行 dry-run hunk application。如果任意 hunk 无法应用或 target file 不存在，patch 会在 approval prompt 前报告为 validation failure，用户会看到具体失败的 file 和 hunk。
- Sensitive paths 无法 validation，因为 permission system 不能访问内容，因此它们仍然需要 approval，并且可能在 execution time 失败。
- Approval metadata path 和 execution path 都使用同一个 `tryApplyHunks` helper 执行 hunk application，确保 line-ending handling 和 matching semantics 一致。
- Checkpoint 在 mutation 前覆盖每个 affected path。
- Validation failure 时，模型应该重新读取 affected files，并重新生成 patch，而不是请求 approval。

### Failure recovery

当 `apply_patch` 返回 validation failure，例如 hunk mismatch、context not found、file changed，错误消息会包含类似 "Re-read the file" 的可执行 guidance。预期恢复顺序是：

1. `Read` affected file(s)，收集更新后的 context。
2. 基于当前 file content 重新生成 patch。
3. 使用 corrected patch 重试 `apply_patch`。

在 patch failure 触发 `Read` 后，模型应该继续修改，或者明确解释为什么无法继续。这个约束同时编码在 tool description guidance 和 system prompt 中。

`apply_patch` 复用 `edit_file` 和 `write_file` 使用的 shared permission、diff metadata 和 checkpoint flow。

## Permission Model

`edit_file`、`write_file` 和 `apply_patch` 应该都使用同一个 write permission family：

- Workspace path：非敏感写入在 `approval: "auto"` 下自动允许，在 `approval: "on-request"` 下询问，在 `approval: "never"` 下拒绝。
- Outside workspace：deny。
- Sensitive path writes：像其他 writes 一样 ask；secret-read restrictions 仍然适用于读取内容。
- Session/workspace approval memory 应该按 tool 和 resolved path 匹配，或按未来共享 `edit` capability 匹配，但不得绕过 checkpoints。

Approval metadata 应该包含：

- resolved path 或 affected paths
- operation type，也就是 `edit`、`write`、`patch`
- diff text 或 per-file diff metadata
- 可用时包含 additions/deletions counts

## Checkpoints

每次成功 mutation 都会在写入前创建 checkpoint，即使该操作是由 session/workspace rule 自动允许的。

对于 `apply_patch`，checkpoint 会在任何 write 前包含所有 affected paths。这让 add、update 和 delete operations 都可逆。

## Implementation Status

已实现：

1. Shared mutation policy layer，也就是 `mutation-policy.ts`：path validation、diff metadata builders、sensitive-path guard、checkpoint helpers。
2. `edit_file` v1：`replace_all`、line-ending preservation、diff metadata。无 read-before-write gate。
3. `write_file`：包含 read-before-write 和 mtime guard，是唯一使用 `ReadStateTracker` 的工具。
4. `apply_patch`：具备与 Codex/OpenCode 对齐的 grammar：
   - Patch envelope，也就是 `*** Begin Patch` / `*** End Patch`，严格解析。
   - Add File 强制 `+` prefix。
   - Update File 支持 `@@` hunks、context navigation、EOF anchor、insertion-only hunks。
   - 解析 unified-style range headers，也就是 `@@ -1,3 +1,4 @@`，并忽略 range info。
   - 支持 `@@ context @@` 形式，trailing `@@` 会剥离；ambiguous mid-line `@@` 会拒绝。
   - 4 级 line matching：exact -> trimEnd -> trim -> collapseWhitespace，并带 cursor progression。
   - Structured failure diagnostics：context/oldLines 分离、whitespace drift detection、ambiguous match detection、partial match percentage、可执行 re-read hints。
   - 通过共享 `tryApplyHunks` helper 在 update files 时保留 CRLF。
   - Move File rejected；`*** Move to:` 支持出现在 `*** Update File:` 后，并可应用 hunks。
   - 检测并拒绝 standard unified diff，也就是 `---`/`+++`，并提供清晰 guidance。
   - Atomic pre-flight validation，execution failure 时 rollback。
   - Approval-stage hunk dry-run：非敏感 path failures 会在 user approval 前报告为 validation failures。
   - Approval metadata 包含 combined diff，checkpoint coverage 覆盖所有 affected paths。
5. 通过 `isMutationTool` / `getCheckpointPaths` 统一 session-loop checkpoint。

暂缓：

- LSP diagnostics
- automatic formatting
- hidden-git snapshot engine
