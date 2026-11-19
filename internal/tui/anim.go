package tui

import (
	"math"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/harmonica"
)

// Animations: smooth reader scrolling (a critically damped spring chasing a
// target offset) and a brief highlight for articles that just arrived (a
// pulsing marker, and unread counts that count up). One 60 fps tick runs
// only while something is moving.

const (
	animFrame = time.Second / 60
	pulseFor  = 1800 * time.Millisecond // how long new articles pulse
	countFor  = 700 * time.Millisecond  // how long counts take to count up
)

// Critically damped: fast, no bounce. Settles visually in ~150ms.
var scrollSpring = harmonica.NewSpring(harmonica.FPS(60), 32.0, 1.0)

type animMsg struct{}

type scrollAnim struct {
	active   bool
	pos, vel float64
	target   int
}

type tween struct {
	from, to int
	start    time.Time
}

func (m *Model) startAnim() {
	if m.animate && !m.animTicking {
		m.animTicking = true
		m.do(tea.Tick(animFrame, func(time.Time) tea.Msg { return animMsg{} }))
	}
}

func (m *Model) animating() bool {
	return m.scroll.active || len(m.fresh) > 0 || len(m.tweens) > 0
}

// animStep advances every animation by one frame and drops finished ones.
func (m *Model) animStep() {
	m.animTicking = false
	now := m.now()
	if s := &m.scroll; s.active {
		s.pos, s.vel = scrollSpring.Update(s.pos, s.vel, float64(s.target))
		if math.Abs(s.pos-float64(s.target)) < 0.5 && math.Abs(s.vel) < 0.5 {
			m.reader.SetYOffset(s.target)
			s.active = false
		} else {
			m.reader.SetYOffset(int(math.Round(s.pos)))
		}
	}
	for id, start := range m.fresh {
		if now.Sub(start) >= pulseFor {
			delete(m.fresh, id)
		}
	}
	for k, tw := range m.tweens {
		if now.Sub(tw.start) >= countFor {
			delete(m.tweens, k)
		}
	}
	if m.animating() {
		m.startAnim()
	}
}

// --- scrolling ---------------------------------------------------------------

func (m *Model) maxScroll() int {
	return max(m.reader.TotalLineCount()-m.reader.Height(), 0)
}

// scrollTarget is where the reader is headed: the spring's target while
// animating, else where it is.
func (m *Model) scrollTarget() int {
	if m.scroll.active {
		return m.scroll.target
	}
	return m.reader.YOffset()
}

func (m *Model) atTop() bool    { return m.scrollTarget() <= 0 }
func (m *Model) atBottom() bool { return m.scrollTarget() >= m.maxScroll() }

// scrollBy moves the reader by delta lines, gliding there when animations
// are on. Repeated presses add up from the target, not the current position.
func (m *Model) scrollBy(delta int) {
	target := clamp(m.scrollTarget()+delta, 0, m.maxScroll())
	if !m.animate {
		m.reader.SetYOffset(target)
		return
	}
	if !m.scroll.active {
		if target == m.reader.YOffset() {
			return
		}
		m.scroll = scrollAnim{active: true, pos: float64(m.reader.YOffset())}
	}
	m.scroll.target = target
	m.startAnim()
}

// stopScroll jumps to the end of any scroll in progress.
func (m *Model) stopScroll() {
	if m.scroll.active {
		m.reader.SetYOffset(m.scroll.target)
	}
	m.scroll = scrollAnim{}
}

// --- new-article highlight ---------------------------------------------------

// countSnapshot records unread counts, to animate the ones a sync raises.
func (m *Model) countSnapshot() map[string]int {
	snap := map[string]int{}
	for id, n := range m.unreadByAcct {
		snap["a:"+id] = n
	}
	for _, e := range m.side {
		snap["s:"+e.key()] = e.unread
	}
	return snap
}

// highlightArrivals pulses items newer than beforeID and counts up raised
// counts. beforeID 0 means the database was empty: everything is new, so
// nothing is special.
func (m *Model) highlightArrivals(beforeID int64, before map[string]int) {
	if !m.animate || beforeID == 0 {
		return
	}
	now := m.now()
	ids, err := m.store.ItemIDsAbove(m.ctx, beforeID, 500)
	if err != nil {
		return
	}
	for _, id := range ids {
		m.fresh[id] = now
	}
	after := m.countSnapshot()
	for k, n := range after {
		if old, ok := before[k]; ok && n > old {
			m.tweens[k] = tween{from: old, to: n, start: now}
		}
	}
	if m.animating() {
		m.startAnim()
	}
}

// count is the unread count to display for key: mid-count-up if it just
// rose, else the real value.
func (m *Model) count(key string, actual int) int {
	tw, ok := m.tweens[key]
	if !ok || tw.to != actual {
		return actual
	}
	t := min(float64(m.now().Sub(tw.start))/float64(countFor), 1)
	ease := 1 - math.Pow(1-t, 3) // ease-out cubic
	return tw.from + int(math.Round(float64(tw.to-tw.from)*ease))
}

var pulseGlyphs = []string{"◉", "✦", "◉", "●"}

// pulse returns the marker for an item that just arrived, and whether it's
// still pulsing.
func (m *Model) pulse(id int64) (string, bool) {
	start, ok := m.fresh[id]
	if !ok {
		return "", false
	}
	age := m.now().Sub(start)
	if age >= pulseFor {
		return "", false
	}
	return pulseGlyphs[int(age/(150*time.Millisecond))%len(pulseGlyphs)], true
}
