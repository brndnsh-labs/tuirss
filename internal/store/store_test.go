package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func open(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, path
}

func seed(t *testing.T, s *Store) Feed {
	t.Helper()
	ctx := context.Background()
	if err := s.EnsureAccount(ctx, Account{ID: "local", Kind: KindLocal, Name: "Local"}); err != nil {
		t.Fatal(err)
	}
	folder, err := s.EnsureFolder(ctx, "local", "Tech")
	if err != nil {
		t.Fatal(err)
	}
	f, err := s.AddFeed(ctx, Feed{AccountID: "local", FolderID: folder, URL: "https://example.com/feed"})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestReopenIsIdempotent(t *testing.T) {
	s, path := open(t)
	seed(t, s)
	s.Close()
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	feeds, err := s2.Feeds(context.Background(), "local")
	if err != nil || len(feeds) != 1 {
		t.Fatalf("feeds = %v, %v", feeds, err)
	}
	if feeds[0].FolderName != "Tech" {
		t.Errorf("folder = %q", feeds[0].FolderName)
	}
}

func TestDuplicateFeed(t *testing.T) {
	s, _ := open(t)
	f := seed(t, s)
	_, err := s.AddFeed(context.Background(), Feed{AccountID: "local", URL: f.URL})
	if !errors.Is(err, ErrFeedExists) {
		t.Fatalf("got %v, want ErrFeedExists", err)
	}
}

func TestUpsertPreservesStateAndCountsNew(t *testing.T) {
	s, _ := open(t)
	ctx := context.Background()
	f := seed(t, s)
	day := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)

	n, err := s.UpsertItems(ctx, f.ID, []Item{
		{GUID: "a", Title: "A", PublishedAt: day},
		{GUID: "b", Title: "B", PublishedAt: day.Add(time.Hour)},
	})
	if err != nil || n != 2 {
		t.Fatalf("first upsert: n=%d err=%v", n, err)
	}

	items, _ := s.Items(ctx, ItemQuery{AccountID: "local"})
	if len(items) != 2 || items[0].GUID != "b" {
		t.Fatalf("want newest first, got %+v", items)
	}
	if err := s.SetRead(ctx, items[1].ID, true); err != nil {
		t.Fatal(err)
	}
	if err := s.SetStarred(ctx, items[1].ID, true); err != nil {
		t.Fatal(err)
	}

	// Same items again, one retitled, one new, one without a date.
	n, err = s.UpsertItems(ctx, f.ID, []Item{
		{GUID: "a", Title: "A (updated)"},
		{GUID: "b", Title: "B", PublishedAt: day.Add(time.Hour)},
		{GUID: "c", Title: "C"},
	})
	if err != nil || n != 1 {
		t.Fatalf("second upsert: n=%d err=%v", n, err)
	}
	a, err := s.Item(ctx, items[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	if a.Title != "A (updated)" || !a.Read || !a.Starred {
		t.Errorf("state lost on update: %+v", a)
	}
	if !a.PublishedAt.Equal(day) {
		t.Errorf("undated update clobbered published_at: %v", a.PublishedAt)
	}

	unread, _ := s.Items(ctx, ItemQuery{UnreadOnly: true})
	if len(unread) != 2 || unread[0].GUID != "c" {
		t.Errorf("unread = %+v", unread)
	}
	starred, _ := s.Items(ctx, ItemQuery{StarredOnly: true})
	if len(starred) != 1 || starred[0].GUID != "a" {
		t.Errorf("starred = %+v", starred)
	}
	feeds, _ := s.Feeds(ctx, "local")
	if feeds[0].UnreadCount != 2 {
		t.Errorf("unread count = %d", feeds[0].UnreadCount)
	}

	changed, err := s.MarkAllRead(ctx, ItemQuery{FeedID: f.ID})
	if err != nil || changed != 2 {
		t.Fatalf("MarkAllRead = %d, %v", changed, err)
	}
	if unread, _ := s.Items(ctx, ItemQuery{UnreadOnly: true}); len(unread) != 0 {
		t.Errorf("still unread: %+v", unread)
	}
}

func TestRecordFetch(t *testing.T) {
	s, _ := open(t)
	ctx := context.Background()
	f := seed(t, s)
	now := time.Now().Truncate(time.Second)

	if err := s.RecordFetch(ctx, f.ID, FetchState{FetchedAt: now, Title: "Example", ETag: `"v1"`}); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordFetch(ctx, f.ID, FetchState{FetchedAt: now, Err: errors.New("boom")}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Feed(ctx, f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Example" || got.ETag != `"v1"` || got.LastError != "boom" || !got.LastFetchedAt.Equal(now) {
		t.Errorf("got %+v", got)
	}

	if err := s.DeleteFeed(ctx, f.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Feed(ctx, f.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("after delete: %v", err)
	}
}

func TestSearch(t *testing.T) {
	s, _ := open(t)
	ctx := context.Background()
	f := seed(t, s)
	_, err := s.UpsertItems(ctx, f.ID, []Item{
		{GUID: "1", Title: "Kernel news", Content: "<p>The <b>scheduler</b> got faster</p>"},
		{GUID: "2", Title: "Café culture", Summary: "Espresso &amp; more"},
		{GUID: "3", Title: "Unrelated", Author: "Ada Lovelace"},
	})
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]int{
		"sched":           1, // prefix match into HTML body
		"cafe":            1, // diacritics folded
		"espresso":        1,
		"lovelace":        1, // author
		"kernel faster":   1, // all terms required
		"kernel espresso": 0,
		`"quoted" OR (`:   0, // FTS syntax is neutralized, not an error
	}
	for q, want := range cases {
		n, err := s.CountItems(ctx, ItemQuery{Search: q})
		if err != nil || n != want {
			t.Errorf("search %q = %d, %v; want %d", q, n, err, want)
		}
	}

	if err := s.DeleteFeed(ctx, f.ID); err != nil {
		t.Fatal(err)
	}
	var left int
	s.db.QueryRow(`SELECT COUNT(*) FROM items_fts`).Scan(&left)
	if left != 0 {
		t.Errorf("fts rows left after cascade delete: %d", left)
	}
}

func TestIncludeIDsAndUnreadCounts(t *testing.T) {
	s, _ := open(t)
	ctx := context.Background()
	f := seed(t, s)
	s.UpsertItems(ctx, f.ID, []Item{{GUID: "a"}, {GUID: "b"}, {GUID: "c"}})
	items, _ := s.Items(ctx, ItemQuery{})
	s.SetRead(ctx, items[0].ID, true)
	s.SetRead(ctx, items[1].ID, true)

	got, _ := s.Items(ctx, ItemQuery{UnreadOnly: true, IncludeIDs: []int64{items[0].ID}})
	if len(got) != 2 {
		t.Errorf("unread+included = %d, want 2", len(got))
	}
	unread, err := s.UnreadByAccount(ctx)
	if err != nil || unread["local"] != 1 {
		t.Errorf("UnreadByAccount = %v, %v", unread, err)
	}
}

func TestSearchBackfillOnUpgrade(t *testing.T) {
	s, _ := open(t)
	ctx := context.Background()
	f := seed(t, s)
	s.UpsertItems(ctx, f.ID, []Item{{GUID: "x", Title: "Backfilled words"}})
	// Simulate a v1 database: drop the index and forget migration 2.
	for _, q := range []string{`DROP TRIGGER items_fts_delete`, `DROP TABLE items_fts`, `DELETE FROM schema_migrations WHERE version = 2`} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.CountItems(ctx, ItemQuery{Search: "backfilled"}); n != 1 {
		t.Errorf("backfill missing: %d", n)
	}
}

func TestOutboxForSyncedAccounts(t *testing.T) {
	s, _ := open(t)
	ctx := context.Background()
	local := seed(t, s)
	s.UpsertItems(ctx, local.ID, []Item{{GUID: "l1"}})

	s.EnsureAccount(ctx, Account{ID: "freshrss:home", Kind: KindFreshRSS, Name: "Home"})
	ids, err := s.SyncFeeds(ctx, "freshrss:home", []RemoteFeed{
		{RemoteID: "feed/1", URL: "https://a.example/feed", Title: "A", Folder: "Tech", FolderRemoteID: "user/-/label/Tech"},
		{RemoteID: "feed/2", URL: "https://b.example/feed", Title: "B"},
	})
	if err != nil || len(ids) != 2 {
		t.Fatalf("SyncFeeds = %v, %v", ids, err)
	}
	s.UpsertItems(ctx, ids["feed/1"], []Item{
		{GUID: "r1", RemoteID: "r1"}, {GUID: "r2", RemoteID: "r2"}, {GUID: "r3", RemoteID: "r3", Starred: true},
	})
	byRemote := map[string]int64{}
	items, _ := s.Items(ctx, ItemQuery{AccountID: "freshrss:home"})
	for _, it := range items {
		byRemote[it.RemoteID] = it.ID
	}

	// Local-account changes never queue.
	litems, _ := s.Items(ctx, ItemQuery{AccountID: "local"})
	s.SetRead(ctx, litems[0].ID, true)

	s.SetRead(ctx, byRemote["r1"], true)
	s.SetRead(ctx, byRemote["r1"], false) // coalesces into one row
	s.SetStarred(ctx, byRemote["r2"], true)
	changes, _ := s.PendingChanges(ctx, "freshrss:home")
	if len(changes) != 2 || changes[0].Flag != FlagRead || changes[0].Value || changes[0].Version != 2 {
		t.Fatalf("changes = %+v", changes)
	}
	if all, _ := s.PendingChanges(ctx, "local"); len(all) != 0 {
		t.Fatalf("local queued changes: %+v", all)
	}

	// Server says r1, r2 unread and only r3 starred. Pending flags win.
	if err := s.ApplyRemoteState(ctx, "freshrss:home", []string{"r1", "r2"}, []string{"r3"}); err != nil {
		t.Fatal(err)
	}
	get := func(r string) Item { it, _ := s.Item(ctx, byRemote[r]); return it }
	if r2 := get("r2"); !r2.Starred || r2.Read {
		t.Errorf("r2 should keep its pending star: %+v", r2)
	}
	if r3 := get("r3"); !r3.Read || !r3.Starred {
		t.Errorf("r3 should become read (not in unread set): %+v", r3)
	}

	// A change made during a push survives ClearChanges.
	s.SetStarred(ctx, byRemote["r2"], false)
	if err := s.ClearChanges(ctx, changes); err != nil {
		t.Fatal(err)
	}
	left, _ := s.PendingChanges(ctx, "freshrss:home")
	if len(left) != 1 || left[0].Flag != FlagStarred || left[0].Value {
		t.Errorf("left = %+v", left)
	}

	// MarkAllRead queues every item it touched.
	n, err := s.MarkAllRead(ctx, ItemQuery{AccountID: "freshrss:home"})
	if err != nil || n != 2 {
		t.Fatalf("MarkAllRead = %d, %v", n, err)
	}
	left, _ = s.PendingChanges(ctx, "freshrss:home")
	if len(left) != 3 {
		t.Errorf("after mark all: %+v", left)
	}

	// Feeds removed on the server disappear with their items and changes.
	ids, err = s.SyncFeeds(ctx, "freshrss:home", []RemoteFeed{{RemoteID: "feed/2", URL: "https://b.example/feed", Title: "B renamed"}})
	if err != nil {
		t.Fatal(err)
	}
	feeds, _ := s.Feeds(ctx, "freshrss:home")
	if len(feeds) != 1 || feeds[0].Title != "B renamed" {
		t.Errorf("feeds = %+v", feeds)
	}
	if left, _ := s.PendingChanges(ctx, "freshrss:home"); len(left) != 0 {
		t.Errorf("changes for deleted items remain: %+v", left)
	}
	if f, _ := s.Folders(ctx, "freshrss:home"); len(f) != 0 {
		t.Errorf("empty folder should be removed: %+v", f)
	}
}

func TestFullContent(t *testing.T) {
	s, _ := open(t)
	ctx := context.Background()
	f := seed(t, s)
	s.UpsertItems(ctx, f.ID, []Item{{GUID: "a", Title: "Teaser", Summary: "short"}})
	items, _ := s.Items(ctx, ItemQuery{})
	id := items[0].ID

	if err := s.SetFullContent(ctx, id, "", errors.New("403")); err != nil {
		t.Fatal(err)
	}
	if it, _ := s.Item(ctx, id); it.FullError != "403" || it.FullContent != "" {
		t.Errorf("after failure: %+v", it)
	}
	if err := s.SetFullContent(ctx, id, "<p>The whole story about pangolins</p>", nil); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.CountItems(ctx, ItemQuery{Search: "pangolins"}); n != 1 {
		t.Error("full text should be searchable")
	}
	// A later feed refresh keeps the full text, and search still finds it.
	s.UpsertItems(ctx, f.ID, []Item{{GUID: "a", Title: "Teaser", Summary: "short v2"}})
	it, _ := s.Item(ctx, id)
	if it.FullContent == "" || it.FullError != "" {
		t.Errorf("refresh lost full text: %+v", it)
	}
	if n, _ := s.CountItems(ctx, ItemQuery{Search: "pangolins"}); n != 1 {
		t.Error("refresh dropped full text from the index")
	}

	if err := s.SetFeedFullText(ctx, f.ID, true); err != nil {
		t.Fatal(err)
	}
	if it, _ := s.Item(ctx, id); !it.FeedFullText {
		t.Error("item should report the feed's full-text preference")
	}
	if feeds, _ := s.Feeds(ctx, "local"); !feeds[0].FullText {
		t.Error("feed should report full text on")
	}
}
