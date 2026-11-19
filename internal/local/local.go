package local

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/brndnsh-labs/tuirss/internal/backend"
	"github.com/brndnsh-labs/tuirss/internal/opml"
	"github.com/brndnsh-labs/tuirss/internal/store"
)

const AccountID = "local"

// Backend syncs feeds tuirss fetches directly from their publishers.
type Backend struct {
	store       *store.Store
	fetcher     *Fetcher
	concurrency int
	now         func() time.Time
}

var _ backend.Backend = (*Backend)(nil)

func New(st *store.Store, fetcher *Fetcher, concurrency int) *Backend {
	return &Backend{store: st, fetcher: fetcher, concurrency: max(concurrency, 1), now: time.Now}
}

func (b *Backend) AccountID() string { return AccountID }

func (b *Backend) Init(ctx context.Context) error {
	return b.store.EnsureAccount(ctx, store.Account{ID: AccountID, Kind: store.KindLocal, Name: "Local"})
}

type fetchResult struct {
	feed store.Feed
	resp Response
	err  error
}

// Sync fetches every feed concurrently. Network work happens in workers; all
// database writes happen on the calling goroutine, so SQLite sees one writer.
func (b *Backend) Sync(ctx context.Context, progress func(backend.Progress)) (backend.SyncResult, error) {
	feeds, err := b.store.Feeds(ctx, AccountID)
	if err != nil {
		return backend.SyncResult{}, err
	}
	res := backend.SyncResult{Feeds: len(feeds)}

	jobs := make(chan store.Feed)
	results := make(chan fetchResult)
	go func() {
		defer close(jobs)
		for _, f := range feeds {
			select {
			case jobs <- f:
			case <-ctx.Done():
				return
			}
		}
	}()
	var wg sync.WaitGroup
	for range min(b.concurrency, len(feeds)) {
		wg.Go(func() {
			for f := range jobs {
				resp, err := b.fetcher.Fetch(ctx, f.URL, f.ETag, f.LastModified)
				results <- fetchResult{feed: f, resp: resp, err: err}
			}
		})
	}
	go func() { wg.Wait(); close(results) }()

	done := 0
	for r := range results {
		done++
		b.apply(ctx, r, &res)
		if progress != nil {
			progress(backend.Progress{Done: done, Total: len(feeds), Current: r.feed.DisplayTitle()})
		}
	}
	return res, ctx.Err()
}

func (b *Backend) apply(ctx context.Context, r fetchResult, res *backend.SyncResult) {
	f := r.feed
	now := b.now()
	fail := func(err error) {
		if ctx.Err() != nil {
			return // cancelled, not the feed's fault
		}
		res.Failed = append(res.Failed, backend.FeedError{FeedID: f.ID, Title: f.DisplayTitle(), Err: err})
		slog.Warn("feed fetch failed", "feed", f.URL, "err", err)
		if err := b.store.RecordFetch(ctx, f.ID, store.FetchState{FetchedAt: now, Err: err}); err != nil {
			slog.Error("recording fetch failure", "feed", f.URL, "err", err)
		}
	}
	if r.err != nil {
		fail(r.err)
		return
	}
	st := store.FetchState{
		FetchedAt:    now,
		ETag:         firstNonEmpty(r.resp.ETag, f.ETag),
		LastModified: firstNonEmpty(r.resp.LastModified, f.LastModified),
	}
	if r.resp.NotModified {
		res.NotModified++
	} else {
		n, err := b.store.UpsertItems(ctx, f.ID, convertItems(r.resp.Feed, f.URL, now))
		if err != nil {
			fail(fmt.Errorf("saving items: %w", err))
			return
		}
		res.Updated++
		res.NewItems += n
		st.Title = strings.TrimSpace(r.resp.Feed.Title)
		st.SiteURL = r.resp.Feed.Link
	}
	if err := b.store.RecordFetch(ctx, f.ID, st); err != nil {
		slog.Error("recording fetch", "feed", f.URL, "err", err)
	}
}

// Subscribe adds a feed by URL (a feed or a page that links to one) and stores
// its current items. It returns the feed and how many items it had.
func (b *Backend) Subscribe(ctx context.Context, rawURL, folder string) (store.Feed, int, error) {
	u, err := NormalizeURL(rawURL)
	if err != nil {
		return store.Feed{}, 0, err
	}
	if f, err := b.store.FeedByURL(ctx, AccountID, u); err == nil {
		return f, 0, store.ErrFeedExists
	}
	resp, err := b.fetcher.Discover(ctx, u)
	if err != nil {
		return store.Feed{}, 0, err
	}
	folderID, err := b.store.EnsureFolder(ctx, AccountID, folder)
	if err != nil {
		return store.Feed{}, 0, err
	}
	f, err := b.store.AddFeed(ctx, store.Feed{
		AccountID:  AccountID,
		FolderID:   folderID,
		FolderName: strings.TrimSpace(folder),
		URL:        resp.URL,
		SiteURL:    resp.Feed.Link,
		Title:      strings.TrimSpace(resp.Feed.Title),
	})
	if errors.Is(err, store.ErrFeedExists) {
		existing, _ := b.store.FeedByURL(ctx, AccountID, resp.URL)
		return existing, 0, err
	}
	if err != nil {
		return f, 0, err
	}
	now := b.now()
	n, err := b.store.UpsertItems(ctx, f.ID, convertItems(resp.Feed, f.URL, now))
	if err != nil {
		return f, 0, err
	}
	err = b.store.RecordFetch(ctx, f.ID, store.FetchState{
		FetchedAt: now, Title: f.Title, SiteURL: f.SiteURL, ETag: resp.ETag, LastModified: resp.LastModified,
	})
	return f, n, err
}

// Import adds OPML entries without fetching them; call Sync afterwards.
func (b *Backend) Import(ctx context.Context, entries []opml.Entry) (added, skipped int, err error) {
	for _, e := range entries {
		u, err := NormalizeURL(e.URL)
		if err != nil {
			slog.Warn("skipping OPML entry", "url", e.URL, "err", err)
			skipped++
			continue
		}
		folderID, err := b.store.EnsureFolder(ctx, AccountID, e.Folder)
		if err != nil {
			return added, skipped, err
		}
		_, err = b.store.AddFeed(ctx, store.Feed{AccountID: AccountID, FolderID: folderID, URL: u, SiteURL: e.SiteURL, Title: e.Title})
		switch {
		case errors.Is(err, store.ErrFeedExists):
			skipped++
		case err != nil:
			return added, skipped, err
		default:
			added++
		}
	}
	return added, skipped, nil
}

// Export returns the local subscriptions as OPML entries.
func (b *Backend) Export(ctx context.Context) ([]opml.Entry, error) {
	feeds, err := b.store.Feeds(ctx, AccountID)
	if err != nil {
		return nil, err
	}
	out := make([]opml.Entry, len(feeds))
	for i, f := range feeds {
		out[i] = opml.Entry{Title: f.Title, URL: f.URL, SiteURL: f.SiteURL, Folder: f.FolderName}
	}
	return out, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
