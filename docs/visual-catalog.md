# TUIRSS Visual State Catalog

Reference document describing every UI state an agent should be able to reason about. All colors use hex notation matching the component source. Terminal dimensions are assumed ≥ 140 cols (wide layout) unless noted otherwise.

---

## Color Palette

All three components share a common palette derived from their `COLORS` constants:

| Token | Hex | Used in |
|-------|-----|---------|
| background | `#1a1a2e` | Container backgrounds, root fill |
| text | `#e0e0e0` | Primary content text |
| textDim | `#888888` | Dimmed/placeholder text |
| textMuted | `#666666` | Muted secondary text (article-view only) |
| accent | `#7aa2f7` | Selection highlights, active indicators |
| border | `#3b4261` | Rounded border lines on all containers |
| success | `#9ece6a` | Status bar success indicators |
| warning | `#e0af68` | Status bar warnings, star icon |
| star | `#e0af68` | Star icon in article list |
| error | `#f7768e` | Status bar error messages |
| statusBg | `#2a2a3e` | Status bar background |

---

## Layout Modes

The app has three layout modes controlled by terminal width:

| Mode | Width | Sidebar | Main |
|------|-------|---------|------|
| **single** | < 100 cols | Hidden (one pane at a time) | Full width |
| **compact** | 100–139 cols | 20 cols (or 3 if collapsed) | Remaining width |
| **wide** | ≥ 140 cols | 30 cols (or 3 if collapsed) | Remaining width |

In **single** mode, only one view is visible at a time (feeds OR articles OR reader). In **compact** and **wide** modes, the sidebar and article pane are shown side-by-side when `viewMode` is `feeds` or `articles`. In `reader` mode, the sidebar is hidden unless zen mode is off and the sidebar is not collapsed.

---

## FeedList States

The FeedList is a `BoxRenderable` with `border: true`, `borderStyle: 'rounded'`, `borderColor: #3b4261`, `backgroundColor: #1a1a2e`. Its title and content change based on state.

### 1. Collapsed Sidebar

**When**: `sidebarCollapsed === true` and layout is compact or wide.

```
╭─▶────────────────╮
│●                  │
│12                 │
╰───────────────────╯
```

- **Title bar**: `▶` (replaces ` Feeds `)
- **Content**: A bullet `●` on line 1. If total unread > 0, the unread count on line 2.
- **Width**: 3 columns (the `SIDEBAR_WIDTHS.collapsed` constant)
- **Colors**: Content uses `textDim` (`#888888`)

### 2. Loading

**When**: `loadingFeeds === true`

```
╭─ Feeds ──────────╮
│Loading feeds...    │
╰───────────────────╯
```

- **Title bar**: ` Feeds ` (left-aligned)
- **Content**: The string `Loading feeds...`
- **Colors**: Content uses `textDim` (`#888888`) with `TextAttributes.DIM`
- **Border**: `#3b4261`, background `#1a1a2e`

### 3. Empty (No Feeds)

**When**: `feeds.length === 0` and `loadingFeeds === false`

```
╭─ Feeds ──────────╮
│No feeds found.    │
│Press r to refresh.│
╰───────────────────╯
```

- **Title bar**: ` Feeds `
- **Content**: `No feeds found. Press r to refresh.`
- **Colors**: Content uses `textDim` (`#888888`) with `TextAttributes.DIM`

### 4. Populated, No Selection

**When**: `feeds.length > 0`, `selectedFeedIndex` points to a feed but `viewMode !== 'feeds'` (so no `▸` marker), categories expanded.

```
╭─ Feeds ──────────────────────╮
│  ▼ Tech                        │
│      Hacker News (23)           │
│      Ars Technica (5)           │
│      Lobsters (12)              │
│  ▼ News                         │
│      BBC (8)                    │
│      Reuters (0)                │
╰────────────────────────────────╯
```

- **Title bar**: ` Feeds `
- **Content**: Categories with `▼` (expanded) or `▶` (collapsed) icons. Each category line shows `  ▼ CategoryLabel (totalUnread)`. Feed items under expanded categories are indented 6 spaces with `      ` prefix (no `▸` since no feed is selected in feeds view).
- **Colors**: Content uses `text` (`#e0e0e0`), attributes reset to `0` (no DIM)

### 5. Populated with Feed Selected

**When**: `viewMode === 'feeds'`, a feed is selected via `selectedFeedIndex`.

```
╭─ Feeds ──────────────────────╮
│  ▼ Tech                        │
│    ▸ Hacker News (23)           │
│      Ars Technica (5)           │
│      Lobsters (12)              │
│  ▼ News                         │
│      BBC (8)                    │
│      Reuters (0)                │
╰────────────────────────────────╯
```

