package tui

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/brndnsh-labs/tuirss/internal/backend"
	"github.com/brndnsh-labs/tuirss/internal/store"
)

// fakeBackend owns an account but never touches the network.
type fakeBackend struct{ id, name string }

func (f fakeBackend) AccountID() string { return f.id }
func (f fakeBackend) Init(ctx context.Context) error {
	return nil
}
func (f fakeBackend) Sync(ctx context.Context, _ func(backend.Progress)) (backend.SyncResult, error) {
	return backend.SyncResult{}, nil
}

func setup(t *testing.T) (*Model, *store.Store) {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	for _, a := range []store.Account{
		{ID: "local", Kind: store.KindLocal, Name: "Local"},
		{ID: "freshrss:home", Kind: store.KindFreshRSS, Name: "rss.example"},
	} {
		if err := st.EnsureAccount(ctx, a); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	add := func(acct, folder, title string, n int) store.Feed {
		fid, _ := st.EnsureFolder(ctx, acct, folder)
		f, err := st.AddFeed(ctx, store.Feed{AccountID: acct, FolderID: fid, URL: "https://" + strings.ReplaceAll(title, " ", "") + ".example/feed", Title: title})
		if err != nil {
			t.Fatal(err)
		}
		var items []store.Item
		for i := 0; i < n; i++ {
			items = append(items, store.Item{
				GUID:        fmt.Sprintf("%s-%d", title, i),
				Title:       fmt.Sprintf("%s post %d with a reasonably long title that will need truncating", title, i),
				URL:         fmt.Sprintf("https://example.com/%s/%d", title, i),
				Content:     "<p>Hello <b>world</b>. " + strings.Repeat("Lorem ipsum dolor sit amet. ", 80) + "</p><p>Searchable zebra</p>",
				PublishedAt: now.Add(-time.Duration(i*7) * time.Hour),
			})
		}
		if _, err := st.UpsertItems(ctx, f.ID, items); err != nil {
			t.Fatal(err)
		}
		return f
	}
	add("local", "Tech", "LWN", 5)
	add("local", "Tech", "Go Blog", 3)
	add("local", "", "xkcd", 2)
	add("freshrss:home", "News", "Remote Feed", 4)

	m := New(ctx, Options{Store: st, Backends: []backend.Backend{
		fakeBackend{id: "local"}, fakeBackend{id: "freshrss:home"},
	}})
	m.Init()
	m.Update(tea.WindowSizeMsg{Width: 140, Height: 40})
	return m, st
}

func press(m *Model, keys ...string) {
	for _, k := range keys {
		var msg tea.KeyPressMsg
		switch k {
		case "space":
			msg = tea.KeyPressMsg{Code: tea.KeySpace, Text: " "}
		case "enter":
			msg = tea.KeyPressMsg{Code: tea.KeyEnter}
		case "esc":
			msg = tea.KeyPressMsg{Code: tea.KeyEscape}
		default:
			r := []rune(k)[0]
			msg = tea.KeyPressMsg{Code: r, Text: k}
		}
		m.Update(msg)
		settleScroll(m)
	}
}

// settleScroll runs animation frames until any reader scroll finishes, like a
// person waiting a moment between keys.
func settleScroll(m *Model) {
	for i := 0; i < 200 && m.scroll.active; i++ {
		m.Update(animMsg{})
	}
}

func checkView(t *testing.T, m *Model) string {
	t.Helper()
	out := m.View().Content
	lines := strings.Split(out, "\n")
	if len(lines) != m.height {
		t.Errorf("%dx%d: view has %d lines", m.width, m.height, len(lines))
	}
	for i, l := range lines {
		if w := ansi.StringWidth(l); w > m.width {
			t.Errorf("%dx%d: line %d is %d wide: %q", m.width, m.height, i, w, ansi.Strip(l))
		}
	}
	return ansi.Strip(out)
}

func TestStartsOnSyncedAccountAllArticles(t *testing.T) {
	m, _ := setup(t)
	if m.account().ID != "freshrss:home" {
		t.Errorf("first account = %s, want the synced account first", m.account().ID)
	}
	if m.view.kind != sideAll || len(m.items) != 4 {
		t.Errorf("view=%v items=%d", m.view, len(m.items))
	}
	out := checkView(t, m)
	for _, want := range []string{"tuirss", "rss.example", "Local", "All articles", "News", "Remote Feed", "TODAY", "4 unread"} {
		if !strings.Contains(out, want) {
			t.Errorf("view missing %q", want)
		}
	}
}

func TestReadingFlow(t *testing.T) {
	m, st := setup(t)
	press(m, "]") // Local
	if m.account().ID != "local" || len(m.items) != 10 {
		t.Fatalf("account=%s items=%d", m.account().ID, len(m.items))
	}

	press(m, "j") // opens the first item
	if m.open == nil || m.open.ID != m.items[0].ID || !m.items[0].Read {
		t.Fatalf("j should open and mark read the first item: %+v", m.open)
	}
	press(m, "j", "j")
	if m.cursor != 2 || m.open.ID != m.items[2].ID {
		t.Fatalf("cursor=%d", m.cursor)
	}
	press(m, "k")
	if m.cursor != 1 {
		t.Fatalf("k: cursor=%d", m.cursor)
	}
	// read items stay in the unread list until it's reloaded
	if len(m.items) != 10 {
		t.Errorf("list shrank to %d", len(m.items))
	}
	unread := m.unreadByAcct["local"]
	if unread != 7 {
		t.Errorf("unread = %d, want 7", unread)
	}

	press(m, "s")
	it, _ := st.Item(context.Background(), m.items[1].ID)
	if !it.Starred || !m.open.Starred {
		t.Error("s should star the item")
	}
	press(m, "m")
	if it, _ := st.Item(context.Background(), m.items[1].ID); it.Read {
		t.Error("m should toggle read off")
	}

	// space pages through the long article before moving on
	press(m, "space")
	if m.cursor != 1 || m.reader.YOffset() == 0 {
		t.Errorf("space should scroll: cursor=%d y=%d", m.cursor, m.reader.YOffset())
	}
	for i := 0; i < 50 && m.cursor == 1; i++ {
		press(m, "space")
	}
	if m.cursor != 2 {
		t.Errorf("space at the bottom should open the next article, cursor=%d", m.cursor)
	}
	checkView(t, m)

	press(m, "esc")
	if m.open != nil {
		t.Error("esc should close the reader")
	}
}

func TestSidebarNavigationAndAccounts(t *testing.T) {
	m, _ := setup(t)
	press(m, "]") // Local: Starred, All, Tech, Go Blog, LWN, xkcd
	press(m, "J")
	if m.view.kind != sideFolder || m.view.title != "Tech" || len(m.items) != 8 {
		t.Fatalf("J → %+v (%d items)", m.view, len(m.items))
	}
	press(m, "J")
	if m.view.kind != sideFeed || m.view.title != "Go Blog" || len(m.items) != 3 {
		t.Fatalf("J → %+v (%d items)", m.view, len(m.items))
	}
	out := checkView(t, m)
	if !strings.Contains(out, "Local › Tech › Go Blog") {
		t.Errorf("breadcrumb missing:\n%s", out)
	}

	// accounts remember their place
	press(m, "]")
	if m.account().ID != "freshrss:home" || m.view.kind != sideAll {
		t.Fatalf("back on first account: %s %+v", m.account().ID, m.view)
	}
	press(m, "[")
	if m.view.title != "Go Blog" {
		t.Errorf("Local should restore Go Blog, got %+v", m.view)
	}

	press(m, "g", "s")
	if m.view.kind != sideStarred {
		t.Errorf("g s → %+v", m.view)
	}
	press(m, "g", "a")
	if m.view.kind != sideAll {
		t.Errorf("g a → %+v", m.view)
	}

	// collapse the folder
	press(m, "J")
	press(m, "x")
	if !m.side[m.sideCursor].collapsed || len(m.side) != 4 {
		t.Errorf("collapse: %+v", m.side)
	}
}

func TestPickerAndSearch(t *testing.T) {
	m, _ := setup(t)
	press(m, "]", "g", "u")
	if m.overlay != overlayPicker {
		t.Fatal("g u should open the picker")
	}
	checkView(t, m)
	press(m, "x", "k", "c", "d", "enter")
	if m.overlay != overlayNone || m.view.title != "xkcd" {
		t.Fatalf("picker → %+v", m.view)
	}

	press(m, "/")
	press(m, "z", "e", "b", "r", "a")
	if m.query != "zebra" || len(m.items) != 10 {
		t.Fatalf("search zebra: query=%q items=%d", m.query, len(m.items))
	}
	press(m, "enter")
	if m.searching {
		t.Error("enter should leave the search box")
	}
	out := checkView(t, m)
	if !strings.Contains(out, "10 results") {
		t.Errorf("header should show result count")
	}
	press(m, "esc")
	if m.query != "" || m.view.title != "xkcd" {
		t.Errorf("esc should restore xkcd, got query=%q view=%+v", m.query, m.view)
	}
}

func TestMarkAllReadConfirms(t *testing.T) {
	m, _ := setup(t)
	press(m, "A")
	if m.confirm == nil {
		t.Fatal("A should ask first")
	}
	press(m, "n")
	if m.unreadByAcct["freshrss:home"] != 4 {
		t.Fatal("n should cancel")
	}
	press(m, "A", "y")
	if m.unreadByAcct["freshrss:home"] != 0 {
		t.Errorf("unread after A y = %d", m.unreadByAcct["freshrss:home"])
	}
	press(m, "t")
	if m.unreadOnly || len(m.items) != 4 {
		t.Errorf("t should show all: %v %d", m.unreadOnly, len(m.items))
	}
}

func TestLayoutsAtManySizes(t *testing.T) {
	m, _ := setup(t)
	press(m, "]")
	for _, size := range [][2]int{{200, 50}, {140, 40}, {120, 30}, {100, 30}, {80, 24}, {60, 20}, {40, 12}} {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		press(m, "esc")
		checkView(t, m)
		press(m, "j")
		checkView(t, m)
		press(m, "f")
		checkView(t, m)
		press(m, "f", "?")
		checkView(t, m)
		press(m, "esc")
	}
}
