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
  background: #dfe7e3;
  border-right: 1px solid rgba(10, 10, 10, 0.08);
}

.brand {
  flex: 0 0 auto;
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 10px 8px 14px;
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
  min-height: 30px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(10, 10, 10, 0.66);
  padding: 5px 9px;
}

.brand .primary:hover {
  background: rgba(10, 10, 10, 0.06);
  color: var(--ink);
}

.session-list {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 4px 14px;
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
  background: rgba(10, 10, 10, 0.16);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.section-heading {
  color: rgba(10, 10, 10, 0.42);
  font-size: 14px;
  font-weight: 500;
  margin: 16px 0 7px;
  padding: 0 0 0 0;
}

.project-row {
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 7px;
  padding: 0 5px;
  color: rgba(10, 10, 10, 0.66);
}

.project-icon {
  width: 14px;
  height: 10px;
  border: 1.4px solid rgba(10, 10, 10, 0.48);
  border-radius: 2px;
  position: relative;
  flex: 0 0 auto;
}

.project-icon::before {
  content: "";
  position: absolute;
  left: 1px;
  top: -4px;
  width: 6px;
  height: 4px;
  border: 1.4px solid rgba(10, 10, 10, 0.48);
  border-bottom: 0;
  border-radius: 2px 2px 0 0;
  background: #dfe7e3;
}

.project-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-count {
  flex: 0 0 auto;
  color: rgba(10, 10, 10, 0.38);
  font-size: 12px;
}

.session-item {
  width: 100%;
  min-height: 32px;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 0;
  background: transparent;
  border-radius: 7px;
  padding: 0 7px 0 28px;
  margin: 1px 0;
  box-shadow: none;
  color: rgba(10, 10, 10, 0.68);
}

.session-item:hover {
  background: rgba(10, 10, 10, 0.045);
}

.session-item.active {
  background: rgba(10, 10, 10, 0.075);
}

.session-item.active .session-title {
  color: rgba(10, 10, 10, 0.86);
  font-weight: 500;
}

.session-title {
  min-width: 0;
  flex: 1;
  color: rgba(10, 10, 10, 0.68);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  font-weight: 400;
}

.session-meta {
  flex: 0 0 auto;
  color: rgba(10, 10, 10, 0.42);
  font-family: inherit;
  font-size: 13px;
  white-space: nowrap;
}

.empty-list {
  color: rgba(10, 10, 10, 0.45);
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
  padding: 28px;
}

.empty {
  max-width: 720px;
  margin: 16vh auto 0;
  color: var(--muted);
  text-align: center;
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-radius: 24px;
  padding: 48px;
}

.empty h1 {
  font-size: 40px;
  font-weight: 500;
  letter-spacing: -0.05em;
  color: var(--ink);
  line-height: 1.1;
  margin: 0 0 12px;
}

.turn {
  max-width: 980px;
  margin: 0 auto 16px;
}

.message {
  border: 1px solid var(--hairline);
  background: var(--surface-card);
  border-radius: 16px;
  padding: 16px 18px;
  box-shadow: 0 12px 28px var(--shadow);
}

.message.user {
  background: var(--brand-peach);
  border-color: #f0a06f;
}

.message.assistant {
  background: #fffdf7;
}

.message.tool {
  box-shadow: none;
  background: var(--brand-lavender);
  border-color: #a894dc;
  padding: 12px 14px;
  margin-top: 8px;
}

.message.error {
  border-color: var(--brand-coral);
  background: #ffe4df;
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
.message.tool .label {
  color: rgba(10, 10, 10, 0.65);
}

.content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.55;
  color: var(--body);
}

.message.user .content,
.message.tool .content {
  color: var(--ink);
}

.tool-summary {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: rgba(10, 10, 10, 0.72);
}

details.tool-details {
  margin-top: 8px;
  color: var(--body);
}

details.tool-details pre {
  margin: 8px 0 0;
  padding: 12px;
  background: rgba(255, 250, 240, 0.7);
  border: 1px solid rgba(10, 10, 10, 0.12);
  border-radius: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow: auto;
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
  right: 24px;
  bottom: 108px;
  width: min(620px, calc(100vw - 48px));
  border: 1px solid #bc8f27;
  background: var(--brand-ochre);
  border-radius: 24px;
  padding: 18px;
  box-shadow: 0 22px 52px rgba(26, 20, 8, 0.18);
  display: none;
}

.approval.visible {
  display: block;
}

.approval-title {
  color: var(--ink);
  font-weight: 700;
  margin-bottom: 8px;
}

.approval-body {
  color: var(--body-strong, #1a1a1a);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.approval-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
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
}
`;
