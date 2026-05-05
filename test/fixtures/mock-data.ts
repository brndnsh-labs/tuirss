import type { Feed, Article } from '../../src/api/types.ts'
import type { AppState } from '../../src/ui/state.ts'

// ==== MOCK FEEDS ====

export const mockFeeds: Feed[] = [
  {
    id: 'feed/001',
    title: 'Hacker News',
    url: 'https://news.ycombinator.com/rss',
    htmlUrl: 'https://news.ycombinator.com',
    categories: [{ id: 'cat/tech', label: 'Technology' }],
    unreadCount: 5,
  },
  {
    id: 'feed/002',
    title: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    htmlUrl: 'https://techcrunch.com',
    categories: [{ id: 'cat/tech', label: 'Technology' }],
    unreadCount: 12,
  },
  {
    id: 'feed/003',
    title: 'The Verge - All Posts',
    url: 'https://www.theverge.com/rss/index.xml',
    htmlUrl: 'https://www.theverge.com',
    categories: [{ id: 'cat/tech', label: 'Technology' }],
    unreadCount: 8,
  },
  {
    id: 'feed/004',
    title: 'BBC News',
    url: 'http://feeds.bbci.co.uk/news/rss.xml',
    htmlUrl: 'https://www.bbc.com/news',
    categories: [{ id: 'cat/news', label: 'News' }],
    unreadCount: 15,
  },
  {
    id: 'feed/005',
    title: 'Reuters',
    url: 'http://feeds.reuters.com/reuters/topNews',
    htmlUrl: 'https://www.reuters.com',
    categories: [{ id: 'cat/news', label: 'News' }],
    unreadCount: 0,
  },
  {
    id: 'feed/006',
    title: 'Nature - Latest Research',
    url: 'https://www.nature.com/nature.rss',
    htmlUrl: 'https://www.nature.com',
    categories: [{ id: 'cat/science', label: 'Science' }],
    unreadCount: 3,
  },
  {
    id: 'feed/007',
    title: 'Ars Technica',
    url: 'http://feeds.arstechnica.com/arstechnica/index',
    htmlUrl: 'https://arstechnica.com',
    categories: [],
    unreadCount: 0,
  },
  {
    id: 'feed/008',
    title: 'A List Apart',
    url: 'https://alistapart.com/main/feed/',
    htmlUrl: 'https://alistapart.com',
    categories: [{ id: 'cat/design', label: 'Design' }],
    unreadCount: 2,
  },
]

// ==== MOCK ARTICLES ====

