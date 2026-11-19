package tui

import (
	"fmt"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/brndnsh-labs/tuirss/internal/format"
	"github.com/brndnsh-labs/tuirss/internal/htmltext"
	"github.com/brndnsh-labs/tuirss/internal/store"
)

type layout struct {
	sideW, listW, readerW, bodyH int
	side, list, reader           bool
}

// layout decides which panes fit. Wide: sidebar | list | reader. As the
// terminal narrows the sidebar goes first, then the list gives way to the
// open article.
func (m *Model) layout() layout {
	w := m.width
	l := layout{bodyH: max(m.height-2, 1)}
	open := m.open != nil
	if open && m.fullscreen {
		l.reader, l.readerW = true, w
		return l
	}
	l.list = !(open && w < 80)
	l.reader = open || w >= 120
	l.side = m.showSidebar && w >= 60 && !(open && w < 110)

	panes := 0
	for _, on := range []bool{l.side, l.list, l.reader} {
		if on {
			panes++
		}
	}
	avail := w - (panes - 1) // one column per separator
	if l.side {
		l.sideW = clamp(w/5, 24, 34)
	}
	rest := avail - l.sideW
	switch {
	case l.list && l.reader:
		l.listW = clamp(rest*2/5, 32, 64)
		l.readerW = rest - l.listW
	case l.list:
		l.listW = rest
	default:
		l.readerW = rest
	}
	return l
}

func (m *Model) View() tea.View {
	var v tea.View
	v.AltScreen = true
	unread := 0
	for _, n := range m.unreadByAcct {
		unread += n
	}
	v.WindowTitle = "tuirss"
	if unread > 0 {
		v.WindowTitle = fmt.Sprintf("tuirss (%d)", unread)
	}
	if m.width == 0 || m.height == 0 {
		v.SetContent("")
		return v
	}
	l := m.layout()
	var panes [][]string
	if l.side {
		panes = append(panes, m.viewSidebar(l.sideW, l.bodyH))
	}
	if l.list {
		panes = append(panes, m.viewList(l.listW, l.bodyH))
	}
	if l.reader {
		panes = append(panes, m.viewReader(l.readerW, l.bodyH))
	}
	sep := m.st.sep.Render("│")
	var b strings.Builder
	b.WriteString(m.viewHeader(m.width))
	b.WriteByte('\n')
	for row := 0; row < l.bodyH; row++ {
		for i, p := range panes {
			if i > 0 {
				b.WriteString(sep)
			}
			b.WriteString(p[row])
		}
		b.WriteByte('\n')
	}
	b.WriteString(m.viewStatus(m.width))
	screen := b.String()

	if box := m.viewOverlay(); box != "" {
		if lipgloss.Width(box) > m.width || lipgloss.Height(box) > m.height {
			box = strings.Join(block(box, min(lipgloss.Width(box), m.width), min(lipgloss.Height(box), m.height)), "\n")
		}
		x := max((m.width-lipgloss.Width(box))/2, 0)
		y := max((m.height-lipgloss.Height(box))/3, 0)
		screen = lipgloss.NewCompositor(
			lipgloss.NewLayer(screen),
			lipgloss.NewLayer(box).X(x).Y(y).Z(1),
		).Render()
	}
	v.SetContent(screen)
	return v
}

// fit pads or truncates a styled line to exactly w cells.
func fit(s string, w int) string {
	if w <= 0 {
		return ""
	}
	if sw := ansi.StringWidth(s); sw > w {
		s = ansi.Truncate(s, w, "…")
	}
	if pad := w - ansi.StringWidth(s); pad > 0 {
		s += strings.Repeat(" ", pad)
	}
	return s
}

// block fits text into exactly h lines of width w.
func block(text string, w, h int) []string {
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	out := make([]string, h)
	for i := range out {
		if i < len(lines) {
			out[i] = fit(lines[i], w)
		} else {
			out[i] = strings.Repeat(" ", w)
		}
	}
	return out
}

