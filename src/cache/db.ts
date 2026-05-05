import { Database } from 'bun:sqlite'
import { join, dirname } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { getDataDir } from '../config/index.ts'
import type { Feed, Article } from '../api/types.ts'

export class Cache {
  private db: Database

  constructor(dbPath?: string) {
    const path = dbPath || join(getDataDir(), 'cache.db')
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.db = new Database(path)
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feeds (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        html_url TEXT,
        category_id TEXT,
        category_name TEXT,
        unread_count INTEGER DEFAULT 0,
        last_updated INTEGER
      );

      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        feed_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        content TEXT,
        summary TEXT,
        url TEXT,
        published_at INTEGER,
        is_read BOOLEAN DEFAULT FALSE,
        is_starred BOOLEAN DEFAULT FALSE,
        fetched_at INTEGER,
        FOREIGN KEY (feed_id) REFERENCES feeds(id)
      );

      CREATE INDEX IF NOT EXISTS idx_articles_feed ON articles(feed_id);
      CREATE INDEX IF NOT EXISTS idx_articles_read ON articles(is_read);
      CREATE INDEX IF NOT EXISTS idx_articles_starred ON articles(is_starred);
      CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
    `)
  }

  saveFeeds(feeds: Feed[]): void {
    const insert = this.db.query(`
      INSERT OR REPLACE INTO feeds
      (id, title, url, html_url, category_id, category_name, unread_count, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const feed of feeds) {
      insert.run(
        feed.id ?? null,
        feed.title ?? null,
        feed.url ?? null,
        feed.htmlUrl ?? null,
        feed.categories?.[0]?.id ?? null,
        feed.categories?.[0]?.label ?? null,
        feed.unreadCount ?? 0,
        Date.now()
      )
    }
  }

  getFeeds(): Feed[] {
    const query = this.db.query('SELECT * FROM feeds ORDER BY title')
    const rows = query.all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      url: row.url as string,
      htmlUrl: row.html_url as string,
      categories: row.category_id
        ? [{ id: row.category_id as string, label: row.category_name as string }]
        : [],
      unreadCount: row.unread_count as number,
    }))
  }

  saveArticles(articles: Article[]): void {
    const insert = this.db.query(`
      INSERT OR REPLACE INTO articles
      (id, feed_id, title, author, content, summary, url, published_at, is_read, is_starred, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const article of articles) {
      const isRead = article.categories?.includes('user/-/state/com.google/read') ?? false
      const isStarred = article.categories?.includes('user/-/state/com.google/starred') ?? false

      const values = [
        article.id ?? null,
        article.origin?.streamId ?? null,
        article.title ?? null,
        article.author ?? null,
        article.content ?? null,
        article.summary?.content ?? null,
        article.alternate?.[0]?.href ?? null,
        article.published ?? null,
        isRead ? 1 : 0,
        isStarred ? 1 : 0,
        Date.now(),
      ]

      // Debug: check for undefined values
      insert.run(...values)
    }
  }

  getArticles(
    feedId?: string,
    unreadOnly?: boolean,
    page: number = 0,
    pageSize: number = 50
  ): Article[] {
    let sql = 'SELECT * FROM articles'
    const params: (string | number)[] = []
    const conditions: string[] = []

    if (feedId) {
      conditions.push('feed_id = ?')
      params.push(feedId)
    }

    if (unreadOnly) {
      conditions.push('is_read = 0')
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY published_at DESC'
    sql += ' LIMIT ? OFFSET ?'
    params.push(pageSize, page * pageSize)

    const query = this.db.query(sql)
    const rows =
      params.length > 0
        ? (query.all(...params) as Array<Record<string, unknown>>)
        : (query.all() as Array<Record<string, unknown>>)
    return rows.map((row) => this.rowToArticle(row))
  }

  getArticleCount(feedId?: string, unreadOnly?: boolean): number {
    let sql = 'SELECT COUNT(*) as count FROM articles'
    const params: (string | number)[] = []
    const conditions: string[] = []

    if (feedId) {
      conditions.push('feed_id = ?')
      params.push(feedId)
    }

    if (unreadOnly) {
      conditions.push('is_read = 0')
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    const query = this.db.query(sql)
    const row = query.get(...params) as { count: number } | null
    return row?.count ?? 0
  }

  searchArticles(query: string, feedId?: string): Article[] {
    let sql = 'SELECT * FROM articles WHERE (title LIKE ? OR content LIKE ? OR author LIKE ?)'
    const params: (string | number)[] = [`%${query}%`, `%${query}%`, `%${query}%`]

    if (feedId) {
      sql += ' AND feed_id = ?'
      params.push(feedId)
    }

    sql += ' ORDER BY published_at DESC'

    const stmt = this.db.query(sql)
    const rows = stmt.all(...params) as Array<Record<string, unknown>>
    return rows.map((row) => this.rowToArticle(row))
  }

  getArticle(id: string): Article | null {
    const row = this.db.query('SELECT * FROM articles WHERE id = ?').get(id) as Record<
      string,
      unknown
    > | null
    if (!row) return null
    return this.rowToArticle(row)
  }

  private rowToArticle(row: Record<string, unknown>): Article {
    const categories = ['user/-/state/com.google/reading-list']
    if (row.is_read) categories.push('user/-/state/com.google/read')
    if (row.is_starred) categories.push('user/-/state/com.google/starred')

    const summary = row.summary as string | null
    return {
      id: row.id as string,
      title: row.title as string,
      published: row.published_at as number,
      content: (row.content as string) || '',
      summary: summary ? { content: summary } : undefined,
      author: row.author as string,
      alternate: row.url ? [{ href: row.url as string, type: 'text/html' }] : [],
      categories,
      origin: {
        streamId: row.feed_id as string,
        title: '',
        htmlUrl: '',
      },
    }
  }

  markAsRead(id: string, read: boolean): void {
    this.db.query('UPDATE articles SET is_read = ? WHERE id = ?').run(read ? 1 : 0, id)
  }

  markAsStarred(id: string, starred: boolean): void {
    this.db.query('UPDATE articles SET is_starred = ? WHERE id = ?').run(starred ? 1 : 0, id)
  }

  close(): void {
    this.db.close()
  }

  exportToOpml(): string {
    const feeds = this.getFeeds()

    let opml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    opml += '<opml version="2.0">\n'
    opml += '  <head>\n'
    opml += `    <title>TUIRSS Feed Export</title>\n`
    opml += `    <dateCreated>${new Date().toUTCString()}</dateCreated>\n`
    opml += '  </head>\n'
    opml += '  <body>\n'

    const categories = new Map<string, Feed[]>()
    const uncategorized: Feed[] = []

    for (const feed of feeds) {
      if (feed.categories && feed.categories.length > 0) {
        const firstCategory = feed.categories[0]
        if (firstCategory) {
          const catId = firstCategory.id || 'uncategorized'
          const existing = categories.get(catId) || []
          existing.push(feed)
          categories.set(catId, existing)
        }
      } else {
        uncategorized.push(feed)
      }
    }

    for (const [, catFeeds] of categories) {
      const catName = catFeeds[0]?.categories?.[0]?.label || 'Uncategorized'
      opml += `    <outline text="${this.escapeXml(catName)}">\n`
      for (const feed of catFeeds) {
        opml += `      <outline type="rss" text="${this.escapeXml(feed.title)}" xmlUrl="${this.escapeXml(feed.url)}" htmlUrl="${this.escapeXml(feed.htmlUrl)}"/>\n`
      }
      opml += '    </outline>\n'
    }

    for (const feed of uncategorized) {
      opml += `    <outline type="rss" text="${this.escapeXml(feed.title)}" xmlUrl="${this.escapeXml(feed.url)}" htmlUrl="${this.escapeXml(feed.htmlUrl)}"/>\n`
    }

    opml += '  </body>\n'
    opml += '</opml>'

    return opml
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}
