# myAgent Local Web Design Guide

This local web app follows a Clay-inspired B2B SaaS product surface: warm cream
canvas, dark ink text, generous rounded geometry, and saturated single-color
cards used as the visual voltage. The interface is still an operational agent
workspace, so the palette is adapted for dense chat, session history, approvals,
and tool timelines rather than marketing hero sections.

## Core Atmosphere

- Default canvas: `#fffaf0`, a cream-tinted white.
- Primary text and CTAs: `#0a0a0a`.
- Feature/card accents rotate through hot pink, deep teal, lavender, peach,
  ochre, and cream-card.
- Border radius is generous: 12px for buttons and inputs, 16px for content
  cards, 24px for major surfaces.
- Body/UI type uses Inter/system UI. Display moments use Inter 500/600 with
  slightly tightened spacing as a Plain Black substitute.

## Color Tokens

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

- Canvas: `#fffaf0`
- Surface Soft: `#faf5e8`
- Surface Card: `#f5f0e0`
- Surface Strong: `#ebe6d6`
- Surface Dark: `#0a1a1a`
- Surface Dark Elevated: `#1a2a2a`
- Hairline: `#e5dcc8`

### Text

- Ink: `#0a0a0a`
- Body Strong: `#1a1a1a`
- Body: `#3a3a3a`
- Muted: `#6a6a6a`
- Muted Soft: `#9a9a9a`
- On Primary / On Dark: `#ffffff`

### Semantic

- Success: `#22c55e`
- Warning: `#f59e0b`
- Error: `#ef4444`

## App Layout

The app is a two-column workspace:

- Left sidebar: session discovery and creation.
- Main pane: fixed header, independently scrollable timeline, fixed composer.

The sidebar and timeline must use independent scroll containers. The app shell
itself should not rely on document scroll.

## Component Rules

### Sidebar

- Warm cream surface.
- Session items use cream cards with 16px radius.
- Active session gets a saturated left rail or outline.
- Metadata uses monospace and muted text.
- Session list must set `min-height: 0` and `overflow-y: auto` so long history
  can scroll.

### Top Bar

- Cream nav-like band pinned to the top of the app shell.
- Shows provider/model, cwd, full session id, and connection status.
- Session id is monospace, selectable, and copyable.

### Timeline

- User messages: peach-tinted cards.
- Assistant messages: cream cards.
- Tool entries: smaller product-fragment cards with colored status rails.
- Approval cards: ochre/warning surface, prominent action buttons.
- Error cards: coral/red-tinted surface.
- Tool output must be collapsible when verbose.

### Composer

- Fixed bottom band.
- Rounded 12px textarea on cream/card surface.
- Primary send button uses dark ink background.
- Browser-native selection, IME, paste, and scrolling are preserved.

## Do

- Keep the entire app warm-light by default.
- Use saturated accent cards sparingly for state and hierarchy.
- Preserve dense operational readability.
- Use product UI fragments/tool summaries inside cards.
- Keep full session id visible and copyable.

## Don't

- Do not use a dark Slack-like chat shell as the primary app surface.
- Do not make a marketing landing page.
- Do not hide session history behind a non-scrollable sidebar.
- Do not expose secrets or direct tool execution in the browser UI.
- Do not introduce Electron/Tauri/Vite just for this embedded first pass.