- **Title bar**: ` Feeds `
- **Content**: Same as state 4, but the selected feed line has `▸ ` prefix (4 spaces + `▸ ` = 6 chars total indent) instead of 6 spaces.
- **Selection marker**: `▸` appears before the selected feed's title

### 6. Category View — Expanded

**When**: `expandedCategories` contains the category ID.

```
╭─ Feeds ──────────────────────╮
│  ▼ Tech (40)                    │
│      Hacker News (23)           │
│      Ars Technica (5)           │
│      Lobsters (12)              │
│  ▼ News (8)                     │
│      BBC (8)                    │
│      Reuters (0)                │
╰────────────────────────────────╯
```

- **Expand icon**: `▼` for expanded categories
- **Unread count**: Shown in parentheses after category label when `totalUnread > 0`
- **Feed items**: Listed under the category with 6-space indent (or `    ▸ ` if selected)

### 7. Category View — Collapsed

**When**: A category ID is NOT in `expandedCategories`.

```
╭─ Feeds ──────────────────────╮
│  ▶ Tech (40)                    │
│  ▶ News (8)                     │
╰────────────────────────────────╯
```

- **Expand icon**: `▶` for collapsed categories
- **Feed items**: Hidden — only the category header line is shown
- **Selection**: If `selectedCategory === category.id` and the category is collapsed, the prefix changes to `▸ ` instead of `  ` before the expand icon

---

## ArticleView States

The ArticleView is a `BoxRenderable` with `border: true`, `borderStyle: 'rounded'`, `borderColor: #3b4261`, `backgroundColor: #1a1a2e`. In list mode it uses a `TextRenderable`; in reader mode it uses a `ScrollBoxRenderable`.

### 1. Loading Articles

**When**: `loadingArticles === true`

```
╭─ Articles ───────────────────╮
│Loading articles...             │
╰────────────────────────────────╯
```

- **Title bar**: ` Articles `
- **Content**: `Loading articles...`
- **Colors**: Content uses `textDim` (`#888888`) with `TextAttributes.DIM`

### 2. Empty (No Unread Articles)

**When**: `articles.length === 0` and `loadingArticles === false`

```
╭─ Articles ───────────────────╮
│No unread articles in FeedName │
╰────────────────────────────────╯
```

- **Title bar**: ` Articles `
- **Content**: `No unread articles in {feed.title}` if a feed is selected, or `No articles` if no feed
- **Colors**: Content uses `textDim` (`#888888`) with `TextAttributes.DIM`

### 3. Article List with 5 Items

**When**: `articles.length === 5`, `viewMode === 'articles'`, no search active

```
╭─ Articles ───────────────────────────────────────────╮
│  ●   Rust 1.75 Released  12/28/2025                    │
│  ● ★ Why Async Matters   12/27/2025                    │
│  ●   TUI Patterns in Go  12/26/2025                    │
│      Bun 1.2 Overview    12/25/2025                    │
│      SQLite Tips         12/24/2025                    │
╰───────────────────────────────────────────────────────╯
```

- **Title bar**: ` Articles `
- **Content**: Each line has three 2-char columns:
  - **Col 1** (selection): `▸ ` if selected, `  ` otherwise
  - **Col 2** (read status): `● ` if unread, `  ` if read
  - **Col 3** (star status): `★ ` if starred, `  ` otherwise
  - Then the article title, followed by the formatted date (`toLocaleDateString()`)
- **Colors**: Content uses `text` (`#e0e0e0`), attributes `0`

### 4. Article List with Selection

**When**: `viewMode === 'articles'`, `selectedArticleIndex` points to an article

```
╭─ Articles ───────────────────────────────────────────╮
│  ●   Rust 1.75 Released  12/28/2025                    │
│▸ ● ★ Why Async Matters   12/27/2025                    │
│  ●   TUI Patterns in Go  12/26/2025                    │
│      Bun 1.2 Overview    12/25/2025                    │
│      SQLite Tips         12/24/2025                    │
╰───────────────────────────────────────────────────────╯
```

- **Selection marker**: `▸` appears before the selected article's title
- **Read marker**: `●` for unread articles, blank for read
- **Star marker**: `★` for starred articles, blank for unstarred

### 5. Article List with Search Results

**When**: `isSearching === true` (typing query) or `filteredArticles.length > 0` (results displayed)

**Typing state** (`isSearching === true`):

```
╭─ Search ─────────────────────────────────────────────╮
│Search: rust_                                           │
╰───────────────────────────────────────────────────────╯
```

- **Title bar**: ` Search `
- **Content**: `Search: {searchQuery}_` (underscore represents cursor)
- **Colors**: Content uses `text` (`#e0e0e0`), attributes `0`

