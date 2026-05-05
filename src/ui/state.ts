import type { Feed, Article } from '../api/types.ts'

export type ViewMode = 'feeds' | 'articles' | 'reader'
export type LayoutMode = 'single' | 'compact' | 'wide'

export interface AppState {
  viewMode: ViewMode

  feeds: Feed[]
  articles: Article[]
  selectedFeedIndex: number
  selectedArticleIndex: number

  loadingFeeds: boolean
  loadingArticles: boolean
  syncing: boolean

  statusMessage: string
  errorMessage: string | null

  sidebarCollapsed: boolean
  layoutMode: LayoutMode
  terminalWidth: number
  terminalHeight: number

  zenMode: boolean

  readerScrollY: number

  searchQuery: string
  isSearching: boolean
  filteredArticles: Article[]

  expandedCategories: Set<string>
  selectedCategory: string | null

  articlesPage: number
  hasMoreArticles: boolean

  isOnline: boolean
  lastSyncTime: number | null
}

export function createInitialState(): AppState {
  return {
    viewMode: 'feeds',
    feeds: [],
    articles: [],
    selectedFeedIndex: 0,
    selectedArticleIndex: 0,
    loadingFeeds: false,
    loadingArticles: false,
    syncing: false,
    statusMessage: '',
    errorMessage: null,
    sidebarCollapsed: false,
    layoutMode: 'wide',
    terminalWidth: 120,
    terminalHeight: 30,
    zenMode: false,
    readerScrollY: 0,
    searchQuery: '',
    isSearching: false,
    filteredArticles: [],
    expandedCategories: new Set(['__all__']),
    selectedCategory: null,

    articlesPage: 0,
    hasMoreArticles: true,

    isOnline: true,
    lastSyncTime: null,
  }
}

export function getSelectedFeed(state: AppState): Feed | null {
  if (state.feeds.length === 0) return null
  return state.feeds[state.selectedFeedIndex] ?? null
}

export function getSelectedArticle(state: AppState): Article | null {
  if (state.articles.length === 0) return null
  return state.articles[state.selectedArticleIndex] ?? null
}

export function getNextViewMode(viewMode: ViewMode): ViewMode | null {
  switch (viewMode) {
    case 'feeds':
      return 'articles'
    case 'articles':
      return 'reader'
    default:
      return null
  }
}

export function getPreviousViewMode(viewMode: ViewMode): ViewMode | null {
  switch (viewMode) {
    case 'reader':
      return 'articles'
    case 'articles':
      return 'feeds'
    default:
      return null
  }
}

export type StateListener = (state: AppState) => void

export class StateManager {
  private state: AppState
  private listeners: Set<StateListener> = new Set()

  constructor() {
    this.state = createInitialState()
  }

  get(): AppState {
    return this.state
  }

  update(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial }
    this.notify()
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}
