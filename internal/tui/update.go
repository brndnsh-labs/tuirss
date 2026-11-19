package tui

import (
	"fmt"
	"os/exec"

	tea "charm.land/bubbletea/v2"
)

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	m.cmds = m.cmds[:0]
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		if m.width != 0 && (msg.Width != m.width || msg.Height != m.height) {
			m.queryTerminal() // the font size may have changed too
		}
		m.width, m.height = msg.Width, msg.Height
	case tea.KeyPressMsg:
		if quit := m.handleKey(msg); quit {
			return m, tea.Quit
		}
	case statusClearMsg:
		if msg.token == m.statusToken {
			m.status = ""
		}
	case refreshMsg:
		m.do(m.startSync())
		m.do(m.scheduleRefresh())
	case syncProgressMsg:
		m.syncProg, m.syncAcct = msg.p, msg.account
		m.do(m.waitSync())
	case syncDoneMsg:
		m.finishSync(msg)
	case spinMsg:
		m.ticking = false
		if m.syncing || len(m.fetching) > 0 {
			m.spin++
			m.startTicking()
		}
	case browserMsg:
		m.fail(msg.err)
	case fullTextMsg:
		m.gotFullText(msg)
	case imageLoadedMsg:
		m.imageLoaded(msg)
	case imagePassMsg:
		m.imagePass(msg)
	case imageDrawMsg:
		m.imageDraw(msg)
	default:
		if m.terminalReply(msg) {
			break
		}
		if m.searching {
			var cmd tea.Cmd
			m.search, cmd = m.search.Update(msg)
			m.do(cmd)
		}
	}
	m.settle()
	cmds := append([]tea.Cmd(nil), m.cmds...)
	return m, tea.Batch(cmds...)
}

// settle re-renders the reader if needed and keeps cursors in range.
func (m *Model) settle() {
	m.cursor = clamp(m.cursor, 0, max(len(m.items)-1, 0))
	m.sideCursor = clamp(m.sideCursor, 0, max(len(m.side)-1, 0))
	if m.open == nil {
		m.fullscreen = false
		m.gfx.place = m.gfx.place[:0]
	}
	m.ensureReader()
	m.scheduleImages()
}

func (m *Model) handleKey(msg tea.KeyPressMsg) (quit bool) {
	k := msg.String()
	if k == "ctrl+c" {
		return true
	}
	if m.confirm != nil {
		c := m.confirm
		m.confirm = nil
		if k == "y" || k == "Y" || k == "enter" {
			c.yes()
		} else {
			m.flash("cancelled")
		}
		return false
	}
	switch m.overlay {
	case overlayHelp:
		if k == "?" || k == "esc" || k == "q" || k == "enter" {
			m.overlay = overlayNone
		}
		return false
	case overlayPicker:
		m.pickerKey(msg)
		return false
	}
	if m.searching {
		m.searchKey(msg)
		return false
	}
	if m.pendingG {
		m.pendingG = false
		m.gKey(k)
		return false
	}

	switch k {
	case "q":
		return true
	case "?":
		m.overlay = overlayHelp

	// Items
	case "j":
		m.step(1)
	case "k":
		m.step(-1)
	case "n", "down":
		m.cursor++
	case "p", "up":
		m.cursor--
	case "o", "enter":
		if it := m.current(); it != nil {
			if m.open != nil && m.open.ID == it.ID {
				m.closeReader()
			} else {
				m.openAt(m.cursor)
			}
		}
	case "space":
		switch {
		case m.open == nil:
			m.openAt(m.cursor)
		case !m.reader.AtBottom():
			m.reader.PageDown()
		default:
			m.step(1)
		}
	case "shift+space", "b":
		switch {
		case m.open == nil:
		case !m.reader.AtTop():
			m.reader.PageUp()
		default:
			m.step(-1)
		}
	case "ctrl+d", "pgdown":
		m.reader.HalfPageDown()
	case "ctrl+u", "pgup":
		m.reader.HalfPageUp()
	case "ctrl+e":
		m.reader.ScrollDown(1)
	case "ctrl+y":
		m.reader.ScrollUp(1)
	case "G", "end":
		m.cursor = len(m.items) - 1
	case "home":
		m.cursor = 0
	case "s":
		if it := m.current(); it != nil {
			m.toggleStar(m.cursor)
		}
	case "m":
		if it := m.current(); it != nil {
			m.setRead(m.cursor, !it.Read)
		}
	case "A":
		m.askMarkAllRead()
	case "v":
		m.openInBrowser()
	case "y":
		m.yank()
	case "e":
		m.toggleFull()
	case "E":
		m.toggleFeedFull()
	case "t":
		m.unreadOnly = !m.unreadOnly
		m.loadItems(0, true)
		if m.unreadOnly {
			m.flash("showing unread articles")
		} else {
			m.flash("showing all articles")
		}

	// Sidebar and accounts
	case "J", "N":
		m.selectSide(m.sideCursor + 1)
	case "K", "P":
		m.selectSide(m.sideCursor - 1)
	case "]", "tab":
		m.enterAccount(m.acct + 1)
	case "[", "shift+tab":
		m.enterAccount(m.acct - 1)
	case "x":
		m.toggleFolder()
	case "g":
		m.pendingG = true

	// Layout
	case "u":
		m.showSidebar = !m.showSidebar
	case "f", "z":
		if m.open != nil {
			m.fullscreen = !m.fullscreen
		}
	case "/":
		m.searching = true
		m.search.SetValue(m.query)
		m.search.CursorEnd()
		m.do(m.search.Focus())
	case "esc":
		switch {
		case m.query != "":
			m.query = ""
			m.loadItems(0, false)
		case m.fullscreen:
			m.fullscreen = false
		case m.open != nil:
			m.closeReader()
		}
	case "r":
		if m.syncing {
			m.flash("already syncing…")
		} else {
			m.loudSync = true
			m.do(m.startSync())
		}
	}
	return false
}

