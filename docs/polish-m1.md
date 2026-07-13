# tuirss polish — milestone 1 (visual)

Status: in progress
Owner: Pico (orchestrator) + worker + reviewers
Branch: TBD (created during implementation)

## Goal

Ship a small, reviewable batch of visual polish that makes the app feel less
WIP and more like a v1. Strictly UI — no keymap, no sync-protocol, no data
model changes. Each item has a concrete target so the worker, reviewers, and
the user can agree on "done."

## Out of scope (deferred to later milestones)

- Reader `j`/`k` semantics change (Q3 = b) — milestone 2
- Sources-level article list (Q2 = a — keep current Reeder-style) — deferred
- `n`/`p` for next/prev article (related to Q3) — milestone 2
- Mark-all-read for a feed — milestone 2
- Sync progress with page counts — milestone 2
- Filter UX with match count / `n` jump — milestone 2
- Feed icons (`iconUrl` is on the row but never rendered) — deferred
- Tags/labels from `categories_json` — deferred
- Proper HTML parser for the reader — deferred

## In scope — milestone 1

### 1. Category grouping in `FeedPane`

`listFeeds()` already sorts feeds by `category_label` then `title`. The UI
ignores the grouping. Render a non-interactive header row above each group.

- Header style: dim (`#8b949e`) bold, format `Category  (12 unread)` where the
  count is the total `unread_count` for feeds in that group.
- Sort order: groups render in `category_label COLLATE NOCASE` order. Feeds
  with `categoryLabel === null` get a "Feeds" group at the top (so the
  "All Feeds" pseudo-row + uncategorized feeds are visually separated from
  categorized ones). The "All Feeds" pseudo-row stays at index 0, before any
  category group.
- No collapse/expand. Keep it simple.

**Implementation contract (critical — the plan was incomplete here):**

`SourceRow` becomes a discriminated union:

```ts
type SourceRow =
  | { kind: "all"; unreadCount: number }
  | { kind: "header"; label: string; unreadCount: number }
  | { kind: "feed"; id: string; title: string; unreadCount: number };
```

`rows` is built by walking the sorted `snapshot.feeds` once, detecting group
boundaries (a transition to a new `categoryLabel`, or the first uncategorized
feed) and inserting a header before the first feed of each group. The "All
Feeds" row is prepended at index 0.

The `rows` array is computed in `App` (lifted from `FeedPane`) so the rest of
the App can use it. Add a helper:

```ts
function rowFeed(rows: SourceRow[], index: number): Feed | null {
  const row = rows[clampIndex(index, rows.length)];
  return row?.kind === "feed" ? /* find in snapshot.feeds */ : null;
}
```

Then update the four call sites that currently assume `rows = [All Feeds, ...feeds]`:

- `App.tsx:66` — `selectedSourceFeed` becomes `rowFeed(rows, feedIndex)`.
- `App.tsx:109` — `useEffect` clamping depends on `rows.length` (not
  `snapshot.feeds.length + 1`).
- `App.tsx:185` — `moveSelection` clamp uses `rows.length`.
- `App.tsx:221` — `jumpSelection` "bottom" target uses `rows.length - 1`
  (this also fixes a pre-existing off-by-one where `G` lands on the last
  feed's row in the *current* flat layout; verify by checking the cursor
  position after `G` from the top of the feed list).

Headers are inert: visually distinct (dim, no selection background), and
`enterReadingLevel` (which is what `activate` calls) returns the row's
feed-or-null — for a header, that's `null`, so it lands on the "All Feeds"
view. The cursor CAN rest on a header; it just shows the dim text and
`enter` is a soft no-op. No header-skip in `moveSelection` — keep the
cursor on the header so the user sees they're between groups.

Windowing (`windowAround`) is over `rows`. `feedIndex` is the index into
`rows`.

### 2. Two-line compact article rows (Q1 = b)

Replace the current single-line `marker title date` row with a two-line block
per article. The reader pane's full title remains in the article header so we
don't need to fit a long title in line 1.

Format:

```
[*| ][●| ] <title truncated to fit>             <date right-aligned>
         <feed title> · <author if present>             <dim>
```

- Line 1: marker column (`●`/` `, `*`/` `) + 1 space + title + 1 space + date
  (5 chars, e.g. `Mar 5`).
- Line 2: 2 spaces of indent + `feedTitle · author` (or just `feedTitle` if no
  author). Dim color (`#8b949e`).
