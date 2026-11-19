package tui

import (
	"fmt"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	uv "github.com/charmbracelet/ultraviolet"
	"github.com/charmbracelet/x/ansi"

	"github.com/brndnsh-labs/tuirss/internal/images"
	"github.com/brndnsh-labs/tuirss/internal/render"
)

// Inline images are drawn as sixel graphics outside Bubble Tea's renderer,
// which only knows about text cells. The article reserves blank lines for
// each image; a short while after the screen settles, an "image pass" draws
// the visible part of each image into its blank lines, and wipes leftovers
// from the previous pass (only over cells that are blank in the current
// frame, so text is never disturbed). Writes are bracketed by DECSC/DECRC so
// the renderer's idea of the cursor stays correct.

const imagePassDelay = 40 * time.Millisecond

type gfxState struct {
	disabled     bool // by the user (TUIRSS_IMAGES=0)
	sixel        bool // the terminal said it supports sixel
	cellW, cellH int  // cell size in pixels, from the terminal
	cache        *images.Cache
	loading      map[string]bool
	sem          chan struct{} // bounds concurrent downloads
	place        []imgPlace    // in article lines, from the last render
	drawn        []cellRect    // what's on screen from the last pass
	sig          string
	seq          int
}

type imgPlace struct {
	line, rows, cols int
	src              string
	w, h             int // scaled size in pixels
}

type cellRect struct{ x, y, w, h int }

type drawJob struct {
	src           string
	w, h          int // scaled image size
	py0, py1      int // visible pixel rows
	x, y, cols, n int // screen cell position, width, visible rows
}

type (
	imageLoadedMsg struct{ src string }
	imagePassMsg   struct{ seq int }
	imageDrawMsg   struct {
		seq   int
		out   string
		drawn []cellRect
	}
)

func newGfx(disabled bool) gfxState {
	return gfxState{
		disabled: disabled,
		cache:    images.NewCache(24),
		loading:  map[string]bool{},
		sem:      make(chan struct{}, 4),
	}
}

func (g *gfxState) enabled() bool {
	// Sanity-check the reported cell size; a bogus reply would reserve
	// absurd amounts of space.
	return !g.disabled && g.sixel && g.cellW >= 4 && g.cellW <= 100 && g.cellH >= 8 && g.cellH <= 200
}

// queryTerminal asks whether sixel is supported and how big a cell is.
func (m *Model) queryTerminal() {
	if m.gfx.disabled {
		return
	}
	m.do(tea.Raw(ansi.RequestPrimaryDeviceAttributes))
	m.do(tea.Raw(ansi.WindowOp(ansi.RequestCellSizeWinOp)))
}

// terminalReply handles terminal responses Bubble Tea passes through as-is.
func (m *Model) terminalReply(msg tea.Msg) bool {
	switch e := msg.(type) {
	case uv.PrimaryDeviceAttributesEvent:
		for _, attr := range e {
			if attr == 4 {
				m.gfx.sixel = true
			}
		}
	case uv.CellSizeEvent:
		m.gfx.cellW, m.gfx.cellH = e.Width, e.Height
	default:
		return false
	}
	m.readerKey = "" // re-render with images
	return true
}

// imageFunc sizes images for the article being rendered, and starts
// downloading ones it hasn't seen.
func (m *Model) imageFunc(measure, bodyH int, referer string) render.ImageFunc {
	if !m.gfx.enabled() {
		return nil
	}
	return func(src, alt string) int {
		info, st := m.gfx.cache.Info(src)
		switch st {
		case images.Missing:
			m.loadImage(src, referer)
			return 0
		case images.Failed:
			return 0
		}
		if info.W < 24 || info.H < 24 {
			return -1 // tracking pixels, icons
		}
		_, h := m.fit(info, measure, bodyH)
		return (h + m.gfx.cellH - 1) / m.gfx.cellH
	}
}

func (m *Model) fit(info images.Info, measure, bodyH int) (int, int) {
	return images.Fit(info, measure*m.gfx.cellW, 12*bodyH*m.gfx.cellH)
}

// placeImages records where the rendered article's images are, in article
// line numbers (offset is how many lines precede the body).
func (m *Model) placeImages(res render.Result, offset, measure, bodyH int) {
	m.gfx.place = m.gfx.place[:0]
	for _, p := range res.Images {
		info, st := m.gfx.cache.Info(p.Src)
		if st != images.Ready {
			continue
		}
		w, h := m.fit(info, measure, bodyH)
		m.gfx.place = append(m.gfx.place, imgPlace{
			line: offset + p.Line, rows: p.Rows, src: p.Src, w: w, h: h,
			cols: (w + m.gfx.cellW - 1) / m.gfx.cellW,
		})
	}
}

