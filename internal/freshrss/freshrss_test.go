package freshrss

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/zalando/go-keyring"

	"tuirss/internal/backend"
	"tuirss/internal/config"
	"tuirss/internal/store"
)

// fakeServer is a small in-memory FreshRSS Google Reader API.
type fakeServer struct {
	*httptest.Server
	mu         sync.Mutex
	subs       []Subscription
	items      map[uint64]*fakeItem
	edits      int
	logins     int
	expireT    bool // next write gets "bad token"
	failWrites bool
}

type fakeItem struct {
	id      uint64
	feed    string
	title   string
	read    bool
	starred bool
}

const (
	fakeUser  = "alice"
	fakePass  = "api-pass"
	fakeAuth  = "alice/authtoken"
	fakeToken = "WRITETOKEN"
)

func newFake(t *testing.T) *fakeServer {
	f := &fakeServer{items: map[uint64]*fakeItem{}}
	sub := func(id, title, url, label string) Subscription {
		s := Subscription{ID: id, Title: title, URL: url, HTMLURL: strings.TrimSuffix(url, "/feed")}
		if label != "" {
			s.Categories = append(s.Categories, struct {
				ID    string `json:"id"`
				Label string `json:"label"`
			}{"user/-/label/" + label, label})
		}
		return s
	}
	f.subs = []Subscription{
		sub("feed/1", "Kernel News", "https://kernel.example/feed", "Tech"),
		sub("feed/2", "Cooking", "https://food.example/feed", ""),
	}
	base := uint64(1_700_000_000_000_000)
	for i := 0; i < 6; i++ {
		feed := "feed/1"
		if i >= 4 {
			feed = "feed/2"
		}
		f.items[base+uint64(i)] = &fakeItem{id: base + uint64(i), feed: feed, title: fmt.Sprintf("Post %d", i), read: i == 3}
	}
	f.items[base+3].starred = true // read but starred: still fetched

	mux := http.NewServeMux()
	p := "/api/greader.php"
	mux.HandleFunc(p+"/accounts/ClientLogin", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		f.mu.Lock()
		f.logins++
		f.mu.Unlock()
		if r.Form.Get("Email") != fakeUser || r.Form.Get("Passwd") != fakePass {
			http.Error(w, "Unauthorized!", http.StatusUnauthorized)
			return
		}
		fmt.Fprintf(w, "SID=%s\nLSID=null\nAuth=%s\n", fakeAuth, fakeAuth)
	})
	authed := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "GoogleLogin auth="+fakeAuth {
				http.Error(w, "Unauthorized!", http.StatusUnauthorized)
				return
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			h(w, r)
		}
	}
	mux.HandleFunc(p+"/reader/api/0/token", authed(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, fakeToken)
	}))
	mux.HandleFunc(p+"/reader/api/0/subscription/list", authed(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"subscriptions": f.subs})
	}))
	mux.HandleFunc(p+"/reader/api/0/stream/items/ids", authed(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		var ids []uint64
		for id, it := range f.items {
			switch q.Get("s") {
			case readingList:
				if q.Get("xt") == stateRead && it.read {
					continue
				}
			case stateStarred:
				if !it.starred {
					continue
				}
			}
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] > ids[j] })
		// two per page, to exercise continuation
		start, _ := strconv.Atoi(q.Get("c"))
		end := min(start+2, len(ids))
		refs := []map[string]string{}
		for _, id := range ids[start:end] {
			refs = append(refs, map[string]string{"id": strconv.FormatUint(id, 10)})
		}
		out := map[string]any{"itemRefs": refs}
		if end < len(ids) {
			out["continuation"] = strconv.Itoa(end)
		}
		json.NewEncoder(w).Encode(out)
	}))
	mux.HandleFunc(p+"/reader/api/0/stream/items/contents", authed(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		var items []map[string]any
		for _, raw := range r.Form["i"] {
			long, _ := NormalizeID(raw)
			it := f.items[idValue(long)]
			if it == nil {
				continue
			}
			cats := []string{readingList}
			if it.read {
				cats = append(cats, stateRead)
			}
			if it.starred {
				cats = append(cats, stateStarred)
			}
			items = append(items, map[string]any{
				"id":            long,
				"published":     1_763_000_000 + int64(it.id%100)*60,
				"timestampUsec": strconv.FormatUint(it.id, 10),
				"title":         it.title,
				"author":        "Ada",
				"canonical":     []map[string]string{{"href": "https://example.com/" + strconv.FormatUint(it.id, 10)}},
				"categories":    cats,
				"origin":        map[string]string{"streamId": it.feed},
				"summary":       map[string]string{"content": "<p>Body of " + it.title + "</p>"},
			})
		}
		json.NewEncoder(w).Encode(map[string]any{"items": items})
	}))
	mux.HandleFunc(p+"/reader/api/0/edit-tag", authed(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if f.expireT {
			f.expireT = false
			w.Header().Set("X-Reader-Google-Bad-Token", "true")
			http.Error(w, "Unauthorized!", http.StatusUnauthorized)
			return
		}
		if f.failWrites {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		if r.Form.Get("T") != fakeToken {
			http.Error(w, "bad T", http.StatusUnauthorized)
			return
		}
		f.edits++
		for _, raw := range r.Form["i"] {
			long, _ := NormalizeID(raw)
			it := f.items[idValue(long)]
			if it == nil {
				continue
			}
			for _, tag := range []struct {
				v   string
				val bool
			}{{r.Form.Get("a"), true}, {r.Form.Get("r"), false}} {
				switch tag.v {
				case stateRead:
					it.read = tag.val
				case stateStarred:
					it.starred = tag.val
				}
			}
		}
		fmt.Fprint(w, "OK")
	}))
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

