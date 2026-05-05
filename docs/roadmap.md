# TUIRSS Roadmap

## Status Legend
- ✅ Complete
- 🔄 In Progress
- 📋 Planned
- ❌ Not Planned

---

## Phase 1: Foundation ✅ COMPLETE

**Infrastructure & Core Systems**

- ✅ Project setup (Bun + TypeScript + strict mode)
- ✅ TOML configuration with Zod validation
- ✅ XDG directories support
- ✅ Auto-generated config on first run
- ✅ FreshRSS API client (Google Reader API)
  - ✅ Authentication (ClientLogin)
  - ✅ Fetch feeds
  - ✅ Fetch unread counts
  - ✅ Fetch articles
  - ✅ Mark read/unread
  - ✅ Star/unstar
- ✅ SQLite cache (bun:sqlite)
  - ✅ Feeds table
  - ✅ Articles table
  - ✅ CRUD operations
  - ✅ Indexes for performance
- ✅ Dev tooling
  - ✅ TypeScript strict mode
  - ✅ ESLint (oxlint)
  - ✅ Prettier
  - ✅ Pre-commit hooks
  - ✅ VS Code settings

---

## Phase 2: UI ✅ COMPLETE

**Terminal Interface**

- ✅ OpenTUI integration
- ✅ 2-column layout (feeds | articles)
- ✅ Vim navigation (j/k/h/l)
- ✅ Keyboard shortcuts
  - ✅ Navigate (j/k/↑/↓)
  - ✅ Go back (h/←)
  - ✅ Select/open (l/→/Enter)
  - ✅ Mark read (m)
  - ✅ Toggle star (s)
  - ✅ Refresh (r)
  - ✅ Quit (q)
- ✅ Feed list with unread counts
- ✅ Article list with read/star status
- ✅ Article detail view
- ✅ Status bar with hints
- ✅ Background sync (5 min interval)
- ✅ Clean shutdown handling

---

## Phase 3: Polish 📋 PLANNED

**User Experience Improvements**

- 📋 Search/filter articles
- 📋 Folder/category view
- 📋 Customizable keybindings (partial - config exists)
- 📋 Configurable UI themes
- 📋 Article pagination (load more)
- 📋 Full-text search in cached articles
- 📋 Export/import OPML
- 📋 Offline mode indicators

---

## Phase 4: Advanced Features 📋 PLANNED

**Power User Features**

- 📋 Multiple account support
- 📋 Feed organization (folders, tags)
- 📋 Rules/filters (auto-mark read, etc.)
- 📋 Statistics (reading habits)
- 📋 Full-text search indexing
- 📋 Article sharing (via webhooks)
- 📋 Mobile-responsive layout (if terminal supports)

---

## Known Issues / Technical Debt

1. **HTML Rendering**: Article content is stripped to plain text. Rich HTML rendering would be nice.
2. **Image Handling**: Images in articles are not displayed (terminal limitation).
3. **Large Feeds**: No pagination in UI yet - all articles loaded at once.
4. **Sync Failures**: Network errors during sync don't retry automatically.
5. **Testing**: No automated tests yet.

---

## Completed Milestones

| Date | Milestone | Commit |
|------|-----------|--------|
| Initial | Project setup | - |
| Phase 1 | Config + API + Cache | Multiple |
| Phase 2 | OpenTUI interface | `65d86ee` |
| Polish | Shutdown handling | `38d7d4f` |

---

## Next Steps

1. **Immediate**: Run smoke test with actual FreshRSS server
2. **Short term**: Add search functionality
3. **Medium term**: Folder/category organization
4. **Long term**: Full-text search, rules engine
