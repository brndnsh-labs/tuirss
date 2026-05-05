import type { Feed, Article } from '../api/types.ts'

export type NavigationDepth = 'content' | 'articles' | 'feeds'
export type LayoutMode = 'single' | 'compact' | 'wide'

export interface AppState {
  navigationDepth: NavigationDepth

  feeds: Feed[]
  articles: Article[]
  selectedFeedId: string | null
  selectedArticleIndex: number

  loadingFeeds: boolean
  loadingArticles: boolean
  syncing: boolean

  statusMessage: string
  errorMessage: string | null

  layoutMode: LayoutMode
  terminalWidth: number
  terminalHeight: number

  zenMode: boolean

  searchQuery: string
  isSearching: boolean
  filteredArticles: Article[]

  expandedCategories: Set<string>

  articlesPage: number
  hasMoreArticles: boolean

  isOnline: boolean
  lastSyncTime: number | null
}

export function createInitialState(): AppState {
  return {
    navigationDepth: 'content',
    feeds: [],
    articles: [],
    selectedFeedId: null,
    selectedArticleIndex: 0,
    loadingFeeds: false,
    loadingArticles: false,
    syncing: false,
    statusMessage: '',
    errorMessage: null,
    layoutMode: 'wide',
    terminalWidth: 120,
    terminalHeight: 30,
    zenMode: false,
    searchQuery: '',
    isSearching: false,
    filteredArticles: [],
    expandedCategories: new Set(['__all__']),

    articlesPage: 0,
    hasMoreArticles: true,

    isOnline: true,
    lastSyncTime: null,
  }
}

export function getSelectedFeed(state: AppState): Feed | null {
  if (!state.selectedFeedId) return null
  return state.feeds.find((f) => f.id === state.selectedFeedId) ?? null
}

export function getSelectedArticle(state: AppState): Article | null {
  if (state.articles.length === 0) return null
  return state.articles[state.selectedArticleIndex] ?? null
}

export function getDisplayArticles(state: AppState): Article[] {
  return state.filteredArticles.length > 0 ? state.filteredArticles : state.articles
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
