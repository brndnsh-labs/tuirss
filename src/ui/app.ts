import { createCliRenderer, BoxRenderable } from '@opentui/core'
import type { CliRenderer } from '@opentui/core'
import type { Config } from '../config/index.ts'
import { FreshRSSClient } from '../api/index.ts'
import type { Feed, Article } from '../api/types.ts'
import { Cache } from '../cache/index.ts'
import {
  StateManager,
  getSelectedFeed,
  getSelectedArticle,
  getNextViewMode,
  getPreviousViewMode,
} from './state.ts'
import type { AppState, ViewMode, LayoutMode } from './state.ts'
import { KeyboardHandler, resolveActionForContext } from './keyboard.ts'
import type { Action } from './keyboard.ts'
import { FeedList } from './components/feed-list.ts'
import { ArticleView } from './components/article-view.ts'
import { StatusBar } from './components/status-bar.ts'

const LAYOUT_BREAKPOINTS = {
  narrow: 100,
  wide: 140,
}

const SIDEBAR_WIDTHS = {
  collapsed: 3,
  compact: 20,
  full: 30,
}

export class App {
  private renderer!: CliRenderer
  private state: StateManager
  private keyboard: KeyboardHandler
  private config: Config
  private client: FreshRSSClient
  private cache: Cache

  private feedList!: FeedList
  private articleView!: ArticleView
  private statusBar!: StatusBar
  private rootContainer!: BoxRenderable
  private mainArea!: BoxRenderable

  private syncInterval: ReturnType<typeof setInterval> | null = null
  private unsubscribeState: (() => void) | null = null
  private unsubscribeDebug: (() => void) | null = null
  private destroyed = false
  private initialFeedLoaded = false