**Results displayed** (`filteredArticles.length > 0`, `isSearching === false`):

```
╭─ Search: "rust" (3) ──────────────────────────────────╮
│▸ ●   Rust 1.75 Released  12/28/2025                    │
│  ●   Rust async patterns 12/20/2025                    │
│      Rust testing guide   12/15/2025                    │
╰───────────────────────────────────────────────────────╯
```

- **Title bar**: ` Search: "{searchQuery}" ({count}) `
- **Content**: Same format as article list, but using `filteredArticles` instead of `articles`

**No results** (`filteredArticles.length === 0` after search):

```
╭─ Search: "xyz" (0) ───────────────────────────────────╮
│No articles found matching "xyz"                         │
╰───────────────────────────────────────────────────────╯
```

- **Content**: `No articles found matching "{searchQuery}"`
- **Colors**: `textDim` with `TextAttributes.DIM`

### 6. Reader Mode — Normal

**When**: `viewMode === 'reader'`, `zenMode === false`

```
╭─ Rust 1.75 Released ─────────────────────────────────╮
│ Rust 1.75 Released                                      │
│ by The Rust Team · Wednesday, December 28, 2025 · ✓ read│
│ ────────────────────────────────────────────────────── │
│                                                         │
│ Article body text goes here. The content is stripped   │
│ of HTML tags and rendered as plain text with word wrap. │
│                                                         │
╰───────────────────────────────────────────────────────╯
```

- **Title bar**: Truncated article title (max 40 chars) with `…` ellipsis, e.g. ` Rust 1.75 Released `
- **Content structure** (top to bottom):
  1. **Title**: `article.title` in bold (`TextAttributes.BOLD`), color `text` (`#e0e0e0`)
  2. **Meta line**: `\n` + joined metadata parts separated by ` · `:
     - `by {author}` if `article.author` exists
     - Formatted date (`weekday, month day, year`) if `article.published` exists
     - `✓ read` if article has read category
     - `★ starred` if article has starred category
  3. **Separator**: `\n` + `─` repeated `min(60, containerWidth - 4)` times + `\n`
  4. **Body**: `\n` + HTML-stripped content (`stripHtml()`), color `text` (`#e0e0e0`)
- **Scrolling**: Uses `ScrollBoxRenderable` with `scrollY: true`, `viewportCulling: true`
- **Meta colors**: `textDim` (`#888888`)
- **Separator colors**: `textDim` (`#888888`)

### 7. Reader Mode — Zen Mode

**When**: `viewMode === 'reader'`, `zenMode === true`

```
│                                                         │
│ Article body text goes here. The content is stripped   │
│ of HTML tags and rendered as plain text with word wrap. │
│                                                         │
```

- **Title bar**: Empty string (`""`) — no title shown
- **No meta line**: Author, date, read/star status are all hidden
- **No separator**: The `─` divider is not rendered
- **Content**: Only the article body text, preceded by `\n`
- **Layout**: Sidebar hidden, status bar hidden, article view takes full width
- **Colors**: Body text uses `text` (`#e0e0e0`)

### 8. Reader with Long Content (Scrolling)

**When**: `viewMode === 'reader'`, article content exceeds viewport height

Same visual structure as state 6 (or 7 for zen), but:

- The `ScrollBoxRenderable` enables vertical scrolling
- `scrollUp(lines)` / `scrollDown(lines)` move by 5 lines (default) or 3 lines (key binding)
- `pageUp` / `pageDown` move by 15 lines
- `scrollToTop()` / `scrollToBottom()` jump to extremes
- The content scrolls within the container; the border and title bar remain fixed

---

## StatusBar States

The StatusBar is a single `TextRenderable` with `height: 1`, `fg: #e0e0e0`, `bg: #2a2a3e`, `wrapMode: 'none'`, `truncate: true`. It always occupies the bottom row of the terminal.

The status bar is hidden when `zenMode === true && viewMode === 'reader'`.

### General Format

```
{status indicator}  {last sync}  unread: {N}  │  {shortcuts}
```

### 1. Normal Idle State

**When**: No special conditions (not syncing, no error, online, no search)

```
unread: 42  │  j/k:navigate  l/Enter:articles  r:refresh  ^e:export  q:quit
```

- **Status indicator**: None (empty)
- **Unread count**: Sum of all `feed.unreadCount` values
- **Shortcuts**: Vary by `viewMode`:
  - `feeds`: `j/k:navigate  l/Enter:articles  r:refresh  ^e:export  q:quit`
  - `articles`: `j/k:navigate  l/Enter:read  h:back  /:search  m:read  s:star  r:refresh  ^e:export  q:quit`
  - `reader`: `j/k:navigate  h:back  z:zen  m:read  s:star  r:refresh  ^e:export  q:quit`
