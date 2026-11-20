package tui

import (
	"strings"
	"time"

	"charm.land/lipgloss/v2"
)

// Unread sparklines: how many unread articles each feed has from each of the
// last few days, so you can see at a glance whether a backlog is fresh or old.
// The header shows sparkDays for the current view; sidebar rows show the last
// sideSparkDays when the sidebar is wide enough.
const (
	sparkDays     = 14
	sideSparkDays = 7
	// sidebar rows need at least this many cells for the title before the
	// sparkline column is shown
	sideSparkMinTitle = 12
)

// sparkLevels are the nonzero bar heights. A day with no unread articles
// draws as a muted baseline (▁), so the smallest real bar starts one step up
// and an empty day never looks like a quiet one.
var sparkLevels = []rune("▂▃▄▅▆▇█")

const sparkBase = "▁"

// loadHistory buckets the account's unread articles from the last sparkDays
// days by local calendar day.
func (m *Model) loadHistory(accountID string) {
	now := m.now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	first := today.AddDate(0, 0, -(sparkDays - 1))
	times, err := m.store.UnreadSince(m.ctx, accountID, first)
	if err != nil {
		m.history = nil
		return
	}
	m.history = bucketDays(times, first)
}

// bucketDays counts times into sparkDays daily buckets starting at first
// (a local midnight). Times after the last bucket count as today.
func bucketDays(times map[int64][]time.Time, first time.Time) map[int64][]int {
	out := make(map[int64][]int, len(times))
	for feed, ts := range times {
		counts := make([]int, sparkDays)
		for _, t := range ts {
			t = t.In(first.Location())
			day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, first.Location())
			// round, so a 23- or 25-hour DST day still lands in the right bucket
			i := int((day.Sub(first) + 12*time.Hour) / (24 * time.Hour))
			counts[clamp(i, 0, sparkDays-1)]++
		}
		out[feed] = counts
	}
	return out
}

// addSparks fills in each sidebar entry's sparkline: feeds from history,
// folders and "All articles" as the sum of their feeds. Starred has none.
func (m *Model) addSparks(entries []sideEntry) {
	folders := map[int64][]int{}
	all := make([]int, sparkDays)
	for _, f := range m.feeds {
		h := m.history[f.ID]
		addInto(all, h)
		if f.FolderID != 0 {
			if folders[f.FolderID] == nil {
				folders[f.FolderID] = make([]int, sparkDays)
			}
			addInto(folders[f.FolderID], h)
		}
	}
	for i := range entries {
		e := &entries[i]
		switch e.kind {
		case sideAll:
			e.spark = all
		case sideFolder:
			e.spark = folders[e.id]
		case sideFeed:
			e.spark = m.history[e.id]
		}
	}
}

func addInto(dst, src []int) {
	for i := range min(len(dst), len(src)) {
		dst[i] += src[i]
	}
}

// sparkline draws the last n days of counts, scaled to their own maximum.
// Bars use bars; empty days use base. With nothing unread in those days it is
// n blank cells: a flat line on every caught-up feed would only be noise.
func sparkline(counts []int, n int, bars, base lipgloss.Style) string {
	if len(counts) > n {
		counts = counts[len(counts)-n:]
	}
	hi := 0
	for _, c := range counts {
		hi = max(hi, c)
	}
	if hi == 0 {
		return strings.Repeat(" ", n)
	}
	var b strings.Builder
	for range n - len(counts) {
		b.WriteString(base.Render(sparkBase))
	}
	for _, c := range counts {
		if c == 0 {
			b.WriteString(base.Render(sparkBase))
			continue
		}
		// 1..len(levels), proportional, rounding up so a 1 next to a 100
		// is still visible
		lvl := (c*len(sparkLevels) + hi - 1) / hi
		b.WriteString(bars.Render(string(sparkLevels[lvl-1])))
	}
	return b.String()
}
