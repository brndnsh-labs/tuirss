package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	"tuirss/internal/backend"
	"tuirss/internal/format"
	"tuirss/internal/local"
	"tuirss/internal/opml"
	"tuirss/internal/store"
	"tuirss/internal/tui"
)

// parseArgs parses flags that may appear before or after positional arguments.
func parseArgs(fs *flag.FlagSet, args []string) ([]string, error) {
	fs.SetOutput(io.Discard)
	var pos []string
	for {
		if err := fs.Parse(args); err != nil {
			return nil, err
		}
		args = fs.Args()
		if len(args) == 0 {
			return pos, nil
		}
		pos = append(pos, args[0])
		args = args[1:]
	}
}

func cmdTUI(ctx context.Context, a *app, args []string) error {
	if len(args) != 0 {
		return errors.New("usage: tuirss tui")
	}
	if len(a.backends) == 0 {
		return errors.New("no accounts enabled: add a [[freshrss]] account or set local.enabled = true in the config")
	}
	return tui.Run(ctx, tui.Options{Store: a.store, Backends: a.backends, RefreshInterval: a.cfg.RefreshInterval.Duration})
}

func cmdAdd(ctx context.Context, a *app, args []string) error {
	fs := flag.NewFlagSet("add", flag.ContinueOnError)
	folder := fs.String("folder", "", "")
	pos, err := parseArgs(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 {
		return errors.New("usage: tuirss add [-folder NAME] URL")
	}
	f, n, err := a.local.Subscribe(ctx, pos[0], *folder)
	if errors.Is(err, store.ErrFeedExists) {
		return fmt.Errorf("already subscribed to %s (id %d)", f.DisplayTitle(), f.ID)
	}
	if err != nil {
		return err
	}
	where := ""
	if f.FolderName != "" {
		where = " in " + f.FolderName
	}
	fmt.Fprintf(a.out, "Subscribed to %s%s — %d items\n", f.DisplayTitle(), where, n)
	return nil
}

func cmdRemove(ctx context.Context, a *app, args []string) error {
	if len(args) != 1 {
		return errors.New("usage: tuirss remove ID|URL")
	}
	var f store.Feed
	var err error
	if id, perr := strconv.ParseInt(args[0], 10, 64); perr == nil {
		f, err = a.store.Feed(ctx, id)
		if err == nil && f.AccountID != local.AccountID {
			return errors.New("only local feeds can be removed from the command line")
		}
	} else {
		u, nerr := local.NormalizeURL(args[0])
		if nerr != nil {
			return nerr
		}
		f, err = a.store.FeedByURL(ctx, local.AccountID, u)
	}
	if errors.Is(err, store.ErrNotFound) {
		return fmt.Errorf("no local feed matches %q (see `tuirss feeds`)", args[0])
	}
	if err != nil {
		return err
	}
	if err := a.store.DeleteFeed(ctx, f.ID); err != nil {
		return err
	}
	fmt.Fprintf(a.out, "Removed %s\n", f.DisplayTitle())
	return nil
}

func cmdImport(ctx context.Context, a *app, args []string) error {
	if len(args) != 1 {
		return errors.New("usage: tuirss import FILE.opml")
	}
	f, err := os.Open(args[0])
	if err != nil {
		return err
	}
	defer f.Close()
	entries, err := opml.Parse(f)
	if err != nil {
		return err
	}
	added, skipped, err := a.local.Import(ctx, entries)
	if err != nil {
		return err
	}
	fmt.Fprintf(a.out, "Imported %d feeds (%d skipped as duplicates or invalid)\n", added, skipped)
	if added == 0 {
		return nil
	}
	return cmdRefresh(ctx, a, nil)
}

func cmdExport(ctx context.Context, a *app, args []string) error {
	if len(args) > 1 {
		return errors.New("usage: tuirss export [FILE.opml]")
	}
	entries, err := a.local.Export(ctx)
	if err != nil {
		return err
	}
	if len(args) == 0 {
		return opml.Write(a.out, "tuirss subscriptions", entries)
	}
	f, err := os.Create(args[0])
	if err != nil {
		return err
	}
	if err := opml.Write(f, "tuirss subscriptions", entries); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	fmt.Fprintf(a.errw, "Exported %d feeds to %s\n", len(entries), args[0])
	return nil
}

// accountName maps account ids to display names.
func (a *app) accountNames(ctx context.Context) map[string]string {
	names := map[string]string{}
	if accts, err := a.store.Accounts(ctx); err == nil {
		for _, ac := range accts {
			names[ac.ID] = ac.Name
		}
	}
	return names
}

// accountIDs returns the ids of every enabled account, or just the one named.
func (a *app) accountIDs(ctx context.Context, name string) ([]string, error) {
	var ids []string
	names := a.accountNames(ctx)
	for _, b := range a.backends {
		if name == "" || strings.EqualFold(names[b.AccountID()], name) {
			ids = append(ids, b.AccountID())
		}
	}
	if name != "" && len(ids) == 0 {
		return nil, fmt.Errorf("no enabled account named %q", name)
	}
	return ids, nil
}

func cmdFeeds(ctx context.Context, a *app, args []string) error {
	fs := flag.NewFlagSet("feeds", flag.ContinueOnError)
	account := fs.String("account", "", "")
	if _, err := parseArgs(fs, args); err != nil {
		return err
	}
	ids, err := a.accountIDs(ctx, *account)
	if err != nil {
		return err
	}
	names := a.accountNames(ctx)
	now := time.Now()
	tw := tabwriter.NewWriter(a.out, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "ID\tACCOUNT\tUNREAD\tFOLDER\tTITLE\tFETCHED")
	total := 0
	for _, id := range ids {
		feeds, err := a.store.Feeds(ctx, id)
		if err != nil {
			return err
		}
		for _, f := range feeds {
			total++
			status := format.Ago(f.LastFetchedAt, now)
			switch {
			case f.LastError != "":
				status = "error: " + format.Truncate(f.LastError, 50)
			case f.AccountID != local.AccountID:
				status = "via server"
			}
			fmt.Fprintf(tw, "%d\t%s\t%d\t%s\t%s\t%s\n", f.ID, format.Truncate(names[id], 16), f.UnreadCount, f.FolderName, format.Truncate(f.DisplayTitle(), 50), status)
		}
	}
	if total == 0 {
		fmt.Fprintln(a.out, "No feeds yet. Try `tuirss add <url>`, `tuirss import feeds.opml`, or `tuirss refresh` for FreshRSS.")
		return nil
	}
	return tw.Flush()
}

func cmdRefresh(ctx context.Context, a *app, args []string) error {
	if len(args) != 0 {
		return errors.New("usage: tuirss refresh")
	}
	names := a.accountNames(ctx)
	tty := isTerminal(os.Stderr)
	var failed bool
	for _, b := range a.backends {
		name := names[b.AccountID()]
		start := time.Now()
		res, err := b.Sync(ctx, func(p backend.Progress) {
			if tty {
				fmt.Fprintf(a.errw, "\r\033[K  %s [%d/%d] %s", name, p.Done, p.Total, format.Truncate(p.Current, 50))
			}
		})
		if tty {
			fmt.Fprint(a.errw, "\r\033[K")
		}
		took := time.Since(start).Round(100 * time.Millisecond)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			failed = true
			fmt.Fprintf(a.out, "%s: ✗ %v\n", name, err)
			continue
		}
		if b.AccountID() == local.AccountID {
			fmt.Fprintf(a.out, "%s: checked %d feeds in %s: %d new items, %d unchanged, %d failed\n",
				name, res.Feeds, took, res.NewItems, res.NotModified, len(res.Failed))
		} else {
			fmt.Fprintf(a.out, "%s: synced %d feeds in %s: %d new items\n", name, res.Feeds, took, res.NewItems)
		}
		for _, f := range res.Failed {
			fmt.Fprintf(a.out, "  ✗ %s: %v\n", f.Title, f.Err)
		}
	}
	if failed {
		return errors.New("some accounts failed to sync")
	}
	return nil
}