// spread puts left and right on one line of width w.
func spread(left, right string, w int) string {
	gap := w - ansi.StringWidth(left) - ansi.StringWidth(right)
	if gap < 1 {
		return fit(left, w)
	}
	return left + strings.Repeat(" ", gap) + right
}

// --- header and status -----------------------------------------------------

func (m *Model) viewTitle() string {
	if m.query != "" {
		return fmt.Sprintf("“%s”", m.query)
	}
	return m.view.title
}

func (m *Model) viewHeader(w int) string {
	sep := m.st.crumbSep.Render(" › ")
	crumbs := []string{m.account().Name}
	if m.query != "" {
		crumbs = append(crumbs, "Search", m.viewTitle())
	} else {
		if m.view.kind == sideFeed && m.view.folder != "" {
			crumbs = append(crumbs, m.view.folder)
		}
		crumbs = append(crumbs, m.view.title)
	}
	left := m.st.logo.Render("◆ tuirss") + " " + m.st.crumb.Render(strings.Join(crumbs, sep))

	var right string
	switch {
	case m.query != "":
		right = fmt.Sprintf("%d results", len(m.items))
	case m.view.kind == sideStarred:
		right = fmt.Sprintf("%d starred", len(m.items))
	case m.unreadOnly:
		right = fmt.Sprintf("%d unread", m.view.unread)
	default:
		right = fmt.Sprintf("all · %d articles", len(m.items))
	}
	return spread(left, m.st.headerRight.Render(right+" "), w)
}

func (m *Model) viewStatus(w int) string {
	var left string
	switch {
	case m.confirm != nil:
		left = m.st.key.Render(" ? ") + m.confirm.prompt + m.st.status.Render("  y/n")
	case m.searching:
		m.search.SetWidth(max(w-30, 10))
		left = " " + m.search.View()
	case m.pendingG:
		left = m.st.status.Render(" g… ") + m.hints([][2]string{{"a", "all"}, {"s", "starred"}, {"u", "jump to feed"}, {"1-9", "account"}, {"g", "top"}})
	case m.status != "":
		st := m.st.ok
		if m.statusErr {
			st = m.st.errMsg
		}
		left = " " + st.Render(m.status)
	case m.open != nil:
		left = " " + m.hints([][2]string{{"j/k", "next/prev"}, {"space", "page"}, {"s", "star"}, {"e", "full text"}, {"v", "browser"}, {"?", "help"}})
	default:
		left = " " + m.hints([][2]string{{"j/k", "read"}, {"J/K", "feeds"}, {"g u", "jump"}, {"/", "search"}, {"r", "refresh"}, {"?", "help"}})
	}

	var right string
	switch {
	case m.syncing:
		right = m.st.spinner.Render(spinner[m.spin%len(spinner)]) + m.st.status.Render(" syncing")
		if m.syncProg.Total > 0 {
			right += m.st.status.Render(fmt.Sprintf(" %d/%d", m.syncProg.Done, m.syncProg.Total))
		}
	case len(m.fetching) > 0:
		right = m.st.spinner.Render(spinner[m.spin%len(spinner)]) + m.st.status.Render(" fetching article")
	case !m.lastSync.IsZero():
		right = m.st.status.Render("synced " + format.Ago(m.lastSync, m.now()))
		if !strings.HasPrefix(format.Ago(m.lastSync, m.now()), "just") {
			right += m.st.status.Render(" ago")
		}
	}
	if m.open != nil {
		if pct := m.reader.ScrollPercent(); m.reader.TotalLineCount() > m.reader.Height() {
			right = m.st.status.Render(fmt.Sprintf("%3.0f%%  ", pct*100)) + right
		}
	}
	return spread(left, right+" ", w)
}

func (m *Model) hints(pairs [][2]string) string {
	var parts []string
	for _, p := range pairs {
		parts = append(parts, m.st.key.Render(p[0])+" "+m.st.status.Render(p[1]))
	}
	return strings.Join(parts, m.st.status.Render(" · "))
}

// --- sidebar ---------------------------------------------------------------

