# TUIRSS Knowledge Base

**Project**: TUIRSS - Terminal-based FreshRSS client with Reeder-inspired UX
**Stack**: TypeScript + Bun + OpenTUI + SQLite
**Last Updated**: 2026-05-05

## Overview

TUIRSS is a terminal RSS reader built with OpenTUI. It uses a three-state navigation model (feeds → articles → reader) with responsive layout modes (single/compact/wide) and zen mode for distraction-free reading.

## Structure

```
tuirss/
├── src/
│   ├── main.ts              # Entry point
│   ├── api/                 # FreshRSS API client
│   ├── cache/               # SQLite cache layer
│   ├── config/              # TOML config with Zod validation
│   └── ui/                  # OpenTUI interface
│       ├── components/      # FeedList, ArticleView, StatusBar
│       ├── app.ts           # Main orchestrator
│       ├── keyboard.ts      # Key handling
│       └── state.ts         # State management
├── docs/                    # Architecture, development, roadmap
└── config files             # .prettierrc, .oxlintrc.json, etc.
```

## Where to Look

| Task | Location | Notes |
|------|----------|-------|
| Add API method | `src/api/client.ts` | FreshRSSClient class |
| Update UI layout | `src/ui/app.ts` | Layout logic in `applyLayout()` |
| Add keyboard shortcut | `src/ui/keyboard.ts` | Add to `DEFAULT_KEYBINDINGS` |
| Modify state | `src/ui/state.ts` | StateManager class |
| Update component | `src/ui/components/*.ts` | Follow existing patterns |
| Config schema | `src/config/schema.ts` | Zod validation |
| Config loading | `src/config/loader.ts` | TOML + XDG paths |

## Critical Conventions

### Import Rules (REQUIRED)

```typescript
// ALWAYS use .ts extension (verbatimModuleSyntax enforces this)
import { something } from './file.ts'

// Type imports must use 'import type'
import type { MyType } from './types.ts'

// External packages - no extension
import { z } from 'zod'
```

### Code Style (Enforced)

```typescript
// NO semicolons
const x = 1

// Single quotes
const str = 'hello'

// Trailing commas (ES5 style)
const obj = {
  a: 1,
  b: 2,  // ← trailing comma
}

// 100 char line width
```

### State Management Pattern

```typescript
// Use StateManager with subscription pattern
const state = new StateManager()
state.subscribe((newState) => {
  // Re-render on state change
})
state.update({ viewMode: 'articles' })  // Partial update
```

### Three-State Navigation

```typescript
// viewMode: 'feeds' | 'articles' | 'reader'
// Navigation: j/k navigate, l/Enter forward, h/ESC back
// Auto-marks articles as read when entering reader mode
```

## Anti-Patterns (Forbidden)

| Don't | Do Instead | Why |
|-------|-----------|-----|
| `any` type | `unknown` + type guards | Strict TypeScript |
| Fallthrough switch cases | Explicit `break` or `return` | `noFallthroughCasesInSwitch` |
| Implicit method override | Use `override` keyword | `noImplicitOverride` |
| `obj[key]` without check | Check index access | `noUncheckedIndexedAccess` |
| Semicolons | Omit them | Prettier config |
| Double quotes | Single quotes | Prettier config |
| Import without .ts extension | Always add .ts | `verbatimModuleSyntax` |

## Development Commands

```bash
# Development
bun run dev          # Run app
bun run check        # Full validation (typecheck + lint + format)

# Individual checks
bun run typecheck    # TypeScript only
bun run lint         # oxlint
bun run lint:fix     # Auto-fix lint issues
bun run format       # Prettier format
bun run format:check # Verify formatting

# Build
bun run build        # Build to dist/
```

## Key Patterns

### Responsive Layout

```typescript
// Layout modes: 'single' | 'compact' | 'wide'
// Breakpoints: narrow < 100 cols, wide > 140 cols
// Single mode: One view at a time (feeds OR articles OR reader)
// Compact/Wide: Side-by-side with collapsible sidebar
```

### Error Handling

```typescript
try {
  // operation
} catch (error) {
  if (error instanceof ConfigError) {
    // Handle specific error
  }
  // Generic error handling
}
```

### Configuration

Uses Zod schemas in `src/config/schema.ts`:
- Validates at runtime
- Provides defaults
- TOML format
- XDG directory support

## Notes

- **No tests yet** - Roadmap item
- **No pagination** - All articles loaded at once
- **HTML stripped** - Articles shown as plain text
- **Bun runtime** - Not Node.js compatible
- **Pre-commit hooks** - TypeScript + lint must pass
