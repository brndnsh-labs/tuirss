import type { Feed, Article } from '../api/types.ts'

export type Pane = 'feeds' | 'articles'
export type ArticleViewMode = 'list' | 'detail'

export interface AppState {
  // Navigation
  activePane: Pane
  articleViewMode: ArticleViewMode

  // Data
  feeds: Feed[]
  articles: Article[]
  selectedFeedIndex: number
  selectedArticleIndex: number

  // Loading states
  loadingFeeds: boolean
  loadingArticles: boolean
  syncing: boolean

  // Status message
  statusMessage: string
  errorMessage: string | null
}

export function createInitialState(): AppState {
  return {
    activePane: 'feeds',
    articleViewMode: 'list',
    feeds: [],
    articles: [],
    selectedFeedIndex: 0,
    selectedArticleIndex: 0,
    loadingFeeds: false,
    loadingArticles: false,
    syncing: false,
    statusMessage: '',
    errorMessage: null,
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