func (m *Model) viewSidebar(w, h int) []string {
	var top []string
	for i, a := range m.accounts {
		mark, name := m.st.acct.Render("◇"), m.st.acct.Render(a.Name)
		if i == m.acct {
			mark, name = m.st.acctMark.Render("◆"), m.st.acctActive.Render(a.Name)
		}
		count := ""
		if n := m.unreadByAcct[a.ID]; n > 0 {
			count = m.st.sideCount.Render(fmt.Sprint(n))
		}
		if m.acctErr[a.ID] != "" {
			count = m.st.sideErr.Render("!") + " " + count
		}
		top = append(top, spread(" "+mark+" "+name, count+" ", w))
	}
	if len(m.accounts) == 0 {
		top = append(top, m.st.sideEmpty.Render(" no accounts configured"))
	}
	top = append(top, m.st.sep.Render(strings.Repeat("─", w)))

	rows := h - len(top)
	if rows <= 0 {
		return block(strings.Join(top, "\n"), w, h)
	}
	// keep the cursor visible
	if m.sideCursor < m.sideOffset {
		m.sideOffset = m.sideCursor
	}
	if m.sideCursor >= m.sideOffset+rows {
		m.sideOffset = m.sideCursor - rows + 1
	}
	m.sideOffset = clamp(m.sideOffset, 0, max(len(m.side)-rows, 0))

	lines := top
	for i := m.sideOffset; i < len(m.side) && i < m.sideOffset+rows; i++ {
		lines = append(lines, m.sideRow(m.side[i], i == m.sideCursor, w))
	}
	if len(m.feeds) == 0 && len(m.accounts) > 0 {
		lines = append(lines, "", m.st.sideEmpty.Render(" no feeds yet"))
	}
	return block(strings.Join(lines, "\n"), w, h)
}

func (m *Model) sideRow(e sideEntry, selected bool, w int) string {
	var icon string
	switch e.kind {
	case sideStarred:
		icon = m.st.star.Render("★")
	case sideAll:
		icon = m.st.dot.Render("◉")
	case sideFolder:
		icon = m.st.muted.Render("▾")
		if e.collapsed {
			icon = m.st.muted.Render("▸")
		}
	case sideFeed:
		icon = " "
		if e.hasErr {
			icon = m.st.sideErr.Render("!")
		}
	}
	title := m.st.sideItem.Render(e.title)
	if e.unread == 0 && e.kind != sideStarred {
		title = m.st.sideEmpty.Render(e.title)
	}
	if selected {
		title = m.st.sideSel.Render(e.title)
	}
	bar := " "
	if selected {
		bar = m.st.bar.Render("▌")
	}
	indent := strings.Repeat("  ", e.depth)
	count := ""
	if e.unread > 0 {
		count = m.st.sideCount.Render(fmt.Sprint(e.unread))
	}
	left := bar + indent + icon + " " + title
	cw := ansi.StringWidth(count)
	return fit(left, w-cw-2) + " " + count + " "
}

// --- item list -------------------------------------------------------------

func dayLabel(t, now time.Time) string {
	t, now = t.Local(), now.Local()
	day := func(x time.Time) time.Time { y, mo, d := x.Date(); return time.Date(y, mo, d, 0, 0, 0, 0, time.Local) }
	diff := int(day(now).Sub(day(t)).Hours() / 24)
	switch {
	case diff <= 0:
		return "Today"
	case diff == 1:
		return "Yesterday"
	case diff < 7:
		return t.Format("Monday")
	case t.Year() == now.Year():
		return t.Format("January 2")
	default:
		return t.Format("January 2, 2006")
	}
}

