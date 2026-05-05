import { createCliRenderer, BoxRenderable } from '@opentui/core'
import type { CliRenderer } from '@opentui/core'
import type { Config } from '../config/index.ts'
import { FreshRSSClient } from '../api/index.ts'
import type { Feed } from '../api/types.ts'
import { Cache } from '../cache/index.ts'
import { StateManager, getSelectedFeed, getSelectedArticle } from './state.ts'
import type { AppState } from './state.ts'
import { KeyboardHandler, resolveActionForContext } from './keyboard.ts'
import type { Action } from './keyboard.ts'
import { FeedList } from './components/feed-list.ts'
import { ArticleView } from './components/article-view.ts'
import { StatusBar } from './components/status-bar.ts'

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

  private syncInterval: ReturnType<typeof setInterval> | null = null
  private destroyed = false

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

    this.renderer.start()

    await this.initialLoad()

    this.startAutoSync()
  }

  private buildLayout(): void {
    this.rootContainer = new BoxRenderable(this.renderer, {
      id: 'root',
      flexDirection: 'row',
      width: '100%',
      height: '100%',
      shouldFill: true,
      backgroundColor: '#1a1a2e',
    })

    this.feedList = new FeedList(this.renderer)
    this.articleView = new ArticleView(this.renderer)
    this.statusBar = new StatusBar(this.renderer)

    const listWidthPercent =
      typeof this.config.ui.list_width === 'number'
        ? `${this.config.ui.list_width}%`
        : this.config.ui.list_width

    this.feedList.container.width = listWidthPercent as `${number}%`
    this.feedList.container.height = '100%'

    this.articleView.container.flexGrow = 1
    this.articleView.container.height = '100%'

    const mainArea = new BoxRenderable(this.renderer, {
      id: 'main-area',
      flexDirection: 'row',
      flexGrow: 1,
      shouldFill: true,
    })
    mainArea.add(this.feedList.container)
    mainArea.add(this.articleView.container)

    this.rootContainer.add(mainArea)
    this.rootContainer.add(this.statusBar.text)

    this.renderer.root.add(this.rootContainer)
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

  private handleAction(action: Action): void {
    const state = this.state.get()
    const resolvedAction = resolveActionForContext(action, state.activePane, state.articleViewMode)
    if (!resolvedAction) return

    switch (resolvedAction) {
      case 'navDown': {
        if (state.activePane === 'feeds') {
          const maxIdx = state.feeds.length - 1
          if (state.selectedFeedIndex < maxIdx) {
            this.state.update({ selectedFeedIndex: state.selectedFeedIndex + 1 })
            this.loadArticlesForFeed(state.selectedFeedIndex + 1)
          }
        } else {
          const maxIdx = state.articles.length - 1
          if (state.selectedArticleIndex < maxIdx) {
            this.state.update({ selectedArticleIndex: state.selectedArticleIndex + 1 })
          }
        }
        break
      }
      case 'navUp': {
        if (state.activePane === 'feeds') {
          if (state.selectedFeedIndex > 0) {
            this.state.update({ selectedFeedIndex: state.selectedFeedIndex - 1 })
            this.loadArticlesForFeed(state.selectedFeedIndex - 1)
          }
        } else {
          if (state.selectedArticleIndex > 0) {
            this.state.update({ selectedArticleIndex: state.selectedArticleIndex - 1 })
          }
        }
        break
      }
      case 'navLeft': {
        if (state.activePane === 'articles') {
          this.state.update({ activePane: 'feeds' })
        }
        break
      }
      case 'select': {
        if (state.activePane === 'feeds') {
          this.state.update({
            activePane: 'articles',
            articleViewMode: 'list',
            selectedArticleIndex: 0,
          })
        } else if (state.articleViewMode === 'list') {
          this.state.update({ articleViewMode: 'detail' })
        }
        break
      }
      case 'goBack': {
        if (state.activePane === 'articles' && state.articleViewMode === 'detail') {
          this.state.update({ articleViewMode: 'list' })
        } else if (state.activePane === 'articles') {
          this.state.update({ activePane: 'feeds' })
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
        this.toggleRead()
        break
      }
      case 'star': {
        this.toggleStar()
        break
      }
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

        if (cachedFeeds.length > 0) {
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
      const selectedFeed = getSelectedFeed(currentState)

      this.state.update({
        feeds: enrichedFeeds,
        syncing: false,
        statusMessage: `Synced ${enrichedFeeds.length} feeds`,
        errorMessage: null,
      })

      if (selectedFeed) {
        await this.loadArticlesForFeed(currentState.selectedFeedIndex)
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
        articleViewMode: 'list',
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