func newTestBackend(t *testing.T, srv *fakeServer, password string) (*Backend, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	cfg := config.FreshRSS{Name: "Home", URL: srv.URL + "/", Username: fakeUser, PasswordCommand: "echo " + password}
	b := New(st, cfg)
	if err := b.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	return b, st
}

func byTitle(t *testing.T, st *store.Store) map[string]store.Item {
	t.Helper()
	items, err := st.Items(context.Background(), store.ItemQuery{AccountID: "freshrss:Home"})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]store.Item{}
	for _, it := range items {
		out[it.Title] = it
	}
	return out
}

func TestInitialSync(t *testing.T) {
	srv := newFake(t)
	b, st := newTestBackend(t, srv, fakePass)
	ctx := context.Background()

	var steps int
	res, err := b.Sync(ctx, func(p backend.Progress) { steps++ })
	if err != nil {
		t.Fatal(err)
	}
	// 5 unread + 1 read-but-starred
	if res.Feeds != 2 || res.NewItems != 6 || steps < 5 {
		t.Fatalf("res = %+v steps=%d", res, steps)
	}
	feeds, _ := st.Feeds(ctx, "freshrss:Home")
	if len(feeds) != 2 || feeds[0].Title != "Cooking" || feeds[1].FolderName != "Tech" || feeds[1].RemoteID != "feed/1" {
		t.Fatalf("feeds = %+v", feeds)
	}
	items := byTitle(t, st)
	p3 := items["Post 3"]
	if !p3.Read || !p3.Starred || p3.Author != "Ada" || p3.URL == "" || !strings.Contains(p3.Content, "Body of Post 3") {
		t.Errorf("Post 3 = %+v", p3)
	}
	if items["Post 0"].Read || items["Post 0"].PublishedAt.IsZero() {
		t.Errorf("Post 0 = %+v", items["Post 0"])
	}

	// Second sync fetches nothing new.
	res, err = b.Sync(ctx, nil)
	if err != nil || res.NewItems != 0 {
		t.Fatalf("second sync: %+v %v", res, err)
	}
	if srv.logins != 1 {
		t.Errorf("logins = %d, want the auth token reused", srv.logins)
	}
}

