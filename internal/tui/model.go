// Package tui is tuirss's terminal interface. It reads and writes only the
// local store; backends sync in the background.
package tui

import (
	"context"
	"fmt"
	"sort"
	"time"

	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"

	"tuirss/internal/backend"
	"tuirss/internal/store"
)

type Options struct {
	Store           *store.Store
	Backends        []backend.Backend
	RefreshInterval time.Duration
	FullText        Extractor // optional; enables e / E
	NoImages        bool      // don't draw inline images even if the terminal can
}

// Extractor fetches an article's page and returns its main content as HTML.
type Extractor interface {
	Extract(ctx context.Context, pageURL string) (string, error)
}

// Run starts the TUI and blocks until it exits.
func Run(ctx context.Context, opts Options) error {
	_, err := tea.NewProgram(New(ctx, opts), tea.WithContext(ctx)).Run()
	return err
}

type sideKind int

const (
	sideStarred sideKind = iota
	sideAll
	sideFolder
	sideFeed
)

type sideEntry struct {
	kind      sideKind
	id        int64 // folder or feed id
	title     string
	folder    string // for feeds: the folder name, if any
	unread    int
	depth     int
	hasErr    bool
	collapsed bool
}

func (e sideEntry) key() string { return fmt.Sprintf("%d:%d", e.kind, e.id) }

type acctState struct {
	view   sideEntry
	itemID int64
}

type overlayKind int

const (
	overlayNone overlayKind = iota
	overlayHelp
	overlayPicker
)

type confirmation struct {
	prompt string
	yes    func()
}

type Model struct {
	ctx      context.Context
	store    *store.Store
	backends []backend.Backend
	refresh  time.Duration
	st       styles
	now      func() time.Time
	cmds     []tea.Cmd // collected during Update

	width, height int

	accounts     []store.Account
	unreadByAcct map[string]int
	acctErr      map[string]string // last sync error per account
	acct         int
	saved        map[string]acctState

	feeds      []store.Feed
	starred    int
	side       []sideEntry
	sideCursor int
	sideOffset int
	collapsed  map[int64]bool
	view       sideEntry
	unreadOnly bool

	items      []store.Item
	cursor     int
	listOffset int
	excerpts   map[int64]string

	extractor Extractor
	gfx       gfxState
	fullMode  map[int64]bool // per-article e overrides for this session
	fetching  map[int64]bool // full-text extractions in flight
	ticking   bool           // spinner tick loop running

	open      *store.Item // the item in the reader
	reader    viewport.Model
	readerKey string
	links     []string

	showSidebar bool
	fullscreen  bool

	overlay overlayKind
	picker  picker

	searching bool
	search    textinput.Model
	query     string

	confirm  *confirmation
	pendingG bool

	status      string
	statusErr   bool
	statusToken int

	syncing  bool
	loudSync bool // the user asked for this sync
	syncCh   chan tea.Msg
	syncProg backend.Progress
	syncAcct string
	lastSync time.Time
	spin     int
}

func New(ctx context.Context, opts Options) *Model {
	ti := textinput.New()
	ti.Prompt = "/ "
	ti.Placeholder = "search titles, authors and text"
	refresh := opts.RefreshInterval
	if refresh <= 0 {
		refresh = 30 * time.Minute
	}
	return &Model{
		ctx:          ctx,
		store:        opts.Store,
		backends:     opts.Backends,
		refresh:      refresh,
		st:           newStyles(),
		now:          time.Now,
		saved:        map[string]acctState{},
		collapsed:    map[int64]bool{},
		excerpts:     map[int64]string{},
		unreadByAcct: map[string]int{},
		acctErr:      map[string]string{},
		unreadOnly:   true,
		extractor:    opts.FullText,
		gfx:          newGfx(opts.NoImages),
		fullMode:     map[int64]bool{},
		fetching:     map[int64]bool{},
		showSidebar:  true,
		reader:       viewport.New(),
		search:       ti,
		picker:       newPicker(),
	}
}

func (m *Model) Init() tea.Cmd {
	m.reloadAccounts()
	m.enterAccount(0)
	m.do(m.scheduleRefresh())
	m.do(m.startSync())
	m.queryTerminal()
	cmds := m.cmds
	m.cmds = nil
	return tea.Batch(cmds...)
}