- The date appears on line 1 only (line 2 is purely attribution).
- Each article is wrapped in a `<box key={article.id} flexDirection="column">`
  containing the two `<text>`s. The wrapper is essential — sibling `<text>`s
  inside a flex column can interleave between adjacent articles' lines on
  small viewports. The wrapper keeps the 2 lines glued.
- Sticky-read articles (in `stickyReadIds`) get the dim color on BOTH lines
  (not just line 1). The current code's `article.isRead ? "#8b949e" :
  "#f0f6fc"` color logic must apply to both lines of the same `<text>` pair.
- Selected article: both `<text>`s get the inverted color (`#101418` fg,
  `#d7ba7d` bg).
- Window size (article count) = `Math.max(2, Math.floor((height - 5) / 2))`.
  Each article renders exactly 2 lines. The window is in *articles*, but the
  rendered output is `2 * count` lines. If the terminal height is odd, the
  last row of the pane is just empty — fine. Pane chrome: `border` (1+1) +
  `padding={1}` (1+1) = 4 rows, so content area = `height - 4`. The `height
  - 5` math gives a 1-row buffer. Document the slight regression at very
  small heights (height < 9) in the worker handoff.
- Pane width math (per `mode`). The line is `marker (3 chars) + 1 space +
  title + 1 space + date (5 chars)` = 10 chars of overhead on line 1, so
  `titleMax = lineBudget - 10`. The metadata line is `2 spaces indent +
  feed + 1 space + · + 1 space + author`, so `metaMax = lineBudget - 5` (the
  indent is 2 chars, `· author` is 3 chars total).
  - `one` (100% wide, `lineBudget ≈ width - 4`): title `width - 14`, meta
    `width - 9`.
  - `two` (34 wide, `lineBudget ≈ 30`): title `20`, meta `25`.
  - `three` (42 wide, `lineBudget ≈ 38`): title `28`, meta `33`.
  These are starting points; the worker should capture frames at 70, 100,
  and 140 widths and adjust if titles get clipped unpleasantly. Aim for the
  full title visible in `one` mode and aggressive truncation in `two`/
  `three` mode is fine.
- `formatDate(null)` returns `""` (`src/text.ts:137–143`). For the new
  line 1, the missing date would leave a trailing space. Either trim
  trailing whitespace in the rendered string, or only render the date
  segment when non-empty. Minor visual issue.

### 3. Better unread marker

Replace the `u`/` ` (letter) with a filled/hollow dot.

- `●` (U+25CF) for unread.
- ` ` (space) for read.
- The starred marker stays as `*` (left of the dot).
- Marker column: `* ●` (3 chars) for starred-unread, `*  ` for starred-read,
  `  ●` for unstarred-unread, `   ` for unstarred-read.

The "u" letter is no longer rendered anywhere.

### 4. Empty-state guidance

Replace `No articles here.` and `No feeds cached yet. Press r to sync.` with
contextual hints.

- Article list empty (view = unread): `No unread articles. Press v to switch
  views, r to sync.`
- Article list empty (view = all): `No articles in this feed. Press r to
  sync.`
- Article list empty (view = starred): `No starred articles yet. Press s on
  an article to star it.`
- Feed list empty: `No feeds yet. Press r to sync.`
- Reader with article missing body: keep current `(empty article body)`.

The `ArticlePane` doesn't currently know the view. Pass `view` as a prop and
have the pane pick the right message — most local. The "feeds empty" case is
already in `FeedPane` and just needs a string change.

## Files likely to change

- `src/ui/App.tsx` — `FeedPane`, `ArticlePane`, status text in `empty`
  branches, `SourceRow` type, the `rows` computation (lifted out of
  `FeedPane` into `App`), `selectedSourceFeed` lookup (line 66), three clamp
  sites (lines 109, 185, 221), `rowFeed` helper, new `<box>` wrapper per
  article, marker glyphs, `formatDate` trailing-space handling.
- `src/text.ts` — `truncate` is fine; no new helper needed.
- `tests/app.test.tsx` — **update** the existing assertion at line 119
  (currently asserts `No articles here.` for the starred view; change to the
  new starred message) and add new tests for:
  - category header is rendered when there are categorized feeds
  - two-line row format: line 1 contains the title, line 2 contains the feed
    name and the new dim color
  - empty-state guidance for each of the three views
  - new marker glyph (`●`) is rendered for unread
  - feed list empty state message (`No feeds yet. Press r to sync.`)
- `tests/ui-harness.tsx` — add a `subscriptionWithCategory(id, title,
  categoryId, categoryLabel)` helper. Keep the existing `subscription(id,
  title)` helper as-is (call sites should not need to change).

