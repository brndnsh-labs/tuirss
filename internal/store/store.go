// Package store is tuirss's local SQLite cache. The UI reads only from here;
// backends write into it when they sync.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"tuirss/internal/htmltext"
)

//go:embed migrations/*.sql
var migrations embed.FS

var (
	ErrNotFound   = errors.New("not found")
	ErrFeedExists = errors.New("already subscribed to this feed")
)

type Store struct{ db *sql.DB }

// Open opens (creating if needed) the database at path and applies migrations.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	dsn := path + "?_txlock=immediate" +
		"&_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=synchronous(NORMAL)" +
		"&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("creating schema_migrations: %w", err)
	}
	applied := map[int]bool{}
	rows, err := s.db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()
	entries, err := fs.ReadDir(migrations, "migrations") // sorted by name
	if err != nil {
		return err
	}
	for _, e := range entries {
		name := e.Name()
		v, err := strconv.Atoi(strings.SplitN(name, "_", 2)[0])
		if err != nil {
			return fmt.Errorf("bad migration filename %q", name)
		}
		if applied[v] {
			continue
		}
		body, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if hook := migrationHooks[v]; hook != nil {
			if err := hook(ctx, tx); err != nil {
				tx.Rollback()
				return fmt.Errorf("migration %s: %w", name, err)
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, v, time.Now().Unix()); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// migrationHooks run Go code after a migration's SQL, in the same transaction.
var migrationHooks = map[int]func(context.Context, *sql.Tx) error{
	2: reindexSearch,
}

// reindexSearch fills items_fts from existing items, in batches.
func reindexSearch(ctx context.Context, tx *sql.Tx) error {
	type row struct {
		id                              int64
		title, author, summary, content string
	}
	var last int64
	for {
		rows, err := tx.QueryContext(ctx, `SELECT id, title, author, summary, content FROM items WHERE id > ? ORDER BY id LIMIT 500`, last)
		if err != nil {
			return err
		}
		var batch []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.title, &r.author, &r.summary, &r.content); err != nil {
				rows.Close()
				return err
			}
			batch = append(batch, r)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(batch) == 0 {
			return nil
		}
		for _, r := range batch {
			if err := indexItem(ctx, tx, r.id, r.title, r.author, r.summary, r.content); err != nil {
				return err
			}
		}
		last = batch[len(batch)-1].id
	}
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func indexItem(ctx context.Context, db execer, id int64, title, author, summary, content string) error {
	body := content
	if body == "" {
		body = summary
	}
	_, err := db.ExecContext(ctx, `INSERT OR REPLACE INTO items_fts (rowid, title, author, body) VALUES (?, ?, ?, ?)`,
		id, htmltext.PlainText(title), author, htmltext.PlainText(body))
	return err
}

func toUnix(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.Unix()
}

func fromUnix(v int64) time.Time {
	if v == 0 {
		return time.Time{}
	}
	return time.Unix(v, 0)
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullID(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

type scanner interface{ Scan(...any) error }