func (m *Model) do(cmd tea.Cmd) {
	if cmd != nil {
		m.cmds = append(m.cmds, cmd)
	}
}

// --- status line -----------------------------------------------------------

type statusClearMsg struct{ token int }

func (m *Model) flash(text string) { m.setStatus(text, false) }

func (m *Model) fail(err error) {
	if err != nil {
		m.setStatus("✗ "+err.Error(), true)
	}
}

func (m *Model) setStatus(text string, isErr bool) {
	m.status, m.statusErr = text, isErr
	m.statusToken++
	tok := m.statusToken
	d := 4 * time.Second
	if isErr {
		d = 8 * time.Second
	}
	m.do(tea.Tick(d, func(time.Time) tea.Msg { return statusClearMsg{tok} }))
}

// --- accounts and sidebar --------------------------------------------------

func (m *Model) account() store.Account {
	if m.acct < len(m.accounts) {
		return m.accounts[m.acct]
	}
	return store.Account{}
}

func (m *Model) reloadAccounts() {
	accts, err := m.store.Accounts(m.ctx)
	if err != nil {
		m.fail(err)
		return
	}
	have := map[string]bool{}
	for _, b := range m.backends {
		have[b.AccountID()] = true
	}
	var out []store.Account
	for _, a := range accts {
		if have[a.ID] {
			out = append(out, a)
		}
	}
	// Synced accounts first; local feeds last, like Reeder's "On My Device".
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Kind != store.KindLocal && out[j].Kind == store.KindLocal
	})
	cur := m.account().ID
	m.accounts = out
	for i, a := range out {
		if a.ID == cur {
			m.acct = i
		}
	}
	if u, err := m.store.UnreadByAccount(m.ctx); err == nil {
		m.unreadByAcct = u
	}
}

func (m *Model) reloadSidebar() {
	a := m.account()
	feeds, err := m.store.Feeds(m.ctx, a.ID)
	if err != nil {
		m.fail(err)
		return
	}
	m.feeds = feeds
	m.starred, _ = m.store.CountItems(m.ctx, store.ItemQuery{AccountID: a.ID, StarredOnly: true})
	key := m.view.key()
	m.side = buildSidebar(feeds, m.starred, m.unreadByAcct[a.ID], m.collapsed)
	m.sideCursor = clamp(m.sideCursor, 0, len(m.side)-1)
	for i, e := range m.side {
		if e.key() == key {
			m.sideCursor = i
			m.view = e // fresh counts
		}
	}
}

func buildSidebar(feeds []store.Feed, starred, unread int, collapsed map[int64]bool) []sideEntry {
	out := []sideEntry{
		{kind: sideStarred, title: "Starred", unread: starred},
		{kind: sideAll, title: "All articles", unread: unread},
	}
	var loose []store.Feed
	for i := 0; i < len(feeds); {
		f := feeds[i]
		if f.FolderID == 0 {
			loose = append(loose, f)
			i++
			continue
		}
		j, sum, anyErr := i, 0, false
		for j < len(feeds) && feeds[j].FolderID == f.FolderID {
			sum += feeds[j].UnreadCount
			anyErr = anyErr || feeds[j].LastError != ""
			j++
		}
		out = append(out, sideEntry{kind: sideFolder, id: f.FolderID, title: f.FolderName, unread: sum, hasErr: anyErr, collapsed: collapsed[f.FolderID]})
		if !collapsed[f.FolderID] {
			for _, ff := range feeds[i:j] {
				out = append(out, feedEntry(ff, 1))
			}
		}
		i = j
	}
	for _, f := range loose {
		out = append(out, feedEntry(f, 0))
	}
	return out
}

func feedEntry(f store.Feed, depth int) sideEntry {
	return sideEntry{kind: sideFeed, id: f.ID, title: f.DisplayTitle(), folder: f.FolderName, unread: f.UnreadCount, depth: depth, hasErr: f.LastError != ""}
}

// enterAccount switches to account i, restoring where you were in it.
func (m *Model) enterAccount(i int) {
	if len(m.accounts) == 0 {
		return
	}
	if cur := m.account(); cur.ID != "" && len(m.side) > 0 {
		st := acctState{view: m.view}
		if m.cursor < len(m.items) {
			st.itemID = m.items[m.cursor].ID
		}
		m.saved[cur.ID] = st
	}
	m.acct = (i%len(m.accounts) + len(m.accounts)) % len(m.accounts)
	m.closeReader()
	m.query = ""
	saved, ok := m.saved[m.account().ID]
	m.view = sideEntry{kind: sideAll}
	if ok {
		m.view = saved.view
	}
	m.reloadSidebar()
	m.sideOffset = 0
	m.loadItems(saved.itemID, false)
}

