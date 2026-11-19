package tui

import (
	"context"
	"image"
	"image/color"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	uv "github.com/charmbracelet/ultraviolet"

	"tuirss/internal/store"
)

func solid(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{30, 120, 200, 255})
		}
	}
	return img
}

// setupImages opens a local article containing a 400×300 image in a sixel
// terminal with 10×20 pixel cells.
func setupImages(t *testing.T) (*Model, string) {
	t.Helper()
	m, st := setup(t)
	ctx := context.Background()
	f, err := st.AddFeed(ctx, store.Feed{AccountID: "local", URL: "https://comics.example/feed", Title: "Comics"})
	if err != nil {
		t.Fatal(err)
	}
	src := "https://comics.example/strip.png"
	st.UpsertItems(ctx, f.ID, []store.Item{{
		GUID: "c1", Title: "Today's strip", URL: "https://comics.example/1", PublishedAt: time.Now().Add(time.Hour),
		Content: `<p>Intro text.</p><p><img src="` + src + `" alt="strip"></p><img src="https://comics.example/pixel.gif">` +
			"<p>" + strings.Repeat("After the comic there is a lot of text. ", 120) + "</p>",
	}})
	m.gfx.cache.Put(src, solid(400, 300), nil)
	m.gfx.cache.Put("https://comics.example/pixel.gif", solid(1, 1), nil)

	m.Update(uv.PrimaryDeviceAttributesEvent{62, 4, 22})
	m.Update(uv.CellSizeEvent{Width: 10, Height: 20})
	if !m.gfx.enabled() {
		t.Fatal("sixel + cell size should enable images")
	}
	press(m, "]") // Local; the comic is the newest item
	press(m, "j")
	if m.open == nil || m.open.Title != "Today's strip" {
		t.Fatalf("opened %+v", m.open)
	}
	return m, src
}

func TestImagePlacementAndScroll(t *testing.T) {
	m, src := setupImages(t)
	if len(m.gfx.place) != 1 {
		t.Fatalf("placements = %+v", m.gfx.place)
	}
	p := m.gfx.place[0]
	// 140-wide terminal: the measure fits 400px (40 cells) without scaling.
	if p.src != src || p.w != 400 || p.h != 300 || p.rows != 15 || p.cols != 40 {
		t.Fatalf("placement = %+v", p)
	}
	jobs := m.desiredImages()
	if len(jobs) != 1 || jobs[0].n != 15 || jobs[0].py0 != 0 || jobs[0].py1 != 300 {
		t.Fatalf("jobs = %+v", jobs)
	}
	l := m.layout()
	if jobs[0].x != l.sideW+1+l.listW+1+readerPad {
		t.Errorf("x = %d", jobs[0].x)
	}

	// Scroll so the top 5 rows of the image are above the pane: crop them.
	m.reader.SetYOffset(p.line + 5)
	jobs = m.desiredImages()
	if len(jobs) != 1 || jobs[0].y != 1 || jobs[0].n != 10 || jobs[0].py0 != 100 || jobs[0].py1 != 300 {
		t.Errorf("cropped job = %+v", jobs)
	}
	m.reader.SetYOffset(p.line + p.rows + 3)
	if jobs := m.desiredImages(); len(jobs) != 0 {
		t.Errorf("scrolled past: %+v", jobs)
	}
}

