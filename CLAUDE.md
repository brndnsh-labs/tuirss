# tuirss

Terminal RSS reader in Go (Bubble Tea v2) for local feeds and FreshRSS.
User docs: README.md. Release process: RELEASING.md. Plans: ROADMAP.md.

## Commands

- Build: `go build -o bin/tuirss ./cmd/tuirss`
- Before pushing, run what CI runs: `gofmt -l .` (must print nothing),
  `go vet ./...`, `go test -race ./...`. CI also runs a GoReleaser snapshot
  build, so check config changes with
  `go run github.com/goreleaser/goreleaser/v2@latest release --snapshot --clean`.
- `go install ./cmd/tuirss` updates the maintainer's installed copy in
  `~/go/bin`. Do it after changes they'll want to use.

## Architecture

- **The UI never waits on the network.** Backends (`internal/local`,
  `internal/freshrss`, both implementing `internal/backend`) sync into the
  SQLite store, and the TUI reads and writes only the store. Network work
  started by the TUI (sync, full-text and image fetches) runs in `tea.Cmd`s.
- **Read/star changes on synced accounts go through the outbox.**
  `store.SetRead`, `SetStarred` and `MarkAllRead` queue them. FreshRSS
  `push()` sends them at the start of each sync, and `ApplyRemoteState`
  never overwrites a flag that still has a pending change.
- **Stay CGO-free.** SQLite is `modernc.org/sqlite` (pure Go), which is what
  lets GoReleaser cross-compile every target. Don't add C dependencies.
- **Migrations** are embedded files, `internal/store/migrations/NNNN_name.sql`.
  Add a new numbered file; never edit one that has shipped. Go code that must
  run after a migration goes in `migrationHooks`.
- **Inline images** are sixel graphics written with `tea.Raw`, outside
  Bubble Tea's renderer. Read the comment at the top of
  `internal/tui/images.go` before changing layout, scrolling or overlays:
  anything that moves the reader must keep `desiredImages`/`scheduleImages`
  correct.
- **Theme colors** are ANSI palette indexes (`internal/tui/styles.go`), so
  tuirss follows the terminal's theme. Don't hard-code RGB colors.
- Charm libraries are the v2 modules under `charm.land/…`; their APIs differ
  from the v1 `github.com/charmbracelet/…` docs most examples use.

## Testing safely

- **Never run dev builds against the maintainer's real data or FreshRSS
  server.** Point `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME` at
  a scratch directory. To test with realistic data, copy the database and use
  a config whose `[[freshrss]]` url is unreachable (e.g.
  `https://freshrss.invalid`), so nothing can sync or push.
- Tests must not use the network or the real keyring: use `httptest` servers
  and `keyring.MockInit()`.
- TUI unit tests drive the model with key messages. The helpers in
  `internal/tui/tui_test.go` include `press` (which lets scroll animations
  finish) and `checkView` (which checks every line fits the terminal).
- For a real terminal, run the binary in a detached tmux session
  (`tmux -L tuirss-test new-session -d -x 150 -y 40 '…'`, then `send-keys`
  and `capture-pane -p`). Pause between keys: Escape followed quickly by a
  key arrives as alt+key.
- tmux captures can't show sixel images. Image changes need the maintainer
  to check them in foot; don't open terminal windows on their desktop.

## Conventions

- This repo's git config uses the maintainer's GitHub no-reply email. Keep
  it, so personal addresses stay out of the public history.
- The repo is public: docs and examples use generic names
  (`freshrss.example.com`), never the maintainer's own servers or accounts.
- Update ROADMAP.md when a feature is finished or deferred.
- New user-facing keys go in the help overlay (`helpSections` in
  `internal/tui/overlay.go`) and, if notable, in the README.
