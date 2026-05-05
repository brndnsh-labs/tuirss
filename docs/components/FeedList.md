# FeedList Component

**Purpose**: Displays RSS feeds organized by category with selection and expansion controls.

## Required State

| State Field | Type | Purpose |
|-------------|------|---------|
| `feeds` | `Feed[]` | List of feeds to display |
| `selectedFeedIndex` | `number` | Currently selected feed position |
| `viewMode` | `ViewMode` | Only shows selection when 'feeds' |
| `sidebarCollapsed` | `boolean` | Switches to compact indicator mode |
| `loadingFeeds` | `boolean` | Shows loading state |
| `expandedCategories` | `Set<string>` | Tracks which category folders are open |
| `layoutMode` | `LayoutMode` | Affects width calculations |

## Visual States

### 1. Sidebar Collapsed
**When**: `sidebarCollapsed === true` in compact/wide layout
**Displays**: `●\n{totalUnread}` or just `●` if no unread

### 2. Loading
**When**: `loadingFeeds === true`
**Displays**: "Loading feeds..." in dim text

### 3. Empty
**When**: `feeds.length === 0`
**Displays**: "No feeds found. Press r to refresh."

### 4. Category View (Populated)
**When**: Feeds organized by category
**Features**:
- Category headers with expand/collapse icons (`▼`/`▶`)
- Unread counts per category in parentheses
- Feed list under expanded categories
- Selection indicator (`▸`) for selected feed
- Unread badge (`({count})`) per feed

### 5. Flat List (Legacy)
Simple list without category grouping

## Key Behaviors

1. **Selection Indicator**: Only shows when `viewMode === 'feeds'`
2. **Category Expansion**: Controlled by `expandedCategories` Set
3. **Width Adaptation**: Width changes based on `layoutMode`
4. **Unread Aggregation**: Category headers show total unread for all feeds in category

## Gotchas

- **Index Tracking**: When categories are collapsed, feed indices skip over hidden feeds
- **Width Calculations**: Container width - 2 for padding
- **Selection Sync**: Must stay in sync with `selectedFeedIndex` from parent
- **Category Sorting**: Categories sorted alphabetically by label