func (m *Model) loadImage(src, referer string) {
	if m.gfx.loading[src] {
		return
	}
	m.gfx.loading[src] = true
	cache, sem, ctx := m.gfx.cache, m.gfx.sem, m.ctx
	m.do(func() tea.Msg {
		sem <- struct{}{}
		defer func() { <-sem }()
		_ = cache.Load(ctx, src, referer) // failures are cached and shown as placeholders
		return imageLoadedMsg{src: src}
	})
}

func (m *Model) imageLoaded(msg imageLoadedMsg) {
	delete(m.gfx.loading, msg.src)
	m.readerKey = ""
}

// desiredImages is what should be on screen right now.
func (m *Model) desiredImages() []drawJob {
	// Images hide while the reader glides and come back when it stops.
	if !m.gfx.enabled() || m.open == nil || m.overlay != overlayNone || len(m.gfx.place) == 0 || m.scroll.active {
		return nil
	}
	l := m.layout()
	if !l.reader {
		return nil
	}
	x := readerPad
	if l.side {
		x += l.sideW + 1
	}
	if l.list {
		x += l.listW + 1
	}
	var jobs []drawJob
	for _, p := range m.gfx.place {
		top := 1 + p.line - m.reader.YOffset() // screen row of the image's first line
		v0, v1 := max(top, 1), min(top+p.rows, 1+l.bodyH)
		if v1 <= v0 {
			continue
		}
		jobs = append(jobs, drawJob{
			src: p.src, w: p.w, h: p.h,
			py0: (v0 - top) * m.gfx.cellH, py1: (v1 - top) * m.gfx.cellH,
			x: x, y: v0, cols: p.cols, n: v1 - v0,
		})
	}
	return jobs
}

// scheduleImages queues an image pass when what should be drawn changed.
func (m *Model) scheduleImages() {
	if !m.gfx.enabled() && len(m.gfx.drawn) == 0 {
		return
	}
	sig := fmt.Sprint(m.desiredImages(), m.width, m.height)
	if sig == m.gfx.sig {
		return
	}
	m.gfx.sig = sig
	m.gfx.seq++
	seq := m.gfx.seq
	delay := imagePassDelay
	if len(m.desiredImages()) == 0 {
		delay = time.Millisecond // only erasing: do it before anything moves far
	}
	m.do(tea.Tick(delay, func(time.Time) tea.Msg { return imagePassMsg{seq} }))
}

func (m *Model) imagePass(msg imagePassMsg) {
	if msg.seq != m.gfx.seq {
		return // something changed since; a newer pass is queued
	}
	jobs := m.desiredImages()
	erase := eraseSeq(strings.Split(m.View().Content, "\n"), m.gfx.drawn)
	cache, seq := m.gfx.cache, msg.seq
	m.do(func() tea.Msg { // encoding can take a while; keep it off the UI loop
		var b strings.Builder
		b.WriteString(ansi.SaveCursor)
		b.WriteString(erase)
		var drawn []cellRect
		for _, j := range jobs {
			six := cache.Sixel(j.src, j.w, j.h, j.py0, j.py1)
			if six == "" {
				continue
			}
			fmt.Fprintf(&b, "\x1b[%d;%dH", j.y+1, j.x+1)
			b.WriteString(six)
			drawn = append(drawn, cellRect{j.x, j.y, j.cols, j.n})
		}
		b.WriteString(ansi.RestoreCursor)
		return imageDrawMsg{seq: seq, out: b.String(), drawn: drawn}
	})
}

func (m *Model) imageDraw(msg imageDrawMsg) {
	if msg.seq != m.gfx.seq {
		return // stale; the next pass erases what's still on screen
	}
	m.do(tea.Raw(msg.out))
	m.gfx.drawn = msg.drawn
}

// eraseSeq overwrites, with spaces, the cells of previously drawn images that
// are blank in the current frame. Cells holding text were already redrawn by
// the renderer (which removes image pixels under them).
func eraseSeq(frame []string, drawn []cellRect) string {
	var b strings.Builder
	for _, r := range drawn {
		for y := r.y; y < r.y+r.h && y < len(frame); y++ {
			seg := ansi.Strip(ansi.Cut(frame[y], r.x, r.x+r.w))
			runes := []rune(seg)
			if ansi.StringWidth(seg) != len(runes) {
				continue // wide characters: column math would be off; leave it
			}
			for len(runes) < r.w {
				runes = append(runes, ' ')
			}
			for i := 0; i < len(runes); {
				if runes[i] != ' ' {
					i++
					continue
				}
				j := i
				for j < len(runes) && runes[j] == ' ' {
					j++
				}
				fmt.Fprintf(&b, "\x1b[%d;%dH\x1b[0m%s", y+1, r.x+i+1, strings.Repeat(" ", j-i))
				i = j
			}
		}
	}
	return b.String()
}
