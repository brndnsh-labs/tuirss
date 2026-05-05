# StatusBar Component

**Purpose**: Displays system status, current state, and available keyboard shortcuts.

## Required State

| State Field | Type | Purpose |
|-------------|------|---------|
| `syncing` | `boolean` | Shows sync indicator |
| `errorMessage` | `string \| null` | Displays errors |
| `statusMessage` | `string` | General status text |
| `isOnline` | `boolean` | Shows offline warning |
| `lastSyncTime` | `number \| null` | Shows stale sync warning |
| `feeds` | `Feed[]` | Calculates total unread count |
| `viewMode` | `ViewMode` | Context-aware shortcuts |
| `layoutMode` | `LayoutMode` | Shows sidebar toggle hint |
| `isSearching` | `boolean` | Search mode instructions |

## Visual States

### 1. Search Mode
**When**: `isSearching === true`
**Displays**: "Type to search, Enter to search, Esc to cancel  │  query: {text}"

### 2. Offline
**When**: `isOnline === false`
**Displays**: "⚠ offline" + last sync time if stale (>1 hour)

### 3. Syncing
**When**: `syncing === true`
**Displays**: "⟳ syncing..."

### 4. Error
**When**: `errorMessage` is set
**Displays**: "✗ {errorMessage}"

### 5. Normal (Idle)
**When**: No special states active
**Displays**:
- Optional status message
- Total unread count
- Context-aware keyboard shortcuts

## Keyboard Shortcuts by Context

### Feeds View
`j/k:navigate  l/Enter:articles  r:refresh  ^e:export  q:quit`

### Articles View  
`j/k:navigate  l/Enter:read  h:back  /:search  m:read  s:star  r:refresh  ^e:export  q:quit  \\:sidebar`

### Reader View
`j/k:navigate  h:back  z:zen  m:read  s:star  r:refresh  q:quit`

## Message Priority

1. Search mode (overrides all)
2. Offline warning
3. Syncing indicator
4. Error message
5. Custom status message

## Key Behaviors

1. **Dynamic Shortcuts**: Changes based on `viewMode`
2. **Unread Counter**: Sum of all `feed.unreadCount`
3. **Stale Sync Warning**: Shows "last sync: Xh ago" if >60 minutes
4. **Layout Hints**: Shows `\:sidebar` only in compact/wide layouts
5. **Truncate**: Long content truncated with ellipsis

## Gotchas

- **Message Stacking**: Only one status message shown at a time
- **Unread Count**: Always visible except in search mode
- **Separator**: Uses `│` character between sections
- **Background**: Fixed background color (`#2a2a3e`)
- **Single Line**: Must fit in 1 terminal row
