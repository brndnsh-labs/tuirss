# Architecture

## Overview

TUIRSS is a terminal-based RSS reader built with:
- **Runtime**: Bun (JavaScript/TypeScript)
- **UI Framework**: OpenTUI (vanilla imperative API)
- **Database**: SQLite via bun:sqlite
- **API**: FreshRSS Google Reader API

## Directory Structure

```
src/
├── main.ts              # Entry point
├── config/              # Configuration management
│   ├── index.ts         # Public API exports
│   ├── schema.ts        # Zod schemas + defaults
│   └── loader.ts        # TOML loading, XDG paths
├── api/                 # FreshRSS API client
│   ├── index.ts         # Public API exports
│   ├── client.ts        # FreshRSSClient class
│   └── types.ts         # TypeScript interfaces
├── cache/               # Local SQLite cache
│   ├── index.ts         # Public API exports
│   └── db.ts            # Cache class (bun:sqlite)
└── ui/                  # Terminal UI
    ├── app.ts           # Main app orchestrator
    ├── state.ts         # Reactive state management
    ├── keyboard.ts      # Key event handling
    └── components/      # UI components
        ├── feed-list.ts
        ├── article-view.ts
        └── status-bar.ts
```

## Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Config    │────▶│  FreshRSS    │────▶│   Cache     │
│  (TOML)     │     │    API       │     │  (SQLite)   │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                                                ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   User      │◀────│  OpenTUI     │◀────│     UI      │
│ (Terminal)  │     │  Renderer    │     │  Components │
└─────────────┘     └──────────────┘     └─────────────┘
```

1. **Startup**: Load config → Init cache → Build UI
2. **Initial Load**: Query cache → Display feeds → Fetch from API
3. **Navigation**: User input → State update → Re-render
4. **Sync**: API fetch → Cache update → UI refresh

## Key Components

### Config System

**Files**: `src/config/loader.ts`, `src/config/schema.ts`

- TOML-based configuration
- Zod schema validation with defaults
- XDG directory support (`~/.config/tuirss/`)
- Auto-generation on first run

**Schema**:
```typescript
server: { url, username, password }
sync: { interval, retention_days }
ui: { list_width, show_unread_counts, date_format }
keybindings: { nav_down, nav_up, ... }
```

### API Client

**File**: `src/api/client.ts`

**FreshRSSClient** class handles:
- Authentication (Google Reader ClientLogin)
- Token management (auth + write tokens)
- Feed operations (list, unread counts)
- Article operations (fetch, mark read/star)

**Key Methods**:
- `login()` - Authenticate with FreshRSS
- `getFeeds()` - List all subscriptions
- `getArticles()` - Fetch articles for stream
- `markAsRead()` / `markAsUnread()` - Update read status
- `starArticle()` / `unstarArticle()` - Update star status

### Cache Layer

**File**: `src/cache/db.ts`

**Cache** class provides:
- SQLite database via `bun:sqlite`
- Persistent storage at `~/.local/share/tuirss/cache.db`
- CRUD operations for feeds and articles
- Mark read/star operations

**Tables**:
- `feeds`: id, title, url, unread_count, ...
- `articles`: id, feed_id, title, content, is_read, is_starred, ...

**Indexes**:
- `idx_articles_feed` - Fast feed filtering
- `idx_articles_read` - Fast unread queries
- `idx_articles_starred` - Fast starred queries
- `idx_articles_published` - Sort by date

### UI System

**Files**: `src/ui/*.ts`

**State Management**:
- `StateManager` class with reactive updates
- Components subscribe to state changes
- Single source of truth

**Keyboard Handling**:
- Global key handler on `renderer.keyInput`
- Context-aware actions (different in feeds vs articles)
- Vim-style navigation (j/k/h/l)

**Component Structure**:
```
App (orchestrator)
├── FeedList (left column)
│   └── TextRenderable
├── ArticleView (right column)
│   └── TextRenderable
└── StatusBar (bottom)
    └── TextRenderable
```

## State Machine

**Panes**: `feeds` | `articles`
**View Modes**: `list` | `detail`

**Transitions**:
- `feeds` → `articles`: Select feed (Enter/l)
- `articles` → `detail`: Select article (Enter)
- `detail` → `articles`: Go back (h)
- `articles` → `feeds`: Go back (h)

## Build & Dev Tools

**Package Scripts**:
```bash
dev          # Run in development
build        # Build to dist/
typecheck    # TypeScript check
lint         # Run oxlint
lint:fix     # Auto-fix lint issues
format       # Format with Prettier
check        # Run all checks
```

**Git Hooks** (pre-commit):
- TypeScript type checking
- Linting

**VS Code**:
- Format on save
- Recommended extensions (Prettier, Oxlint)

## Error Handling

1. **Config Errors**: Clear error messages, exit with code 1
2. **API Errors**: Log to status bar, don't crash
3. **Cache Errors**: Log but continue (cache is best-effort)
4. **UI Errors**: Catch in render loop, log to status bar

## Performance Considerations

1. **SQLite**: Indexed columns for fast queries
2. **Lazy Loading**: Articles loaded per-feed, not all at once
3. **Efficient Rendering**: Single TextRenderable per component (not many children)
4. **Background Sync**: Non-blocking, updates UI when complete

## Security

- Config file contains credentials (600 permissions recommended)
- API password stored in plain text in config
- No credential storage in cache
- SQLite database is local-only

## Future Architecture Considerations

1. **Testing**: Unit tests for cache, API mocking
2. **Plugin System**: Allow custom renderers, key handlers
3. **Multi-Account**: Support multiple FreshRSS instances
4. **Sync Protocol**: Abstract interface for other RSS services
