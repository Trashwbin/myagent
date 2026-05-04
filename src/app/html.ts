import { APP_STYLES } from "./web/styles.js";

export const EMBEDDED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>myAgent</title>
<link rel="icon" href="data:,">
<style>${APP_STYLES}</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <div>
        <div class="brand-title">myAgent</div>
        <div class="brand-subtitle">Local coding workspace</div>
      </div>
      <button class="primary" id="new-session">New</button>
    </div>
    <div class="session-list" id="session-list" aria-label="Sessions"></div>
  </aside>

  <main class="main">
    <header class="topbar">
      <div class="topbar-main">
        <div class="title-row">
          <strong class="session-name" id="session-title">No session</strong>
          <span class="pill"><span class="dot" id="status-dot"></span><span id="status-text">Connecting</span></span>
          <span class="pill" id="model-pill">model</span>
          <span class="pill session-id" id="session-id">session</span>
        </div>
        <div class="workspace" id="workspace"></div>
      </div>
      <button class="ghost" id="copy-session">Copy ID</button>
    </header>

    <section class="timeline" id="timeline">
      <div class="empty" id="empty-state">
        <h1>Start working in this workspace</h1>
        <p>Pick an existing session from the left, or create a new one.</p>
      </div>
    </section>

    <section class="composer">
      <div class="composer-inner">
        <textarea id="input" placeholder="Ask myAgent to inspect, edit, test, or explain this workspace..."></textarea>
        <button class="primary" id="send">Send</button>
      </div>
      <div class="hint">Enter sends. Shift+Enter inserts a new line. Browser-native selection, copy, IME, and scrolling are preserved.</div>
    </section>
  </main>
</div>

<section class="approval" id="approval-panel">
  <div class="approval-title" id="approval-title">Approval required</div>
  <div class="approval-body" id="approval-text"></div>
  <div class="approval-options" id="approval-options">
    <button class="approval-option selected" data-index="0" data-decision="allow_once"><span class="option-index">1.</span><span>Yes</span><span class="option-hint">↑ ↓</span></button>
    <button class="approval-option" data-index="1" data-decision="allow_for_session"><span class="option-index">2.</span><span>Yes, and don't ask again this session</span></button>
    <button class="approval-option muted" data-index="2" data-decision="abort"><span class="option-index">3.</span><span>No, and tell myAgent what to do differently</span></button>
  </div>
  <div class="approval-submit">
    <button class="text-button" data-decision="abort">Skip</button>
    <button class="submit-button" id="approval-submit" data-submit-approval>Submit <span>↵</span></button>
  </div>
</section>

<script type="module" src="/assets/client.js"></script>
</body>
</html>`;
