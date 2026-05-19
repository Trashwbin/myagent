export const APP_STYLES = String.raw`
:root {
  color-scheme: light;
  --sidebar-width: 260px;
  --content-width: 760px;
  --panel-width: 760px;
  --dock-width: 680px;
  --timeline-bottom-safe: 176px;
  --sp-1: 4px;
  --sp-2: 6px;
  --sp-3: 8px;
  --sp-4: 10px;
  --sp-5: 12px;
  --sp-6: 14px;
  --sp-7: 16px;
  --sp-8: 24px;
  --sp-9: 32px;
  --canvas: #f9f9f9;
  --sidebar-surface: #f0f0f0;
  --surface-soft: #f4f4f4;
  --surface-card: #ffffff;
  --surface-strong: #eeeeee;
  --surface-stronger: #dedede;
  --ink: #1a1a1a;
  --body-strong: #2b2b2b;
  --body: #4b4b4b;
  --muted: #737373;
  --muted-soft: #a3a3a3;
  --hairline: #e5e5e5;
  --accent: #2f6f63;
  --accent-soft: rgba(47, 111, 99, 0.08);
  --success: #1f8a55;
  --warning: #9a6a12;
  --error: #b5453f;
  --shadow: rgba(0, 0, 0, 0.08);
  --code-surface: #f2f0ec;
  --code-ink: #171717;
  --code-muted: #666666;
  --z-header: 30;
  --z-popover: 40;
  --z-dock: 50;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideInRight {
  from { opacity: 0; transform: translateX(6px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes softPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
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
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif;
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::selection {
  background: rgba(31, 107, 87, 0.18);
  color: var(--ink);
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
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}

button:hover {
  border-color: var(--muted);
  background: #ffffff;
}

button:active {
  transform: translateY(0.5px);
}

button.primary {
  background: var(--ink);
  border-color: var(--ink);
  color: #ffffff;
}

button.primary:hover {
  box-shadow: 0 2px 8px rgba(10, 10, 0, 0.12);
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

button:focus-visible {
  outline: 2px solid rgba(31, 107, 87, 0.4);
  outline-offset: 2px;
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
  background: var(--sidebar-surface);
  border-right: 1px solid var(--hairline);
}

.sidebar-actions {
  flex: 0 0 auto;
  padding: 14px 12px 8px;
  display: grid;
  gap: 1px;
}

.sidebar-action {
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #666666;
  padding: 7px 9px;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  transition: background-color 100ms ease, color 100ms ease;
}

.sidebar-action:hover {
  background: #e8e8e8;
  color: #242424;
}

.iconfont-icon {
  display: inline-block;
  width: 1em;
  height: 1em;
  color: inherit;
  fill: currentColor;
  stroke: none;
  vertical-align: -0.125em;
  overflow: hidden;
}

.sidebar-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  color: #777777;
}

.sidebar-action:hover .sidebar-icon {
  color: var(--body);
}

.brand {
  flex: 0 0 auto;
  min-height: 0;
  display: none;
}

.session-list {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px 8px 16px;
}

.session-controls {
  display: grid;
  gap: 10px;
  margin: 0 4px 10px;
}

.session-scope {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
}

.scope-pill {
  min-height: 28px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: rgba(255, 255, 255, 0.6);
  color: var(--muted);
  padding: 0 10px;
  font-size: 12px;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}

.scope-pill.active {
  background: #ffffff;
  color: var(--ink);
  border-color: var(--surface-stronger);
}

.session-search {
  width: 100%;
  min-height: 32px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: #e9e9e9;
  color: var(--ink);
  padding: 0 11px;
  outline: none;
  font: inherit;
  transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}

.session-search:focus {
  background: #ffffff;
  border-color: #d2d2d2;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.04);
}

.session-list::-webkit-scrollbar,
.timeline::-webkit-scrollbar {
  width: 10px;
  height: 8px;
}

.session-list::-webkit-scrollbar-track,
.timeline::-webkit-scrollbar-track {
  background: transparent;
}

.session-list::-webkit-scrollbar-thumb,
.timeline::-webkit-scrollbar-thumb {
  background: #cec8b2;
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.session-list:hover::-webkit-scrollbar-track,
.timeline:hover::-webkit-scrollbar-track {
  background: rgba(10, 10, 0, 0.03);
}

.tool-card-output::-webkit-scrollbar,
details.tool-details pre::-webkit-scrollbar,
.shell-terminal-body::-webkit-scrollbar,
.approval-preview::-webkit-scrollbar,
.approval-inline-diff::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.tool-card-output::-webkit-scrollbar-thumb,
details.tool-details pre::-webkit-scrollbar-thumb,
.shell-terminal-body::-webkit-scrollbar-thumb,
.approval-preview::-webkit-scrollbar-thumb,
.approval-inline-diff::-webkit-scrollbar-thumb {
  background: #cec8b2;
  border-radius: 999px;
}

.section-heading {
  color: #9a9a9a;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 16px 0 7px;
  padding: 0 8px;
}

.workspace-row {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 9px;
  padding: 0 9px;
  background: transparent;
  color: #666666;
  font-size: 13px;
}

.workspace-row.selected {
  background: #e7e7e7;
  color: #242424;
}

.workspace-row:hover {
  background: #e8e8e8;
  color: #242424;
}

.workspace-row.workspace-toggle {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
}

.workspace-stack {
  display: grid;
  gap: 1px;
  margin-bottom: 1px;
}

.workspace-chevron {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  color: var(--muted-soft);
}

.workspace-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  color: #777777;
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
  min-width: 0;
  min-height: 30px;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 7px;
  padding: 0 8px;
  margin: 1px 0;
  box-shadow: none;
  color: var(--body);
  transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}

.session-item.nested {
  min-height: 28px;
  margin-left: 24px;
  width: calc(100% - 24px);
  padding-left: 7px;
}

.session-item:hover {
  background: #e8e8e8;
}

.session-item.active {
  background: #dfdfdf;
  border-color: transparent;
  box-shadow: none;
}

.session-item.active::before {
  content: none;
}

.session-item.active .session-title {
  color: #1f1f1f;
  font-weight: 600;
}

.session-title {
  min-width: 0;
  flex: 1 1 auto;
  color: #5f5f5f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  font-weight: 400;
}

.session-meta {
  min-width: 0;
  flex: 0 0 auto;
  color: var(--muted);
  font-family: inherit;
  font-size: 11px;
  white-space: nowrap;
}

.session-sublist {
  display: grid;
  gap: 2px;
}

.session-more {
  justify-self: start;
  min-height: 24px;
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 0 4px 0 31px;
  font-size: 11px;
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
  grid-template-rows: auto minmax(0, 1fr);
  position: relative;
  isolation: isolate;
  background: #ffffff;
}

.topbar {
  min-width: 0;
  position: relative;
  z-index: var(--z-header);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding: 0 22px;
  border-bottom: 1px solid var(--hairline);
  background: #ffffff;
  backdrop-filter: none;
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
  min-width: 30px;
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
  background: #f5f5f5;
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
  gap: var(--sp-3);
  padding: var(--sp-5);
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 42px rgba(10, 10, 0, 0.09);
  animation: fadeIn 120ms ease, slideUp 180ms ease;
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
.dot.running {
  background: var(--warning);
  animation: softPulse 1.4s ease-in-out infinite;
}

.timeline {
  min-height: 0;
  overflow-y: auto;
  padding: 34px 40px var(--timeline-bottom-safe);
  background: #ffffff;
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
  animation: fadeIn 300ms ease;
}

.empty h1 {
  font-size: 26px;
  font-weight: 500;
  letter-spacing: -0.025em;
  color: var(--ink);
  line-height: 1.18;
  margin: 0 0 8px;
}

.empty p {
  margin: 0.5em 0 0;
  line-height: 1.5;
}

.empty::after {
  content: "";
  display: block;
  width: 48px;
  height: 2px;
  margin-top: 24px;
  background: var(--hairline);
  border-radius: 1px;
}

.turn {
  max-width: var(--content-width);
  margin: 0 auto 34px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 18px;
  content-visibility: auto;
  animation: slideUp 240ms ease both;
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
  animation: slideInRight 200ms ease both;
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
  gap: var(--sp-3);
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
  background: #f2f2f2;
  border: 0;
  color: #3f3f3f;
  border-radius: 18px;
  padding: 9px 14px;
  box-shadow: none;
}

.message.assistant .content {
  max-width: 76ch;
  white-space: normal;
}

.markdown-body {
  color: var(--body);
  font-size: 14.5px;
  line-height: 1.68;
  overflow-wrap: anywhere;
  text-wrap: pretty;
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
  margin: 0.68em 0;
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
  border-radius: 12px;
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
  padding: var(--sp-5);
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
  gap: 10px;
}

.assistant-parts {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.turn-tool-trace {
  max-width: 760px;
  border-bottom: 1px solid #eeeeee;
  color: #8d8d8d;
}

.turn-tool-trace-summary {
  width: fit-content;
  max-width: 100%;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  list-style: none;
  color: #8d8d8d;
  font-size: 13px;
}

.turn-tool-trace-summary::-webkit-details-marker {
  display: none;
}

.turn-tool-trace-title {
  flex: 0 0 auto;
}

.turn-tool-trace-meta {
  min-width: 0;
  color: var(--muted-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.turn-tool-trace-caret {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  color: var(--muted-soft);
  transition: transform 120ms ease;
}

.turn-tool-trace[open] .turn-tool-trace-caret {
  transform: rotate(90deg);
}

.turn-tool-trace-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 0 12px;
}

.tool-batch {
  max-width: 760px;
}

.tool-batch.live {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.tool-batch.collapsed {
  border: 0;
}

.tool-batch-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #9b9b9b;
  cursor: pointer;
  list-style: none;
  font-size: 13px;
  font-weight: 500;
}

.tool-batch-summary::-webkit-details-marker {
  display: none;
}

.tool-batch-caret {
  width: 13px;
  height: 13px;
  color: var(--muted-soft);
}

.tool-batch-items.readonly {
  display: none;
}

.tool-batch-header {
  color: #9b9b9b;
  font-size: 12px;
  font-weight: 500;
  padding: 0 2px;
}

.shell-command-batch {
  max-width: 760px;
  color: #9b9b9b;
  font-size: 13px;
}

.shell-command-batch-summary {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 24px;
  color: #9b9b9b;
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
  border: 1px solid #cfcfcf;
  border-radius: 3px;
  color: #8a8a8a;
  padding: 2px;
}

.shell-command-caret {
  width: 13px;
  height: 13px;
  color: var(--muted-soft);
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
  color: #5f5f5f;
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
  padding: 14px 10px 34px;
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
  color: var(--muted-soft);
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
  gap: var(--sp-5);
  min-height: 26px;
  padding: 0 2px;
  color: #8d8d8d;
}

.tool-line-compact .tool-line-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
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
  border: 0;
  border-radius: 0;
  background: transparent;
  overflow: hidden;
}

.tool-context-summary {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
  padding: 0 2px;
  cursor: pointer;
  list-style: none;
  background: transparent;
}

.tool-context-summary::-webkit-details-marker {
  display: none;
}

.tool-context-title {
  color: #8d8d8d;
  font-size: 13px;
  font-weight: 500;
}

.tool-context-meta {
  color: var(--muted);
  font-size: 12px;
}

.tool-context-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0 8px;
}

.tool-line {
  min-width: 0;
  display: block;
  color: var(--muted);
  font-size: 13px;
}

.tool-card {
  max-width: 760px;
  border: 1px solid #eeeeee;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: none;
  overflow: hidden;
  transition: box-shadow 200ms ease;
}

.tool-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.035);
}

.tool-card-context {
  background: #ffffff;
  box-shadow: none;
}

.tool-card-shell {
  background: #ffffff;
  border-color: #eeeeee;
  box-shadow: none;
}

.tool-card-mutation {
  background: #ffffff;
  box-shadow: none;
}

.tool-card-generic {
  background: rgba(255, 255, 255, 0.85);
}

.tool-card-header {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: var(--sp-5) 15px;
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
  gap: var(--sp-3);
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
  gap: var(--sp-2);
  margin-top: 8px;
}

.tool-card-file-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border: 1px solid rgba(10, 10, 0, 0.06);
  border-radius: 999px;
  background: rgba(250, 248, 243, 0.94);
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
  padding: 0 var(--sp-5) var(--sp-4);
  color: var(--muted);
  font-size: 12px;
}

.tool-card-status {
  flex: 0 0 auto;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: rgba(10, 10, 0, 0.035);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  padding: 2px 8px;
}

.tool-card-status.shell {
  background: #f3efe4;
  border-color: rgba(10, 10, 0, 0.06);
  color: var(--muted);
}

.tool-card-status.running,
.tool-card-status.approval {
  color: #8a5a00;
  background: #fbf4df;
  border-color: rgba(245, 158, 11, 0.2);
}

.tool-card-status.running {
  animation: softPulse 2s ease-in-out infinite;
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
  gap: var(--sp-3);
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
  padding: 0 var(--sp-5) var(--sp-4);
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
  border-top: 1px solid rgba(10, 10, 0, 0.06);
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
  border-top-color: rgba(10, 10, 0, 0.06);
  border-radius: 0 0 14px 14px;
}

.tool-card-shell .tool-card-summary-row {
  padding: 0 var(--sp-5) var(--sp-4);
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
  gap: var(--sp-3);
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
  gap: var(--sp-2);
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
  padding: var(--sp-5);
  background: var(--code-surface);
  color: var(--code-ink);
  border: 0;
  border-radius: 12px;
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

.diff-card {
  max-width: 760px;
  border: 1px solid #e5e5e5;
  border-radius: 12px;
  background: #ffffff;
  overflow: hidden;
  box-shadow: none;
}

.diff-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: 12px 14px;
  border-bottom: 1px solid #f0f0f0;
}

.diff-card-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.2;
}

.diff-card-count {
  color: var(--ink);
  font-weight: 650;
}

.diff-card-add {
  color: #0f6b31;
  font-weight: 650;
}

.diff-card-del {
  color: #9d1f1f;
  font-weight: 650;
}

.diff-card-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  min-height: 0;
  border-radius: 0;
  border: 0;
  background: transparent;
  color: #666666;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: color 150ms ease;
}

.diff-card-toggle:hover {
  background: transparent;
  color: #1f1f1f;
}

.diff-card-toggle-mark {
  width: 13px;
  height: 13px;
  color: var(--body);
}

.diff-card-files {
  display: grid;
}

.diff-card-file {
  border-bottom: 1px solid #f5f5f5;
}

.diff-card-file:last-child {
  border-bottom: none;
}

.diff-card-file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: 9px 14px;
  cursor: pointer;
  list-style: none;
  transition: background 150ms ease;
}

.diff-card-file-row::-webkit-details-marker {
  display: none;
}

.diff-card-file-row:hover {
  background: #fafafa;
}

.diff-card-file-name {
  min-width: 0;
  color: #5f5f5f;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-card-file-meta {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.diff-card-file-stat {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.diff-card-file-add {
  color: #0f6b31;
}

.diff-card-file-del {
  color: #9d1f1f;
}

.diff-card-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hairline);
}

.diff-card-dot.added {
  background: #22c55e;
}

.diff-card-dot.deleted {
  background: #ef4444;
}

.diff-card-dot.modified {
  background: #f59e0b;
}

.diff-card-file-content {
  border-top: 1px solid rgba(10, 10, 0, 0.04);
}

.composer {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: var(--dock-width);
  z-index: var(--z-header);
}

.slash-menu {
  max-width: var(--dock-width);
  margin: 0 auto 8px;
  border: 1px solid rgba(20, 24, 22, 0.09);
  border-radius: 14px;
  background: rgba(250, 251, 248, 0.98);
  box-shadow: 0 12px 32px rgba(20, 24, 22, 0.08);
  overflow: hidden;
}

.slash-command {
  width: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--body);
  padding: 10px 13px;
  text-align: left;
}

.slash-command + .slash-command {
  border-top: 1px solid rgba(20, 24, 22, 0.06);
}

.slash-command:hover,
.slash-command.selected {
  background: rgba(31, 107, 87, 0.08);
}

.slash-command-name {
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
}

.slash-command-description {
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.composer-inner {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--hairline);
  border-radius: 24px;
  background: #ffffff;
  padding: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.composer-inner:focus-within {
  border-color: rgba(31, 107, 87, 0.25);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), 0 0 0 3px rgba(31, 107, 87, 0.06);
}

.composer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
}

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 0;
}

.composer-left-actions,
.composer-right-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

textarea {
  width: 100%;
  min-height: 24px;
  max-height: 200px;
  resize: vertical;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  padding: 8px 8px 4px;
  outline: none;
  line-height: 1.45;
  font-size: 14px;
}

textarea:focus {
  background: transparent;
}

textarea::placeholder {
  color: var(--muted-soft);
}

.send-button {
  width: 32px;
  height: 32px;
  min-height: 32px;
  border: 0;
  border-radius: 999px;
  background: #2f2f2f;
  color: #ffffff;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 150ms ease, transform 150ms ease;
  flex-shrink: 0;
}

.send-button:hover {
  background: #111111;
  transform: scale(1.05);
}

.send-button:active {
  transform: scale(0.95);
}

.send-button:disabled {
  opacity: 0.4;
  transform: none;
}

.send-icon {
  width: 16px;
  height: 16px;
}

.model-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
  background: #f7f7f7;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid #eeeeee;
}

.model-badge.muted {
  opacity: 0.65;
}

.model-badge .dot {
  width: 4px;
  height: 4px;
  border-radius: 99px;
  background: var(--muted-soft);
}

.model-badge .dot.connected { background: var(--success); }

.model-selector {
  position: relative;
  min-width: 0;
}

.model-trigger {
  min-height: 28px;
  max-width: 230px;
  padding: 4px 9px;
  border-radius: 10px;
  cursor: pointer;
}

.model-trigger:hover {
  background: #ffffff;
  border-color: var(--surface-stronger);
}

.model-trigger-icon {
  width: 13px;
  height: 13px;
  color: var(--muted-soft);
  flex: 0 0 auto;
}

.model-trigger-text,
.model-option-main {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.model-provider {
  color: var(--muted);
  flex: 0 0 auto;
}

.model-name,
.model-option-name,
.model-option-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-name {
  max-width: 128px;
  color: var(--ink);
}

.model-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: var(--z-popover);
  width: min(360px, calc(100vw - 32px));
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid rgba(10, 10, 0, 0.08);
  border-radius: 14px;
  background: rgba(253, 252, 250, 0.98);
  box-shadow: 0 16px 40px rgba(10, 10, 0, 0.12);
  padding: 6px;
  animation: slideUp 140ms ease both;
}

.model-provider-group + .model-provider-group {
  border-top: 1px solid rgba(10, 10, 0, 0.06);
  margin-top: 5px;
  padding-top: 5px;
}

.model-provider-heading {
  padding: 7px 8px 5px;
  color: var(--muted-soft);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.model-option {
  width: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  padding: 8px;
  text-align: left;
}

.model-option:hover,
.model-option.active {
  background: rgba(31, 107, 87, 0.08);
}

.model-option-main {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.model-option-name {
  max-width: 250px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}

.model-option-id {
  max-width: 250px;
  color: var(--muted);
  font-size: 11px;
}

.model-option-meta {
  color: var(--muted-soft);
  font-size: 10px;
}

.hint {
  text-align: center;
  color: var(--muted-soft);
  font-size: 11px;
  margin-top: 10px;
}

.slash-menu {
  max-width: var(--dock-width);
  margin: 0 auto 8px;
  border: 1px solid rgba(10, 10, 0, 0.07);
  border-radius: 14px;
  background: rgba(253, 252, 250, 0.98);
  box-shadow: 0 12px 32px rgba(10, 10, 0, 0.08);
  overflow: hidden;
  animation: slideUp 160ms ease both;
}

.slash-command {
  width: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  gap: var(--sp-5);
  align-items: baseline;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--body);
  padding: 10px 13px;
  text-align: left;
  transition: background-color 100ms ease;
}

.slash-command + .slash-command {
  border-top: 1px solid rgba(10, 10, 0, 0.05);
}

.slash-command:hover,
.slash-command.selected {
  background: rgba(31, 107, 87, 0.08);
}

.slash-command-name {
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
}

.slash-command-description {
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.approval {
  position: absolute;
  z-index: var(--z-dock);
  left: 50%;
  bottom: 118px;
  transform: translateX(-50%);
  width: min(90%, var(--dock-width));
  border: 1px solid var(--hairline);
  background: rgba(255, 255, 255, 0.96);
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 18px 42px rgba(10, 10, 0, 0.1);
  display: none;
}

.approval.visible {
  display: block;
  animation: slideUp 240ms ease both;
}

.approval-title {
  color: var(--ink);
  font-weight: 600;
  font-size: 17px;
  letter-spacing: -0.01em;
  margin-bottom: 6px;
}

.approval-body {
  color: var(--body-strong);
  display: grid;
  gap: var(--sp-3);
}

.approval-head {
  display: grid;
  gap: var(--sp-2);
}

.approval-reason {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.approval-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--sp-2);
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
  gap: var(--sp-3);
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
  gap: var(--sp-6);
  padding: 7px 10px;
  border-radius: 0;
  cursor: pointer;
  list-style: none;
  background: rgba(10, 10, 0, 0.02);
}

.diff-file-header {
  cursor: default;
}

.diff-file summary::-webkit-details-marker {
  display: none;
}

.diff-file summary:hover {
  background: rgba(10, 10, 0, 0.04);
}

.diff-file-name {
  min-width: 0;
  color: #2a8f70;
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
  gap: var(--sp-1);
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
  background: rgba(10, 10, 0, 0.02);
  border-right: 1px solid rgba(10, 10, 0, 0.05);
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
  background: rgba(10, 10, 0, 0.03);
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
  padding: var(--sp-5);
  border-radius: 12px;
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
  gap: var(--sp-1);
  margin-top: 14px;
}

.approval-option {
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--sp-3);
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
  transition: background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}

.submit-button:hover,
.submit-button:focus-visible {
  border-color: #222;
  background: #222;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(10, 10, 0, 0.12);
}

.submit-button:active {
  transform: translateY(0.5px);
}

.submit-button span {
  opacity: 0.8;
  margin-left: 4px;
}

@media (max-width: 1024px) {
  :root {
    --sidebar-width: 220px;
  }

  .session-search {
    font-size: 12px;
  }
}

@media (max-width: 760px) {
  :root {
    --sidebar-width: 0px;
  }

  .app {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .timeline {
    padding: 16px 16px calc(var(--timeline-bottom-safe) + 32px);
  }

  .topbar {
    padding: 10px 14px;
  }

  .topbar-actions-panel {
    width: min(340px, calc(100vw - 28px));
  }

  .composer {
    padding: var(--sp-5);
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