func TestPushAndReconcile(t *testing.T) {
	srv := newFake(t)
	b, st := newTestBackend(t, srv, fakePass)
	ctx := context.Background()
	if _, err := b.Sync(ctx, nil); err != nil {
		t.Fatal(err)
	}
	items := byTitle(t, st)

	// Local changes queue, then push on the next sync (through an expired T token).
	st.SetRead(ctx, items["Post 0"].ID, true)
	st.SetStarred(ctx, items["Post 1"].ID, true)
	st.SetStarred(ctx, items["Post 3"].ID, false)
	srv.expireT = true
	if _, err := b.Sync(ctx, nil); err != nil {
		t.Fatal(err)
	}
	srv.mu.Lock()
	base := uint64(1_700_000_000_000_000)
	if !srv.items[base].read || !srv.items[base+1].starred || srv.items[base+3].starred {
		t.Errorf("server state after push: 0 read=%v, 1 starred=%v, 3 starred=%v",
			srv.items[base].read, srv.items[base+1].starred, srv.items[base+3].starred)
	}
	// Another device reads Post 2 and stars Post 5.
	srv.items[base+2].read = true
	srv.items[base+5].starred = true
	srv.mu.Unlock()
	if left, _ := st.PendingChanges(ctx, "freshrss:Home"); len(left) != 0 {
		t.Fatalf("outbox not empty: %+v", left)
	}

	// A local change while the server is down must survive the failed sync and
	// not be overwritten by the server's (stale) state.
	srv.failWrites = true
	st.SetRead(ctx, items["Post 4"].ID, true)
	if _, err := b.Sync(ctx, nil); err == nil {
		t.Fatal("expected push failure")
	}
	left, _ := st.PendingChanges(ctx, "freshrss:Home")
	if len(left) != 1 || left[0].Attempts != 1 {
		t.Fatalf("pending after failure = %+v", left)
	}

	srv.failWrites = false
	if _, err := b.Sync(ctx, nil); err != nil {
		t.Fatal(err)
	}
	items = byTitle(t, st)
	if !items["Post 2"].Read || !items["Post 5"].Starred || !items["Post 4"].Read {
		t.Errorf("reconcile: p2 read=%v p5 starred=%v p4 read=%v", items["Post 2"].Read, items["Post 5"].Starred, items["Post 4"].Read)
	}
	if srv.items[base+4].read != true {
		t.Error("Post 4 read never reached the server")
	}
}

func TestSubscriptionChangesAndBadLogin(t *testing.T) {
	srv := newFake(t)
	b, st := newTestBackend(t, srv, fakePass)
	ctx := context.Background()
	b.Sync(ctx, nil)

	srv.mu.Lock()
	srv.subs = srv.subs[:1] // unsubscribed from Cooking elsewhere
	srv.subs[0].Title = "Kernel News Weekly"
	srv.mu.Unlock()
	if _, err := b.Sync(ctx, nil); err != nil {
		t.Fatal(err)
	}
	feeds, _ := st.Feeds(ctx, "freshrss:Home")
	if len(feeds) != 1 || feeds[0].Title != "Kernel News Weekly" {
		t.Errorf("feeds = %+v", feeds)
	}

	bad, _ := newTestBackend(t, srv, "wrong")
	_, err := bad.Sync(ctx, nil)
	if !errors.Is(err, ErrBadLogin) || !strings.Contains(err.Error(), "tuirss login Home") {
		t.Errorf("bad login error = %v", err)
	}
}

func TestMissingPassword(t *testing.T) {
	srv := newFake(t)
	b, _ := newTestBackend(t, srv, fakePass)
	keyring.MockInit() // never touch the real keyring from tests
	b.secret.Command = ""
	b.secret.Account = "freshrss:test-missing-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	_, err := b.Sync(context.Background(), nil)
	if err == nil || !strings.Contains(err.Error(), "tuirss login") {
		t.Errorf("err = %v", err)
	}
}

func TestNormalizeID(t *testing.T) {
	for in, want := range map[string]string{
		"1700000000000000": "tag:google.com,2005:reader/item/00060a24181e4000",
		"tag:google.com,2005:reader/item/60a24181e4000": "tag:google.com,2005:reader/item/00060a24181e4000",
	} {
		if got, ok := NormalizeID(in); !ok || got != want {
			t.Errorf("NormalizeID(%q) = %q", in, got)
		}
	}
	if _, ok := NormalizeID("nope"); ok {
		t.Error("garbage should not normalize")
	}
}