func TestImagePassDrawsAndHides(t *testing.T) {
	m, _ := setupImages(t)
	m.Update(imagePassMsg{seq: m.gfx.seq})
	// imagePass queued an encode command; run it.
	var draw imageDrawMsg
	for _, c := range m.cmds {
		if msg, ok := c().(imageDrawMsg); ok {
			draw = msg
		}
	}
	if draw.out == "" {
		t.Fatal("no draw produced")
	}
	if !strings.HasPrefix(draw.out, "\x1b7") || !strings.HasSuffix(draw.out, "\x1b8") || !strings.Contains(draw.out, "\x1bP0;1q") {
		t.Errorf("draw should be a cursor-saved sixel: %q…", draw.out[:min(40, len(draw.out))])
	}
	m.Update(draw)
	if len(m.gfx.drawn) != 1 || m.gfx.drawn[0].w != 40 || m.gfx.drawn[0].h != 15 {
		t.Fatalf("drawn = %+v", m.gfx.drawn)
	}

	// A stale draw (from before a change) is ignored.
	m.gfx.seq++
	m.Update(imageDrawMsg{seq: m.gfx.seq - 1, drawn: nil})
	if len(m.gfx.drawn) != 1 {
		t.Error("stale draw should be ignored")
	}

	// Opening help hides images: the pass erases the old rect.
	press(m, "?")
	if jobs := m.desiredImages(); len(jobs) != 0 {
		t.Error("no images under an overlay")
	}
	m.Update(imagePassMsg{seq: m.gfx.seq})
	for _, c := range m.cmds {
		if msg, ok := c().(imageDrawMsg); ok {
			draw = msg
		}
	}
	if strings.Contains(draw.out, "\x1bP") || !strings.Contains(draw.out, "\x1b[0m ") {
		t.Errorf("overlay pass should only erase: %q", draw.out[:min(80, len(draw.out))])
	}
}

func TestEraseOnlyBlankCells(t *testing.T) {
	frame := []string{
		"header",
		"0123456789",
		"01  456 89",
	}
	got := eraseSeq(frame, []cellRect{{x: 2, y: 1, w: 6, h: 2}})
	// Row 1 is all text: nothing. Row 2: cols 2-3 blank, then 7 blank.
	want := "\x1b[3;3H\x1b[0m  \x1b[3;8H\x1b[0m "
	if got != want {
		t.Errorf("erase = %q, want %q", got, want)
	}
}

func TestNoSixelNoImages(t *testing.T) {
	m, _ := setup(t)
	m.Update(uv.PrimaryDeviceAttributesEvent{62, 22}) // no 4
	m.Update(uv.CellSizeEvent{Width: 10, Height: 20})
	if m.gfx.enabled() {
		t.Fatal("images need sixel support")
	}
	press(m, "j")
	if m.imageFunc(80, 30, "") != nil || len(m.desiredImages()) != 0 {
		t.Error("nothing should be placed without sixel")
	}
	_ = tea.KeyPressMsg{}
}

func TestImageOnlyArticle(t *testing.T) {
	m, st := setup(t)
	ctx := context.Background()
	f, err := st.AddFeed(ctx, store.Feed{AccountID: "local", URL: "https://comic-only.example/feed", Title: "Comic only"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.UpsertItems(ctx, f.ID, []store.Item{{
		GUID: "x", Title: "Voyager Crash", URL: "https://xkcd.example/1", PublishedAt: time.Now().Add(time.Hour),
		Summary: `<img src="https://imgs.xkcd.example/voyager.png" title="Hover joke here." alt="Voyager Crash" />`,
	}})
	if err != nil {
		t.Fatal(err)
	}
	press(m, "]", "j")
	out := checkView(t, m)
	if strings.Contains(out, "didn't include the article text") || strings.Contains(out, "looks like a summary") {
		t.Errorf("a comic is content, not a teaser:\n%s", out)
	}
	if !strings.Contains(out, "▣ Voyager Crash") || !strings.Contains(out, "Hover joke here.") {
		t.Errorf("want placeholder and caption:\n%s", out)
	}
}

func TestBogusCellSizeDisablesImages(t *testing.T) {
	m, _ := setup(t)
	m.Update(uv.PrimaryDeviceAttributesEvent{4})
	for _, sz := range []uv.CellSizeEvent{{Width: 0, Height: 0}, {Width: 1, Height: 1}, {Width: 500, Height: 900}} {
		m.Update(sz)
		if m.gfx.enabled() {
			t.Errorf("cell size %+v should not enable images", sz)
		}
	}
	m.Update(uv.CellSizeEvent{Width: 9, Height: 19})
	if !m.gfx.enabled() {
		t.Error("a normal cell size should")
	}
}
