import Database from 'better-sqlite3'
import { join } from 'path'
import { getDataDir } from '../config/index.ts'
import type { Feed, Article } from '../api/types.ts'

export class Cache {
  private db: Database.Database

  constructor(dbPath?: string) {
    const path = dbPath || join(getDataDir(), 'cache.db')
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
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO feeds 
      (id, title, url, html_url, category_id, category_name, unread_count, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insert = this.db.transaction((items: Feed[]) => {
      for (const feed of items) {
        stmt.run(
          feed.id,
          feed.title,
          feed.url,
          feed.htmlUrl,
          feed.categories[0]?.id || null,
          feed.categories[0]?.label || null,
          feed.unreadCount || 0,
          Date.now()
        )
      }
    })

    insert(feeds)
  }

  getFeeds(): Feed[] {
    const rows = this.db.prepare('SELECT * FROM feeds ORDER BY title').all()
    return rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      htmlUrl: row.html_url,
      categories: row.category_id ? [{ id: row.category_id, label: row.category_name }] : [],
      unreadCount: row.unread_count,
    }))
  }

  saveArticles(articles: Article[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO articles 
      (id, feed_id, title, author, content, summary, url, published_at, is_read, is_starred, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insert = this.db.transaction((items: Article[]) => {
      for (const article of items) {
        const isRead = article.categories.includes('user/-/state/com.google/read')
        const isStarred = article.categories.includes('user/-/state/com.google/starred')

        stmt.run(
          article.id,
          article.origin.streamId,
          article.title,
          article.author || null,
          article.content || null,
          article.summary || null,
          article.alternate[0]?.href || null,
          article.published,
          isRead,
          isStarred,
          Date.now()
        )
      }
    })

    insert(articles)
  }

  getArticles(feedId?: string, unreadOnly?: boolean): Article[] {
    let sql = 'SELECT * FROM articles'
    const params: any[] = []
    const conditions: string[] = []

    if (feedId) {
      conditions.push('feed_id = ?')
      params.push(feedId)
    }

    if (unreadOnly) {
      conditions.push('is_read = FALSE')
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY published_at DESC'

    const rows = this.db.prepare(sql).all(...params)
    return rows.map((row: any) => this.rowToArticle(row))
  }

  getArticle(id: string): Article | null {
    const row = this.db.prepare('SELECT * FROM articles WHERE id = ?').get(id)
    if (!row) return null
    return this.rowToArticle(row as any)
  }

  private rowToArticle(row: any): Article {
    const categories = ['user/-/state/com.google/reading-list']
    if (row.is_read) categories.push('user/-/state/com.google/read')
    if (row.is_starred) categories.push('user/-/state/com.google/starred')

    return {
      id: row.id,
      title: row.title,
      published: row.published_at,
      content: row.content || '',
      summary: row.summary,
      author: row.author,
      alternate: row.url ? [{ href: row.url, type: 'text/html' }] : [],
      categories,
      origin: {
        streamId: row.feed_id,
        title: '',
        htmlUrl: '',
      },
    }
  }

  markAsRead(id: string, read: boolean): void {
    this.db.prepare('UPDATE articles SET is_read = ? WHERE id = ?').run(read, id)
  }

  markAsStarred(id: string, starred: boolean): void {
    this.db.prepare('UPDATE articles SET is_starred = ? WHERE id = ?').run(starred, id)
  }

  close(): void {
    this.db.close()
  }
}
