package tui

import (
	"fmt"
	"net/url"
	"strings"

	"charm.land/lipgloss/v2"

	"tuirss/internal/htmltext"
	"tuirss/internal/render"
	"tuirss/internal/store"
)

const (
	readerPad  = 2
	maxMeasure = 88 // comfortable line length for reading
)

// ensureReader re-renders the open article when it or the pane width changes.
func (m *Model) ensureReader() {
	l := m.layout()
	if m.open == nil || !l.reader {
		return
	}
	m.reader.SetWidth(l.readerW)
	m.reader.SetHeight(l.bodyH)
	key := fmt.Sprintf("%d:%d:%v", m.open.ID, l.readerW, m.open.Starred)
	if key == m.readerKey {
		return
	}
	sameItem := strings.HasPrefix(m.readerKey, fmt.Sprintf("%d:", m.open.ID))
	y := m.reader.YOffset()
	content, links := m.article(*m.open, l.readerW)
	m.reader.SetContent(content)
	m.links = links
	m.readerKey = key
	if sameItem {
		m.reader.SetYOffset(y)
	} else {
		m.reader.GotoTop()
	}
}

func (m *Model) article(it store.Item, w int) (string, []string) {
	measure := min(max(w-2*readerPad, 20), maxMeasure)
	var b strings.Builder

	title := strings.Join(strings.Fields(it.Title), " ")
	if title == "" {
		title = "(untitled)"
	}
	b.WriteString("\n")
	b.WriteString(m.st.rTitle.Width(measure).Render(title))
	b.WriteString("\n\n")

	body := it.Content
	if strings.TrimSpace(htmltext.PlainText(body)) == "" {
		body = it.Summary
	}
	meta := []string{it.FeedTitle}
	if it.Author != "" {
		meta = append(meta, it.Author)
	}
	if !it.PublishedAt.IsZero() {
		meta = append(meta, it.PublishedAt.Local().Format("Mon Jan 2, 2006 · 3:04 PM"))
	}
	meta = append(meta, fmt.Sprintf("%d min read", render.ReadingMinutes(htmltext.PlainText(body))))
	metaLine := m.st.rMeta.Width(measure).Render(strings.Join(meta, " · "))
	if it.Starred {
		metaLine = m.st.star.Render("★ ") + metaLine
	}
	b.WriteString(metaLine)
	b.WriteString("\n")
	if it.URL != "" {
		b.WriteString(m.st.rLink.Hyperlink(it.URL).Render(shortURL(it.URL, measure)))
		b.WriteString("\n")
	}
	b.WriteString(m.st.rRule.Render(strings.Repeat("─", measure)))
	b.WriteString("\n\n")

	var links []string
	if strings.TrimSpace(htmltext.PlainText(body)) == "" {
		b.WriteString(m.st.muted.Render("This feed didn't include the article text.\nPress v to open it in your browser."))
		b.WriteString("\n")
	} else {
		res := render.HTML(body, measure, it.URL, m.st.render)
		b.WriteString(res.Body)
		links = res.Links
	}

	if len(links) > 0 {
		b.WriteString("\n")
		b.WriteString(m.st.rRule.Render(strings.Repeat("─", measure)))
		b.WriteString("\n")
		b.WriteString(m.st.render.Heading.Render("Links"))
		b.WriteString("\n")
		for i, l := range links {
			num := m.st.render.LinkRef.Render(fmt.Sprintf("[%d] ", i+1))
			b.WriteString(num + m.st.rLink.Hyperlink(l).Render(shortURL(l, measure-lipgloss.Width(num))))
			b.WriteString("\n")
		}
	}
	b.WriteString("\n")

	pad := strings.Repeat(" ", readerPad)
	lines := strings.Split(b.String(), "\n")
	for i, l := range lines {
		if l != "" {
			lines[i] = pad + l
		}
	}
	return strings.Join(lines, "\n"), links
}

// shortURL drops the scheme and trims to n cells.
func shortURL(raw string, n int) string {
	s := raw
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		s = u.Host + u.EscapedPath()
		if u.RawQuery != "" {
			s += "?" + u.RawQuery
		}
	}
	s = strings.TrimSuffix(s, "/")
	if r := []rune(s); len(r) > n && n > 1 {
		s = string(r[:n-1]) + "…"
	}
	return s
}

const logo = "▀█▀ █ █ █ █▀█ █▀ █▀\n █  █▄█ █ █▀▄ ▄█ ▄█"

func (m *Model) viewReader(w, h int) []string {
	if m.open != nil {
		return block(m.reader.View(), w, h)
	}
	// Nothing open: a splash with a summary of the current account.
	unread := m.unreadByAcct[m.account().ID]
	var sub string
	switch {
	case len(m.feeds) == 0:
		sub = "add a feed to get started"
	case unread == 0:
		sub = fmt.Sprintf("all caught up across %d feeds ✓", len(m.feeds))
	default:
		sub = fmt.Sprintf("%d unread across %d feeds", unread, len(m.feeds))
	}
	hint := m.st.muted.Render("press ") + m.st.key.Render("j") + m.st.muted.Render(" to start reading · ") +
		m.st.key.Render("?") + m.st.muted.Render(" for keys")
	content := lipgloss.JoinVertical(lipgloss.Center,
		m.st.splashLogo.Render(logo), "", m.st.splash.Render(sub), "", hint)
	return block(lipgloss.Place(w, h, lipgloss.Center, lipgloss.Center, content), w, h)
}
