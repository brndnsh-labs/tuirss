-- Article text extracted from the web page, for summary-only feeds.
ALTER TABLE items ADD COLUMN full_content TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN full_error TEXT NOT NULL DEFAULT '';
-- Per-feed preference: show the extracted full text by default.
ALTER TABLE feeds ADD COLUMN full_text INTEGER NOT NULL DEFAULT 0;
