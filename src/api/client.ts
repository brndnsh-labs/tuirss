import type { Feed, Article, UnreadCount } from './types.ts'

export class FreshRSSClient {
  private baseUrl: string
  private username: string
  private password: string
  private authToken: string | null = null
  private writeToken: string | null = null

  constructor(baseUrl: string, username: string, password: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.username = username
    this.password = password
  }

  async login(): Promise<void> {
    const url = `${this.baseUrl}/accounts/ClientLogin`
    const body = new URLSearchParams({
      Email: this.username,
      Passwd: this.password,
    })

    const response = await fetch(url, {
      method: 'POST',
      body,
    })

    if (!response.ok) {
      throw new Error(`Login failed: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    const authMatch = text.match(/Auth=([^
]+)/)
    
    if (!authMatch) {
      throw new Error('Login failed: No Auth token in response')
    }

    this.authToken = authMatch[1]
  }

  private authHeaders(): HeadersInit {
    if (!this.authToken) {
      throw new Error('Not authenticated. Call login() first.')
    }
    return {
      'Authorization': `GoogleLogin auth=${this.authToken}`,
    }
  }

  private async ensureWriteToken(): Promise<void> {
    if (this.writeToken) return

    const response = await fetch(
      `${this.baseUrl}/reader/api/0/token`,
      { headers: this.authHeaders() }
    )

    if (!response.ok) {
      throw new Error(`Failed to get write token: ${response.status}`)
    }

    this.writeToken = await response.text()
  }

  async getFeeds(): Promise<Feed[]> {
    const response = await fetch(
      `${this.baseUrl}/reader/api/0/subscription/list?output=json`,
      { headers: this.authHeaders() }
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch feeds: ${response.status}`)
    }

    const data = await response.json()
    return data.subscriptions || []
  }

  async getUnreadCounts(): Promise<UnreadCount[]> {
    const response = await fetch(
      `${this.baseUrl}/reader/api/0/unread-count?output=json`,
      { headers: this.authHeaders() }
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch unread counts: ${response.status}`)
    }

    const data = await response.json()
    return data.unreadcounts || []
  }

  async getArticles(options: {
    streamId?: string
    unreadOnly?: boolean
    count?: number
    continuation?: string
  } = {}): Promise<{ items: Article[]; continuation?: string }> {
    const params = new URLSearchParams({
      output: 'json',
      n: String(options.count || 20),
    })

    if (options.unreadOnly) {
      params.set('xt', 'user/-/state/com.google/read')
    }

    if (options.continuation) {
      params.set('c', options.continuation)
    }

    const streamId = options.streamId || 'user/-/state/com.google/reading-list'
    const url = `${this.baseUrl}/reader/api/0/stream/contents/${encodeURIComponent(streamId)}?${params}`

    const response = await fetch(url, { headers: this.authHeaders() })

    if (!response.ok) {
      throw new Error(`Failed to fetch articles: ${response.status}`)
    }

    const data = await response.json()
    return {
      items: data.items || [],
      continuation: data.continuation,
    }
  }

  async markAsRead(articleIds: string[]): Promise<void> {
    await this.ensureWriteToken()
    
    const body = new URLSearchParams()
    body.set('T', this.writeToken!)
    body.set('a', 'user/-/state/com.google/read')
    
    for (const id of articleIds) {
      body.append('i', id)
    }

    const response = await fetch(
      `${this.baseUrl}/reader/api/0/edit-tag`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body,
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to mark as read: ${response.status}`)
    }
  }

  async markAsUnread(articleIds: string[]): Promise<void> {
    await this.ensureWriteToken()
    
    const body = new URLSearchParams()
    body.set('T', this.writeToken!)
    body.set('r', 'user/-/state/com.google/read')
    
    for (const id of articleIds) {
      body.append('i', id)
    }

    const response = await fetch(
      `${this.baseUrl}/reader/api/0/edit-tag`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body,
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to mark as unread: ${response.status}`)
    }
  }

  async starArticle(articleIds: string[]): Promise<void> {
    await this.ensureWriteToken()
    
    const body = new URLSearchParams()
    body.set('T', this.writeToken!)
    body.set('a', 'user/-/state/com.google/starred')
    
    for (const id of articleIds) {
      body.append('i', id)
    }

    const response = await fetch(
      `${this.baseUrl}/reader/api/0/edit-tag`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body,
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to star article: ${response.status}`)
    }
  }

  async unstarArticle(articleIds: string[]): Promise<void> {
    await this.ensureWriteToken()
    
    const body = new URLSearchParams()
    body.set('T', this.writeToken!)
    body.set('r', 'user/-/state/com.google/starred')
    
    for (const id of articleIds) {
      body.append('i', id)
    }

    const response = await fetch(
      `${this.baseUrl}/reader/api/0/edit-tag`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body,
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to unstar article: ${response.status}`)
    }
  }
}
