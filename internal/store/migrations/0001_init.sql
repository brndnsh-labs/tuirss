-- Timestamps are unix seconds; 0 means "unknown".

CREATE TABLE accounts (
    id         TEXT PRIMARY KEY,          -- "local", "freshrss:<name>"
    kind       TEXT NOT NULL,             -- "local" | "freshrss"
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE folders (
    id         INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    remote_id  TEXT NOT NULL DEFAULT '',  -- e.g. "user/-/label/Tech" for FreshRSS
    name       TEXT NOT NULL,
    UNIQUE (account_id, name)
);

CREATE TABLE feeds (
    id              INTEGER PRIMARY KEY,
    account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder_id       INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    remote_id       TEXT NOT NULL DEFAULT '',  -- e.g. "feed/42" for FreshRSS
    url             TEXT NOT NULL,
    site_url        TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    etag            TEXT NOT NULL DEFAULT '',
    last_modified   TEXT NOT NULL DEFAULT '',
    last_fetched_at INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL,
    UNIQUE (account_id, url)
);

CREATE TABLE items (
    id           INTEGER PRIMARY KEY,
    feed_id      INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid         TEXT NOT NULL,              -- stable per-feed key used for dedupe
    remote_id    TEXT NOT NULL DEFAULT '',   -- FreshRSS item id
    url          TEXT NOT NULL DEFAULT '',
    title        TEXT NOT NULL DEFAULT '',
    author       TEXT NOT NULL DEFAULT '',
    summary      TEXT NOT NULL DEFAULT '',
    content      TEXT NOT NULL DEFAULT '',
    published_at INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL DEFAULT 0,
    fetched_at   INTEGER NOT NULL,
    is_read      INTEGER NOT NULL DEFAULT 0,
    is_starred   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (feed_id, guid)
);

CREATE INDEX items_by_feed    ON items (feed_id, published_at DESC);
CREATE INDEX items_by_date    ON items (published_at DESC);
CREATE INDEX items_unread     ON items (feed_id) WHERE is_read = 0;
CREATE INDEX items_starred    ON items (published_at DESC) WHERE is_starred = 1;
