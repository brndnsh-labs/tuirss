export interface Feed {
  id: string
  title: string
  url: string
  htmlUrl: string
  categories: Array<{ id: string; label: string }>
  unreadCount?: number
}

export interface Article {
  id: string
  title: string
  published: number
  content: string
  summary?: string
  author?: string
  alternate: Array<{ href: string; type: string }>
  categories: string[]
  origin: {
    streamId: string
    title: string
    htmlUrl: string
  }
}

export interface UnreadCount {
  id: string
  count: number
  newestItemTimestampUsec: string
}
