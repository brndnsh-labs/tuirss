# tuirss

A FreshRSS terminal client using the Google Reader compatible API and OpenTUI.

## Setup

```bash
bun install
cp config.example.toml config.toml
$EDITOR config.toml
bun run start
```

The real `config.toml` is ignored because it contains the FreshRSS API password.

## Keys

- `h` / `l`: move between panes or narrow-screen views
- `j` / `k`: move selection
- `g` / `G`: jump to top/bottom
- `enter`: open the selected feed or article
- `r`: sync
- `m`: toggle read/unread
- `s`: toggle starred
- `/`: filter articles
- `escape`: close filter/help
- `?`: help
- `q`: quit
