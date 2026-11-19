package tui

import (
	"errors"
	"fmt"
	"log/slog"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/brndnsh-labs/tuirss/internal/backend"
)

type (
	refreshMsg      struct{}
	spinMsg         struct{}
	syncProgressMsg struct {
		account string
		p       backend.Progress
	}
	syncDoneMsg struct {
		res  backend.SyncResult
		errs map[string]error // by account id; nil entry = synced fine
	}
)

var spinner = []string{"⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"}

func spinTick() tea.Cmd {
	return tea.Tick(90*time.Millisecond, func(time.Time) tea.Msg { return spinMsg{} })
}

func (m *Model) scheduleRefresh() tea.Cmd {
	return tea.Tick(m.refresh, func(time.Time) tea.Msg { return refreshMsg{} })
}

// startSync runs every backend in a goroutine, streaming progress back as
// messages. Only one sync runs at a time.
func (m *Model) startSync() tea.Cmd {
	if m.syncing || len(m.backends) == 0 {
		return nil
	}
	m.syncing = true
	m.syncProg = backend.Progress{}
	m.syncMaxID, _ = m.store.MaxItemID(m.ctx)
	ch := make(chan tea.Msg, 32)
	m.syncCh = ch
	backends, ctx := m.backends, m.ctx
	go func() {
		var total backend.SyncResult
		errs := map[string]error{}
		for _, b := range backends {
			id := b.AccountID()
			res, err := b.Sync(ctx, func(p backend.Progress) {
				select {
				case ch <- syncProgressMsg{account: id, p: p}:
				default: // drop progress rather than block the sync
				}
			})
			total.Feeds += res.Feeds
			total.Updated += res.Updated
			total.NotModified += res.NotModified
			total.NewItems += res.NewItems
			total.Failed = append(total.Failed, res.Failed...)
			if err != nil && ctx.Err() == nil {
				slog.Error("sync failed", "account", id, "err", err)
				errs[id] = err
			} else {
				errs[id] = nil
			}
		}
		ch <- syncDoneMsg{res: total, errs: errs}
	}()
	m.startTicking()
	return m.waitSync()
}

// startTicking runs the spinner while anything is in progress.
func (m *Model) startTicking() {
	if !m.ticking {
		m.ticking = true
		m.do(spinTick())
	}
}

func (m *Model) waitSync() tea.Cmd {
	ch := m.syncCh
	if ch == nil {
		return nil
	}
	return func() tea.Msg { return <-ch }
}

func (m *Model) accountName(id string) string {
	for _, a := range m.accounts {
		if a.ID == id {
			return a.Name
		}
	}
	return id
}

func plural(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

func (m *Model) finishSync(msg syncDoneMsg) {
	// Feed failures are reported after the first sync and manual refreshes,
	// not every background refresh; the sidebar's ! marks persist either way.
	loud := m.loudSync || m.lastSync.IsZero()
	m.syncing = false
	m.syncCh = nil
	m.lastSync = m.now()
	before := m.countSnapshot()
	m.reloadAccounts()
	m.reloadSidebar()
	m.loadItems(0, true)
	if msg.res.NewItems > 0 {
		m.highlightArrivals(m.syncMaxID, before)
	}
	var failures []error
	for id, err := range msg.errs {
		if err == nil {
			delete(m.acctErr, id)
			continue
		}
		m.acctErr[id] = err.Error()
		failures = append(failures, fmt.Errorf("%s: %w", m.accountName(id), err))
	}
	switch {
	case len(failures) > 0 && loud:
		m.fail(errors.Join(failures...))
	case len(msg.res.Failed) > 0 && loud && msg.res.NewItems > 0:
		m.setStatus(fmt.Sprintf("✓ %s · %s failed", plural(msg.res.NewItems, "new article"), plural(len(msg.res.Failed), "feed")), true)
	case len(msg.res.Failed) > 0 && loud:
		m.setStatus(fmt.Sprintf("%s failed to refresh (marked ! in the sidebar)", plural(len(msg.res.Failed), "feed")), true)
	case msg.res.NewItems > 0:
		m.flash("✓ " + plural(msg.res.NewItems, "new article"))
	case loud:
		m.flash("✓ up to date")
	}
	m.loudSync = false
}
