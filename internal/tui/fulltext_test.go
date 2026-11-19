package tui

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"

	"tuirss/internal/store"
)

type fakeExtractor struct {
	mu    sync.Mutex
	calls []string
	fail  map[string]bool
}

func (f *fakeExtractor) Extract(ctx context.Context, u string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, u)
	if f.fail[u] {
		return "", errors.New("the site returned 403 Forbidden")
	}
	return "<p>FULL TEXT of " + u + ": " + strings.Repeat("many words here ", 50) + "</p>", nil
}

func (f *fakeExtractor) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

// settleCmds runs cmd (and batches inside it), feeding full-text results back
// into the model. Timers (spinner, status) are abandoned rather than awaited.
func settleCmds(m *Model, cmd tea.Cmd) {
	if cmd == nil {
		return
	}
	done := make(chan tea.Msg, 1)
	go func() { done <- cmd() }()
	select {
	case msg := <-done:
		switch msg := msg.(type) {
		case tea.BatchMsg:
			for _, c := range msg {
				settleCmds(m, c)
			}
		case fullTextMsg:
			_, next := m.Update(msg)
			settleCmds(m, next)
		}
	case <-time.After(300 * time.Millisecond):
	}
}

func pressRun(m *Model, keys ...string) {
	for _, k := range keys {
		msg := tea.KeyPressMsg{Code: []rune(k)[0], Text: k}
		_, cmd := m.Update(msg)
		settleCmds(m, cmd)
	}
}

func setupFullText(t *testing.T) (*Model, *store.Store, *fakeExtractor) {
	t.Helper()
	m, st := setup(t)
	ctx := context.Background()
	f, err := st.AddFeed(ctx, store.Feed{AccountID: "local", URL: "https://teasers.example/feed", Title: "Teasers"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	var items []store.Item
	for i := 0; i < 3; i++ {
		items = append(items, store.Item{
			GUID: fmt.Sprint(i), Title: fmt.Sprintf("Teaser %d", i),
			URL:         fmt.Sprintf("https://teasers.example/%d", i),
			Summary:     "<p>Only a sentence. Read more…</p>",
			PublishedAt: now.Add(-time.Duration(i) * time.Minute),
		})
	}
	if _, err := st.UpsertItems(ctx, f.ID, items); err != nil {
		t.Fatal(err)
	}
	ex := &fakeExtractor{fail: map[string]bool{"https://teasers.example/2": true}}
	m.extractor = ex
	press(m, "]") // Local
	press(m, "g", "u")
	for _, r := range "teasers" {
		press(m, string(r))
	}
	press(m, "enter")
	if m.view.title != "Teasers" || len(m.items) != 3 {
		t.Fatalf("setup: view=%+v items=%d", m.view, len(m.items))
	}
	return m, st, ex
}

func TestFullTextToggle(t *testing.T) {
	m, st, ex := setupFullText(t)
	pressRun(m, "j")
	out := checkView(t, m)
	if !strings.Contains(out, "looks like a summary") || ex.count() != 0 {
		t.Fatalf("teaser should hint at e without fetching (calls=%d):\n%s", ex.count(), out)
	}

	pressRun(m, "e")
	out = checkView(t, m)
	if !strings.Contains(out, "FULL TEXT of https://teasers.example/0") || !strings.Contains(out, "full article from teasers.example") {
		t.Fatalf("e should show the full article:\n%s", out)
	}
	if it, _ := st.Item(context.Background(), m.open.ID); it.FullContent == "" {
		t.Error("full text should be cached in the store")
	}

	pressRun(m, "e")
	if out := checkView(t, m); strings.Contains(out, "FULL TEXT") {
		t.Error("second e should go back to the feed's text")
	}
	pressRun(m, "e")
	if ex.count() != 1 {
		t.Errorf("cached article was fetched again (%d calls)", ex.count())
	}
}

func TestFullTextPerFeed(t *testing.T) {
	m, st, ex := setupFullText(t)
	pressRun(m, "j", "E")
	feed, _ := st.Feed(context.Background(), m.open.FeedID)
	if !feed.FullText {
		t.Fatal("E should save the feed preference")
	}
	// Opening fetched item 0; read-ahead fetched item 1.
	if ex.count() != 2 {
		t.Errorf("calls after E = %v", ex.calls)
	}
	pressRun(m, "j")
	if out := checkView(t, m); !strings.Contains(out, "FULL TEXT of https://teasers.example/1") {
		t.Errorf("next article should already be full text:\n%s", out)
	}

	// Item 2's site refuses; we fall back to the feed text and say why.
	pressRun(m, "j")
	out := checkView(t, m)
	if !strings.Contains(out, "couldn't get the full article") || !strings.Contains(out, "Only a sentence") {
		t.Errorf("failure should fall back with a message:\n%s", out)
	}
	calls := ex.count()
	pressRun(m, "k", "j")
	if ex.count() != calls {
		t.Error("a failed article shouldn't be retried automatically")
	}
	pressRun(m, "e", "e") // explicit retry
	if ex.count() != calls+1 {
		t.Errorf("e should retry a failed extraction (calls %d → %d)", calls, ex.count())
	}

	pressRun(m, "E")
	if feed, _ := st.Feed(context.Background(), m.open.FeedID); feed.FullText {
		t.Error("second E should turn the preference off")
	}
}