func (m *Model) viewList(w, h int) []string {
	if len(m.items) == 0 {
		msg := "No articles"
		switch {
		case m.query != "":
			msg = "No matches"
		case m.acctErr[m.account().ID] != "" && (len(m.feeds) == 0 || m.view.kind == sideAll):
			msg = "Couldn't sync " + m.account().Name + "\n\n" + lipgloss.Wrap(m.acctErr[m.account().ID], max(w-6, 10), " ")
		case len(m.feeds) == 0 && m.account().Kind != store.KindLocal:
			msg = "No subscriptions yet\n\nsyncing with the server…"
		case len(m.feeds) == 0:
			msg = "No feeds yet\n\ntuirss add <url>\ntuirss import feeds.opml"
		case m.view.kind == sideFeed && m.feedErr(m.view.id) != "":
			msg = "Couldn't fetch this feed\n\n" + lipgloss.Wrap(m.feedErr(m.view.id), max(w-6, 10), "")
		case m.view.kind == sideStarred:
			msg = "Nothing starred yet\n\npress s on an article"
		case m.unreadOnly:
			msg = "✓ All caught up\n\npress t to show read articles"
		}
		return block(lipgloss.Place(w, h, lipgloss.Center, lipgloss.Center, m.st.splash.Align(lipgloss.Center).Render(msg)), w, h)
	}

	now := m.now()
	multiFeed := m.view.kind != sideFeed || m.query != ""
	var lines []string
	starts := make([]int, len(m.items))
	lastDay := ""
	for i, it := range m.items {
		if d := dayLabel(it.PublishedAt, now); d != lastDay {
			if lastDay != "" {
				lines = append(lines, "")
			}
			lines = append(lines, " "+m.st.day.Render(strings.ToUpper(d)))
			lastDay = d
		}
		starts[i] = len(lines)
		lines = append(lines, m.itemRows(it, i == m.cursor, multiFeed, w, now)...)
	}

	// Scroll so the cursor item (and its day header, when it starts a group) shows.
	start := starts[m.cursor]
	top := start
	if top > 0 && strings.TrimSpace(ansi.Strip(lines[top-1])) != "" && (m.cursor == 0 || starts[m.cursor-1]+2 != start) {
		top--
	}
	if top < m.listOffset {
		m.listOffset = top
	}
	if start+2 > m.listOffset+h {
		m.listOffset = start + 2 - h
	}
	m.listOffset = clamp(m.listOffset, 0, max(len(lines)-h, 0))
	end := min(m.listOffset+h, len(lines))
	return block(strings.Join(lines[m.listOffset:end], "\n"), w, h)
}

func (m *Model) feedErr(id int64) string {
	for _, f := range m.feeds {
		if f.ID == id {
			return f.LastError
		}
	}
	return ""
}

func (m *Model) itemRows(it store.Item, cur, multiFeed bool, w int, now time.Time) []string {
	bar := " "
	if cur {
		bar = m.st.bar.Render("▌")
	}
	mark := " "
	switch {
	case it.Starred:
		mark = m.st.star.Render("★")
	case !it.Read:
		mark = m.st.dot.Render("●")
	}
	title := strings.Join(strings.Fields(it.Title), " ")
	if title == "" {
		title = "(untitled)"
	}
	ts := format.Ago(it.PublishedAt, now)
	tw := max(w-4-ansi.StringWidth(ts)-1, 4)
	title = ansi.Truncate(title, tw, "…")
	switch {
	case cur:
		title = m.st.titleCur.Render(title)
	case it.Read:
		title = m.st.titleRead.Render(title)
	default:
		title = m.st.titleUnread.Render(title)
	}
	line1 := spread(bar+mark+" "+title, m.st.meta.Render(ts)+" ", w)

	var meta string
	if multiFeed {
		meta = it.FeedTitle
		if it.Author != "" {
			meta += " · " + it.Author
		}
	} else {
		meta = m.excerpt(it)
		if meta == "" {
			meta = it.Author
		}
	}
	line2 := bar + "  " + m.st.meta.Render(ansi.Truncate(meta, max(w-4, 1), "…"))
	return []string{line1, line2}
}

func (m *Model) excerpt(it store.Item) string {
	if e, ok := m.excerpts[it.ID]; ok {
		return e
	}
	src := it.Summary
	if src == "" {
		src = it.Content
	}
	e := htmltext.Excerpt(src, 200)
	m.excerpts[it.ID] = e
	return e
}
