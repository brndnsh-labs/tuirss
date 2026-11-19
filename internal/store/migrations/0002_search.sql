-- Full-text search over items. The app writes plain text (HTML stripped) into
-- this table whenever it saves an item; the trigger keeps deletes in step.
CREATE VIRTUAL TABLE items_fts USING fts5(
    title, author, body,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
    DELETE FROM items_fts WHERE rowid = old.id;
END;
