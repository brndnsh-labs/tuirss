# ArticleView Component

**Purpose**: Displays articles in list mode or renders full article content in reader mode.

## Required State

| State Field | Type | Purpose |
|-------------|------|---------|
| `viewMode` | `ViewMode` | Switches between list/reader modes |
| `articles` | `Article[]` | All articles for current feed |
| `filteredArticles` | `Article[]` | Search results (if active) |
| `selectedArticleIndex` | `number` | Currently selected article |
| `loadingArticles` | `boolean` | Shows loading state |
| `zenMode` | `boolean` | Hides metadata in reader mode |
| `isSearching` | `boolean` | Shows search input overlay |
| `searchQuery` | `string` | Current search text |
| `hasMoreArticles` | `boolean` | Shows "load more" prompt |

## Visual States

### Article List Mode

#### 1. Search Active
**When**: `isSearching === true`
**Displays**: "Search: {query}_" with cursor

#### 2. Loading
**When**: `loadingArticles === true`
**Displays**: "Loading articles..." in dim text

#### 3. Empty (No Articles)
**When**: `articles.length === 0`
**Displays**: "No unread articles in {feedTitle}" or "No articles"

#### 4. Empty Search Results
**When**: `filteredArticles.length === 0` with active search
**Displays**: "No articles found matching \"{query}\""

#### 5. Article List
**When**: Articles available
**Features**:
- Read indicator (`●` or empty space)
- Star indicator (`★` or empty space)
- Selection indicator (`▸` for selected)
- Article title
- Publication date (dimmed)
- "Load more" prompt if `hasMoreArticles`

### Reader Mode

#### 1. Normal Reader
**When**: `viewMode === 'reader'` and `zenMode === false`
**Features**:
- Bold title at top
- Metadata line (author, date, read/star status)
- Separator line (`─` repeated)
- Article content (HTML stripped)

#### 2. Zen Mode Reader
**When**: `viewMode === 'reader'` and `zenMode === true`
**Features**:
- Title only in window title bar
- Full content width
- No metadata shown

#### 3. Scrolling Content
**When**: Article content exceeds viewport
**Features**:
- ScrollBox with vertical scrolling
- Page up/down controls
- Scroll position maintained

## Key Behaviors

1. **Mode Switching**: Component switches rendering entirely based on `viewMode`
2. **Search Filtering**: Uses `filteredArticles` if available, else `articles`
3. **HTML Stripping**: Content processed through `stripHtml()` function
4. **Scroll Management**: ScrollBox created on-demand for reader mode
5. **Title Truncation**: Window title truncated to 40 chars

## Gotchas

- **Dual Article Sources**: Must check both `filteredArticles` and `articles`
- **HTML Entities**: Must decode `&amp;`, `&lt;`, etc. in `stripHtml()`
- **Scroll State**: Scroll position lost when switching articles
- **Content Width**: Must subtract 2 from container width for borders
- **Date Formatting**: Unix timestamp (seconds) converted to local date string
