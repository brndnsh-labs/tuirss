# tuirss

A FreshRSS terminal client using the Google Reader compatible API and OpenTUI.

The default wide layout is a Reeder-style two column view: unread articles on
the left and the reader on the right. Sources live one level up; use `h` from
the article list to slide the reading view away and choose a feed.

## Setup

```bash
bun install
cp config.example.toml config.toml
$EDITOR config.toml
bun run start
```

The real `config.toml` is ignored because it contains the FreshRSS API password.

Opening an article marks it read but keeps it listed (dimmed) until you leave
the feed, so the cursor never jumps out from under you. The reader renders
article HTML as styled, word-wrapped markdown in a scroll view.

## Keys

- `h` / `l`: move between reader levels and panes
- `j` / `k`: move selection; in the reader, scroll the article
- `g` / `G`: jump to top/bottom (of the list, or the article when reading)
- `enter`: choose the selected source or open the selected article
- `r`: sync
- `m`: toggle read/unread
- `s`: toggle starred
- `v`: cycle view (Unread → All → Starred)
- `o`: open the article in your browser
- `/`: filter articles
- `escape`: close filter/help
- `?`: help
- `q`: quit