## Data model — no changes

All work reads from the existing fields: `feed.categoryLabel`,
`article.originTitle`, `article.author`, `article.published`,
`article.isRead`, `article.isStarred`. No SQLite migrations.

## Validation contract

The worker must demonstrate, with evidence in the handoff:

1. `bun run check` passes (typecheck + every existing + every new test).
2. Headless harness frames at widths 70 (one-pane), 100 (two-pane), 140
   (three-pane) and heights 18, 30 all show:
   - panes with intact borders (no clipping, no overflow)
   - 2-line article rows with the correct glyph, title, date, feed, author
   - category headers above their groups, with the right counts
   - empty-state guidance when the relevant list is empty
3. New + updated tests in `tests/app.test.tsx` cover the cases above and the
   empty-state assertion update at line 119.
4. No regressions: every test that was passing before is still passing.
5. Cursor on a category header: capture a frame showing the dim header
   without selection background; press `enter`; the resulting frame is the
   "All Feeds" or "selected feed" view, not a wrong feed. Status bar shows
   the correct title.
6. `G` from the top of the feed list lands on the last row of `rows` (not
   off by one). Verify in a test or captured frame.

The reviewers will independently capture frames at the same widths and
verify the worker's claim.

## Reviewer angles (to be launched in parallel after the worker lands)

1. **Correctness/regressions.** Re-read the diff against `CLAUDE.md`'s
   architecture notes — especially the sticky-read effect, selection-by-id,
   the `articleOptions` effect, and `windowAround`. Run `bun run check`.
   Specifically verify: the four call sites that depended on the
   `[All Feeds, ...feeds]` invariant are now header-aware (lines 66, 109,
   185, 221); `G` lands on `rows.length - 1`; `selectedSourceFeed` on a
   header is `null`; the `useEffect` clamping re-runs when `rows.length`
   changes; the `<box>` wrapper doesn't break the cursor highlight on the
   first/last article.
2. **Visual / layout.** Use `tests/ui-harness.tsx` to capture frames at
   widths 70, 100, 140 with realistic fixtures. Inspect the actual rendered
   output. Flag: clipping, awkward truncation, misaligned columns, broken
   borders, unreadable text, the dot glyph not rendering in the terminal
   (some fonts fall back), category headers showing wrong counts, sticky
   articles missing dim color on line 2, etc. Capture one frame at height
   = 10 to confirm the small-height overflow case is acceptable.
3. **Simplicity / maintainability.** Flag unused code, redundant
   conditionals, over-extracted helpers, AI-slop. The goal is a diff that a
   future maintainer (or Brandon in 6 months) can read and extend without
   surprise. The existing `App.tsx` is tight — the diff should keep it
   tight.

## Stop rules

- Worker reports complete → parent launches 3 parallel reviewers (async,
  fresh context) → parent synthesizes findings → parent launches one fix
  worker (async, forked context) → parent re-runs `bun run check` and
  captures final frames at 70/100/140 widths → parent writes a one-pager
  summary of what changed and what's deferred.
- Max 3 review rounds. After that, anything still flagged is deferred and
  surfaced in the summary.
- Any unapproved product / scope / architecture change proposed by a
  reviewer or the worker is held for the user, not applied.

## Open questions for the user (resolved before launch)

- Q1 article row density → **b (two-line compact)**
- Q2 sources-level layout → **a (keep Reeder-style)**
- Q3 reader `j`/`k` semantics → **b (Reeder-faithful, deferred to m2)**

## Scout findings (incorporated above)

The plan was reviewed by a fresh-context scout before launch. Two material
gaps were caught:

1. **Category header row lookup math** — `selectedSourceFeed` and three
   clamp sites silently break with headers inserted. Fixed by lifting
   `rows` to `App` scope and adding the `rowFeed` helper + a discriminated
   `SourceRow` union.
2. **Width budget framing** — the per-mode title-truncate numbers were
   line-lengths, not title-lengths. Fixed in section 2 by reframing as
   "title = line length - 10" and recomputing.

Smaller corrections also folded in: `<box>` wrapper per article, sticky-read
dim color on both lines, `formatDate` null handling, existing test at
`app.test.tsx:119` needs updating (not just adding), `useEffect` clamping
depends on `rows.length` not `feeds.length`, harness gets a new
`subscriptionWithCategory` helper, `G` lands on `rows.length - 1` (fixes
pre-existing off-by-one).
