package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

const (
	KindLocal    = "local"
	KindFreshRSS = "freshrss"
)

type Account struct {
	ID   string
	Kind string
	Name string
}

// EnsureAccount creates the account if needed and keeps its display name current.
func (s *Store) EnsureAccount(ctx context.Context, a Account) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO accounts (id, kind, name, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
		a.ID, a.Kind, a.Name, time.Now().Unix())
	return err
}

func (s *Store) Accounts(ctx context.Context) ([]Account, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, kind, name FROM accounts ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Account
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.Kind, &a.Name); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

type Folder struct {
	ID        int64
	AccountID string
	RemoteID  string
	Name      string
}

// EnsureFolder returns the id of the named folder, creating it if needed.
// An empty name means "no folder" and returns 0.
func (s *Store) EnsureFolder(ctx context.Context, accountID, name string) (int64, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, nil
	}
	var id int64
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO folders (account_id, name) VALUES (?, ?)
		ON CONFLICT (account_id, name) DO UPDATE SET name = excluded.name
		RETURNING id`, accountID, name).Scan(&id)
	return id, err
}

func (s *Store) Folders(ctx context.Context, accountID string) ([]Folder, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, account_id, remote_id, name FROM folders
		WHERE account_id = ? ORDER BY name COLLATE NOCASE`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Folder
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.AccountID, &f.RemoteID, &f.Name); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
