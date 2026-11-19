package freshrss

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/brndnsh-labs/tuirss/internal/backend"
	"github.com/brndnsh-labs/tuirss/internal/config"
	"github.com/brndnsh-labs/tuirss/internal/secret"
	"github.com/brndnsh-labs/tuirss/internal/store"
)

const (
	fetchBatch = 250  // items per stream/items/contents request
	editBatch  = 100  // ids per edit-tag request
	maxFetch   = 3000 // most items fetched in one sync (newest first)
)

// AccountID is the store account for a configured FreshRSS server.
func AccountID(name string) string { return "freshrss:" + name }

// Backend syncs one FreshRSS account into the store.
type Backend struct {
	cfg    config.FreshRSS
	store  *store.Store
	secret secret.Source

	mu     sync.Mutex
	client *Client
	// newClient is swappable for tests.
	newClient func(url, user, password string) *Client
}

var _ backend.Backend = (*Backend)(nil)

func New(st *store.Store, cfg config.FreshRSS) *Backend {
	return &Backend{
		cfg:       cfg,
		store:     st,
		secret:    SecretFor(cfg),
		newClient: NewClient,
	}
}

// SecretFor is where the account's API password comes from.
func SecretFor(cfg config.FreshRSS) secret.Source {
	return secret.Source{Account: AccountID(cfg.Name), Command: cfg.PasswordCommand}
}

func (b *Backend) AccountID() string { return AccountID(b.cfg.Name) }

func (b *Backend) Init(ctx context.Context) error {
	return b.store.EnsureAccount(ctx, store.Account{ID: b.AccountID(), Kind: store.KindFreshRSS, Name: b.cfg.Name})
}

func (b *Backend) getClient(ctx context.Context) (*Client, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.client != nil {
		return b.client, nil
	}
	pw, err := b.secret.Get(ctx)
	if errors.Is(err, secret.ErrMissing) {
		return nil, fmt.Errorf("no API password for %q yet: run `tuirss login %s`", b.cfg.Name, b.cfg.Name)
	}
	if err != nil {
		return nil, err
	}
	b.client = b.newClient(b.cfg.URL, b.cfg.Username, pw)
	return b.client, nil
}

// Sync pushes queued local changes, then pulls subscriptions, new items and
// the server's read/starred state.
func (b *Backend) Sync(ctx context.Context, progress func(backend.Progress)) (backend.SyncResult, error) {
	var res backend.SyncResult
	c, err := b.getClient(ctx)
	if err != nil {
		return res, err
	}
	step, total := 0, 5
	report := func(what string) {
		step++
		if progress != nil {
			progress(backend.Progress{Done: min(step, total), Total: total, Current: what})
		}
	}
	err = b.sync(ctx, c, &res, report, &total)
	if errors.Is(err, ErrBadLogin) {
		b.mu.Lock()
		b.client = nil // re-read the password next time
		b.mu.Unlock()
		err = fmt.Errorf("%w (update it with `tuirss login %s`)", err, b.cfg.Name)
	}
	return res, err
}

func (b *Backend) sync(ctx context.Context, c *Client, res *backend.SyncResult, report func(string), total *int) error {
	acct := b.AccountID()

	if _, err := c.authToken(ctx); err != nil {
		if errors.Is(err, ErrBadLogin) {
			return err
		}
		return fmt.Errorf("logging in: %w", err)
	}
	if err := b.push(ctx, c); err != nil {
		return fmt.Errorf("sending changes: %w", err)
	}
	report("sent changes")

	subs, err := c.Subscriptions(ctx)
	if err != nil {
		return fmt.Errorf("listing subscriptions: %w", err)
	}
	remote := make([]store.RemoteFeed, 0, len(subs))
	for _, s := range subs {
		rf := store.RemoteFeed{RemoteID: s.ID, URL: s.URL, SiteURL: s.HTMLURL, Title: s.Title}
		for _, cat := range s.Categories {
			if strings.HasPrefix(cat.ID, labelPrefix) {
				rf.FolderRemoteID = cat.ID
				rf.Folder = cat.Label
				if rf.Folder == "" {
					rf.Folder = strings.TrimPrefix(cat.ID, labelPrefix)
				}
				break
			}
		}
		if rf.URL == "" {
			rf.URL = s.ID // the url column must be unique and non-empty
		}
		remote = append(remote, rf)
	}
	feedIDs, err := b.store.SyncFeeds(ctx, acct, remote)
	if err != nil {
		return err
	}
	res.Feeds = len(subs)
	report("subscriptions")

	unread, err := c.ItemIDs(ctx, readingList, stateRead)
	if err != nil {
		return fmt.Errorf("listing unread: %w", err)
	}
	starred, err := c.ItemIDs(ctx, stateStarred, "")
	if err != nil {
		return fmt.Errorf("listing starred: %w", err)
	}
	report("item states")

	have, err := b.store.RemoteItemIDs(ctx, acct)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	var missing []string
	for _, id := range append(unread, starred...) {
		if !have[id] && !seen[id] {
			seen[id] = true
			missing = append(missing, id)
		}
	}
	sort.Slice(missing, func(i, j int) bool { return idValue(missing[i]) > idValue(missing[j]) })
	if len(missing) > maxFetch {
		slog.Info("capping item fetch", "account", acct, "missing", len(missing), "fetching", maxFetch)
		missing = missing[:maxFetch]
	}
	*total += (len(missing) + fetchBatch - 1) / fetchBatch
	for len(missing) > 0 {
		n := min(len(missing), fetchBatch)
		batch := missing[:n]
		missing = missing[n:]
		items, err := c.Items(ctx, batch)
		if err != nil {
			return fmt.Errorf("fetching articles: %w", err)
		}
		added, err := b.save(ctx, items, feedIDs)
		if err != nil {
			return err
		}
		res.NewItems += added
		report("articles")
	}
	if res.NewItems > 0 {
		res.Updated = 1
	}

	if err := b.store.ApplyRemoteState(ctx, acct, unread, starred); err != nil {
		return err
	}
	report("done")
	return nil
}

