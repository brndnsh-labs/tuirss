# UI Module

**Purpose**: OpenTUI-based terminal interface with responsive three-state navigation

## Where to Look

| Task | Location | Notes |
|------|----------|-------|
| Layout logic | `app.ts` | `applyLayout()`, `buildLayout()` |
| State changes | `state.ts` | `StateManager.update()`, view modes |
| Key handling | `keyboard.ts` | `DEFAULT_KEYBINDINGS` array |
| Feed list UI | `components/feed-list.ts` | `FeedList.update()` |
| Article view | `components/article-view.ts` | `ArticleView.update()` |
| Status bar | `components/status-bar.ts` | Context-aware shortcuts |

## Conventions

### Component Pattern

```typescript
export class ComponentName {
  readonly container: BoxRenderable
  private contentText: TextRenderable

  constructor(ctx: RenderContext) {
    this.container = new BoxRenderable(ctx, {
      id: 'unique-id',
      border: true,
      borderStyle: 'single',
      title: ' Title ',
      shouldFill: true,
      backgroundColor: '#1a1a2e',
    })

    this.contentText = new TextRenderable(ctx, {
      id: 'content-id',
      fg: '#cccccc',
      wrapMode: 'word',
    })

    this.container.add(this.contentText)
  }

  update(state: AppState): void {
    const innerWidth = this.container.width - 2
    if (innerWidth > 0) {
      this.contentText.width = innerWidth
    }

    if (!this.container.visible) {
      return
    }

    // Render logic
  }
}
```

### Visibility Management

The app (`app.ts`) controls visibility, NOT components:

```typescript
// In app.ts - central visibility control
this.feedList.container.visible = state.viewMode === 'feeds'
this.articleView.container.visible = state.viewMode !== 'feeds'

// In components - respect visibility
update(state: AppState): void {
  if (!this.container.visible) {
    return  // Early return if not visible
  }
  // Render logic
}
```

### Navigation Flow

```
feeds → articles → reader
  ↑      ↑         ↓
  └── h/ESC ───────┘
```

- `l` or `Enter`: Go deeper
- `h` or `ESC`: Go back
- `j/k`: Navigate within current view

### Layout Constants

Define at module level in `app.ts`:

```typescript
const LAYOUT_BREAKPOINTS = {
  narrow: 100,  // < 100 cols = single pane
  wide: 140,    // > 140 cols = wide sidebar
}

const SIDEBAR_WIDTHS = {
  collapsed: 3,
  compact: 20,
  full: 30,
}
```

### Zen Mode

- Press `z` in reader mode to hide sidebar + status bar
- Full-width article content
- Press `z` again to exit

## Anti-Patterns

- **Don't override visibility in components** - App controls it
- **Don't access renderer directly in components** - Pass RenderContext
- **Don't mutate state** - Use `state.update()` for changes
- **Don't forget early return** - Check `visible` at start of `update()`

## Testing UI Changes

```bash
# Run and manually test
bun run dev

# In another terminal, resize to test responsive modes
stty cols 80   # Test narrow/single mode
stty cols 120  # Test compact mode  
stty cols 160  # Test wide mode
```
