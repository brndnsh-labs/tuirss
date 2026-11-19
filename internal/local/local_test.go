package local

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/brndnsh-labs/tuirss/internal/backend"
	"github.com/brndnsh-labs/tuirss/internal/opml"
	"github.com/brndnsh-labs/tuirss/internal/store"
)

const rssV1 = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test Blog</title><link>https://blog.example/</link>
  <item><guid>post-1</guid><title>First</title><link>/posts/1</link>
        <pubDate>Mon, 02 Nov 2026 10:00:00 +0000</pubDate><description>one</description></item>
  <item><title>No GUID</title><link>https://blog.example/posts/2</link>
        <pubDate>Tue, 03 Nov 2026 10:00:00 +0000</pubDate></item>
</channel></rss>`

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Site</title><link href="https://atom.example/"/>
  <entry><id>tag:atom.example,2026:1</id><title>Hello</title>
         <author><name>Ada</name></author>
         <updated>2026-11-04T10:00:00Z</updated><content type="html">&lt;p&gt;hi&lt;/p&gt;</content></entry>
</feed>`

type fakeServer struct {
	*httptest.Server
	rssHits atomic.Int32
	rssBody atomic.Value // string
}

func newServer(t *testing.T) *fakeServer {
	fs := &fakeServer{}
	fs.rssBody.Store(rssV1)
	mux := http.NewServeMux()
	mux.HandleFunc("/rss", func(w http.ResponseWriter, r *http.Request) {
		fs.rssHits.Add(1)
		body := fs.rssBody.Load().(string)
		etag := fmt.Sprintf(`"%d"`, len(body))
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprint(w, body)
	})
	mux.HandleFunc("/atom", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/atom+xml")
		fmt.Fprint(w, atom)
	})
	mux.HandleFunc("/page", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, `<!doctype html><html><head><title>Site</title>
			<link rel="stylesheet" href="/style.css">
			<link rel="alternate" type="application/atom+xml" title="Feed" href="/atom">
			</head><body>hi</body></html>`)
	})
	mux.HandleFunc("/plain", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><body>no feeds here</body></html>`)
	})
	mux.HandleFunc("/broken", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	})
	fs.Server = httptest.NewServer(mux)
	t.Cleanup(fs.Close)
	return fs
}

func newBackend(t *testing.T) (*Backend, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	b := New(st, NewFetcher(5*time.Second), 4)
	b.now = func() time.Time { return time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC) }
	if err := b.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	return b, st
}

func TestSubscribeDirectFeed(t *testing.T) {
	srv := newServer(t)
	b, st := newBackend(t)
	ctx := context.Background()

	f, n, err := b.Subscribe(ctx, srv.URL+"/rss", "Blogs")
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 || f.Title != "Test Blog" || f.FolderName != "Blogs" {
		t.Fatalf("feed=%+v n=%d", f, n)
	}
	items, _ := st.Items(ctx, store.ItemQuery{FeedID: f.ID})
	if len(items) != 2 {
		t.Fatalf("items = %d", len(items))
	}
	// Newest first; GUID falls back to link; relative link resolved against site.
	if items[0].GUID != "https://blog.example/posts/2" {
		t.Errorf("fallback guid = %q", items[0].GUID)
	}
	if items[1].URL != "https://blog.example/posts/1" {
		t.Errorf("resolved link = %q", items[1].URL)
	}

	if _, _, err := b.Subscribe(ctx, srv.URL+"/rss", ""); !errors.Is(err, store.ErrFeedExists) {
		t.Errorf("duplicate subscribe: %v", err)
	}
}

func TestSubscribeDiscoversFromPage(t *testing.T) {
	srv := newServer(t)
	b, st := newBackend(t)
	ctx := context.Background()

	f, n, err := b.Subscribe(ctx, srv.URL+"/page", "")
	if err != nil {
		t.Fatal(err)
	}
	if f.URL != srv.URL+"/atom" || f.Title != "Atom Site" || n != 1 {
		t.Fatalf("feed=%+v n=%d", f, n)
	}
	items, _ := st.Items(ctx, store.ItemQuery{FeedID: f.ID})
	if items[0].Author != "Ada" || !strings.Contains(items[0].Content, "<p>hi</p>") {
		t.Errorf("item = %+v", items[0])
	}

	if _, _, err := b.Subscribe(ctx, srv.URL+"/plain", ""); !errors.Is(err, ErrNotAFeed) {
		t.Errorf("page without feed: %v", err)
	}
}

func TestSyncConditionalAndErrors(t *testing.T) {
	srv := newServer(t)
	b, st := newBackend(t)
	ctx := context.Background()

	added, skipped, err := b.Import(ctx, []opml.Entry{
		{URL: srv.URL + "/rss", Folder: "Blogs"},
		{URL: srv.URL + "/atom"},
		{URL: srv.URL + "/broken"},
		{URL: srv.URL + "/rss"}, // duplicate
		{URL: "ftp://nope"},     // invalid
	})
	if err != nil || added != 3 || skipped != 2 {
		t.Fatalf("import: added=%d skipped=%d err=%v", added, skipped, err)
	}

	var calls atomic.Int32
	res, err := b.Sync(ctx, func(p backend.Progress) { calls.Add(1) })
	if err != nil {
		t.Fatal(err)
	}
	if res.Feeds != 3 || res.Updated != 2 || res.NewItems != 3 || len(res.Failed) != 1 || calls.Load() != 3 {
		t.Fatalf("first sync: %+v (progress calls %d)", res, calls.Load())
	}

	// Unchanged feed → 304, no new items.
	res, err = b.Sync(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.NotModified != 1 || res.NewItems != 0 {
		t.Fatalf("second sync: %+v", res)
	}

	// Feed gains an item.
	srv.rssBody.Store(strings.Replace(rssV1, "<item>", `<item><guid>post-3</guid><title>Third</title></item><item>`, 1))
	res, _ = b.Sync(ctx, nil)
	if res.NewItems != 1 {
		t.Fatalf("third sync: %+v", res)
	}

	feeds, _ := st.Feeds(ctx, AccountID)
	for _, f := range feeds {
		broken := strings.HasSuffix(f.URL, "/broken")
		if broken != (f.LastError != "") {
			t.Errorf("feed %s: last_error=%q", f.URL, f.LastError)
		}
		if strings.HasSuffix(f.URL, "/rss") && (f.Title != "Test Blog" || f.FolderName != "Blogs") {
			t.Errorf("rss feed = %+v", f)
		}
	}

	entries, err := b.Export(ctx)
	if err != nil || len(entries) != 3 {
		t.Fatalf("export: %v %v", entries, err)
	}
}

func TestNormalizeURL(t *testing.T) {
	for in, want := range map[string]string{
		"lwn.net":                 "https://lwn.net",
		" http://x.example/feed ": "http://x.example/feed",
		"https://a.example/?q=1":  "https://a.example/?q=1",
	} {
		if got, err := NormalizeURL(in); err != nil || got != want {
			t.Errorf("NormalizeURL(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "ftp://x", "https://"} {
		if _, err := NormalizeURL(bad); err == nil {
			t.Errorf("NormalizeURL(%q) should fail", bad)
		}
	}
}