// selectSide opens sidebar entry i in the item list.
func (m *Model) selectSide(i int) {
	if i < 0 || i >= len(m.side) {
		return
	}
	m.sideCursor = i
	m.view = m.side[i]
	m.query = ""
	m.closeReader()
	m.loadItems(0, false)
}

// --- items -----------------------------------------------------------------

func (m *Model) itemQuery() store.ItemQuery {
	q := store.ItemQuery{AccountID: m.account().ID, Limit: 1000}
	if m.query != "" {
		q.Search = m.query
		return q
	}
	switch m.view.kind {
	case sideStarred:
		q.StarredOnly = true
		return q
	case sideFolder:
		q.FolderID = m.view.id
	case sideFeed:
		q.FeedID = m.view.id
	}
	q.UnreadOnly = m.unreadOnly
	return q
}

// loadItems re-queries the list. With preserve, items read since the last
// load stay visible (so the list doesn't shift under you) and the cursor
// stays on the same item.
func (m *Model) loadItems(keepID int64, preserve bool) {
	q := m.itemQuery()
	if preserve {
		if keepID == 0 && m.cursor < len(m.items) {
			keepID = m.items[m.cursor].ID
		}
		if q.UnreadOnly {
			for _, it := range m.items {
				if it.Read {
					q.IncludeIDs = append(q.IncludeIDs, it.ID)
				}
			}
		}
	}
	items, err := m.store.Items(m.ctx, q)
	if err != nil {
		m.fail(err)
		return
	}
	m.items = items
	if !preserve {
		m.cursor, m.listOffset = 0, 0
	}
	if keepID != 0 {
		for i, it := range items {
			if it.ID == keepID {
				m.cursor = i
			}
		}
	}
	m.cursor = clamp(m.cursor, 0, max(len(items)-1, 0))
}

func (m *Model) current() *store.Item {
	if m.cursor >= 0 && m.cursor < len(m.items) {
		return &m.items[m.cursor]
	}
	return nil
}

func (m *Model) openAt(i int) {
	if i < 0 || i >= len(m.items) {
		return
	}
	m.cursor = i
	it := m.items[i]
	m.open = &it
	m.readerKey = ""
	m.reader.GotoTop()
	m.setRead(i, true)
	if m.wantFull(it) {
		m.fetchFull(it, false)
		m.readAhead(i)
	}
}

func (m *Model) closeReader() {
	m.open = nil
	m.fullscreen = false
	m.readerKey = ""
}

func (m *Model) setRead(i int, read bool) {
	it := &m.items[i]
	if it.Read == read {
		return
	}
	if err := m.store.SetRead(m.ctx, it.ID, read); err != nil {
		m.fail(err)
		return
	}
	it.Read = read
	if m.open != nil && m.open.ID == it.ID {
		m.open.Read = read
	}
	m.refreshCounts()
}

func (m *Model) toggleStar(i int) {
	it := &m.items[i]
	if err := m.store.SetStarred(m.ctx, it.ID, !it.Starred); err != nil {
		m.fail(err)
		return
	}
	it.Starred = !it.Starred
	if m.open != nil && m.open.ID == it.ID {
		m.open.Starred = it.Starred
		m.readerKey = ""
	}
	m.refreshCounts()
}

func (m *Model) refreshCounts() {
	if u, err := m.store.UnreadByAccount(m.ctx); err == nil {
		m.unreadByAcct = u
	}
	m.reloadSidebar()
}

func (m *Model) markAllRead() {
	q := m.itemQuery()
	n, err := m.store.MarkAllRead(m.ctx, q)
	if err != nil {
		m.fail(err)
		return
	}
	for i := range m.items {
		m.items[i].Read = true
	}
	if m.open != nil {
		m.open.Read = true
	}
	m.refreshCounts()
	m.flash(fmt.Sprintf("✓ marked %d articles read", n))
}

func clamp(v, lo, hi int) int {
	if hi < lo {
		return lo
	}
	return min(max(v, lo), hi)
}
