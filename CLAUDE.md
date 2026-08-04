# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run check          # typecheck + all tests (same gate CI runs)
bun run typecheck      # tsc --noEmit
bun test               # all tests
bun test tests/sync.test.ts        # one file
bun test -t "replays queued"       # by test name
bun run start          # run the TUI (needs a filled-in config.toml)
```

Running the app requires `config.toml` (copy from `config.example.toml`; it holds the FreshRSS API password and is gitignored). Tests never touch `config.toml` or the network — they inject a fake `fetcher` into `GReaderClient` and use in-memory SQLite for `CacheStore`.

To verify UI changes, drive the real `App` headlessly with `tests/ui-harness.tsx` (OpenTUI test renderer + mock keys; examples in `tests/app.test.tsx`, gotchas in `.claude/skills/verify-tui/SKILL.md`). Don't launch `bun run start` from an agent shell — it's a fullscreen app that needs a live server.

CI is GitHub Actions (`.github/workflows/ci.yml`) on GitHub-hosted `ubuntu-latest`. This repo is public, and the org's self-hosted runner group refuses public repos, so don't switch it to `[self-hosted]` — the job would queue forever with no error. Bun isn't preinstalled on the hosted image; it comes in via `oven-sh/setup-bun`.

## Architecture

FreshRSS terminal client, offline-first. Data flows in one direction:

```
GReaderClient (src/greader.ts)  →  SyncManager (src/sync.ts)  →  CacheStore (src/cache.ts, bun:sqlite)  →  App (src/ui/App.tsx)
```

- **The UI never reads from the network.** `App` only renders `SyncSnapshot`s pulled from SQLite via `sync.snapshot(articleOptions)`. Anything the server returns must land in the cache before it can appear on screen.
- **Writes are optimistic with an offline queue.** `SyncManager.setRead/setStarred` update SQLite immediately, then try the API; on failure the change goes into `pending_mutations` and is replayed at the start of the next sync. `CacheStore.upsertArticles` consults pending mutations so a sync can't clobber a queued local change.
- **Sync is incremental.** `syncReadingList` pages through the reading-list stream using `ot` (newer-than) from the `last_article_timestamp` stored in the `sync_state` table, bounded by `sync.pageSize`/`sync.maxPages` from config.
- **GReaderClient** speaks FreshRSS's Google Reader compatible API: `ClientLogin` → `GoogleLogin auth=` header, a write token for `edit-tag`, read/starred state as categories (`user/-/state/com.google/read` etc.).

### UI (src/ui/)

OpenTUI React (`@opentui/react`); every `.tsx` file needs the `/** @jsxImportSource @opentui/react */` pragma. Rendering is width-responsive via `layoutMode(width)` → `"one" | "two" | "three"`.

The UI is split into four files: `App.tsx` (state, effects, keybindings, top-level layout), `panes.tsx` (Sources, ArticleList, Reader, FilterInput — each a thin wrapper around a native OpenTUI component), `overlays.tsx` (StatusBar, HelpOverlay), and `theme.ts` (COLORS, READER_SYNTAX, glyphs, per-mode `PANE_WIDTHS`). Both lists are native `<select>` renderables — `Sources` for feeds, `ArticleList` for articles. The 2-line compact article row format is preserved via `<select>`'s `name` (line 1: marker + title + date) and `description` (line 2: feed · author) fields; `Sources` sets `showDescription={false}` so its rows stay single-line. Selection in both lists is controlled via the `selectedIndex` prop — the reconciler maps it to the renderable's clamping setter without firing `onChange`, so no ref/effect sync is needed (don't reintroduce one). The filter input is a native `<input>` (`flexGrow={1}` in a 1-row strip above the status bar).

Navigation is two-level, Reeder-style: `navLevel` is `"sources"` (feed picker) or `"reading"` (article list + reader), with `focusedPane` tracking the active pane inside reading. `h`/`l` move between levels/panes. The two levels are a plain conditional swap of in-flow panes (sources = Sources + reader in wide modes; reading = ArticleList + reader) — deliberately *not* an absolute-positioned overlay slide, which previously left the panes painting into the same cells whenever the `useTimeline` clock didn't advance. Keybindings are declared through `@opentui/keymap`'s `useBindings` (command list + key table) — add new keys there. The keymap is global and `enabled: !filterMode` so the `<input>` (and its built-in backspace/paste/ctrl-u handling) owns keystrokes while the filter row is open.

The **reader** is a real `<scrollbox>` wrapping a `<markdown>` renderable (`htmlToMarkdown` converts feed HTML to markdown); the markdown must have `width: "100%"` to wrap inside the scrollbox, and it's `key`ed by article id so switching articles remounts and resets scroll. `j`/`k`/`g`/`G` are driven by the global keymap (which dispatches by `focusedPane`), calling `readerScrollRef.current?.scrollBy` / `scrollTo` when the reader is focused. The `<select>`'s built-in `j`/`k` handler is dead code in the current design because the keymap consumes those keys first; that tradeoff buys consistent reader `j`/`k` behavior across the app.

Selection subtlety worth knowing before you touch it: the article cursor is tracked **by id** (`selectedArticleId`), not index, so the list can change under it without the cursor drifting. Reading or marking an article read adds its id to `stickyReadIds` so it stays listed (dimmed) instead of vanishing from the unread view mid-read — and the refresh for that path is driven by the `articleOptions`-change effect, **not** a manual `refreshFromCache()`, which would query with pre-sticky options and drop the row. `view` (`unread`/`all`/`starred`) and `stickyReadIds` both feed `cache.listArticles`'s `keepIds` option.

### Conventions

- `src/types.ts` holds all shared types, including the GReader wire formats; snake_case→camelCase mapping between SQLite rows and app types lives in `cache.ts`'s `*FromRow` helpers.
- Article IDs are used verbatim as the GReader long-form IDs; timestamps are stored in the units the API returns (seconds for `published`, ms for `crawlTimeMsec`, µs strings for `timestampUsec` — see `itemTimestampSeconds` in `sync.ts` before touching them).
- `src/text.ts` is a small grab-bag of string helpers: `htmlToMarkdown` (feed HTML → reader markdown), `htmlToText`, `decodeHtmlEntities`, `truncate`, `formatDate`, `layoutMode` (the width→one/two/three splitter). `windowAround` exists but is now only used by `tests/text.test.ts`; the production lists are `<select>`s and do their own scrolling.
