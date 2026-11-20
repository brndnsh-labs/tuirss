package tui

import (
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

func TestSparkline(t *testing.T) {
	plain := lipgloss.NewStyle()
	cases := []struct {
		counts []int
		n      int
		want   string
	}{
		{nil, 4, "    "},
		{[]int{0, 1, 2, 7}, 4, "▁▂▃█"},
		{[]int{1, 100}, 2, "▂█"},     // a lone article still shows next to a big day
		{[]int{5, 0, 3, 3}, 2, "██"}, // last n days, scaled to them
		{[]int{2}, 3, "▁▁█"},         // short history pads on the left
		{[]int{0, 0, 0}, 3, "   "},   // nothing unread: blank
		{[]int{7, 6, 5, 4, 3, 2, 1}, 7, "█▇▆▅▄▃▂"},
	}
	for _, c := range cases {
		if got := sparkline(c.counts, c.n, plain, plain); got != c.want {
			t.Errorf("sparkline(%v, %d) = %q, want %q", c.counts, c.n, got, c.want)
		}
	}
}

func TestBucketDays(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tzdata:", err)
	}
	// 14 days ending on 2026-11-03, spanning the end of DST on 2026-11-01.
	first := time.Date(2026, 10, 21, 0, 0, 0, 0, loc)
	at := func(m time.Month, d, h int) time.Time { return time.Date(2026, m, d, h, 0, 0, 0, loc) }
	got := bucketDays(map[int64][]time.Time{1: {
		at(10, 21, 0),  // first bucket
		at(11, 1, 23),  // the 25-hour day
		at(11, 2, 0),   // the day after it
		at(11, 3, 23),  // today
		at(11, 9, 12),  // in the future: counts as today
		at(10, 25, 12), //
	}}, first)[1]
	want := make([]int, sparkDays)
	want[0], want[4], want[11], want[12], want[13] = 1, 1, 1, 1, 2
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("buckets = %v, want %v", got, want)
		}
	}
}

func TestSidebarSparklines(t *testing.T) {
	m, _ := setup(t)
	press(m, "]") // to Local, which has 10 unread from the last day or so
	for m.account().ID != "local" {
		press(m, "]")
	}
	all := m.side[1]
	if all.kind != sideAll {
		t.Fatalf("side[1] = %+v", all)
	}
	sum := 0
	for _, c := range all.spark {
		sum += c
	}
	if sum != 10 || len(all.spark) != sparkDays {
		t.Errorf("All articles spark = %v, want %d days summing to 10", all.spark, sparkDays)
	}
	for _, e := range m.side {
		if e.kind == sideStarred && e.spark != nil {
			t.Errorf("starred has a sparkline: %v", e.spark)
		}
	}

	m.Update(tea.WindowSizeMsg{Width: 160, Height: 40}) // 32-wide sidebar: room for them
	out := checkView(t, m)
	if !strings.Contains(out, "14d ") {
		t.Errorf("header has no sparkline:\n%s", out)
	}
	sideHas := func(out string) bool {
		for _, l := range strings.Split(out, "\n")[1:] {
			if strings.Contains(l, "All articles") {
				return strings.ContainsAny(l, "▁▂▃▄▅▆▇█")
			}
		}
		return false
	}
	if !sideHas(out) {
		t.Errorf("sidebar has no sparklines at 160 wide:\n%s", out)
	}

	m.Update(tea.WindowSizeMsg{Width: 140, Height: 40}) // 28-wide sidebar: titles win
	if out := checkView(t, m); sideHas(out) {
		t.Errorf("sidebar sparklines at 140 wide:\n%s", out)
	}

	press(m, "A", "y") // mark everything read
	for _, c := range m.side[1].spark {
		if c != 0 {
			t.Fatalf("after mark all read, spark = %v", m.side[1].spark)
		}
	}
}
