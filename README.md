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

## Keys

- `h` / `l`: move between reader levels and panes
- `j` / `k`: move selection
- `g` / `G`: jump to top/bottom
- `enter`: choose the selected source or open the selected article
- `r`: sync
- `m`: toggle read/unread
- `s`: toggle starred
- `/`: filter articles
- `escape`: close filter/help
- `?`: help
- `q`: quit