- **Sidebar toggle**: `\:sidebar` appended when `layoutMode !== 'single'` and `viewMode !== 'reader'`
- **Colors**: `fg: #e0e0e0`, `bg: #2a2a3e`

### 2. Syncing Indicator

**When**: `syncing === true`

```
⟳ syncing...  unread: 42  │  j/k:navigate  l/Enter:articles  r:refresh  ^e:export  q:quit
```

- **Status indicator**: `⟳ syncing...`
- **Icon**: `⟳` (circular arrow)
- **Colors**: Same `fg: #e0e0e0` (no special color for the syncing text)

### 3. Error Message

**When**: `errorMessage !== null`

```
✗ Sync failed: connection refused  unread: 42  │  j/k:navigate  ...
```

- **Status indicator**: `✗ {errorMessage}`
- **Icon**: `✗` (cross mark)
- **Colors**: Same `fg: #e0e0e0` (the error icon/text uses the default foreground)

### 4. Offline Indicator

**When**: `isOnline === false`

```
⚠ offline  unread: 42  │  j/k:navigate  ...
```

- **Status indicator**: `⚠ offline`
- **Icon**: `⚠` (warning triangle)
- **Priority**: Offline takes precedence over syncing and error in the status position (checked first in the conditional chain)
- **Colors**: Same `fg: #e0e0e0`

### 5. Search Mode

**When**: `isSearching === true`

```
Type to search, Enter to search, Esc to cancel  │  query: rust
```

- **Content**: `Type to search, Enter to search, Esc to cancel  │  query: {searchQuery || '(empty)'}`
- **No unread count**: The search prompt replaces the normal status layout
- **No shortcuts**: The search instructions replace the shortcut display
- **Colors**: Same `fg: #e0e0e0`, `bg: #2a2a3e`

---

## Status Message Priority

The status bar renders the first matching condition in this order:

1. `isSearching === true` → search prompt (completely replaces normal layout)
2. `isOnline === false` → `⚠ offline`
3. `syncing === true` → `⟳ syncing...`
4. `errorMessage !== null` → `✗ {errorMessage}`
5. `statusMessage !== ''` → custom status message (e.g. `Synced 5 feeds`)

After the status indicator (if any), the bar appends:
- `last sync: {N}h ago` if `lastSyncTime` exists and > 60 minutes ago (only when not syncing and online)
- `unread: {N}` always
- `│  {shortcuts}` always

---

## Icon Reference

| Icon | Meaning | Context |
|------|---------|---------|
| `▸` | Selected item | FeedList feed selection, ArticleView article selection |
| `▼` | Expanded category | FeedList category header |
| `▶` | Collapsed category | FeedList category header |
| `●` | Unread article | ArticleView list item |
| `★` | Starred article | ArticleView list item, Reader meta line |
| `✓` | Read article | Reader meta line |
| `⟳` | Syncing | StatusBar |
| `✗` | Error | StatusBar |
| `⚠` | Offline | StatusBar |

---

## State Transitions Affecting UI

| Trigger | State Change | UI Effect |
|---------|-------------|-----------|
| `j`/`k` | `selectedFeedIndex` or `selectedArticleIndex` changes | `▸` marker moves |
| `l`/`Enter` | `viewMode`: feeds→articles→reader | Pane visibility changes, layout reflows |
| `h`/`ESC` | `viewMode`: reader→articles→feeds | Pane visibility changes, layout reflows |
| `r` | `syncing: true` → API call → `syncing: false` | StatusBar shows `⟳ syncing...` then result |
| `m` | Toggle `user/-/state/com.google/read` in article categories | `●` appears/disappears, `✓ read` in reader |
| `s` | Toggle `user/-/state/com.google/starred` in article categories | `★` appears/disappears |
| `z` | `zenMode` toggles (reader only) | Sidebar + StatusBar hidden, title bar cleared |
| `\` | `sidebarCollapsed` toggles | Sidebar width changes to/from 3 cols |
| `/` | `isSearching: true` | ArticleView title becomes ` Search `, content becomes search input |
| `Enter` (search) | `filteredArticles` populated, `isSearching: false` | Title shows search query + count |
| `ESC` (search) | `isSearching: false`, `searchQuery: ''`, `filteredArticles: []` | Returns to normal article list |
| Resize | `layoutMode` recalculated, `terminalWidth`/`terminalHeight` updated | Layout mode changes (single/compact/wide) |
| Network error | `isOnline: false` | StatusBar shows `⚠ offline` |