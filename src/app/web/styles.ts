export const APP_STYLES = String.raw`
:root {
  color-scheme: light;
  --canvas: #fffaf0;
  --surface-soft: #faf5e8;
  --surface-card: #f5f0e0;
  --surface-strong: #ebe6d6;
  --ink: #0a0a0a;
  --body-strong: #1a1a1a;
  --body: #3a3a3a;
  --muted: #6a6a6a;
  --muted-soft: #9a9a9a;
  --hairline: #e5dcc8;
  --brand-pink: #ff4d8b;
  --brand-teal: #1a3a3a;
  --brand-lavender: #b8a4ed;
  --brand-peach: #ffb084;
  --brand-ochre: #e8b94a;
  --brand-mint: #a4d4c5;
  --brand-coral: #ff6b5a;
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  --shadow: rgba(26, 20, 8, 0.08);
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
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
}

button,
textarea {
  font: inherit;
}

button {
  border: 1px solid var(--hairline);
  background: var(--canvas);
  color: var(--ink);
  border-radius: 12px;
  min-height: 40px;
  padding: 10px 14px;
  cursor: pointer;
}

button:hover {
  border-color: var(--ink);
}

button.primary {
  background: var(--ink);
  border-color: var(--ink);
  color: #ffffff;
}

button.danger {
  background: var(--brand-coral);
  border-color: var(--brand-coral);
  color: var(--ink);
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
  grid-template-columns: 298px minmax(0, 1fr);
  background: var(--canvas);
}

.sidebar {
  min-width: 0;
  min-height: 0;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--surface-soft);
  border-right: 1px solid var(--hairline);
}

.brand {
  flex: 0 0 auto;
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 10px 9px 14px;
  border-bottom: 1px solid rgba(229, 220, 200, 0.72);
}

.brand-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}

.brand-subtitle {
  margin-top: 1px;
  color: rgba(10, 10, 10, 0.46);
  font-size: 12px;
}

.brand .primary {
  min-height: 32px;
  border: 1px solid var(--ink);
  border-radius: 12px;
  background: var(--ink);
  color: #ffffff;
  padding: 7px 12px;
}

.brand .primary:hover {
  background: var(--body-strong);
  color: #ffffff;
}

.session-list {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 8px 16px;
}

.session-list::-webkit-scrollbar,
.timeline::-webkit-scrollbar,
.session-id::-webkit-scrollbar {
  width: 10px;
  height: 8px;
}

.session-list::-webkit-scrollbar-thumb,
.timeline::-webkit-scrollbar-thumb,
.session-id::-webkit-scrollbar-thumb {
  background: #d8ceb7;
  border-radius: 999px;
  border: 2px solid var(--surface-soft);
}

.section-heading {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  margin: 16px 0 7px;
  padding: 0 2px;
}

.workspace-row {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--hairline);
  border-radius: 12px;
  padding: 0 10px;
  background: var(--surface-card);
  color: var(--body);
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
  background: var(--surface-card);
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
  min-height: 34px;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 12px;
  padding: 0 8px 0 12px;
  margin: 1px 0;
  box-shadow: none;
  color: var(--body);
}

.session-item:hover {
  background: rgba(245, 240, 224, 0.68);
}

.session-item.active {
  background: var(--surface-strong);
  border-color: var(--hairline);
}

.session-item.active::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 999px;
  background: var(--brand-teal);
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
  font-size: 13px;
  white-space: nowrap;
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
}

.topbar {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--hairline);
  background: rgba(255, 250, 240, 0.9);
  backdrop-filter: blur(8px);
}

.topbar-main {
  min-width: 0;
  flex: 1;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.session-name {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.035em;
}

.workspace {
  color: var(--muted);
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  margin-top: 5px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--hairline);
  color: var(--body);
  background: var(--surface-card);
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  white-space: nowrap;
}

.session-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  max-width: min(100%, 520px);
  overflow-x: auto;
  user-select: all;
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
  padding: 34px 28px 40px;
  background: var(--canvas);
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
  max-width: 900px;
  margin: 0 auto 28px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
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
  background: var(--surface-card);
  color: var(--ink);
  border-radius: 16px;
  padding: 9px 12px;
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
  color: var(--brand-teal);
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
  background: #11110f !important;
  color: #f7f2e5;
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

.tool-line {
  min-width: 0;
  display: block;
  color: var(--muted);
  font-size: 13px;
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
  background: #11110f;
  color: #f7f2e5;
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

.composer {
  border-top: 1px solid var(--hairline);
  background: rgba(250, 245, 232, 0.94);
  backdrop-filter: blur(8px);
  padding: 16px 22px 18px;
}

.composer-inner {
  max-width: 980px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}

textarea {
  width: 100%;
  min-height: 52px;
  max-height: 200px;
  resize: vertical;
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: var(--canvas);
  color: var(--ink);
  padding: 13px 15px;
  outline: none;
  line-height: 1.45;
}

textarea:focus {
  border-color: var(--ink);
}

.hint {
  max-width: 980px;
  margin: 8px auto 0;
  color: var(--muted);
  font-size: 12px;
}

.approval {
  position: fixed;
  left: calc(149px + 50vw);
  bottom: 118px;
  transform: translateX(-50%);
  width: min(760px, calc(100vw - 346px));
  border: 1px solid var(--hairline);
  background: var(--surface-soft);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 18px 42px rgba(26, 20, 8, 0.12);
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
  gap: 12px;
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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.approval-field {
  min-width: 0;
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: var(--canvas);
  padding: 10px 12px;
}

.approval-label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}

.approval-value {
  color: var(--body-strong);
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.approval-command {
  display: block;
  color: var(--ink);
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  overflow-x: auto;
  white-space: pre;
  padding: 10px 12px;
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
  border-radius: 10px;
  background: #11110f;
  color: #f7f2e5;
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
  margin-top: 18px;
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
  background: rgba(10, 10, 10, 0.055);
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
  color: var(--on-primary);
  padding: 0 14px;
  font-weight: 600;
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
    padding: 14px;
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
