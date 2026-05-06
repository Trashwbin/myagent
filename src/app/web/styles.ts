export const APP_STYLES = String.raw`
:root {
  color-scheme: light;
  --sidebar-width: 286px;
  --content-width: 872px;
  --panel-width: 760px;
  --dock-width: 860px;
  --canvas: #f5f6f2;
  --surface-soft: #eef0ea;
  --surface-card: #fafbf8;
  --surface-strong: #e4e8de;
  --surface-stronger: #d9ddd2;
  --ink: #141816;
  --body-strong: #242a26;
  --body: #39403a;
  --muted: #687068;
  --muted-soft: #8b9389;
  --hairline: #d6dbd1;
  --accent: #1f6b57;
  --accent-soft: rgba(31, 107, 87, 0.1);
  --success: #1f8a55;
  --warning: #9a6a12;
  --error: #b5453f;
  --shadow: rgba(20, 24, 22, 0.05);
  --code-surface: #ececec;
  --code-ink: #171717;
  --code-muted: #5f5f5f;
  --z-header: 30;
  --z-popover: 40;
  --z-dock: 50;
}

* {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
}

body {
  margin: 0;
  overflow: hidden;
  background: var(--canvas);
  color: var(--ink);
  font-family: "SF Pro Text", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
}

button,
textarea {
  font: inherit;
}

button {
  border: 1px solid var(--hairline);
  background: var(--surface-card);
  color: var(--ink);
  border-radius: 10px;
  min-height: 40px;
  padding: 10px 13px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

button:hover {
  border-color: var(--muted);
  background: #ffffff;
}

button.primary {
  background: var(--ink);
  border-color: var(--ink);
  color: #ffffff;
}

button.danger {
  background: #f9ebe9;
  border-color: rgba(181, 69, 63, 0.2);
  color: var(--error);
}

button.ghost {
  background: transparent;
  border-color: transparent;
  color: var(--muted);
}

button:disabled {
  cursor: default;
  opacity: 0.55;
}

.app {
  height: 100vh;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  background: var(--canvas);
}

.sidebar {
  min-width: 0;
  min-height: 0;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #eff1eb 0%, #ecefe7 100%);
  border-right: 1px solid var(--hairline);
}

.brand {
  flex: 0 0 auto;
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px 10px 16px;
  border-bottom: 1px solid rgba(214, 219, 209, 0.84);
}

.brand-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}

.brand-subtitle {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
}

.brand .primary {
  min-height: 34px;
  border: 1px solid var(--ink);
  border-radius: 10px;
  background: var(--ink);
  color: #ffffff;
  padding: 7px 12px;
}

.brand .primary:hover {
  background: #202522;
  color: #ffffff;
}

.session-list {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 10px 16px;
}

.session-controls {
  display: grid;
  gap: 10px;
  margin-bottom: 10px;
}

.session-scope {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.scope-pill {
  min-height: 28px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: rgba(255, 255, 255, 0.6);
  color: var(--muted);
  padding: 0 10px;
  font-size: 12px;
}

.scope-pill.active {
  background: #ffffff;
  color: var(--ink);
  border-color: var(--surface-stronger);
}

.session-search {
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--ink);
  padding: 0 11px;
  outline: none;
  font: inherit;
}

.session-search:focus {
  background: #ffffff;
  border-color: var(--muted);
}

.session-list::-webkit-scrollbar,
.timeline::-webkit-scrollbar {
  width: 10px;
  height: 8px;
}

.session-list::-webkit-scrollbar-thumb,
.timeline::-webkit-scrollbar-thumb {
  background: #cdd3c8;
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.section-heading {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin: 16px 0 8px;
  padding: 0 4px;
}

.workspace-row {
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.56);
  color: var(--body);
}

.workspace-row.current {
  background: rgba(255, 255, 255, 0.78);
}

.workspace-row.workspace-toggle {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
}

.workspace-stack {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.workspace-chevron {
  width: 12px;
  flex: 0 0 auto;
  color: var(--muted-soft);
  font-size: 11px;
  text-align: center;
}

.workspace-icon {
  width: 14px;
  height: 10px;
  border: 1.4px solid var(--muted);
  border-radius: 2px;
  position: relative;
  flex: 0 0 auto;
}

.workspace-icon::before {
  content: "";
  position: absolute;
  left: 1px;
  top: -4px;
  width: 6px;
  height: 4px;
  border: 1.4px solid var(--muted);
  border-bottom: 0;
  border-radius: 2px 2px 0 0;
  background: rgba(255, 255, 255, 0.56);
}

.workspace-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.workspace-count {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 12px;
}

.session-item {
  position: relative;
  width: 100%;
  min-height: 36px;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 10px;
  padding: 0 9px 0 12px;
  margin: 1px 0;
  box-shadow: none;
  color: var(--body);
}

.session-item.nested {
  min-height: 34px;
  margin-left: 16px;
  width: calc(100% - 16px);
  padding-left: 10px;
}

.session-item:hover {
  background: rgba(255, 255, 255, 0.7);
}

.session-item.active {
  background: #ffffff;
  border-color: var(--hairline);
  box-shadow: 0 1px 0 rgba(20, 24, 22, 0.02);
}

.session-item.active::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 999px;
  background: var(--accent);
}

.session-item.active .session-title {
  color: var(--ink);
  font-weight: 500;
}

.session-title {
  min-width: 0;
  flex: 1;
  color: var(--body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  font-weight: 400;
}

.session-meta {
  flex: 0 0 auto;
  color: var(--muted);
  font-family: inherit;
  font-size: 12px;
  white-space: nowrap;
}

.session-sublist {
  display: grid;
  gap: 2px;
}

.session-more {
  justify-self: start;
  min-height: 28px;
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 0 4px 0 20px;
  font-size: 12px;
}

.session-more:hover {
  background: transparent;
  color: var(--ink);
}

.empty-list {
  color: var(--muted);
  font-size: 13px;
  padding: 14px 8px;
}

.main {
  min-width: 0;
  min-height: 0;
  height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  isolation: isolate;
}

.topbar {
  min-width: 0;
  position: relative;
  z-index: var(--z-header);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 46px;
  padding: 8px 22px;
  border-bottom: 1px solid var(--hairline);
  background: rgba(250, 251, 248, 0.84);
  backdrop-filter: blur(14px);
}

.topbar-main {
  min-width: 0;
  flex: 1;
}

.session-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.topbar-actions {
  position: relative;
  flex: 0 0 auto;
}

.topbar-actions-trigger {
  min-width: 36px;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  list-style: none;
}

.topbar-actions-trigger::-webkit-details-marker {
  display: none;
}

.topbar-actions-trigger:hover {
  background: rgba(255, 255, 255, 0.72);
  border-color: var(--hairline);
}

.topbar-actions-icon {
  width: 6px;
  height: 6px;
  border-right: 1px solid currentColor;
  border-bottom: 1px solid currentColor;
  color: var(--muted);
  transform: rotate(45deg) translateY(-1px);
  transition: transform 140ms ease;
}

.topbar-actions[open] .topbar-actions-icon {
  transform: rotate(225deg) translateY(-1px);
}

.topbar-actions-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: var(--z-popover);
  width: min(380px, calc(100vw - var(--sidebar-width) - 42px));
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 42px rgba(20, 24, 22, 0.09);
}

.topbar-action-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
}

.topbar-action-label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.topbar-action-value {
  min-width: 0;
  color: var(--body);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.topbar-action-value.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  user-select: all;
}

.topbar-copy-button {
  width: fit-content;
  justify-self: end;
  min-height: 30px;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 99px;
  background: var(--muted-soft);
}

.dot.connected { background: var(--success); }
.dot.running { background: var(--warning); }

.timeline {
  min-height: 0;
  overflow-y: auto;
  padding: 28px 32px 44px;
  background: linear-gradient(180deg, #fafbf8 0%, #f5f6f2 100%);
}

.empty {
  max-width: 560px;
  margin: 20vh auto 0;
  color: var(--muted);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0;
}

.empty h1 {
  font-size: 26px;
  font-weight: 500;
  letter-spacing: -0.025em;
  color: var(--ink);
  line-height: 1.18;
  margin: 0 0 8px;
}

.turn {
  max-width: var(--content-width);
  margin: 0 auto 30px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  content-visibility: auto;
}

.message {
  border: 0;
  background: transparent;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
}

.message.user {
  display: flex;
  justify-content: flex-end;
}

.message.assistant {
  max-width: 760px;
}

.message.error {
  color: var(--ink);
}

.label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.message.user .label,
.message.assistant .label {
  display: none;
}

.content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.62;
  color: var(--body);
  font-size: 15px;
}

.message.user .content {
  width: fit-content;
  max-width: min(76%, 64ch);
  margin-left: auto;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--hairline);
  color: var(--ink);
  border-radius: 14px;
  padding: 10px 12px;
}

.message.assistant .content {
  max-width: 76ch;
}

.message.assistant .content {
  white-space: normal;
}

.markdown-body {
  color: var(--body);
  font-size: 15px;
  line-height: 1.62;
  overflow-wrap: anywhere;
}

.markdown-body > :first-child {
  margin-top: 0;
}

.markdown-body > :last-child {
  margin-bottom: 0;
}

.markdown-body p,
.markdown-body ul,
.markdown-body ol,
.markdown-body blockquote,
.markdown-body pre,
.markdown-body table {
  margin: 0.72em 0;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  color: var(--ink);
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.25;
  margin: 1.2em 0 0.5em;
}

.markdown-body h1 {
  font-size: 22px;
}

.markdown-body h2 {
  font-size: 19px;
}

.markdown-body h3 {
  font-size: 16px;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 1.35em;
}

.markdown-body li {
  margin: 0.22em 0;
}

.markdown-body li > p {
  margin: 0.22em 0;
}

.markdown-body blockquote {
  border-left: 3px solid var(--hairline);
  color: var(--muted);
  padding-left: 12px;
}

.markdown-body a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
  font-size: 13px;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid var(--hairline);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}

.markdown-body th {
  color: var(--ink);
  background: var(--surface-card);
  font-weight: 600;
}

.md-inline-code {
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--surface-card);
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.88em;
  padding: 0.08em 0.34em;
}

.md-code,
.md-code .shiki,
.md-code-fallback {
  border-radius: 8px;
  background: var(--code-surface) !important;
  color: var(--code-ink);
  overflow: auto;
}

.md-code {
  margin: 0.85em 0;
}

.md-code .shiki,
.md-code-fallback {
  margin: 0;
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.md-code .shiki span {
  background: transparent !important;
}

.tool-stack {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.assistant-parts {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-batch {
  max-width: 760px;
}

.tool-batch.live {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-batch.collapsed {
  border: 0;
}

.tool-batch-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  cursor: pointer;
  list-style: none;
  font-size: 13px;
  font-weight: 500;
}

.tool-batch-summary::-webkit-details-marker {
  display: none;
}

.tool-batch-caret {
  color: var(--muted-soft);
  font-size: 11px;
}

.tool-batch-items.readonly {
  display: none;
}

.tool-batch-header {
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  padding: 0 2px;
}

.shell-command-batch {
  max-width: 760px;
  color: var(--muted);
  font-size: 13px;
}

.shell-command-batch-summary {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 24px;
  color: var(--muted-soft);
  cursor: pointer;
  list-style: none;
}

.shell-command-batch-summary::-webkit-details-marker,
.shell-command-row::-webkit-details-marker {
  display: none;
}

.shell-command-icon {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(20, 24, 22, 0.22);
  border-radius: 3px;
  color: var(--muted);
  font-size: 9px;
  line-height: 1;
}

.shell-command-caret {
  color: var(--muted-soft);
  font-size: 12px;
}

.shell-command-list {
  display: grid;
  gap: 7px;
  margin-top: 5px;
}

.shell-command-item {
  min-width: 0;
}

.shell-command-row {
  width: fit-content;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 22px;
  color: var(--body);
  cursor: pointer;
  list-style: none;
  overflow-wrap: anywhere;
}

.shell-terminal {
  position: relative;
  margin: 6px 0 2px;
  border-radius: 8px;
  background: var(--code-surface);
  color: var(--code-ink);
  overflow: hidden;
}

.shell-terminal-label {
  padding: 8px 10px 0;
  color: var(--code-muted);
  font-size: 12px;
}

.shell-terminal-body {
  margin: 0;
  padding: 16px 10px 36px;
  color: var(--code-ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.shell-prompt {
  color: var(--code-ink);
}

.shell-terminal-status {
  position: absolute;
  right: 10px;
  bottom: 8px;
  color: #7a7a7a;
  font-size: 13px;
}

.shell-terminal-status.failed,
.shell-terminal-status.invalid,
.shell-terminal-status.denied {
  color: var(--error);
}

.tool-line-compact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  padding: 0 2px;
  color: var(--muted);
}

.tool-line-compact .tool-line-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tool-line-title {
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
}

.tool-line-subtitle {
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.tool-line-files {
  color: var(--muted-soft);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.tool-context-group {
  border: 1px solid var(--hairline);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
  overflow: hidden;
}

.tool-context-summary {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  cursor: pointer;
  list-style: none;
  background: rgba(20, 24, 22, 0.02);
}

.tool-context-summary::-webkit-details-marker {
  display: none;
}

.tool-context-title {
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}

.tool-context-meta {
  color: var(--muted);
  font-size: 12px;
}

.tool-context-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 12px;
}

.tool-line {
  min-width: 0;
  display: block;
  color: var(--muted);
  font-size: 13px;
}

.tool-card {
  max-width: 760px;
  border: 1px solid var(--hairline);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 8px 24px rgba(20, 24, 22, 0.03);
  overflow: hidden;
}

.tool-card-context {
  background: rgba(255, 255, 255, 0.82);
  box-shadow: inset 3px 0 0 rgba(31, 107, 87, 0.22);
}

.tool-card-shell {
  background: #ffffff;
  border-color: rgba(20, 24, 22, 0.1);
  box-shadow: 0 6px 18px rgba(20, 24, 22, 0.04);
}

.tool-card-mutation {
  background: rgba(255, 255, 255, 0.82);
  box-shadow: inset 3px 0 0 rgba(31, 107, 87, 0.28);
}

.tool-card-generic {
  background: rgba(255, 255, 255, 0.82);
}

.tool-card-header {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 15px;
}

.tool-card-header.shell {
  padding: 10px 12px 8px;
}

.tool-card-main {
  min-width: 0;
  flex: 1;
}

.tool-card-title-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-card-title {
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}

.tool-card-shell .tool-card-title {
  font-size: 12px;
  letter-spacing: 0.01em;
}

.tool-card-subtitle {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow-wrap: anywhere;
}

.tool-card-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.tool-card-file-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border: 1px solid rgba(10, 10, 10, 0.08);
  border-radius: 999px;
  background: rgba(245, 246, 242, 0.94);
  color: var(--body);
  padding: 0 8px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-card-file-chip.muted {
  color: var(--muted);
}

.tool-card-summary {
  flex: 0 0 auto;
  color: var(--body);
  font-size: 12px;
  white-space: nowrap;
}

.tool-card-shell .tool-card-summary {
  color: var(--muted);
  font-size: 11px;
}

.tool-card-footnote {
  padding: 0 12px 10px;
  color: var(--muted);
  font-size: 12px;
}

.tool-card-status {
  flex: 0 0 auto;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: rgba(10, 10, 10, 0.04);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  padding: 2px 8px;
}

.tool-card-status.shell {
  background: #f2f4f1;
  border-color: rgba(20, 24, 22, 0.08);
  color: var(--muted);
}

.tool-card-status.running,
.tool-card-status.approval {
  color: #8a5a00;
  background: #fbf4df;
  border-color: rgba(245, 158, 11, 0.2);
}

.tool-card-status.ok {
  color: #0f6b31;
  background: #e9f8ed;
  border-color: rgba(34, 197, 94, 0.2);
}

.tool-card-status.denied,
.tool-card-status.failed,
.tool-card-status.invalid {
  color: #9d1f1f;
  background: #fde8e5;
  border-color: rgba(239, 68, 68, 0.2);
}

.tool-card-details {
  display: block;
}

.tool-card-summary-row,
.tool-card-secondary-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  list-style: none;
}

.tool-card-summary-row::-webkit-details-marker,
.tool-card-secondary-toggle::-webkit-details-marker {
  display: none;
}

.tool-card-summary-row {
  padding-right: 12px;
}

.tool-card-secondary-toggle {
  padding: 0 12px 10px;
}

.tool-card-secondary-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.tool-card-output {
  margin: 0;
  padding: 12px 12px 13px;
  background: var(--code-surface);
  color: var(--code-ink);
  border-top: 1px solid rgba(20, 24, 22, 0.08);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow: auto;
}

.tool-card-shell .tool-card-output {
  background: var(--code-surface);
  color: var(--code-ink);
  border-top-color: rgba(20, 24, 22, 0.08);
  border-radius: 0 0 14px 14px;
}

.tool-card-shell .tool-card-summary-row {
  padding: 0 12px 10px;
}

.tool-card-shell .tool-card-secondary-label {
  color: var(--muted-soft);
}

.tool-card-shell .tool-caret {
  color: var(--muted-soft);
}

.tool-header {
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  max-width: 100%;
}

.tool-title {
  min-width: 0;
  max-width: 58ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
  font-weight: 600;
}

.tool-summary {
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}

.tool-line.running .tool-summary,
.tool-line.approval .tool-summary {
  color: #8a5a00;
}

details.tool-details {
  display: block;
  margin: 0;
  color: var(--body);
}

details.tool-details summary {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  cursor: pointer;
  color: var(--muted);
  list-style: none;
}

details.tool-details summary::-webkit-details-marker {
  display: none;
}

details.tool-details summary::before {
  content: none;
}

.tool-caret {
  flex: 0 0 auto;
  color: var(--muted-soft);
  font-size: 11px;
  line-height: 1;
}

details.tool-details pre {
  margin: 8px 0 0;
  padding: 12px;
  background: var(--code-surface);
  color: var(--code-ink);
  border: 0;
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 300px;
  overflow: auto;
}

.status-line {
  max-width: 760px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.status-line.warning {
  color: #8a5a00;
}

.status-line.error {
  color: var(--error);
}

.turn-review {
  max-width: 760px;
  border: 1px solid var(--hairline);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 10px 28px rgba(20, 24, 22, 0.03);
  overflow: hidden;
}

.turn-review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(229, 220, 200, 0.75);
  background: rgba(20, 24, 22, 0.025);
}

.turn-review-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.turn-review-title {
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}

.turn-review-meta {
  color: var(--muted);
  font-size: 12px;
}

.turn-review-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.turn-review-statline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.turn-review-toggle {
  min-height: 28px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: #ffffff;
  color: var(--body);
  padding: 0 10px;
  font-size: 12px;
}

.turn-review-files {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.review-file {
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: rgba(250, 251, 248, 0.92);
  overflow: hidden;
}

.review-file-summary {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 8px 12px;
  cursor: pointer;
  list-style: none;
  background: rgba(20, 24, 22, 0.02);
}

.review-file-summary::-webkit-details-marker {
  display: none;
}

.review-file-main {
  min-width: 0;
  flex: 1;
}

.review-file-name-group {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0;
  flex-wrap: wrap;
}

.review-file-directory {
  color: var(--muted);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.review-file-filename {
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.review-file-meta {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.review-file-status {
  border: 1px solid var(--hairline);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
}

.review-file-status.added {
  color: #0f6b31;
  background: #e9f8ed;
  border-color: rgba(34, 197, 94, 0.2);
}

.review-file-status.deleted {
  color: #9d1f1f;
  background: #fde8e5;
  border-color: rgba(239, 68, 68, 0.2);
}

.review-file-status.modified {
  color: #8a5a00;
  background: #fbf4df;
  border-color: rgba(245, 158, 11, 0.2);
}

.review-file-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.review-file-diff {
  border-top: 1px solid rgba(10, 10, 10, 0.06);
}

.composer {
  border-top: 1px solid var(--hairline);
  background: rgba(238, 240, 234, 0.94);
  padding: 14px 24px 16px;
}

.composer-inner {
  max-width: var(--dock-width);
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
  border: 1px solid var(--hairline);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.86);
  padding: 10px;
}

textarea {
  width: 100%;
  min-height: 50px;
  max-height: 200px;
  resize: vertical;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
  padding: 10px 12px;
  outline: none;
  line-height: 1.45;
}

textarea:focus {
  background: rgba(245, 246, 242, 0.9);
}

.hint {
  max-width: var(--dock-width);
  margin: 8px auto 0;
  color: var(--muted);
  font-size: 12px;
}

.approval {
  position: fixed;
  z-index: var(--z-dock);
  left: calc(var(--sidebar-width) + (100vw - var(--sidebar-width)) / 2);
  bottom: 118px;
  transform: translateX(-50%);
  width: min(var(--dock-width), calc(100vw - var(--sidebar-width) - 56px));
  border: 1px solid var(--hairline);
  background: rgba(255, 255, 255, 0.96);
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 18px 42px rgba(20, 24, 22, 0.08);
  display: none;
}

.approval.visible {
  display: block;
}

.approval-title {
  color: var(--ink);
  font-weight: 600;
  font-size: 17px;
  letter-spacing: -0.01em;
  margin-bottom: 6px;
}

.approval-body {
  color: var(--body-strong, #1a1a1a);
  display: grid;
  gap: 8px;
}

.approval-head {
  display: grid;
  gap: 6px;
}

.approval-reason {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.approval-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}

.approval-field {
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0 2px;
}

.approval-label {
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 3px;
}

.approval-value {
  color: var(--body-strong);
  font-size: 13px;
  line-height: 1.45;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.approval-command {
  display: block;
  color: var(--ink);
  background: transparent;
  border: 0;
  border-radius: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  overflow-x: auto;
  white-space: pre;
  padding: 0;
}

.approval-file-list,
.tool-diff-list {
  display: grid;
  gap: 8px;
}

.tool-diff-list {
  margin-top: 8px;
  max-width: min(760px, calc(100vw - 360px));
}

.diff-file {
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: var(--canvas);
  overflow: hidden;
}

.diff-file summary,
.diff-file-header {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 7px 10px;
  border-radius: 0;
  cursor: pointer;
  list-style: none;
  background: rgba(10, 10, 10, 0.025);
}

.diff-file-header {
  cursor: default;
}

.diff-file summary::-webkit-details-marker {
  display: none;
}

.diff-file summary:hover {
  background: rgba(10, 10, 10, 0.045);
}

.diff-file-name {
  min-width: 0;
  color: #0068b7;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-file-stat {
  flex: 0 0 auto;
  display: inline-flex;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1;
}

.diff-file-stat .stat-add {
  color: var(--success);
}

.diff-file-stat .stat-del {
  color: var(--error);
}

.approval-inline-diff {
  margin: 0;
  border-top: 1px solid var(--hairline);
  background: #ffffff;
  max-height: 320px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}

.diff-row {
  display: grid;
  grid-template-columns: 52px 20px minmax(0, 1fr);
  min-height: 20px;
  white-space: pre;
  position: relative;
}

.diff-row::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}

.diff-gutter {
  color: #7d7d7d;
  background: rgba(10, 10, 10, 0.025);
  border-right: 1px solid rgba(10, 10, 10, 0.06);
  text-align: right;
  padding: 0 10px 0 6px;
  user-select: none;
}

.diff-marker {
  text-align: center;
  user-select: none;
}

.diff-code {
  min-width: 0;
  padding: 0 12px 0 6px;
  overflow: visible;
}

.diff-row.ctx {
  color: var(--body);
}

.diff-row.add {
  color: #006b2b;
  background: #e9f8ed;
}

.diff-row.add::before {
  background: #22c55e;
}

.diff-row.del {
  color: #9d1f1f;
  background: #fde8e5;
}

.diff-row.del::before {
  background: #ef4444;
}

.diff-row.hunk {
  color: #7a5b00;
  background: #fbf4df;
}

.diff-row.hunk .diff-code {
  font-weight: 600;
}

.diff-row.file {
  color: var(--muted);
  background: rgba(10, 10, 10, 0.035);
}

.approval-details {
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: var(--canvas);
  padding: 10px 12px;
}

.approval-details summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.approval-preview {
  margin: 10px 0 0;
  padding: 12px;
  border-radius: 8px;
  background: var(--code-surface);
  color: var(--code-ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow: auto;
}

.approval-options {
  display: grid;
  gap: 4px;
  margin-top: 14px;
}

.approval-option {
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
  text-align: left;
  padding: 7px 10px;
}

.approval-option:hover,
.approval-option.selected {
  background: rgba(31, 107, 87, 0.08);
}

.approval-option.muted {
  color: var(--muted-soft);
}

.option-index {
  color: var(--muted-soft);
}

.option-hint {
  color: var(--muted-soft);
  font-size: 12px;
}

.approval-submit {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.submit-button {
  min-height: 34px;
  border-radius: 999px;
  border: 1px solid var(--ink);
  background: var(--ink);
  color: #ffffff;
  padding: 0 14px;
  font-weight: 600;
}

.submit-button:hover,
.submit-button:focus-visible {
  border-color: #202522;
  background: #202522;
  color: #ffffff;
}

.submit-button span {
  opacity: 0.8;
  margin-left: 4px;
}

@media (max-width: 760px) {
  .app {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .timeline {
    padding: 16px;
  }

  .topbar {
    padding: 10px 14px;
  }

  .topbar-actions-panel {
    width: min(340px, calc(100vw - 28px));
  }

  .composer {
    padding: 12px;
  }

  .approval {
    right: 12px;
    left: 12px;
    transform: none;
    width: auto;
    bottom: 92px;
  }

  .approval-fields {
    grid-template-columns: 1fr;
  }
}
`;
