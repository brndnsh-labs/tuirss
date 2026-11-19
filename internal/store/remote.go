package store

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

const (
	FlagRead    = "read"
	FlagStarred = "starred"
)

// Change is a queued local read/star change for a synced account.
type Change struct {
	ID       int64
	ItemID   int64
	RemoteID string
	Flag     string // FlagRead or FlagStarred
	Value    bool
	Version  int
	Attempts int
}

type queryer interface {
	execer
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// queueChanges records flag changes for items that belong to synced accounts.
// Items in local accounts are skipped by the query itself.
func queueChanges(ctx context.Context, tx queryer, ids []int64, flag string, v bool) error {
	now := time.Now().Unix()
	for len(ids) > 0 {
		n := min(len(ids), 500)
		chunk := ids[:n]
		ids = ids[n:]
		args := []any{flag, boolInt(v), now}
		for _, id := range chunk {
			args = append(args, id)
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO outbox (account_id, item_id, remote_id, flag, value, created_at)
			SELECT f.account_id, i.id, i.remote_id, ?, ?, ?
			FROM items i JOIN feeds f ON f.id = i.feed_id JOIN accounts a ON a.id = f.account_id
			WHERE i.id IN (`+placeholders(len(chunk))+`) AND a.kind != 'local' AND i.remote_id != ''
			ON CONFLICT (item_id, flag) DO UPDATE SET
				value = excluded.value, created_at = excluded.created_at,
				version = outbox.version + 1, attempts = 0, last_error = ''`, args...)
		if err != nil {
			return err
		}
	}
	return nil
}

// PendingChanges lists queued changes for an account, oldest first.
func (s *Store) PendingChanges(ctx context.Context, accountID string) ([]Change, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, item_id, remote_id, flag, value, version, attempts
		FROM outbox WHERE account_id = ? ORDER BY id`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Change
	for rows.Next() {
		var c Change
		if err := rows.Scan(&c.ID, &c.ItemID, &c.RemoteID, &c.Flag, &c.Value, &c.Version, &c.Attempts); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ClearChanges removes pushed changes, unless they were changed again since
// they were read (their version moved on).
func (s *Store) ClearChanges(ctx context.Context, changes []Change) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, c := range changes {
		if _, err := tx.ExecContext(ctx, `DELETE FROM outbox WHERE id = ? AND version = ?`, c.ID, c.Version); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// FailChanges records a failed push attempt.
func (s *Store) FailChanges(ctx context.Context, changes []Change, cause error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, c := range changes {
		if _, err := tx.ExecContext(ctx, `UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?`, cause.Error(), c.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RemoteFeed is a subscription as a sync server describes it.
type RemoteFeed struct {
	RemoteID       string
	URL            string
	SiteURL        string
	Title          string
	Folder         string
	FolderRemoteID string
}

// SyncFeeds makes the account's feeds match the server's list: new ones are
// added, existing ones updated, and ones gone from the server removed (with
// their items). It returns remote id → local feed id.
func (s *Store) SyncFeeds(ctx context.Context, accountID string, feeds []RemoteFeed) (map[string]int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	now := time.Now().Unix()
	ids := map[string]int64{}
	for _, rf := range feeds {
		var folderID any
		if name := strings.TrimSpace(rf.Folder); name != "" {
			var id int64
			if err := tx.QueryRowContext(ctx, `
				INSERT INTO folders (account_id, remote_id, name) VALUES (?, ?, ?)
				ON CONFLICT (account_id, name) DO UPDATE SET remote_id = excluded.remote_id
				RETURNING id`, accountID, rf.FolderRemoteID, name).Scan(&id); err != nil {
				return nil, err
			}
			folderID = id
		}
		var id int64
		err := tx.QueryRowContext(ctx, `
			UPDATE feeds SET url = ?, site_url = ?, title = ?, folder_id = ?
			WHERE account_id = ? AND remote_id = ? RETURNING id`,
			rf.URL, rf.SiteURL, rf.Title, folderID, accountID, rf.RemoteID).Scan(&id)
		if err == sql.ErrNoRows {
			err = tx.QueryRowContext(ctx, `
				INSERT INTO feeds (account_id, folder_id, remote_id, url, site_url, title, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (account_id, url) DO UPDATE SET
					remote_id = excluded.remote_id, site_url = excluded.site_url,
					title = excluded.title, folder_id = excluded.folder_id
				RETURNING id`,
				accountID, folderID, rf.RemoteID, rf.URL, rf.SiteURL, rf.Title, now).Scan(&id)
		}
		if err != nil {
			return nil, err
		}
		ids[rf.RemoteID] = id
	}

	rows, err := tx.QueryContext(ctx, `SELECT id FROM feeds WHERE account_id = ?`, accountID)
	if err != nil {
		return nil, err
	}
	keep := map[int64]bool{}
	for _, id := range ids {
		keep[id] = true
	}
	var gone []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		if !keep[id] {
			gone = append(gone, id)
		}
	}
	rows.Close()
	for _, id := range gone {
		if _, err := tx.ExecContext(ctx, `DELETE FROM feeds WHERE id = ?`, id); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM folders WHERE account_id = ? AND id NOT IN (SELECT folder_id FROM feeds WHERE folder_id IS NOT NULL)`, accountID); err != nil {
		return nil, err
	}
	return ids, tx.Commit()
}

// RemoteItemIDs returns the remote ids of the account's cached items.
func (s *Store) RemoteItemIDs(ctx context.Context, accountID string) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT i.remote_id FROM items i JOIN feeds f ON f.id = i.feed_id
		WHERE f.account_id = ? AND i.remote_id != ''`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// ApplyRemoteState sets read/starred on the account's cached items from the
// server's full unread and starred id sets. Items with a pending local change
// to a flag keep their local value for that flag.
func (s *Store) ApplyRemoteState(ctx context.Context, accountID string, unread, starred []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, t := range []struct {
		table string
		ids   []string
	}{{"sync_unread", unread}, {"sync_starred", starred}} {
		if _, err := tx.ExecContext(ctx, `CREATE TEMP TABLE IF NOT EXISTS `+t.table+` (id TEXT PRIMARY KEY)`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM temp.`+t.table); err != nil {
			return err
		}
		for _, id := range t.ids {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO temp.`+t.table+` (id) VALUES (?)`, id); err != nil {
				return err
			}
		}
	}
	const scope = `remote_id != '' AND feed_id IN (SELECT id FROM feeds WHERE account_id = ?)`
	if _, err := tx.ExecContext(ctx, `
		UPDATE items SET is_read = (remote_id NOT IN (SELECT id FROM temp.sync_unread))
		WHERE `+scope+` AND id NOT IN (SELECT item_id FROM outbox WHERE flag = 'read')`, accountID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE items SET is_starred = (remote_id IN (SELECT id FROM temp.sync_starred))
		WHERE `+scope+` AND id NOT IN (SELECT item_id FROM outbox WHERE flag = 'starred')`, accountID); err != nil {
		return err
	}
	for _, t := range []string{"sync_unread", "sync_starred"} {
		if _, err := tx.ExecContext(ctx, `DROP TABLE temp.`+t); err != nil {
			return err
		}
	}
	return tx.Commit()
}
