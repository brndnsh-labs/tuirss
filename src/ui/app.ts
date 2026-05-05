import { createCliRenderer, BoxRenderable } from '@opentui/core'
import type { CliRenderer } from '@opentui/core'
import type { Config } from '../config/index.ts'
import { FreshRSSClient } from '../api/index.ts'
import type { Feed } from '../api/types.ts'
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

    this.renderer.start()

    this.updateLayoutMode()

    await this.initialLoad()

    this.startAutoSync()
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
      this.keyboard.handleKey(key)
    })
  }

  private setupStateListener(): void {
    this.state.subscribe((state: AppState) => {
      this.render(state)
    })
  }

  private navigateToViewMode(viewMode: ViewMode): void {
    this.state.update({ viewMode })
    this.applyLayout()
  }

  private handleAction(action: Action): void {
    const state = this.state.get()
    const resolvedAction = resolveActionForContext(action, state.viewMode)
    if (!resolvedAction) return

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
          const maxIdx = state.articles.length - 1
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
    }
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
      const articles = this.cache.getArticles(feed.id, true)
      this.state.update({
        articles,
        loadingArticles: false,
        selectedArticleIndex: 0,
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
    this.cache.close()
    this.renderer.destroy()
    process.exit(0)
  }
}
