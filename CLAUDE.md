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

CI is Forgejo Actions (`.forgejo/workflows/ci.yml`) on a self-hosted runner; `runs-on` must stay exactly `[self-hosted]` — extra labels leave the job waiting forever.

## Architecture

FreshRSS terminal client, offline-first. Data flows in one direction:

```
GReaderClient (src/greader.ts)  →  SyncManager (src/sync.ts)  →  CacheStore (src/cache.ts, bun:sqlite)  →  App (src/ui/App.tsx)
```

- **The UI never reads from the network.** `App` only renders `SyncSnapshot`s pulled from SQLite via `sync.snapshot(articleOptions)`. Anything the server returns must land in the cache before it can appear on screen.
- **Writes are optimistic with an offline queue.** `SyncManager.setRead/setStarred` update SQLite immediately, then try the API; on failure the change goes into `pending_mutations` and is replayed at the start of the next sync. `CacheStore.upsertArticles` consults pending mutations so a sync can't clobber a queued local change.
- **Sync is incremental.** `syncReadingList` pages through the reading-list stream using `ot` (newer-than) from the `last_article_timestamp` stored in the `sync_state` table, bounded by `sync.pageSize`/`sync.maxPages` from config.
- **GReaderClient** speaks FreshRSS's Google Reader compatible API: `ClientLogin` → `GoogleLogin auth=` header, a write token for `edit-tag`, read/starred state as categories (`user/-/state/com.google/read` etc.).

### UI (src/ui/App.tsx — the only UI file)

OpenTUI React (`@opentui/react`); every `.tsx` file needs the `/** @jsxImportSource @opentui/react */` pragma. Rendering is width-responsive via `layoutMode(width)` → `"one" | "two" | "three"`.

Navigation is two-level, Reeder-style: `navLevel` is `"sources"` (feed picker) or `"reading"` (article list + reader), with `focusedPane` tracking the active pane inside reading. `h`/`l` move between levels/panes. The two levels are a plain conditional swap of in-flow panes (sources = FeedPane + reader in wide modes; reading = article list + reader) — deliberately *not* an absolute-positioned overlay slide, which previously left the panes painting into the same cells whenever the `useTimeline` clock didn't advance. Keybindings are declared through `@opentui/keymap`'s `useBindings` (command list + key table) — add new keys there, not in raw `useKeyboard`. The one raw `useKeyboard` handler is the `/` filter's inline text entry, which disables the binding table while active (`enabled: !filterMode`).

Article-list "scrolling" is manual windowing (`windowAround` in `src/text.ts`), not an OpenTUI scrollbox. The **reader** is a real `<scrollbox>` wrapping a `<markdown>` renderable (`htmlToMarkdown` converts feed HTML to markdown); the markdown must have `width: "100%"` to wrap inside the scrollbox, and it's `key`ed by article id so switching articles remounts and resets scroll. `j`/`k`/`g`/`G` scroll it via a `ScrollBoxRenderable` ref when the reader pane is focused.

Selection subtlety worth knowing before you touch it: the article cursor is tracked **by id** (`selectedArticleId`), not index, so the list can change under it without the cursor drifting. Reading or marking an article read adds its id to `stickyReadIds` so it stays listed (dimmed) instead of vanishing from the unread view mid-read — and the refresh for that path is driven by the `articleOptions`-change effect, **not** a manual `refreshFromCache()`, which would query with pre-sticky options and drop the row. `view` (`unread`/`all`/`starred`) and `stickyReadIds` both feed `cache.listArticles`'s `keepIds` option.

### Conventions

- `src/types.ts` holds all shared types, including the GReader wire formats; snake_case→camelCase mapping between SQLite rows and app types lives in `cache.ts`'s `*FromRow` helpers.
- Article IDs are used verbatim as the GReader long-form IDs; timestamps are stored in the units the API returns (seconds for `published`, ms for `crawlTimeMsec`, µs strings for `timestampUsec` — see `itemTimestampSeconds` in `sync.ts` before touching them).