// save stores fetched items, grouped by feed. It returns how many were new.
func (b *Backend) save(ctx context.Context, items []Item, feedIDs map[string]int64) (int, error) {
	byFeed := map[int64][]store.Item{}
	for _, it := range items {
		id, ok := NormalizeID(it.ID)
		if !ok {
			continue
		}
		feedID, ok := feedIDs[it.Origin.StreamID]
		if !ok {
			slog.Debug("item from unknown feed", "feed", it.Origin.StreamID)
			continue
		}
		byFeed[feedID] = append(byFeed[feedID], convert(it, id))
	}
	added := 0
	for feedID, items := range byFeed {
		n, err := b.store.UpsertItems(ctx, feedID, items)
		if err != nil {
			return added, err
		}
		added += n
	}
	return added, nil
}

func convert(it Item, id string) store.Item {
	si := store.Item{
		GUID:     id,
		RemoteID: id,
		Title:    strings.TrimSpace(it.Title),
		Author:   strings.TrimSpace(it.Author),
		Content:  it.Content.Content,
		Read:     it.has(stateRead),
		Starred:  it.has(stateStarred),
	}
	if si.Content == "" {
		si.Content = it.Summary.Content // FreshRSS sends the full text here
	}
	for _, l := range append(it.Canonical, it.Alternate...) {
		if l.Href != "" {
			si.URL = l.Href
			break
		}
	}
	switch {
	case it.Published > 0:
		si.PublishedAt = time.Unix(int64(it.Published), 0)
	case it.TimestampUsec > 0:
		si.PublishedAt = time.UnixMicro(int64(it.TimestampUsec))
	}
	if it.Updated > 0 {
		si.UpdatedAt = time.Unix(int64(it.Updated), 0)
	}
	return si
}

// push sends queued read/star changes, grouped into edit-tag calls.
func (b *Backend) push(ctx context.Context, c *Client) error {
	changes, err := b.store.PendingChanges(ctx, b.AccountID())
	if err != nil || len(changes) == 0 {
		return err
	}
	type group struct {
		flag  string
		value bool
	}
	groups := map[group][]store.Change{}
	for _, ch := range changes {
		g := group{ch.Flag, ch.Value}
		groups[g] = append(groups[g], ch)
	}
	for g, chs := range groups {
		tag := stateRead
		if g.flag == store.FlagStarred {
			tag = stateStarred
		}
		for len(chs) > 0 {
			n := min(len(chs), editBatch)
			batch := chs[:n]
			chs = chs[n:]
			ids := make([]string, n)
			for i, ch := range batch {
				ids[i] = ch.RemoteID
			}
			add, remove := tag, ""
			if !g.value {
				add, remove = "", tag
			}
			if err := c.EditTag(ctx, ids, add, remove); err != nil {
				if ferr := b.store.FailChanges(ctx, batch, err); ferr != nil {
					slog.Error("recording push failure", "err", ferr)
				}
				return err
			}
			if err := b.store.ClearChanges(ctx, batch); err != nil {
				return err
			}
		}
	}
	slog.Info("pushed changes", "account", b.AccountID(), "count", len(changes))
	return nil
}

// Verify checks that the configured credentials work.
func Verify(ctx context.Context, cfg config.FreshRSS, password string) error {
	c := NewClient(cfg.URL, cfg.Username, password)
	if err := c.Login(ctx); err != nil {
		return err
	}
	_, err := c.Subscriptions(ctx)
	return err
}
