# tuirss

A terminal RSS reader for local feeds and FreshRSS, with Google Reader-style
keyboard navigation. See [ROADMAP.md](ROADMAP.md) for what's next.

## Install

**Download:** grab the archive for your system from
[Releases](https://github.com/brndnsh-labs/tuirss/releases) (Linux and macOS,
x86-64 and ARM), unpack it, and put `tuirss` somewhere on your `PATH`.

**With Go 1.27+:**

```sh
go install github.com/brndnsh-labs/tuirss/cmd/tuirss@latest
```

**From a clone:** `go build -o bin/tuirss ./cmd/tuirss` (and `go test ./...`).
`tuirss version` shows which build you're running. See
[RELEASING.md](RELEASING.md) for how releases are made. Passwords are stored with the Secret Service API
(gnome-keyring, KeePassXC, …) unless you set `password_command`.

## FreshRSS

1. In FreshRSS, enable the API (Settings → Authentication → "Allow API access")
   and set an API password (Settings → Profile → API management).
2. Add the account to `~/.config/tuirss/config.toml`:

   ```toml
   [[freshrss]]
   name = "Home"                       # shown in the sidebar
   url = "https://freshrss.example.com"
   username = "your-freshrss-username"
   # password_command = "pass show freshrss"   # optional; keyring otherwise
   ```
3. `tuirss login` — checks the API password and saves it to your keyring.
4. `tuirss` — read. Changes sync back to the server in the background; if
   you're offline they're queued and sent on the next sync.

## Keys

Google Reader style: `j`/`k` next/previous article, `space` page/next,
`s` star, `m` toggle read, `v` open in browser, `J`/`K` next/previous feed,
`g u` jump to a feed, `[`/`]` switch account, `/` search, `?` all keys.

**Full articles:** for feeds that only send a teaser, `e` fetches the article
from the web page and shows it in the reader (cached after the first fetch);
`E` makes a feed always do this.

**Images** are drawn inline in terminals with sixel graphics (foot, WezTerm,
recent xterm, …), detected automatically. Elsewhere — including inside tmux —
they show as `▣` placeholders. Set `TUIRSS_IMAGES=0` to turn them off.

**Animations:** the reader scrolls smoothly, and articles that arrive while
you're reading pulse briefly as the unread counts count up. Set
`animations = false` in the config to turn both off.

**Unread sparklines** show when your unread articles were published, one bar
per day with today on the right: the last 7 days beside each feed and folder
(when the sidebar is wide enough), and the last 14 for the current view in
the header. A backlog that's all on the left is old news.

## Command line

```sh
tuirss                                 # open the reader
tuirss add lwn.net -folder Tech        # a feed URL or any page that links to one
tuirss import subscriptions.opml       # adds feeds, then refreshes
tuirss refresh
tuirss feeds
tuirss items -unread -n 20
tuirss export > backup.opml
tuirss remove 3
```

## Files

| What   | Where                                |
|--------|--------------------------------------|
| Config | `~/.config/tuirss/config.toml` (a commented example is written on first run) |
| Data   | `~/.local/share/tuirss/tuirss.db`    |
| Log    | `~/.local/state/tuirss/tuirss.log` (`TUIRSS_DEBUG=1` for more detail) |

## Layout

```
cmd/tuirss/         CLI entry point and subcommands
internal/backend/   Backend interface every account type implements
internal/local/     Local feeds: fetching, discovery, conversion, sync
internal/freshrss/  FreshRSS: Google Reader API client and sync
internal/secret/    passwords from password_command or the keyring
internal/tui/       Bubble Tea interface
internal/render/    article HTML → styled terminal text
internal/htmltext/  HTML → plain text (search, excerpts)
internal/store/     SQLite cache (the UI reads only from here)
internal/opml/      OPML import/export
internal/config/    config.toml loading and validation
internal/paths/     XDG paths
internal/format/    display helpers shared by CLI and TUI
```

Backends sync remote state into the store; the UI never waits on the network.

## License

MIT — see [LICENSE](LICENSE).