// step moves to the next/previous item and opens it, Google Reader style. If
// nothing is open yet, it opens the item under the cursor.
func (m *Model) step(delta int) {
	if len(m.items) == 0 {
		return
	}
	if m.open == nil {
		m.openAt(m.cursor)
		return
	}
	next := m.cursor + delta
	if next < 0 || next >= len(m.items) {
		if delta > 0 {
			m.flash("that's the last article")
		}
		return
	}
	m.openAt(next)
}

func (m *Model) gKey(k string) {
	switch k {
	case "a", "h":
		m.selectSide(1)
	case "s":
		m.selectSide(0)
	case "u", "f":
		m.openPicker()
	case "g":
		m.cursor = 0
	case "1", "2", "3", "4", "5", "6", "7", "8", "9":
		i := int(k[0] - '1')
		if i < len(m.accounts) {
			m.enterAccount(i)
		}
	}
}

func (m *Model) searchKey(msg tea.KeyPressMsg) {
	switch msg.String() {
	case "esc":
		m.searching = false
		m.search.Blur()
		if m.query != "" {
			m.query = ""
			m.loadItems(0, false)
		}
		return
	case "enter":
		m.searching = false
		m.search.Blur()
		return
	case "down", "ctrl+n":
		m.cursor++
		return
	case "up", "ctrl+p":
		m.cursor--
		return
	}
	var cmd tea.Cmd
	m.search, cmd = m.search.Update(msg)
	m.do(cmd)
	if v := m.search.Value(); v != m.query {
		m.query = v
		m.closeReader()
		m.loadItems(0, false)
	}
}

func (m *Model) toggleFolder() {
	if m.sideCursor >= len(m.side) || m.side[m.sideCursor].kind != sideFolder {
		m.flash("x expands/collapses folders: select one with J/K")
		return
	}
	id := m.side[m.sideCursor].id
	m.collapsed[id] = !m.collapsed[id]
	m.reloadSidebar()
}

func (m *Model) askMarkAllRead() {
	q := m.itemQuery()
	q.UnreadOnly, q.IncludeIDs = true, nil
	n, err := m.store.CountItems(m.ctx, q)
	if err != nil {
		m.fail(err)
		return
	}
	if n == 0 {
		m.flash("nothing unread here")
		return
	}
	m.confirm = &confirmation{
		prompt: fmt.Sprintf("Mark %d articles in %s as read?", n, m.viewTitle()),
		yes:    m.markAllRead,
	}
}

type browserMsg struct{ err error }

func (m *Model) targetURL() string {
	if it := m.current(); it != nil && it.URL != "" {
		return it.URL
	}
	if m.open != nil {
		return m.open.URL
	}
	return ""
}

func (m *Model) openInBrowser() {
	u := m.targetURL()
	if u == "" {
		m.flash("this article has no link")
		return
	}
	m.flash("opening in browser…")
	m.do(func() tea.Msg {
		cmd := exec.Command("xdg-open", u)
		if err := cmd.Start(); err != nil {
			return browserMsg{fmt.Errorf("opening browser: %w", err)}
		}
		go cmd.Wait()
		return nil
	})
}

func (m *Model) yank() {
	u := m.targetURL()
	if u == "" {
		m.flash("this article has no link")
		return
	}
	m.do(tea.SetClipboard(u))
	m.flash("✓ copied link")
}
