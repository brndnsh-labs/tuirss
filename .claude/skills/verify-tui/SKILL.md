---
name: verify-tui
description: Run or headlessly drive the tuirss TUI to verify UI changes — use whenever a change touches src/ui/ or keybindings and you need to see real frames, not just unit tests.
---

# Verifying tuirss UI changes

## Headless (preferred — no config.toml, no server)

`tests/ui-harness.tsx` boots the real `App` against an in-memory SQLite cache and
OpenTUI's `createTestRenderer`. Use it from a bun test (see `tests/app.test.tsx`
for working examples):

```tsx
import { item, renderApp, subscription } from "./ui-harness";

const ui = await renderApp({
  subscriptions: [subscription("feed/1", "Feed One")],
  items: [item("item/1", "feed/1", "Title", "Body text", 1710000100)],
  unreadCounts: { unreadcounts: [{ id: "feed/1", count: 1 }] },
  width: 110,   // >=120 three-pane, >=80 two-pane, else one-pane
  height: 30,
});

await ui.press("j", "RETURN");        // key names or KeyCodes names (ESCAPE, RETURN, ...)
const frame = await ui.frame();       // plain-char frame; assert with toContain
console.log(frame);                   // eyeball the actual layout when debugging
ui.destroy();
```

Run with `bun test tests/app.test.tsx` (or a scratch `tests/_*.test.tsx` you delete after).

### Gotchas learned the hard way

- **Flush timing**: keymap layers register in React passive effects, which take
  more than one macrotask to flush. The harness's `press`/`frame` already wait;
  don't hand-roll a single `setTimeout(0)` and press keys before it settles.
- **Kitty keyboard**: the harness enables `kittyKeyboard: true` to match
  `main.tsx`. Without it a bare ESC is ambiguous and may never dispatch.
- **Markdown warmup**: the reader's `<markdown>` spins up a Tree-sitter worker
  on its first mount (~40ms, process-global). `renderApp` pays this once up
  front so the first `frame()` already shows article body; don't be surprised
  that a bare `createTestRenderer` + `<markdown>` renders blank for ~13 passes.
- **Frozen clock**: the test renderer's clock doesn't auto-advance, so
  `useTimeline` animations (the sources slide) never progress — the sources
  layer overlaps the reading pane in captured frames. That's a harness artifact,
  not a bug; assert with `toContain`, not on exact column layout, for anything
  behind an animation.
- **Debug scripts must live inside the repo** (e.g. `tests/_debug.tsx`, deleted
  after): running a script from outside pulls a second copy of `@opentui/core`
  and crashes with "Environment variable ... already registered".
- `captureCharFrame()` has no colors — assert selection/focus changes by their
  *consequences* (e.g. reader pane content follows the selected article), or use
  `captureSpans()` from the raw test renderer if you truly need styling.

## For real

```bash
bun run start        # needs config.toml (copy config.example.toml); q quits
TUIRSS_CONFIG=/path/to/other.toml bun run start
```

It's a fullscreen alternate-buffer app talking to a live FreshRSS server —
don't run it from an agent shell expecting captured output; use the headless
harness instead.