func cmdItems(ctx context.Context, a *app, args []string) error {
	fs := flag.NewFlagSet("items", flag.ContinueOnError)
	account := fs.String("account", "", "")
	unread := fs.Bool("unread", false, "")
	starred := fs.Bool("starred", false, "")
	feed := fs.Int64("feed", 0, "")
	n := fs.Int("n", 25, "")
	if _, err := parseArgs(fs, args); err != nil {
		return err
	}
	q := store.ItemQuery{FeedID: *feed, UnreadOnly: *unread, StarredOnly: *starred, Limit: *n}
	if *account != "" {
		ids, err := a.accountIDs(ctx, *account)
		if err != nil {
			return err
		}
		q.AccountID = ids[0]
	}
	items, err := a.store.Items(ctx, q)
	if err != nil {
		return err
	}
	now := time.Now()
	tw := tabwriter.NewWriter(a.out, 0, 0, 2, ' ', 0)
	for _, it := range items {
		mark := " "
		if !it.Read {
			mark = "●"
		}
		if it.Starred {
			mark = "★"
		}
		fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\n", mark, it.ID, format.Ago(it.PublishedAt, now),
			format.Truncate(it.FeedTitle, 24), format.Truncate(strings.Join(strings.Fields(it.Title), " "), 80))
	}
	return tw.Flush()
}

func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}
