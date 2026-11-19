package store

import (
	"context"
	"time"
)

type Feed struct {
	ID            int64
	AccountID     string
	FolderID      int64 // 0 = not in a folder
	FolderName    string
	RemoteID      string
	URL           string
	SiteURL       string
	Title         string
	ETag          string
	LastModified  string
	LastFetchedAt time.Time
	LastError     string
	UnreadCount   int
}

// DisplayTitle is the feed's title, falling back to its URL.
func (f Feed) DisplayTitle() string {
	if f.Title != "" {
		return f.Title
	}
	return f.URL
}

const feedSelect = `
	SELECT f.id, f.account_id, COALESCE(f.folder_id, 0), COALESCE(fo.name, ''), f.remote_id,
	       f.url, f.site_url, f.title, f.etag, f.last_modified, f.last_fetched_at, f.last_error,
	       (SELECT COUNT(*) FROM items i WHERE i.feed_id = f.id AND i.is_read = 0)
	FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id`

func scanFeed(sc scanner) (Feed, error) {
	var f Feed
	var fetched int64
	err := sc.Scan(&f.ID, &f.AccountID, &f.FolderID, &f.FolderName, &f.RemoteID,
		&f.URL, &f.SiteURL, &f.Title, &f.ETag, &f.LastModified, &fetched, &f.LastError,
		&f.UnreadCount)
	f.LastFetchedAt = fromUnix(fetched)
	return f, err
}

// AddFeed inserts a feed. It returns ErrFeedExists if the account already has its URL.
func (s *Store) AddFeed(ctx context.Context, f Feed) (Feed, error) {
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO feeds (account_id, folder_id, remote_id, url, site_url, title, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		f.AccountID, nullID(f.FolderID), f.RemoteID, f.URL, f.SiteURL, f.Title, time.Now().Unix())
	if isUniqueViolation(err) {
		return f, ErrFeedExists
	}
	if err != nil {
		return f, err
	}
	f.ID, err = res.LastInsertId()
	return f, err
}

// Feeds lists an account's feeds, sorted by folder then title, with unread counts.
func (s *Store) Feeds(ctx context.Context, accountID string) ([]Feed, error) {
	rows, err := s.db.QueryContext(ctx, feedSelect+`
		WHERE f.account_id = ?
		ORDER BY COALESCE(fo.name, '') COLLATE NOCASE,
		         CASE WHEN f.title = '' THEN f.url ELSE f.title END COLLATE NOCASE`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Feed
	for rows.Next() {
		f, err := scanFeed(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) Feed(ctx context.Context, id int64) (Feed, error) {
	f, err := scanFeed(s.db.QueryRowContext(ctx, feedSelect+` WHERE f.id = ?`, id))
	return f, notFound(err)
}

func (s *Store) FeedByURL(ctx context.Context, accountID, url string) (Feed, error) {
	f, err := scanFeed(s.db.QueryRowContext(ctx, feedSelect+` WHERE f.account_id = ? AND f.url = ?`, accountID, url))
	return f, notFound(err)
}

// DeleteFeed removes a feed and all of its items.
func (s *Store) DeleteFeed(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM feeds WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// FetchState is the outcome of fetching a feed.
type FetchState struct {
	FetchedAt    time.Time
	Err          error  // on error, only the time and error are recorded
	Title        string // empty leaves the stored value alone
	SiteURL      string // empty leaves the stored value alone
	ETag         string
	LastModified string
}

func (s *Store) RecordFetch(ctx context.Context, feedID int64, st FetchState) error {
	if st.Err != nil {
		_, err := s.db.ExecContext(ctx, `UPDATE feeds SET last_fetched_at = ?, last_error = ? WHERE id = ?`,
			toUnix(st.FetchedAt), st.Err.Error(), feedID)
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE feeds SET
			title           = CASE WHEN ?1 = '' THEN title ELSE ?1 END,
			site_url        = CASE WHEN ?2 = '' THEN site_url ELSE ?2 END,
			etag            = ?3,
			last_modified   = ?4,
			last_fetched_at = ?5,
			last_error      = ''
		WHERE id = ?6`,
		st.Title, st.SiteURL, st.ETag, st.LastModified, toUnix(st.FetchedAt), feedID)
	return err
}
