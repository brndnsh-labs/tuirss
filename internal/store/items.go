package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type Item struct {
	ID          int64
	FeedID      int64
	GUID        string // stable per-feed key; required
	RemoteID    string
	URL         string
	Title       string
	Author      string
	Summary     string // usually HTML
	Content     string // usually HTML; may be empty when the feed only sends summaries
	PublishedAt time.Time
	UpdatedAt   time.Time
	FetchedAt   time.Time
	Read        bool
	Starred     bool
	FeedTitle   string // filled in by queries
	// FullContent is the article text extracted from the web page, if
	// fetched; FullError is why extraction failed, if it did.
	FullContent  string
	FullError    string
	FeedFullText bool // the feed prefers full text
}

// UpsertItems inserts new items and refreshes the text of existing ones, matched
// by (feed, GUID). Read and starred state of existing items is never touched.
// It returns how many items were new.
func (s *Store) UpsertItems(ctx context.Context, feedID int64, items []Item) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	exists, err := tx.PrepareContext(ctx, `SELECT 1 FROM items WHERE feed_id = ? AND guid = ?`)
	if err != nil {
		return 0, err
	}
	defer exists.Close()
	upsert, err := tx.PrepareContext(ctx, `
		INSERT INTO items (feed_id, guid, remote_id, url, title, author, summary, content,
		                   published_at, updated_at, fetched_at, is_read, is_starred)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (feed_id, guid) DO UPDATE SET
			remote_id    = CASE WHEN excluded.remote_id != '' THEN excluded.remote_id ELSE items.remote_id END,
			url          = excluded.url,
			title        = excluded.title,
			author       = excluded.author,
			summary      = excluded.summary,
			content      = excluded.content,
			published_at = CASE WHEN excluded.published_at > 0 THEN excluded.published_at ELSE items.published_at END,
			updated_at   = excluded.updated_at
		RETURNING id, full_content`)
	if err != nil {
		return 0, err
	}
	defer upsert.Close()

	now := time.Now()
	inserted := 0
	for _, it := range items {
		if it.GUID == "" {
			return 0, errors.New("store: item has no GUID")
		}
		var one int
		err := exists.QueryRowContext(ctx, feedID, it.GUID).Scan(&one)
		isNew := errors.Is(err, sql.ErrNoRows)
		if err != nil && !isNew {
			return 0, err
		}
		published := it.PublishedAt
		if published.IsZero() && isNew {
			published = now // undated items sort as "first seen"
		}
		var id int64
		var full string
		if err := upsert.QueryRowContext(ctx, feedID, it.GUID, it.RemoteID, it.URL, it.Title, it.Author,
			it.Summary, it.Content, toUnix(published), toUnix(it.UpdatedAt), now.Unix(),
			boolInt(it.Read), boolInt(it.Starred)).Scan(&id, &full); err != nil {
			return 0, err
		}
		body := it.Content
		if full != "" {
			body = full
		}
		if err := indexItem(ctx, tx, id, it.Title, it.Author, it.Summary, body); err != nil {
			return 0, err
		}
		if isNew {
			inserted++
		}
	}
	return inserted, tx.Commit()
}

