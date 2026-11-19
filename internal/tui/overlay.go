package tui

import (
	"fmt"
	"sort"
	"strings"
	"unicode"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func (m *Model) viewOverlay() string {
	switch m.overlay {
	case overlayHelp:
		return m.viewHelp()
	case overlayPicker:
		return m.viewPicker()
	}
	return ""
}

var helpSections = []struct {
	title string
	keys  [][2]string
}{
	{"Reading", [][2]string{
		{"j / k", "next / previous article"},
		{"n / p", "move without opening"},
		{"o  enter", "open / close article"},
		{"space", "page down, then next article"},
		{"⇧space  b", "page up, then previous"},
		{"ctrl+d / u", "half page down / up"},
		{"gg / G", "first / last article"},
	}},
	{"Articles", [][2]string{
		{"s", "star"},
		{"m", "toggle read"},
		{"A", "mark all here as read"},
		{"e", "full article ⇄ feed text"},
		{"E", "always full text for feed"},
		{"v", "open in browser"},
		{"y", "copy link"},
		{"t", "unread only ⇄ all"},
	}},
	{"Feeds & accounts", [][2]string{
		{"J / K", "next / previous feed"},
		{"g u", "jump to a feed"},
		{"g a / g s", "all articles / starred"},
		{"x", "collapse folder"},
		{"[ / ]", "previous / next account"},
		{"g 1-9", "go to account"},
	}},
	{"View", [][2]string{
		{"/", "search"},
		{"u", "toggle sidebar"},
		{"f", "focus article"},
		{"esc", "back"},
		{"r", "refresh now"},
		{"q", "quit"},
	}},
}

func (m *Model) viewHelp() string {
	var cols []string
	for _, sec := range helpSections {
		var b strings.Builder
		b.WriteString(m.st.boxTitle.Render(sec.title))
		b.WriteString("\n\n")
		for _, k := range sec.keys {
			b.WriteString(fit(m.st.boxKey.Render(k[0]), 12))
			b.WriteString(k[1])
			b.WriteString("\n")
		}
		cols = append(cols, b.String())
	}
	var body string
	if m.width >= 180 {
		body = lipgloss.JoinHorizontal(lipgloss.Top, cols[0], "    ", cols[1], "    ", cols[2], "    ", cols[3])
	} else if m.width >= 100 {
		left := lipgloss.JoinVertical(lipgloss.Left, cols[0], cols[1])
		right := lipgloss.JoinVertical(lipgloss.Left, cols[2], cols[3])
		body = lipgloss.JoinHorizontal(lipgloss.Top, left, "    ", right)
	} else {
		body = lipgloss.JoinVertical(lipgloss.Left, cols...)
	}
	footer := m.st.muted.Render("press ? or esc to close")
	return m.st.box.Render(lipgloss.JoinVertical(lipgloss.Left, body, footer))
}

// --- feed picker (g u) -----------------------------------------------------

type picker struct {
	input   textinput.Model
	all     []sideEntry
	matches []sideEntry
	cursor  int
}

func newPicker() picker {
	ti := textinput.New()
	ti.Prompt = "› "
	ti.Placeholder = "jump to a feed or folder"
	return picker{input: ti}
}

func (m *Model) openPicker() {
	all := buildSidebar(m.feeds, m.starred, m.unreadByAcct[m.account().ID], map[int64]bool{})
	m.picker.all = all
	m.picker.input.SetValue("")
	m.picker.cursor = 0
	m.picker.filter()
	m.overlay = overlayPicker
	m.do(m.picker.input.Focus())
}

func (p *picker) filter() {
	q := p.input.Value()
	type scored struct {
		e sideEntry
		s int
	}
	var out []scored
	for i, e := range p.all {
		if q == "" {
			out = append(out, scored{e, -i})
			continue
		}
		if s, ok := fuzzy(q, e.title+" "+e.folder); ok {
			out = append(out, scored{e, s})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].s > out[j].s })
	p.matches = p.matches[:0]
	for _, s := range out {
		p.matches = append(p.matches, s.e)
	}
	p.cursor = clamp(p.cursor, 0, max(len(p.matches)-1, 0))
}

func (m *Model) pickerKey(msg tea.KeyPressMsg) {
	p := &m.picker
	switch msg.String() {
	case "esc":
		m.overlay = overlayNone
		return
	case "enter":
		m.overlay = overlayNone
		if p.cursor < len(p.matches) {
			target := p.matches[p.cursor]
			if target.kind == sideFeed && m.collapsed[m.folderOf(target.id)] {
				delete(m.collapsed, m.folderOf(target.id))
				m.reloadSidebar()
			}
			for i, e := range m.side {
				if e.key() == target.key() {
					m.selectSide(i)
				}
			}
		}
		return
	case "down", "ctrl+n", "tab":
		p.cursor = clamp(p.cursor+1, 0, max(len(p.matches)-1, 0))
		return
	case "up", "ctrl+p", "shift+tab":
		p.cursor = clamp(p.cursor-1, 0, max(len(p.matches)-1, 0))
		return
	}
	var cmd tea.Cmd
	before := p.input.Value()
	p.input, cmd = p.input.Update(msg)
	m.do(cmd)
	if p.input.Value() != before {
		p.cursor = 0
		p.filter()
	}
}

func (m *Model) folderOf(feedID int64) int64 {
	for _, f := range m.feeds {
		if f.ID == feedID {
			return f.FolderID
		}
	}
	return 0
}

func (m *Model) viewPicker() string {
	w := clamp(m.width-8, 30, 64)
	p := &m.picker
	p.input.SetWidth(w - 4)
	lines := []string{p.input.View(), m.st.sep.Render(strings.Repeat("─", w))}
	const rows = 12
	start := clamp(p.cursor-rows+1, 0, max(len(p.matches)-rows, 0))
	for i := start; i < len(p.matches) && i < start+rows; i++ {
		e := p.matches[i]
		name := e.title
		if e.kind == sideFeed && e.folder != "" {
			name = m.st.muted.Render(e.folder+" › ") + name
		}
		if e.kind == sideFolder {
			name += m.st.muted.Render("/")
		}
		bar := "  "
		if i == p.cursor {
			bar = m.st.bar.Render("▌ ")
			name = m.st.boxSel.Render(ansi.Strip(name))
		}
		count := ""
		if e.unread > 0 {
			count = m.st.sideCount.Render(fmt.Sprint(e.unread))
		}
		lines = append(lines, spread(bar+name, count, w))
	}
	if len(p.matches) == 0 {
		lines = append(lines, m.st.muted.Render("  no matches"))
	}
	for len(lines) < rows+2 {
		lines = append(lines, "")
	}
	return m.st.box.Padding(0, 1).Render(strings.Join(lines, "\n"))
}

// fuzzy reports whether every rune of q appears in s in order, scoring
// consecutive runs and word starts higher.
func fuzzy(q, s string) (int, bool) {
	qr := []rune(strings.ToLower(q))
	sr := []rune(strings.ToLower(s))
	score, si, prev := 0, 0, -2
	for _, c := range qr {
		if unicode.IsSpace(c) {
			continue
		}
		found := -1
		for j := si; j < len(sr); j++ {
			if sr[j] == c {
				found = j
				break
			}
		}
		if found < 0 {
			return 0, false
		}
		score++
		if found == prev+1 {
			score += 3
		}
		if found == 0 || !unicode.IsLetter(sr[found-1]) && !unicode.IsDigit(sr[found-1]) {
			score += 2
		}
		prev, si = found, found+1
	}
	return score*10 - len(sr)/4, true
}
