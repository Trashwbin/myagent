# myAgent 本地 Web 设计指南

这个本地 Web 应用采用 Clay 风格的 B2B SaaS 产品界面：暖奶油色画布、深色墨水文字、宽松的圆角几何，以及高饱和单色卡片作为视觉张力来源。它仍然是一个操作型 agent 工作区，因此配色会适配密集聊天、会话历史、审批和工具时间线，而不是营销落地页的 hero 区。

## 核心氛围

- 默认画布：`#faf8f3`，带奶油色调的白色。
- 主文字和 CTA：`#0a0a0a`。
- 功能/卡片强调色在热粉、深青、薰衣草紫、桃色、赭黄和奶油卡片色之间轮换。
- 圆角较大：按钮和输入框 12px，内容卡片 16px，主要表面 24px。
- 正文/UI 字体使用 Inter 或系统 UI。展示性文字使用 Inter 500/600，并略微收紧字距，作为 Plain Black 的替代。

## 颜色 Token

### Brand

- Primary: `#0a0a0a`
- Brand Pink: `#ff4d8b`
- Brand Teal: `#1a3a3a`
- Brand Lavender: `#b8a4ed`
- Brand Peach: `#ffb084`
- Brand Ochre: `#e8b94a`
- Brand Mint: `#a4d4c5`
- Brand Coral: `#ff6b5a`

### Surface

- Canvas: `#faf8f3`
- Surface Soft: `#f3efe4`
- Surface Card: `#fdfcfa`
- Surface Strong: `#e8e3d5`
- Surface Dark: `#0a1a1a`
- Surface Dark Elevated: `#1a2a2a`
- Hairline: `#ddd8c4`

### Text

- Ink: `#0a0a0a`
- Body Strong: `#1a1a18`
- Body: `#3a3930`
- Muted: `#706e5e`
- Muted Soft: `#9a9785`
- On Primary / On Dark: `#ffffff`

### Semantic

- Accent: `#1f6b57`
- Success: `#1f8a55`
- Warning: `#9a6a12`
- Error: `#b5453f`

## 动效

- 所有 transition 默认使用 `150ms-200ms ease`。
- Turn 条目使用 `slideUp` 动画，也就是 opacity + translateY。
- 用户消息使用 `slideInRight`，形成聊天气泡感。
- 运行中状态在状态 badge 和 topbar 圆点上使用 `softPulse` 动画。
- `prefers-reduced-motion: reduce` 会禁用所有动画和 transition。
- 工具卡片 hover 时通过增强 `box-shadow` 轻微抬起。
- Composer 聚焦时，内圈使用强调色微光，也就是 `:focus-within`。

## 应用布局

应用是双栏工作区：

- 左侧 sidebar：会话发现和创建。
- 主面板：固定 header、独立滚动的 timeline、固定 composer。

Sidebar 和 timeline 必须使用独立滚动容器。应用 shell 本身不应该依赖 document scroll。

## 组件规则

### Sidebar

- 暖奶油色表面。
- 会话条目使用 16px 圆角的奶油色卡片。
- 激活会话使用高饱和左侧 rail 或 outline。
- metadata 使用 monospace 和 muted 文字。
- 会话列表必须设置 `min-height: 0` 和 `overflow-y: auto`，这样长历史可以滚动。

### Top Bar

- 奶油色导航带，固定在应用 shell 顶部。
- 展示 provider/model、cwd、完整 session id 和连接状态。
- Session id 使用 monospace，可选中、可复制。
- 运行中圆点会 pulse。

### Timeline

- 用户消息：奶油色卡片，非对称圆角 `16px 16px 4px 16px`。
- Assistant 消息：普通文字，不使用卡片。
- 工具条目：更小的产品片段卡片，带彩色状态 rail。
- 审批卡片：赭黄/警告表面，突出操作按钮。
- 错误卡片：珊瑚/红色调表面。
- 冗长的工具输出必须可折叠。
- 工具卡片 hover 时轻微抬起。

### Composer

- 固定底部栏。
- 16px 圆角 textarea，放在奶油/卡片表面上。
- 主发送按钮使用深墨色背景。
- 保留浏览器原生 selection、IME、paste 和滚动行为。
- `focus-within` 添加强调色 tint ring。

## Do

- 默认保持整个应用为暖亮色。
- 谨慎使用高饱和强调卡片来表达状态和层级。
- 保持密集操作界面的可读性。
- 在卡片中使用产品 UI 片段和工具摘要。
- 保持完整 session id 可见且可复制。
- 所有交互状态变化使用平滑 transition，时长 150-200ms。
- 用细微 slide-up 动画呈现条目，包括 turns、approval dock、slash menu。

## Don't

- 不要把深色 Slack 式聊天 shell 作为主界面表面。
- 不要做营销落地页。
- 不要把会话历史藏在不可滚动的 sidebar 后面。
- 不要在浏览器 UI 中暴露 secret 或直接工具执行能力。
- 不要为了第一版 embedded 实现引入 Electron/Tauri/Vite。
- 不要使用突兀的瞬时显示/隐藏，始终使用 transition。