  constructor(config: Config) {
    this.config = config
    this.state = new StateManager()
    this.keyboard = new KeyboardHandler()
    this.client = new FreshRSSClient(
      config.server.url,
      config.server.username,
      config.server.password
    )
    this.cache = new Cache()
  }

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      exitOnCtrlC: false,
      screenMode: 'alternate-screen',
    })

    this.renderer.setBackgroundColor('#1a1a2e')

    process.on('SIGINT', () => this.shutdown())
    process.on('SIGTERM', () => this.shutdown())

    this.buildLayout()
    this.setupKeyboard()
    this.setupStateListener()
    this.setupResizeHandler()
    this.setupDebugMode()

    this.renderer.start()

    this.updateLayoutMode()

    await this.initialLoad()

    this.startAutoSync()
  }

  private setupDebugMode(): void {
    if (!process.env.DEBUG) return

    const debugPath = process.env.DEBUG_PATH || '/tmp/tuirss-state.json'

    this.unsubscribeDebug = this.state.subscribe((state: AppState) => {
      const debugInfo = {
        timestamp: new Date().toISOString(),
        viewMode: state.viewMode,
        layoutMode: state.layoutMode,
        feedsCount: state.feeds.length,
        articlesCount: state.articles.length,
        selectedFeedIndex: state.selectedFeedIndex,
        selectedArticleIndex: state.selectedArticleIndex,
        zenMode: state.zenMode,
        sidebarCollapsed: state.sidebarCollapsed,
        isSearching: state.isSearching,
        searchQuery: state.searchQuery,
        filteredArticlesCount: state.filteredArticles.length,
        hasMoreArticles: state.hasMoreArticles,
        isOnline: state.isOnline,
        syncing: state.syncing,
        errorMessage: state.errorMessage,
        statusMessage: state.statusMessage,
        terminalSize: {
          width: state.terminalWidth,
          height: state.terminalHeight,
        },
      }

      Bun.write(debugPath, JSON.stringify(debugInfo, null, 2)).catch(() => {})
    })
  }

  private getLayoutMode(width: number): LayoutMode {
    if (width < LAYOUT_BREAKPOINTS.narrow) return 'single'
    if (width < LAYOUT_BREAKPOINTS.wide) return 'compact'
    return 'wide'
  }

  private updateLayoutMode(): void {
    const width = this.renderer.width
    const height = this.renderer.height
    const layoutMode = this.getLayoutMode(width)

    this.state.update({
      layoutMode,
      terminalWidth: width,
      terminalHeight: height,
    })

    this.applyLayout()
  }

  private applyLayout(): void {
    const state = this.state.get()

    if (state.zenMode && state.viewMode === 'reader') {
      this.feedList.container.visible = false
      this.articleView.container.visible = true
      this.articleView.container.width = '100%'
      this.articleView.container.flexGrow = 1
      this.statusBar.text.visible = false
    } else if (state.layoutMode === 'single') {
      this.statusBar.text.visible = true
      this.feedList.container.visible = state.viewMode === 'feeds'
      this.articleView.container.visible = state.viewMode !== 'feeds'

      if (state.viewMode === 'feeds') {
        this.feedList.container.width = '100%'
        this.feedList.container.flexGrow = 1
      } else {
        this.articleView.container.width = '100%'
        this.articleView.container.flexGrow = 1
      }
    } else {
      this.statusBar.text.visible = true

      const showSidebar = !state.zenMode && state.viewMode !== 'reader' && !state.sidebarCollapsed

      this.feedList.container.visible = showSidebar
      this.articleView.container.visible = true

      if (showSidebar) {
        if (state.sidebarCollapsed) {
          this.feedList.container.width = SIDEBAR_WIDTHS.collapsed
        } else if (state.layoutMode === 'compact') {
          this.feedList.container.width = SIDEBAR_WIDTHS.compact
        } else {
          this.feedList.container.width = SIDEBAR_WIDTHS.full
        }
        this.feedList.container.flexGrow = 0
      }

      this.articleView.container.flexGrow = 1
    }

    this.renderer.requestRender()
  }

  private buildLayout(): void {
    this.rootContainer = new BoxRenderable(this.renderer, {
      id: 'root',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      shouldFill: true,
      backgroundColor: '#1a1a2e',
    })

    this.feedList = new FeedList(this.renderer)
    this.articleView = new ArticleView(this.renderer)
    this.statusBar = new StatusBar(this.renderer)

    this.mainArea = new BoxRenderable(this.renderer, {
      id: 'main-area',
      flexDirection: 'row',
      flexGrow: 1,
      shouldFill: true,
    })

    this.mainArea.add(this.feedList.container)
    this.mainArea.add(this.articleView.container)

    this.rootContainer.add(this.mainArea)
    this.rootContainer.add(this.statusBar.text)

    this.renderer.root.add(this.rootContainer)
  }

  private setupResizeHandler(): void {
    this.renderer.on('resize', () => {
      this.updateLayoutMode()
    })
  }

  private setupKeyboard(): void {
    this.keyboard.onAction((action: Action) => {
      this.handleAction(action)
    })

    this.renderer.keyInput.on('keypress', (key) => {
      const state = this.state.get()
      if (state.isSearching) {
        this.handleSearchInput(key)
      } else {
        this.keyboard.handleKey(key)
      }
    })
  }

  private handleSearchInput(key: {
    name: string
    ctrl: boolean
    shift: boolean
    meta: boolean
    char?: string
  }): void {
    const state = this.state.get()
    let query = state.searchQuery

    if (key.name === 'return' || key.name === 'enter') {
      this.performSearch(query)
      return
    }

    if (key.name === 'escape') {
      this.state.update({ isSearching: false, searchQuery: '' })
      this.render(this.state.get())
      return
    }

    if (key.name === 'backspace') {
      query = query.slice(0, -1)
    } else if (key.name === 'space') {
      query += ' '
    } else if (key.char && key.char.length === 1 && !key.ctrl && !key.meta) {
      query += key.char
    }

    this.state.update({ searchQuery: query })
    this.render(this.state.get())
  }

  private setupStateListener(): void {
    this.unsubscribeState = this.state.subscribe((state: AppState) => {
      this.render(state)
    })
  }

  private navigateToViewMode(viewMode: ViewMode): void {
    this.state.update({ viewMode })
    this.applyLayout()
  }

  private getDisplayArticles(state: AppState): Article[] {
    return state.filteredArticles.length > 0 ? state.filteredArticles : state.articles
  }

  private handleAction(action: Action): void {
    const state = this.state.get()
    const resolvedAction = resolveActionForContext(action, state.viewMode)
    if (!resolvedAction) return

    const displayArticles = this.getDisplayArticles(state)

    switch (resolvedAction) {
      case 'navDown': {
        if (state.viewMode === 'feeds') {
          const maxIdx = state.feeds.length - 1
          if (state.selectedFeedIndex < maxIdx) {
            const newIndex = state.selectedFeedIndex + 1
            this.state.update({ selectedFeedIndex: newIndex })
            this.loadArticlesForFeed(newIndex)
          }
        } else {
          const maxIdx = displayArticles.length - 1
          if (state.selectedArticleIndex < maxIdx) {
            const newIndex = state.selectedArticleIndex + 1
            this.state.update({ selectedArticleIndex: newIndex })
            if (state.viewMode === 'reader') {
              this.markCurrentArticleAsRead()
            }
          }
        }
        break
      }
      case 'navUp': {
        if (state.viewMode === 'feeds') {
          if (state.selectedFeedIndex > 0) {
            const newIndex = state.selectedFeedIndex - 1
            this.state.update({ selectedFeedIndex: newIndex })
            this.loadArticlesForFeed(newIndex)
          }
        } else {
          if (state.selectedArticleIndex > 0) {
            this.state.update({ selectedArticleIndex: state.selectedArticleIndex - 1 })
          }
        }
        break
      }
      case 'select': {
        const nextMode = getNextViewMode(state.viewMode)
        if (nextMode) {
          if (nextMode === 'articles' && state.articles.length === 0) {
            this.loadArticlesForFeed(state.selectedFeedIndex).then(() => {
              this.navigateToViewMode(nextMode)
            })
          } else {
            this.navigateToViewMode(nextMode)
            if (nextMode === 'reader') {
              this.markCurrentArticleAsRead()
            }
          }
        }
        break
      }
      case 'goBack': {
        const prevMode = getPreviousViewMode(state.viewMode)
        if (prevMode) {
          this.navigateToViewMode(prevMode)
        }
        break
      }
      case 'quit': {
        this.shutdown()
        break
      }
      case 'refresh': {
        this.syncFromApi()
        break
      }
      case 'markRead': {
        if (state.viewMode !== 'feeds') {
          this.toggleRead()
        }
        break
      }
      case 'star': {
        if (state.viewMode !== 'feeds') {
          this.toggleStar()
        }
        break
      }
      case 'toggleSidebar': {
        if (state.layoutMode !== 'single') {
          this.state.update({ sidebarCollapsed: !state.sidebarCollapsed })
          this.applyLayout()
        }
        break
      }
      case 'toggleZenMode': {
        if (state.viewMode === 'reader') {
          this.state.update({ zenMode: !state.zenMode })
          this.applyLayout()
        }
        break
      }
      case 'scrollDown': {
        this.articleView.scrollDown(3)
        break
      }
      case 'scrollUp': {
        this.articleView.scrollUp(3)
        break
      }
      case 'pageDown': {
        this.articleView.scrollDown(15)
        break
      }
      case 'pageUp': {
        this.articleView.scrollUp(15)
        break
      }
      case 'scrollToTop': {
        this.articleView.scrollToTop()
        break
      }
      case 'scrollToBottom': {
        this.articleView.scrollToBottom()
        break
      }
      case 'search': {
        if (state.viewMode !== 'reader') {
          this.startSearch()
        }
        break
      }
      case 'clearSearch': {
        this.clearSearch()
        break
      }
      case 'expandCollapse': {
        if (state.viewMode === 'feeds') {
          this.toggleCategoryExpand()
        }
        break
      }
      case 'loadMore': {
        if (state.viewMode === 'articles') {
          this.loadMoreArticles()
        }
        break
      }
      case 'exportOpml': {
        this.exportFeedsToOpml()
        break
      }
    }
  }

  private async exportFeedsToOpml(): Promise<void> {
    try {
      const opml = this.cache.exportToOpml()
      const fileName = `tuirss-feeds-${new Date().toISOString().split('T')[0]}.opml`
      const filePath = `${process.env.HOME}/Downloads/${fileName}`

      await Bun.write(filePath, opml)

      this.state.update({
        statusMessage: `Exported feeds to ${fileName}`,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.state.update({
        errorMessage: `Export failed: ${msg}`,
      })
    }
    this.render(this.state.get())
  }

  private async loadMoreArticles(): Promise<void> {
    const state = this.state.get()
    if (!state.hasMoreArticles || state.loadingArticles) {
      return
    }

    const feed = getSelectedFeed(state)
    if (!feed) return

    this.state.update({ loadingArticles: true })
    this.render(this.state.get())

    try {
      const nextPage = state.articlesPage + 1
      const newArticles = this.cache.getArticles(feed.id, true, nextPage, 50)

      if (newArticles.length === 0) {
        this.state.update({
          hasMoreArticles: false,
          loadingArticles: false,
        })
      } else {
        const allArticles = [...state.articles, ...newArticles]
        this.state.update({
          articles: allArticles,
          articlesPage: nextPage,
          hasMoreArticles: newArticles.length === 50,
          loadingArticles: false,
        })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.state.update({
        loadingArticles: false,
        errorMessage: msg,
      })
    }

    this.render(this.state.get())
  }

  private toggleCategoryExpand(): void {
    const state = this.state.get()
    const categories = this.groupFeedsByCategory(state.feeds)
    const currentFeedIndex = state.selectedFeedIndex
    let currentIndex = 0

    for (const category of categories) {
      const categoryStart = currentIndex
      const categoryEnd = currentIndex + category.feeds.length

      if (currentFeedIndex >= categoryStart && currentFeedIndex < categoryEnd) {
        const expanded = new Set(state.expandedCategories)
        if (expanded.has(category.id)) {
          expanded.delete(category.id)
        } else {
          expanded.add(category.id)
        }
        this.state.update({ expandedCategories: expanded })
        break
      }

      currentIndex = categoryEnd
    }
  }

  private groupFeedsByCategory(feeds: Feed[]): Array<{ id: string; label: string; feeds: Feed[] }> {
    const groups = new Map<string, { id: string; label: string; feeds: Feed[] }>()
    const uncategorized: Feed[] = []

    for (const feed of feeds) {
      if (feed.categories && feed.categories.length > 0) {
        for (const category of feed.categories) {
          const id = category.id || 'uncategorized'
          const label = category.label || 'Uncategorized'

          if (!groups.has(id)) {
            groups.set(id, { id, label, feeds: [] })
          }

          groups.get(id)!.feeds.push(feed)
        }
      } else {
        uncategorized.push(feed)
      }
    }

    if (uncategorized.length > 0) {
      groups.set('uncategorized', {
        id: 'uncategorized',
        label: 'Uncategorized',
        feeds: uncategorized,
      })
    }

    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  private startSearch(): void {
    this.state.update({ isSearching: true })
    this.render(this.state.get())
  }

  private clearSearch(): void {
    const state = this.state.get()
    if (state.isSearching) {
      this.state.update({
        isSearching: false,
        searchQuery: '',
        filteredArticles: [],
        selectedArticleIndex: 0,
      })
    } else if (state.searchQuery) {
      this.state.update({
        searchQuery: '',
        filteredArticles: [],
        selectedArticleIndex: 0,
      })
    }
    this.render(this.state.get())
  }

  private performSearch(query: string): void {
    if (!query.trim()) {
      this.state.update({
        searchQuery: '',
        filteredArticles: [],
        selectedArticleIndex: 0,
      })
      return
    }

    const state = this.state.get()
    const feed = getSelectedFeed(state)
    const results = this.cache.searchArticles(query.trim(), feed?.id)

    this.state.update({
      searchQuery: query,
      filteredArticles: results,
      selectedArticleIndex: 0,
      isSearching: false,
    })
    this.render(this.state.get())
  }

  private markCurrentArticleAsRead(): void {
    const state = this.state.get()
    const article = getSelectedArticle(state)
    if (!article) return

    const isRead = article.categories?.includes('user/-/state/com.google/read')
    if (!isRead) {
      this.cache.markAsRead(article.id, true)

      const updatedArticles = state.articles.map((a) => {
        if (a.id !== article.id) return a
        const categories = [...(a.categories || [])]
        if (!categories.includes('user/-/state/com.google/read')) {
          categories.push('user/-/state/com.google/read')
        }
        return { ...a, categories }
      })

      this.state.update({ articles: updatedArticles })
      this.client.markAsRead([article.id]).catch(() => {})
    }
  }

  private render(state: AppState): void {
    if (this.destroyed || this.renderer.isDestroyed) return
    this.feedList.update(state)
    this.articleView.update(state)
    this.statusBar.update(state)
    this.renderer.requestRender()
  }

  private async initialLoad(): Promise<void> {
    this.state.update({ loadingFeeds: true, statusMessage: 'Loading feeds...' })
    this.render(this.state.get())

    try {
      const cachedFeeds = this.cache.getFeeds()
      if (cachedFeeds.length > 0) {
        this.state.update({
          feeds: cachedFeeds,
          loadingFeeds: false,
          statusMessage: '',
        })
        this.render(this.state.get())

        if (cachedFeeds.length > 0 && !this.initialFeedLoaded) {
          this.initialFeedLoaded = true
          await this.loadArticlesForFeed(0)
        }
      }

      await this.syncFromApi()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.state.update({
        loadingFeeds: false,
        errorMessage: msg,
        statusMessage: '',
      })
      this.render(this.state.get())
    }
  }

  private async syncFromApi(): Promise<void> {
    this.state.update({ syncing: true, statusMessage: 'Syncing...' })
    this.render(this.state.get())

    try {
      await this.client.login()

      const feeds = await this.client.getFeeds()
      const unreadCounts = await this.client.getUnreadCounts()

      const unreadMap = new Map<string, number>()
      for (const uc of unreadCounts) {
        unreadMap.set(uc.id, uc.count)
      }

      const enrichedFeeds: Feed[] = feeds.map((feed) => ({
        ...feed,
        unreadCount: unreadMap.get(feed.id) ?? feed.unreadCount ?? 0,
      }))

      this.cache.saveFeeds(enrichedFeeds)

      const articles = await this.client.getArticles({ unreadOnly: true, count: 50 })
      this.cache.saveArticles(articles.items)

      const currentState = this.state.get()

      this.state.update({
        feeds: enrichedFeeds,
        syncing: false,
        statusMessage: `Synced ${enrichedFeeds.length} feeds`,
        errorMessage: null,
        lastSyncTime: Date.now(),
        isOnline: true,
      })

      if (!this.initialFeedLoaded && enrichedFeeds.length > 0) {
        this.initialFeedLoaded = true
        await this.loadArticlesForFeed(0)
      } else if (currentState.viewMode !== 'feeds') {
        const selectedFeed = getSelectedFeed(currentState)
        if (selectedFeed) {
          await this.loadArticlesForFeed(currentState.selectedFeedIndex)
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.state.update({
        syncing: false,
        errorMessage: `Sync failed: ${msg}`,
        statusMessage: '',
      })
    }

    this.render(this.state.get())
  }

  private async loadArticlesForFeed(feedIndex: number): Promise<void> {
    const state = this.state.get()
    const feed = state.feeds[feedIndex]
    if (!feed) return

    this.state.update({ loadingArticles: true })
    this.render(this.state.get())

    try {
      const articles = this.cache.getArticles(feed.id, true, 0, 50)
      const totalCount = this.cache.getArticleCount(feed.id, true)
      this.state.update({
        articles,
        loadingArticles: false,
        selectedArticleIndex: 0,
        articlesPage: 0,
        hasMoreArticles: articles.length < totalCount,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.state.update({
        loadingArticles: false,
        errorMessage: msg,
      })
    }

    this.render(this.state.get())
  }

  private toggleRead(): void {
    const state = this.state.get()
    const article = getSelectedArticle(state)
    if (!article) return

    const isRead = article.categories?.includes('user/-/state/com.google/read')
    const newReadState = !isRead

    this.cache.markAsRead(article.id, newReadState)

    const updatedArticles = state.articles.map((a) => {
      if (a.id !== article.id) return a
      const categories = [...(a.categories || [])]
      if (newReadState) {
        if (!categories.includes('user/-/state/com.google/read')) {
          categories.push('user/-/state/com.google/read')
        }
      } else {
        const idx = categories.indexOf('user/-/state/com.google/read')
        if (idx >= 0) categories.splice(idx, 1)
      }
      return { ...a, categories }
    })

    this.state.update({ articles: updatedArticles })
    this.render(this.state.get())

    if (newReadState) {
      this.client.markAsRead([article.id]).catch(() => {})
    } else {
      this.client.markAsUnread([article.id]).catch(() => {})
    }
  }

  private toggleStar(): void {
    const state = this.state.get()
    const article = getSelectedArticle(state)
    if (!article) return

    const isStarred = article.categories?.includes('user/-/state/com.google/starred')
    const newStarState = !isStarred

    this.cache.markAsStarred(article.id, newStarState)

    const updatedArticles = state.articles.map((a) => {
      if (a.id !== article.id) return a
      const categories = [...(a.categories || [])]
      if (newStarState) {
        if (!categories.includes('user/-/state/com.google/starred')) {
          categories.push('user/-/state/com.google/starred')
        }
      } else {
        const idx = categories.indexOf('user/-/state/com.google/starred')
        if (idx >= 0) categories.splice(idx, 1)
      }
      return { ...a, categories }
    })

    this.state.update({ articles: updatedArticles })
    this.render(this.state.get())

    if (newStarState) {
      this.client.starArticle([article.id]).catch(() => {})
    } else {
      this.client.unstarArticle([article.id]).catch(() => {})
    }
  }

  private startAutoSync(): void {
    const intervalMs = (this.config.sync.interval ?? 300) * 1000
    this.syncInterval = setInterval(() => {
      this.syncFromApi()
    }, intervalMs)
  }

  private shutdown(): void {
    this.destroyed = true
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
    }
    if (this.unsubscribeState) {
      this.unsubscribeState()
    }
    if (this.unsubscribeDebug) {
      this.unsubscribeDebug()
    }
    this.cache.close()
    this.renderer.destroy()
    process.exit(0)
  }
}
