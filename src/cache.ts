import { Database } from "bun:sqlite";
import { itemToArticleFlags } from "./greader";
import type { Article, Feed, GReaderItem, GReaderSubscription, PendingMutation, UnreadCountResponse } from "./types";

export class CacheStore {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feeds (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT,
        html_url TEXT,
        icon_url TEXT,
        category_id TEXT,
        category_label TEXT,
        unread_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        feed_id TEXT,
        title TEXT NOT NULL,
        author TEXT,
        published INTEGER,
        updated INTEGER,
        crawl_time_msec INTEGER,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        url TEXT,
        is_read INTEGER NOT NULL DEFAULT 0,
        is_starred INTEGER NOT NULL DEFAULT 0,
        categories_json TEXT NOT NULL DEFAULT '[]',
        origin_title TEXT,
        synced_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_mutations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('read', 'starred')),
        desired_state INTEGER NOT NULL CHECK(desired_state IN (0, 1)),
        created_at INTEGER NOT NULL,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_articles_feed ON articles(feed_id);
      CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published DESC);
      CREATE INDEX IF NOT EXISTS idx_pending_mutations_created ON pending_mutations(created_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  upsertSubscriptions(subscriptions: GReaderSubscription[]): void {
    const upsertCategory = this.db.prepare(`
      INSERT INTO categories (id, label)
      VALUES ($id, $label)
      ON CONFLICT(id) DO UPDATE SET label = excluded.label
    `);
    const upsertFeed = this.db.prepare(`
      INSERT INTO feeds (id, title, url, html_url, icon_url, category_id, category_label, updated_at)
      VALUES ($id, $title, $url, $htmlUrl, $iconUrl, $categoryId, $categoryLabel, $updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        html_url = excluded.html_url,
        icon_url = excluded.icon_url,
        category_id = excluded.category_id,
        category_label = excluded.category_label,
        updated_at = excluded.updated_at
    `);

    const tx = this.db.transaction((items: GReaderSubscription[]) => {
      for (const item of items) {
        const category = item.categories?.[0] ?? null;
        if (category) {
          upsertCategory.run({ $id: category.id, $label: category.label ?? category.id });
        }

        upsertFeed.run({
          $id: item.id,
          $title: item.title ?? item.id,
          $url: item.url ?? null,
          $htmlUrl: item.htmlUrl ?? null,
          $iconUrl: item.iconUrl ?? null,
          $categoryId: category?.id ?? null,
          $categoryLabel: category?.label ?? null,
          $updatedAt: Date.now(),
        });
      }
    });

    tx(subscriptions);
  }

  upsertUnreadCounts(response: UnreadCountResponse): void {
    const update = this.db.prepare("UPDATE feeds SET unread_count = $count WHERE id = $id");
    const zero = this.db.prepare("UPDATE feeds SET unread_count = 0");

    const tx = this.db.transaction(() => {
      zero.run();
      for (const row of response.unreadcounts) {
        update.run({ $id: row.id, $count: row.count });
      }
    });

    tx();
  }

  upsertArticles(items: GReaderItem[]): void {
    const pendingStates = this.pendingDesiredStates();
    const upsert = this.db.prepare(`
      INSERT INTO articles (
        id, feed_id, title, author, published, updated, crawl_time_msec, content, summary,
        url, is_read, is_starred, categories_json, origin_title, synced_at
      )
      VALUES (
        $id, $feedId, $title, $author, $published, $updated, $crawlTimeMsec, $content, $summary,
        $url, $isRead, $isStarred, $categoriesJson, $originTitle, $syncedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        feed_id = excluded.feed_id,
        title = excluded.title,
        author = excluded.author,
        published = excluded.published,
        updated = excluded.updated,
        crawl_time_msec = excluded.crawl_time_msec,
        content = excluded.content,
        summary = excluded.summary,
        url = excluded.url,
        is_read = excluded.is_read,
        is_starred = excluded.is_starred,
        categories_json = excluded.categories_json,
        origin_title = excluded.origin_title,
        synced_at = excluded.synced_at
    `);

    const tx = this.db.transaction((rows: GReaderItem[]) => {
      for (const item of rows) {
        const flags = itemToArticleFlags(item);
        const pending = pendingStates.get(item.id);
        const content = item.content?.content ?? item.summary?.content ?? "";
        const summary = item.summary?.content ?? item.content?.content ?? "";
        const alternate = item.alternate?.find((link) => link.href)?.href ?? null;
        const canonical = item.canonical?.find((link) => link.href)?.href ?? null;

        upsert.run({
          $id: item.id,
          $feedId: item.origin?.streamId ?? null,
          $title: item.title || "(untitled)",
          $author: item.author ?? null,
          $published: item.published ?? null,
          $updated: item.updated ?? null,
          $crawlTimeMsec: item.crawlTimeMsec ? Number(item.crawlTimeMsec) : null,
          $content: content,
          $summary: summary,
          $url: alternate ?? canonical,
          $isRead: (pending?.read ?? flags.isRead) ? 1 : 0,
          $isStarred: (pending?.starred ?? flags.isStarred) ? 1 : 0,
          $categoriesJson: JSON.stringify(item.categories ?? []),
          $originTitle: item.origin?.title ?? null,
          $syncedAt: Date.now(),
        });
      }
    });

    tx(items);
  }

  listFeeds(): Feed[] {
    return this.db
      .query<FeedRow, []>(`
        SELECT
          id, title, url, html_url, icon_url, category_id, category_label, unread_count, updated_at
        FROM feeds
        ORDER BY
          CASE WHEN category_label IS NULL THEN '' ELSE category_label END COLLATE NOCASE,
          title COLLATE NOCASE
      `)
      .all()
      .map(feedFromRow);
  }

  listArticles(options: { feedId?: string | null; query?: string; unreadOnly?: boolean; starredOnly?: boolean } = {}): Article[] {
    const clauses: string[] = [];
    const params: Record<string, string | number> = {};

    if (options.feedId) {
      clauses.push("feed_id = $feedId");
      params.$feedId = options.feedId;
    }

    if (options.unreadOnly) clauses.push("is_read = 0");
    if (options.starredOnly) clauses.push("is_starred = 1");

    if (options.query?.trim()) {
      clauses.push("(title LIKE $query OR summary LIKE $query OR content LIKE $query OR origin_title LIKE $query)");
      params.$query = `%${options.query.trim()}%`;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .query<ArticleRow, Record<string, string | number>>(
        `
          SELECT *
          FROM articles
          ${where}
          ORDER BY COALESCE(published, updated, 0) DESC, id DESC
          LIMIT 500
        `,
      )
      .all(params)
      .map(articleFromRow);
  }

  getArticle(id: string): Article | null {
    const row = this.db.query<ArticleRow, [string]>("SELECT * FROM articles WHERE id = ?").get(id);
    return row ? articleFromRow(row) : null;
  }

  markArticleRead(articleId: string, read: boolean): void {
    this.db.prepare("UPDATE articles SET is_read = ? WHERE id = ?").run(read ? 1 : 0, articleId);
  }

  markArticleStarred(articleId: string, starred: boolean): void {
    this.db.prepare("UPDATE articles SET is_starred = ? WHERE id = ?").run(starred ? 1 : 0, articleId);
  }

  enqueueMutation(articleId: string, action: PendingMutation["action"], desiredState: boolean, error: string | null = null): void {
    this.db
      .prepare(
        `
          INSERT INTO pending_mutations (article_id, action, desired_state, created_at, last_error)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(articleId, action, desiredState ? 1 : 0, Date.now(), error);
  }

  listPendingMutations(): PendingMutation[] {
    return this.db
      .query<PendingMutationRow, []>("SELECT * FROM pending_mutations ORDER BY created_at ASC")
      .all()
      .map(pendingFromRow);
  }

  removePendingMutation(id: number): void {
    this.db.prepare("DELETE FROM pending_mutations WHERE id = ?").run(id);
  }

  markPendingMutationError(id: number, error: string): void {
    this.db.prepare("UPDATE pending_mutations SET last_error = ? WHERE id = ?").run(error, id);
  }

  getState(key: string): string | null {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM sync_state WHERE key = ?").get(key);
    return row?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  private pendingDesiredStates(): Map<string, { read?: boolean; starred?: boolean }> {
    const states = new Map<string, { read?: boolean; starred?: boolean }>();

    for (const mutation of this.listPendingMutations()) {
      const state = states.get(mutation.articleId) ?? {};
      if (mutation.action === "read") {
        state.read = mutation.desiredState;
      } else {
        state.starred = mutation.desiredState;
      }
      states.set(mutation.articleId, state);
    }

    return states;
  }
}

type FeedRow = {
  id: string;
  title: string;
  url: string | null;
  html_url: string | null;
  icon_url: string | null;
  category_id: string | null;
  category_label: string | null;
  unread_count: number;
  updated_at: number;
};

type ArticleRow = {
  id: string;
  feed_id: string | null;
  title: string;
  author: string | null;
  published: number | null;
  updated: number | null;
  crawl_time_msec: number | null;
  content: string;
  summary: string;
  url: string | null;
  is_read: number;
  is_starred: number;
  categories_json: string;
  origin_title: string | null;
  synced_at: number;
};

type PendingMutationRow = {
  id: number;
  article_id: string;
  action: "read" | "starred";
  desired_state: number;
  created_at: number;
  last_error: string | null;
};

function feedFromRow(row: FeedRow): Feed {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    htmlUrl: row.html_url,
    iconUrl: row.icon_url,
    categoryId: row.category_id,
    categoryLabel: row.category_label,
    unreadCount: row.unread_count,
    updatedAt: row.updated_at,
  };
}

function articleFromRow(row: ArticleRow): Article {
  return {
    id: row.id,
    feedId: row.feed_id,
    title: row.title,
    author: row.author,
    published: row.published,
    updated: row.updated,
    crawlTimeMsec: row.crawl_time_msec,
    content: row.content,
    summary: row.summary,
    url: row.url,
    isRead: row.is_read === 1,
    isStarred: row.is_starred === 1,
    categories: JSON.parse(row.categories_json) as string[],
    originTitle: row.origin_title,
    syncedAt: row.synced_at,
  };
}

function pendingFromRow(row: PendingMutationRow): PendingMutation {
  return {
    id: row.id,
    articleId: row.article_id,
    action: row.action,
    desiredState: row.desired_state === 1,
    createdAt: row.created_at,
    lastError: row.last_error,
  };
}
