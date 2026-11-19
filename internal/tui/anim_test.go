package tui

import (
	"context"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/brndnsh-labs/tuirss/internal/backend"
	"github.com/brndnsh-labs/tuirss/internal/store"
)

func key(m *Model, k string) {
	msg := tea.KeyPressMsg{Code: []rune(k)[0], Text: k}
	if k == "space" {
		msg = tea.KeyPressMsg{Code: tea.KeySpace, Text: " "}
	}
	m.Update(msg)
}

func TestSmoothScroll(t *testing.T) {
	m, _ := setup(t)
	m.Update(tea.WindowSizeMsg{Width: 140, Height: 14})
	press(m, "]", "j") // a long article
	page := m.reader.Height()
	if m.maxScroll() < 2*page {
		t.Fatalf("test article too short: max scroll %d, page %d", m.maxScroll(), page)
	}

	key(m, "space")
	if !m.scroll.active || m.scroll.target != page || m.reader.YOffset() != 0 {
		t.Fatalf("space should start a glide to %d: %+v y=%d", page, m.scroll, m.reader.YOffset())
	}
	// Two quick presses add up: the second continues from the target.
	key(m, "space")
	if m.scroll.target != 2*page {
		t.Errorf("target = %d, want %d", m.scroll.target, 2*page)
	}

	frames, last, monotonic := 0, 0, true
	for m.scroll.active && frames < 200 {
		m.Update(animMsg{})
		frames++
		y := m.reader.YOffset()
		if y < last {
			monotonic = false // a critically damped spring never overshoots back
		}
		last = y
		if frames == 2 && (y == 0 || y >= 2*page) {
			t.Errorf("frame 2 should be mid-glide, y=%d", y)
		}
	}
	if m.reader.YOffset() != 2*page || !monotonic {
		t.Errorf("settled at %d (want %d), monotonic=%v", m.reader.YOffset(), 2*page, monotonic)
	}
	if frames < 4 || frames > 30 {
		t.Errorf("glide took %d frames; want a short, visible animation", frames)
	}
}

func TestSpaceAtBottomUsesTarget(t *testing.T) {
	m, _ := setup(t)
	press(m, "]", "j")
	start := m.cursor
	// Mash space: each press glides further; once the target reaches the
	// bottom, the next press moves to the next article even mid-glide.
	for i := 0; i < 60 && m.cursor == start; i++ {
		key(m, "space")
		m.Update(animMsg{})
	}
	if m.cursor != start+1 {
		t.Fatalf("space at the bottom should open the next article (cursor %d)", m.cursor)
	}
	if m.scroll.active || m.reader.YOffset() != 0 {
		t.Errorf("a new article starts at the top, not mid-glide: %+v y=%d", m.scroll, m.reader.YOffset())
	}
}

func TestReducedMotionJumps(t *testing.T) {
	m, _ := setup(t)
	m.animate = false
	m.Update(tea.WindowSizeMsg{Width: 140, Height: 14})
	press(m, "]", "j")
	key(m, "space")
	if m.scroll.active || m.reader.YOffset() != min(m.reader.Height(), m.maxScroll()) {
		t.Errorf("without animations space should jump: %+v y=%d", m.scroll, m.reader.YOffset())
	}
}

// arrivingBackend adds a new article to a feed each time it syncs.
type arrivingBackend struct {
	st     *store.Store
	feedID int64
	n      int
}

func (b *arrivingBackend) AccountID() string              { return "local" }
func (b *arrivingBackend) Init(ctx context.Context) error { return nil }
func (b *arrivingBackend) Sync(ctx context.Context, _ func(backend.Progress)) (backend.SyncResult, error) {
	b.n++
	added, err := b.st.UpsertItems(ctx, b.feedID, []store.Item{{
		GUID: "arrival-" + string(rune('a'+b.n)), Title: "Breaking: something new", PublishedAt: time.Now().Add(time.Hour),
	}})
	return backend.SyncResult{NewItems: added}, err
}

// finishSync feeds the running sync's messages to the model until it's done.
func finishSync(t *testing.T, m *Model) {
	t.Helper()
	for m.syncing {
		select {
		case msg := <-m.syncCh:
			m.Update(msg)
		case <-time.After(5 * time.Second):
			t.Fatal("sync never finished")
		}
	}
}

func runSync(t *testing.T, m *Model) {
	t.Helper()
	finishSync(t, m) // the startup sync from Init
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	if !m.syncing {
		t.Fatal("r should start a sync")
	}
	finishSync(t, m)
}

func TestArrivalsPulseAndCountUp(t *testing.T) {
	m, st := setup(t)
	feeds, _ := st.Feeds(context.Background(), "local")
	ab := &arrivingBackend{st: st, feedID: feeds[0].ID}
	m.backends = []backend.Backend{ab}
	press(m, "]") // Local, 10 unread
	clock := time.Now()
	m.now = func() time.Time { return clock }

	runSync(t, m)
	if len(m.fresh) != 1 {
		t.Fatalf("fresh = %v", m.fresh)
	}
	if m.items[0].Title != "Breaking: something new" {
		t.Fatalf("new article should be at the top: %q", m.items[0].Title)
	}
	if _, ok := m.fresh[m.items[0].ID]; !ok {
		t.Error("the new article should be the fresh one")
	}
	out := checkView(t, m)
	if !strings.Contains(out, "◉ Breaking") && !strings.Contains(out, "✦ Breaking") {
		t.Errorf("new article should pulse:\n%s", out)
	}
	// Counts start at the old value and count up.
	if got := m.count("a:local", m.unreadByAcct["local"]); got != 10 {
		t.Errorf("count at start = %d, want 10", got)
	}
	clock = clock.Add(countFor / 2)
	if got := m.count("a:local", 11); got < 10 || got > 11 {
		t.Errorf("count mid-way = %d", got)
	}

	clock = clock.Add(pulseFor)
	m.Update(animMsg{})
	if m.animating() {
		t.Errorf("animations should be done: fresh=%v tweens=%v", m.fresh, m.tweens)
	}
	if out := checkView(t, m); strings.Contains(out, "✦") || !strings.Contains(out, "● Breaking") {
		t.Errorf("after the pulse it's a normal unread article:\n%s", out)
	}
	if got := m.count("a:local", 11); got != 11 {
		t.Errorf("final count = %d", got)
	}
}

func TestFirstSyncDoesNotPulse(t *testing.T) {
	m, _ := setup(t)
	m.highlightArrivals(0, map[string]int{})
	if len(m.fresh) != 0 {
		t.Error("an empty database means everything is new: nothing should pulse")
	}
}
