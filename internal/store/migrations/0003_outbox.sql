-- Read/star changes made locally to items in synced accounts, waiting to be
-- pushed. One row per (item, flag): later changes overwrite earlier ones, so
-- only the final state is sent. version guards against clearing a row that
-- changed while a push was in flight.
CREATE TABLE outbox (
    id         INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    remote_id  TEXT NOT NULL,
    flag       TEXT NOT NULL,     -- 'read' | 'starred'
    value      INTEGER NOT NULL,  -- 1 = set, 0 = clear
    version    INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    UNIQUE (item_id, flag)
);

CREATE INDEX outbox_by_account ON outbox (account_id);
CREATE INDEX items_by_remote_id ON items (remote_id) WHERE remote_id != '';