export const mockArticles: Article[] = [
  {
    id: 'article/001',
    title: 'Show HN: I built a TUI RSS reader in TypeScript',
    published: Math.floor(Date.now() / 1000) - 3600,
    content: '<p>This is a comprehensive article about building TUIs...</p>',
    author: 'john_doe',
    alternate: [{ href: 'https://example.com/1', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list'],
    origin: { streamId: 'feed/001', title: 'Hacker News', htmlUrl: 'https://news.ycombinator.com' },
  },
  {
    id: 'article/002',
    title: 'The Future of Terminal UIs: A Deep Dive into OpenTUI',
    published: Math.floor(Date.now() / 1000) - 7200,
    content: '<p>Terminal user interfaces are making a comeback...</p><p>In this article we explore...</p>',
    author: 'Jane Smith',
    alternate: [{ href: 'https://example.com/2', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list', 'user/-/state/com.google/read'],
    origin: { streamId: 'feed/002', title: 'TechCrunch', htmlUrl: 'https://techcrunch.com' },
  },
  {
    id: 'article/003',
    title: 'React Server Components: What You Need to Know',
    published: Math.floor(Date.now() / 1000) - 10800,
    content: '<p>React Server Components are changing how we build...</p>',
    alternate: [{ href: 'https://example.com/3', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list', 'user/-/state/com.google/starred'],
    origin: { streamId: 'feed/003', title: 'The Verge', htmlUrl: 'https://www.theverge.com' },
  },
  {
    id: 'article/004',
    title: 'Global Climate Summit Reaches Historic Agreement',
    published: Math.floor(Date.now() / 1000) - 14400,
    content: '<p>Leaders from 190 countries have agreed...</p>',
    author: 'BBC News Team',
    alternate: [{ href: 'https://example.com/4', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list'],
    origin: { streamId: 'feed/004', title: 'BBC News', htmlUrl: 'https://www.bbc.com/news' },
  },
  {
    id: 'article/005',
    title: 'Markets Rally as Inflation Data Shows Improvement',
    published: Math.floor(Date.now() / 1000) - 18000,
    summary: { content: 'Stock markets around the world surged today...' },
    author: 'Reuters Staff',
    alternate: [{ href: 'https://example.com/5', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list', 'user/-/state/com.google/read', 'user/-/state/com.google/starred'],
    origin: { streamId: 'feed/005', title: 'Reuters', htmlUrl: 'https://www.reuters.com' },
  },
  {
    id: 'article/006',
    title: 'Quantum Computing Breakthrough: 1000 Qubits Achieved',
    published: Math.floor(Date.now() / 1000) - 86400,
    content: '<p>Scientists have achieved a major milestone in quantum computing...</p>',
    author: 'Dr. Sarah Chen',
    alternate: [{ href: 'https://example.com/6', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list'],
    origin: { streamId: 'feed/006', title: 'Nature', htmlUrl: 'https://www.nature.com' },
  },
  {
    id: 'article/007',
    title: 'New TypeScript 6.0 Features You Should Know',
    published: Math.floor(Date.now() / 1000) - 172800,
    content: '<p>TypeScript 6.0 brings several exciting features...</p>',
    alternate: [{ href: 'https://example.com/7', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list'],
    origin: { streamId: 'feed/007', title: 'Ars Technica', htmlUrl: 'https://arstechnica.com' },
  },
  {
    id: 'article/008',
    title: 'Designing for Accessibility: A Complete Guide',
    published: Math.floor(Date.now() / 1000) - 259200,
    content: '<p>Accessibility is not optional...</p><ul><li>Contrast ratios</li><li>Keyboard navigation</li></ul>',
    author: 'Alex Rivera',
    alternate: [{ href: 'https://example.com/8', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list', 'user/-/state/com.google/read'],
    origin: { streamId: 'feed/008', title: 'A List Apart', htmlUrl: 'https://alistapart.com' },
  },
  {
    id: 'article/009',
    title: 'Very Long Title That Might Wrap in the UI and Test Truncation Behavior Properly',
    published: Math.floor(Date.now() / 1000) - 604800,
    summary: { content: 'Short summary here.' },
    alternate: [{ href: 'https://example.com/9', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list'],
    origin: { streamId: 'feed/001', title: 'Hacker News', htmlUrl: 'https://news.ycombinator.com' },
  },
  {
    id: 'article/010',
    title: 'No Author Article',
    published: Math.floor(Date.now() / 1000) - 1209600,
    content: '<p>This article has no author field.</p>',
    alternate: [{ href: 'https://example.com/10', type: 'text/html' }],
    categories: ['user/-/state/com.google/reading-list', 'user/-/state/com.google/read'],
    origin: { streamId: 'feed/002', title: 'TechCrunch', htmlUrl: 'https://techcrunch.com' },
  },
]

// ==== MOCK APP STATES ====

export const defaultState: AppState = {
  viewMode: 'articles',
  feeds: mockFeeds,
  articles: mockArticles.slice(0, 5),
  selectedFeedIndex: 0,
  selectedArticleIndex: 2,
  loadingFeeds: false,
  loadingArticles: false,
  syncing: false,
  statusMessage: 'Synced 8 feeds',
  errorMessage: null,
  sidebarCollapsed: false,
  layoutMode: 'wide',
  terminalWidth: 160,
  terminalHeight: 50,
  zenMode: false,
  searchQuery: '',
  isSearching: false,
  filteredArticles: [],
  expandedCategories: new Set(['cat/tech']),
  articlesPage: 0,
  hasMoreArticles: true,
  isOnline: true,
  lastSyncTime: Date.now(),
}

export const emptyState: AppState = {
  ...defaultState,
  feeds: [],
  articles: [],
  selectedFeedIndex: 0,
  selectedArticleIndex: 0,
  statusMessage: '',
  expandedCategories: new Set(),
}

export const loadingState: AppState = {
  ...defaultState,
  loadingFeeds: true,
  loadingArticles: true,
  statusMessage: 'Loading...',
}

export const searchingState: AppState = {
  ...defaultState,
  isSearching: true,
  searchQuery: 'TypeScript',
  statusMessage: '',
}

export const searchResultsState: AppState = {
  ...defaultState,
  searchQuery: 'TypeScript',
  isSearching: false,
  filteredArticles: mockArticles.filter(a => a.title.toLowerCase().includes('typescript')),
  statusMessage: 'Found 2 articles',
}

export const errorState: AppState = {
  ...defaultState,
  errorMessage: 'Failed to connect to server',
  statusMessage: '',
}

export const offlineState: AppState = {
  ...defaultState,
  isOnline: false,
  errorMessage: null,
  statusMessage: '',
}

export const singleFeedState: AppState = {
  ...defaultState,
  feeds: mockFeeds.slice(0, 1),
  articles: mockArticles.filter(a => a.origin.streamId === 'feed/001'),
  selectedFeedIndex: 0,
}

export const zenModeState: AppState = {
  ...defaultState,
  viewMode: 'reader',
  zenMode: true,
  selectedArticleIndex: 0,
}

export const collapsedSidebarState: AppState = {
  ...defaultState,
  viewMode: 'articles',
  sidebarCollapsed: true,
}

export const compactLayoutState: AppState = {
  ...defaultState,
  layoutMode: 'compact',
  terminalWidth: 120,
}

export const singleLayoutState: AppState = {
  ...defaultState,
  layoutMode: 'single',
  terminalWidth: 80,
}

export const syncingState: AppState = {
  ...defaultState,
  syncing: true,
  statusMessage: 'Syncing...',
}
