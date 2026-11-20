# Roadmap

## v1

- [x] **M0 — Scaffold:** config, XDG paths, SQLite store + migrations, file logging
- [x] **M1 — Local feeds:** RSS/Atom/JSON parsing, concurrent conditional fetching,
      dedupe, feed autodiscovery, OPML import/export, CLI (`add`, `remove`,
      `import`, `export`, `feeds`, `refresh`, `items`)
- [x] **M2 — Core TUI:** Bubble Tea, responsive three-pane layout, Reeder-style
      account switcher above folders, Google Reader keymap, HTML → terminal
      renderer, `v` open in browser, `?` help, `/` search (SQLite FTS5)
- [x] **M3 — FreshRSS:** Google Reader API (`/api/greader.php`), `tuirss login`
      with keyring / `password_command`, incremental sync, outbox for offline
      actions with retry
- [x] **M4 — Polish:**
  - [x] theme follows the terminal's palette (so Omarchy themes apply)
  - [x] sync spinner, reading-time estimates
  - [x] full-text extraction for summary-only feeds (`e` / `E`)
  - [x] inline sixel images in the reader (pulled forward from post-v1)
  - [x] tested against a live FreshRSS server
  - [x] smooth scrolling and new-article highlights (`animations = false` to disable)
  - [x] unread sparklines (sidebar and header)

## After v1

- Manage subscriptions and folders from inside the TUI
- `:` command palette (`:subscribe`, `:import`, `:unsubscribe`, …)
- Full-screen image viewer (zoom into a comic); Kitty graphics protocol
- Pipe an article to a command (`|` → `$PAGER`, summarizer, notes script)
- Follow permanent redirects (301/308) by updating the stored feed URL
- Item retention / pruning of old read items
- Friendlier network error messages in `tuirss feeds`
- Mouse support (wheel scrolling in the reader, click to select)
- Load more than 1000 items per list (paging)
- FreshRSS: first sync caches at most 3000 unread/starred articles (newest
  first); fetch older ones on demand
- Show the number of changes waiting to sync in the status bar
