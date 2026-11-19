// Package backend defines what every account type (local feeds, FreshRSS)
// provides. Backends sync remote state into the store; the UI only reads the store.
package backend

import "context"

type Backend interface {
	// AccountID is the store account this backend owns.
	AccountID() string
	// Init creates the backend's account in the store if needed.
	Init(ctx context.Context) error
	// Sync brings the store up to date. progress may be nil.
	Sync(ctx context.Context, progress func(Progress)) (SyncResult, error)
}

type Progress struct {
	Done, Total int
	Current     string // title of the feed just finished
}

type FeedError struct {
	FeedID int64
	Title  string
	Err    error
}

type SyncResult struct {
	Feeds       int // feeds checked
	Updated     int // feeds that returned new content
	NotModified int // feeds the server said were unchanged
	NewItems    int
	Failed      []FeedError
}