// ItemQuery selects items. Zero fields don't filter.
type ItemQuery struct {
	AccountID   string
	FeedID      int64
	FolderID    int64
	UnreadOnly  bool
	StarredOnly bool
	// IncludeIDs keeps these items in an UnreadOnly result even if they've
	// been read, so a reloaded list doesn't yank away what you just read.
	IncludeIDs []int64
	// Search is free text matched against title, author and body.
	Search string
	Limit  int // default 200
	Offset int
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// ftsQuery turns what someone typed into an FTS5 query: every word must match,
// as a prefix, with FTS syntax characters neutralized by quoting.
func ftsQuery(s string) string {
	var terms []string
	for _, f := range strings.Fields(s) {
		terms = append(terms, `"`+strings.ReplaceAll(f, `"`, `""`)+`"*`)
	}
	return strings.Join(terms, " ")
}

func (q ItemQuery) where() (string, []any) {
	var conds []string
	var args []any
	if q.AccountID != "" {
		conds = append(conds, "f.account_id = ?")
		args = append(args, q.AccountID)
	}
	if q.FeedID != 0 {
		conds = append(conds, "i.feed_id = ?")
		args = append(args, q.FeedID)
	}
	if q.FolderID != 0 {
		conds = append(conds, "f.folder_id = ?")
		args = append(args, q.FolderID)
	}
	if q.UnreadOnly {
		if len(q.IncludeIDs) == 0 {
			conds = append(conds, "i.is_read = 0")
		} else {
			conds = append(conds, "(i.is_read = 0 OR i.id IN ("+placeholders(len(q.IncludeIDs))+"))")
			for _, id := range q.IncludeIDs {
				args = append(args, id)
			}
		}
	}
	if fq := ftsQuery(q.Search); fq != "" {
		conds = append(conds, "i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)")
		args = append(args, fq)
	}
	if q.StarredOnly {
		conds = append(conds, "i.is_starred = 1")
	}
	if len(conds) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

const itemSelect = `
	SELECT i.id, i.feed_id, i.guid, i.remote_id, i.url, i.title, i.author, i.summary, i.content,
	       i.published_at, i.updated_at, i.fetched_at, i.is_read, i.is_starred,
	       CASE WHEN f.title = '' THEN f.url ELSE f.title END,
	       i.full_content, i.full_error, f.full_text
	FROM items i JOIN feeds f ON f.id = i.feed_id`

func scanItem(sc scanner) (Item, error) {
	var it Item
	var pub, upd, fetched int64
	err := sc.Scan(&it.ID, &it.FeedID, &it.GUID, &it.RemoteID, &it.URL, &it.Title, &it.Author,
		&it.Summary, &it.Content, &pub, &upd, &fetched, &it.Read, &it.Starred, &it.FeedTitle,
		&it.FullContent, &it.FullError, &it.FeedFullText)
	it.PublishedAt, it.UpdatedAt, it.FetchedAt = fromUnix(pub), fromUnix(upd), fromUnix(fetched)
	return it, err
}

// Items returns matching items, newest first.
func (s *Store) Items(ctx context.Context, q ItemQuery) ([]Item, error) {
	where, args := q.where()
	limit := q.Limit
	if limit <= 0 {
		limit = 200
	}
	args = append(args, limit, q.Offset)
	rows, err := s.db.QueryContext(ctx, itemSelect+where+` ORDER BY i.published_at DESC, i.id DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Item
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func (s *Store) Item(ctx context.Context, id int64) (Item, error) {
	it, err := scanItem(s.db.QueryRowContext(ctx, itemSelect+` WHERE i.id = ?`, id))
	return it, notFound(err)
}

// SetRead changes an item's read state. For synced accounts the change is
// also queued for the next push.
func (s *Store) SetRead(ctx context.Context, id int64, read bool) error {
	return s.setFlag(ctx, "is_read", FlagRead, id, read)
}

// SetStarred changes an item's starred state, queueing it like SetRead.
func (s *Store) SetStarred(ctx context.Context, id int64, starred bool) error {
	return s.setFlag(ctx, "is_starred", FlagStarred, id, starred)
}

func (s *Store) setFlag(ctx context.Context, col, flag string, id int64, v bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE items SET `+col+` = ? WHERE id = ?`, boolInt(v), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if err := queueChanges(ctx, tx, []int64{id}, flag, v); err != nil {
		return err
	}
	return tx.Commit()
}

// MarkAllRead marks every unread item matching q as read, ignoring Limit and
// Offset, and queues the changes for synced accounts. It returns how many
// items changed.
func (s *Store) MarkAllRead(ctx context.Context, q ItemQuery) (int64, error) {
	q.UnreadOnly = true
	q.IncludeIDs = nil
	where, args := q.where()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT i.id FROM items i JOIN feeds f ON f.id = i.feed_id`+where, args...)
	if err != nil {
		return 0, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for rest := ids; len(rest) > 0; {
		n := min(len(rest), 500)
		chunk := make([]any, n)
		for i, id := range rest[:n] {
			chunk[i] = id
		}
		if _, err := tx.ExecContext(ctx, `UPDATE items SET is_read = 1 WHERE id IN (`+placeholders(n)+`)`, chunk...); err != nil {
			return 0, err
		}
		rest = rest[n:]
	}
	if err := queueChanges(ctx, tx, ids, FlagRead, true); err != nil {
		return 0, err
	}
	return int64(len(ids)), tx.Commit()
}

// SetFullContent stores extracted article text (or why extraction failed)
// and re-indexes the item for search.
func (s *Store) SetFullContent(ctx context.Context, id int64, html string, fetchErr error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	errText := ""
	if fetchErr != nil {
		errText = fetchErr.Error()
	}
	res, err := tx.ExecContext(ctx, `UPDATE items SET full_content = CASE WHEN ?1 = '' THEN full_content ELSE ?1 END, full_error = ?2 WHERE id = ?3`, html, errText, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if html != "" {
		var title, author, summary string
		if err := tx.QueryRowContext(ctx, `SELECT title, author, summary FROM items WHERE id = ?`, id).Scan(&title, &author, &summary); err != nil {
			return err
		}
		if err := indexItem(ctx, tx, id, title, author, summary, html); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// MaxItemID is the highest item id, or 0 if there are none. Ids only grow,
// so items added later have larger ones.
func (s *Store) MaxItemID(ctx context.Context) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(id), 0) FROM items`).Scan(&id)
	return id, err
}

// ItemIDsAbove returns up to limit item ids greater than id.
func (s *Store) ItemIDsAbove(ctx context.Context, id int64, limit int) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM items WHERE id > ? ORDER BY id LIMIT ?`, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// CountItems counts items matching q, ignoring Limit and Offset.
func (s *Store) CountItems(ctx context.Context, q ItemQuery) (int, error) {
	where, args := q.where()
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM items i JOIN feeds f ON f.id = i.feed_id`+where, args...).Scan(&n)
	return n, err
}

// UnreadByAccount returns the unread item count for every account.
func (s *Store) UnreadByAccount(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT f.account_id, COUNT(*) FROM items i JOIN feeds f ON f.id = i.feed_id
		WHERE i.is_read = 0 GROUP BY f.account_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// UnreadSince returns, for each feed in the account, the publish times of its
// unread items published at or after since. The TUI buckets them by day for
// its unread sparklines.
func (s *Store) UnreadSince(ctx context.Context, accountID string, since time.Time) (map[int64][]time.Time, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT i.feed_id, i.published_at FROM items i JOIN feeds f ON f.id = i.feed_id
		WHERE f.account_id = ? AND i.is_read = 0 AND i.published_at >= ?`,
		accountID, since.Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]time.Time{}
	for rows.Next() {
		var feed, pub int64
		if err := rows.Scan(&feed, &pub); err != nil {
			return nil, err
		}
		out[feed] = append(out[feed], time.Unix(pub, 0))
	}
	return out, rows.Err()
}
