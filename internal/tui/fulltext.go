package tui

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/brndnsh-labs/tuirss/internal/htmltext"
	"github.com/brndnsh-labs/tuirss/internal/store"
)

type fullTextMsg struct {
	id   int64
	html string
	err  error
}

// wantFull reports whether an article should show its extracted full text:
// the per-article choice (e) if made, else the feed's preference (E).
func (m *Model) wantFull(it store.Item) bool {
	if v, ok := m.fullMode[it.ID]; ok {
		return v
	}
	return it.FeedFullText
}

// fetchFull starts extracting an article in the background, unless it's
// already cached or in flight. retry also retries a previous failure.
func (m *Model) fetchFull(it store.Item, retry bool) {
	if m.extractor == nil || it.URL == "" || it.FullContent != "" || m.fetching[it.ID] {
		return
	}
	if it.FullError != "" && !retry {
		return
	}
	m.fetching[it.ID] = true
	m.startTicking()
	ex, st, ctx, id, u := m.extractor, m.store, m.ctx, it.ID, it.URL
	m.do(func() tea.Msg {
		html, err := ex.Extract(ctx, u)
		if ctx.Err() == nil {
			_ = st.SetFullContent(ctx, id, html, err) // the cache is best effort
		}
		return fullTextMsg{id: id, html: html, err: err}
	})
}

// readAhead fetches the article after i if it will want full text, since
// it's the likely next read.
func (m *Model) readAhead(i int) {
	if i+1 < len(m.items) && m.wantFull(m.items[i+1]) {
		m.fetchFull(m.items[i+1], false)
	}
}

func (m *Model) gotFullText(msg fullTextMsg) {
	delete(m.fetching, msg.id)
	apply := func(it *store.Item) {
		if it.ID != msg.id {
			return
		}
		if msg.err != nil {
			it.FullError = msg.err.Error()
		} else {
			it.FullContent, it.FullError = msg.html, ""
		}
	}
	for i := range m.items {
		apply(&m.items[i])
	}
	if m.open != nil {
		apply(m.open)
		if m.open.ID == msg.id {
			m.readerKey = ""
		}
	}
}

// toggleFull is e: flip the open article between feed text and full text.
func (m *Model) toggleFull() {
	if m.extractor == nil {
		return
	}
	if m.open == nil {
		m.openAt(m.cursor)
		if m.open == nil {
			return
		}
	}
	it := *m.open
	if it.URL == "" {
		m.flash("this article has no link to fetch")
		return
	}
	on := !m.wantFull(it)
	m.fullMode[it.ID] = on
	m.readerKey = ""
	if on {
		m.fetchFull(it, true)
	}
}

// toggleFeedFull is E: make the article's feed always (or never) use full text.
func (m *Model) toggleFeedFull() {
	it := m.open
	if it == nil {
		it = m.current()
	}
	if m.extractor == nil || it == nil {
		return
	}
	on := !it.FeedFullText
	if err := m.store.SetFeedFullText(m.ctx, it.FeedID, on); err != nil {
		m.fail(err)
		return
	}
	feedID := it.FeedID
	for i := range m.items {
		if m.items[i].FeedID == feedID {
			m.items[i].FeedFullText = on
			delete(m.fullMode, m.items[i].ID)
		}
	}
	if m.open != nil && m.open.FeedID == feedID {
		m.open.FeedFullText = on
		delete(m.fullMode, m.open.ID)
		m.readerKey = ""
		if on {
			m.fetchFull(*m.open, true)
			m.readAhead(m.cursor)
		}
	}
	m.reloadSidebar()
	if on {
		m.flash(fmt.Sprintf("✓ %s will always show full articles", it.FeedTitle))
	} else {
		m.flash(fmt.Sprintf("%s will show the feed's own text", it.FeedTitle))
	}
}

// looksLikeSummary guesses whether the feed only sent a teaser.
func looksLikeSummary(html string) bool {
	if strings.Contains(strings.ToLower(html), "<img") {
		return false // image posts (comics, photos) are short on purpose
	}
	return len(strings.Fields(htmltext.PlainText(html))) < 120
}
