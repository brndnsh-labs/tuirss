// Command tuirss is a terminal RSS reader for local feeds and FreshRSS.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/brndnsh-labs/tuirss/internal/backend"
	"github.com/brndnsh-labs/tuirss/internal/config"
	"github.com/brndnsh-labs/tuirss/internal/freshrss"
	"github.com/brndnsh-labs/tuirss/internal/local"
	"github.com/brndnsh-labs/tuirss/internal/logx"
	"github.com/brndnsh-labs/tuirss/internal/paths"
	"github.com/brndnsh-labs/tuirss/internal/store"
)

type app struct {
	cfg      config.Config
	store    *store.Store
	local    *local.Backend
	freshrss []*freshrss.Backend
	backends []backend.Backend // every enabled account, in config order
	out      io.Writer
	errw     io.Writer
}

type command struct {
	name, args, help string
	run              func(ctx context.Context, a *app, args []string) error
}

var commands []command

func init() {
	commands = []command{
		{"tui", "", "open the reader (the default)", cmdTUI},
		{"add", "[-folder NAME] URL", "subscribe to a feed (or a page that links to one)", cmdAdd},
		{"remove", "ID|URL", "unsubscribe from a feed and delete its items", cmdRemove},
		{"import", "FILE.opml", "add feeds from an OPML file, then refresh", cmdImport},
		{"export", "[FILE.opml]", "write subscriptions as OPML (stdout by default)", cmdExport},
		{"feeds", "", "list subscriptions with unread counts", cmdFeeds},
		{"refresh", "", "sync every account now", cmdRefresh},
		{"items", "[-account NAME] [-unread] [-starred] [-feed ID] [-n N]", "list recent items", cmdItems},
		{"login", "[NAME]", "save and check a FreshRSS API password", cmdLogin},
		{"logout", "NAME", "forget a saved FreshRSS API password", cmdLogout},
		{"version", "", "show which build this is", nil},
	}
}

func usage(w io.Writer) {
	fmt.Fprintf(w, "tuirss — a terminal RSS reader\n\nUsage:\n  tuirss [-config FILE] [-db FILE] [COMMAND [ARGS]]\n\nCommands:\n")
	for _, c := range commands {
		fmt.Fprintf(w, "  %-8s %-52s %s\n", c.name, c.args, c.help)
	}
	fmt.Fprintf(w, "\nFiles:\n  config  %s\n  data    %s\n  log     %s\n", paths.ConfigFile(), paths.DBFile(), paths.LogFile())
}

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	global := flag.NewFlagSet("tuirss", flag.ContinueOnError)
	global.SetOutput(io.Discard)
	cfgPath := global.String("config", paths.ConfigFile(), "")
	dbPath := global.String("db", paths.DBFile(), "")
	showVersion := global.Bool("version", false, "")
	if err := global.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			usage(os.Stdout)
			return 0
		}
		fmt.Fprintln(os.Stderr, "tuirss:", err)
		usage(os.Stderr)
		return 2
	}
	rest := global.Args()
	if *showVersion || len(rest) > 0 && rest[0] == "version" {
		fmt.Println(currentBuild())
		return 0
	}
	if len(rest) > 0 && (rest[0] == "help" || rest[0] == "-h" || rest[0] == "--help") {
		usage(os.Stdout)
		return 0
	}
	if len(rest) == 0 {
		rest = []string{"tui"}
	}
	var cmd *command
	for i := range commands {
		if commands[i].name == rest[0] {
			cmd = &commands[i]
		}
	}
	if cmd == nil {
		fmt.Fprintf(os.Stderr, "tuirss: unknown command %q\n\n", rest[0])
		usage(os.Stderr)
		return 2
	}

	if err := execute(cmd, *cfgPath, *dbPath, rest[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "tuirss:", err)
		return 1
	}
	return 0
}

func execute(cmd *command, cfgPath, dbPath string, args []string) error {
	if logs, err := logx.Setup(paths.LogFile()); err == nil {
		defer logs.Close()
	}
	if cfgPath == paths.ConfigFile() {
		_ = config.WriteExample(cfgPath) // first run: leave a commented config to edit
	} else if _, err := os.Stat(cfgPath); err != nil {
		return fmt.Errorf("config file: %w", err)
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return err
	}
	st, err := store.Open(dbPath)
	if err != nil {
		return fmt.Errorf("opening database: %w", err)
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	a := &app{
		cfg:   cfg,
		store: st,
		local: local.New(st, local.NewFetcher(cfg.Local.Timeout.Duration), cfg.Local.Concurrency),
		out:   os.Stdout,
		errw:  os.Stderr,
	}
	for _, fc := range cfg.FreshRSS {
		b := freshrss.New(st, fc)
		a.freshrss = append(a.freshrss, b)
		a.backends = append(a.backends, b)
	}
	if cfg.Local.Enabled {
		a.backends = append(a.backends, a.local)
	}
	// The local account always exists so add/import work even when it's hidden.
	if err := a.local.Init(ctx); err != nil {
		return err
	}
	for _, b := range a.freshrss {
		if err := b.Init(ctx); err != nil {
			return err
		}
	}
	return cmd.run(ctx, a, args)
}
