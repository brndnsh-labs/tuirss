# Development Guide

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.1+
- Node.js (for some tooling, though Bun is primary)
- Git

### Setup

```bash
# Clone the repo
git clone https://github.com/yourusername/tuirss.git
cd tuirss

# Install dependencies
bun install

# Verify setup
bun run check
```

### Configuration

First run will auto-create config:
```bash
bun run dev
# Fails with config error, but creates ~/.config/tuirss/config.toml
```

Edit the config:
```bash
nano ~/.config/tuirss/config.toml
```

Required fields:
```toml
[server]
url = "http://your-freshrss-instance.com/api/"
username = "your-username"
password = "your-api-password"
```

## Development Workflow

### Running

```bash
# Development (hot reload not available, but fast)
bun run dev

# Or build and run
bun run build
bun run ./dist/main.js
```

### Code Quality

```bash
# Run all checks
bun run check

# Individual checks
bun run typecheck
bun run lint
bun run format:check

# Auto-fix
bun run lint:fix
bun run format
```

**Pre-commit hooks** run automatically on `git commit`.

## Project Structure

See [architecture.md](./architecture.md) for full details.

### Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point, error handling |
| `src/ui/app.ts` | Main app logic, sync, actions |
| `src/ui/state.ts` | Reactive state management |
| `src/api/client.ts` | FreshRSS API client |
| `src/cache/db.ts` | SQLite operations |
| `src/config/loader.ts` | Config loading & defaults |

## Adding Features

### Example: Adding a New Keyboard Shortcut

1. **Add action to keyboard handler** (`src/ui/keyboard.ts`):
```typescript
// In handleAction()
case 'newFeature': {
  // Handle the action
  break
}
```

2. **Map key to action**:
```typescript
// In the key handler
case 'x':
  this.emit('action', 'newFeature')
  return true
```

3. **Implement in App** (`src/ui/app.ts`):
```typescript
// In handleAction()
case 'newFeature': {
  this.doNewFeature()
  break
}
```

4. **Update status bar** (`src/ui/components/status-bar.ts`):
```typescript
// Add to hints
hints += ' x:new-feature'
```

5. **Document in README.md**

### Example: Adding a New UI Component

1. Create file: `src/ui/components/new-component.ts`
2. Extend or wrap OpenTUI renderables
3. Implement `update(state: AppState)` method
4. Add to App's buildLayout()
5. Subscribe to state changes if needed

## Code Style

### TypeScript

- Strict mode enabled
- No `any` types (use `unknown` + type guards)
- Explicit return types on public methods
- Prefer `const` over `let`

### Formatting

- Prettier with 2-space indentation
- Single quotes
- Trailing commas (ES5)
- 100 character line width

### Naming

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`

## Testing

*(Currently no automated tests - here's how to add them)*

### Manual Testing Checklist

Before committing:
- [ ] App starts without errors
- [ ] Config loads correctly
- [ ] Feeds display in left column
- [ ] j/k navigation works
- [ ] Enter opens feed
- [ ] Articles display
- [ ] m toggles read status
- [ ] s toggles star status
- [ ] r triggers sync
- [ ] q quits cleanly
- [ ] All checks pass (`bun run check`)

## Debugging

### Enable Debug Logging

Add to your component:
```typescript
private log(message: string): void {
  if (process.env.DEBUG) {
    console.error(`[Component] ${message}`)
  }
}
```

Run with:
```bash
DEBUG=1 bun run dev 2>debug.log
```

### SQLite Debugging

```bash
# Open cache database
sqlite3 ~/.local/share/tuirss/cache.db

# View feeds
SELECT title, unread_count FROM feeds;

# View recent articles
SELECT title, is_read, is_starred FROM articles ORDER BY published_at DESC LIMIT 10;
```

### Common Issues

**Type errors in OpenTUI**:
- Check version compatibility
- Some types may need `as const` assertions

**SQLite "undefined" errors**:
- Use `?? null` for undefined values
- bun:sqlite doesn't accept undefined

**Config not loading**:
- Check `~/.config/tuirss/config.toml` exists
- Verify TOML syntax
- Check file permissions (readable)

## Contributing

### Commit Messages

Format:
```
Short summary (50 chars or less)

More detailed explanation if needed. Wrap at 72 chars.
Explain what and why, not how.

- Bullet points are okay
- Use present tense
```

### Pull Request Process

1. Fork and branch: `git checkout -b feature/my-feature`
2. Make changes with tests
3. Run all checks: `bun run check`
4. Commit with clear message
5. Push and open PR
6. Describe what and why in PR description

## Release Process

*(When we get there)*

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Tag release: `git tag v1.0.0`
4. Push tags: `git push --tags`
5. Create GitHub release

## Resources

- [OpenTUI Documentation](https://github.com/anomalyco/opentui)
- [FreshRSS API](https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html)
- [Bun Documentation](https://bun.sh/docs)
- [Zod Documentation](https://zod.dev)

## Questions?

Open an issue or check existing documentation:
- `README.md` - User-facing docs
- `docs/architecture.md` - System design
- `docs/roadmap.md` - Feature status
