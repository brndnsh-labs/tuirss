import { BoxRenderable, TextRenderable, ScrollBoxRenderable, TextAttributes } from '@opentui/core'
import type { RenderContext } from '@opentui/core'
import type { AppState } from '../state.ts'
import type { Article } from '../../api/types.ts'

const COLORS = {
  background: '#1a1a2e',
  text: '#e0e0e0',
  textDim: '#888888',
  textMuted: '#666666',
  accent: '#7aa2f7',
  border: '#3b4261',
  success: '#9ece6a',
  warning: '#e0af68',
  star: '#e0af68',
}

export class ArticleView {
  readonly container: BoxRenderable
  private contentText: TextRenderable
  private scrollBox: ScrollBoxRenderable | null = null
  private ctx: RenderContext

  constructor(ctx: RenderContext) {
    this.ctx = ctx
    this.container = new BoxRenderable(ctx, {
      id: 'article-view-container',
      border: true,
      borderStyle: 'rounded',
      borderColor: COLORS.border,
      title: ' Articles ',
      titleAlignment: 'left',
      shouldFill: true,
      backgroundColor: COLORS.background,
    })

    this.contentText = new TextRenderable(ctx, {
      id: 'article-view-text',
      fg: COLORS.text,
      wrapMode: 'word',
    })

    this.container.add(this.contentText)
  }

  update(state: AppState): void {
    if (!this.container.visible) {
      return
    }

    const innerWidth = this.container.width - 2
    if (innerWidth > 0) {
      this.contentText.width = innerWidth
    }

    if (state.viewMode === 'reader') {
      this.renderReader(state)
    } else {
      this.renderList(state)
    }
  }

  private renderList(state: AppState): void {
    if (state.isSearching) {
      this.container.title = ' Search '
      this.container.borderStyle = 'rounded'

      if (this.scrollBox) {
        this.scrollBox.visible = false
        this.contentText.visible = true
      }

      this.contentText.attributes = 0
      this.contentText.fg = COLORS.text
      this.contentText.content = `Search: ${state.searchQuery}_`
      return
    }

    const articles = state.filteredArticles.length > 0 ? state.filteredArticles : state.articles
    const isFiltered = state.filteredArticles.length > 0

    if (isFiltered) {
      this.container.title = ` Search: "${state.searchQuery}" (${articles.length}) `
    } else {
      this.container.title = ' Articles '
    }
    this.container.borderStyle = 'rounded'

    if (this.scrollBox) {
      this.scrollBox.visible = false
      this.contentText.visible = true
    }

    if (state.loadingArticles) {
      this.contentText.content = 'Loading articles...'
      this.contentText.fg = COLORS.textDim
      this.contentText.attributes = TextAttributes.DIM
      return
    }

    if (articles.length === 0) {
      if (isFiltered) {
        this.contentText.content = `No articles found matching "${state.searchQuery}"`
      } else {
        const feed = state.feeds[state.selectedFeedIndex]
        this.contentText.content = feed ? `No unread articles in ${feed.title}` : 'No articles'
      }
      this.contentText.fg = COLORS.textDim
      this.contentText.attributes = TextAttributes.DIM
      return
    }

    this.contentText.attributes = 0
    this.contentText.fg = COLORS.text

    let content = ''
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i] as Article
      const isRead = article.categories?.includes('user/-/state/com.google/read')
      const isStarred = article.categories?.includes('user/-/state/com.google/starred')
      const isSelected = i === state.selectedArticleIndex

      if (content) content += '\n'

      if (isSelected) {
        content += '▸ '
      } else {
        content += '  '
      }

      if (!isRead) {
        content += '● '
      } else {
        content += '  '
      }

      if (isStarred) {
        content += '★ '
      } else {
        content += '  '
      }

      content += article.title || 'Untitled'

      if (article.published) {
        content += `  ${new Date(article.published * 1000).toLocaleDateString()}`
      }
    }

    if (state.hasMoreArticles && !state.loadingArticles) {
      content += '\n\n  ── Press n to load more ──'
    }

    this.contentText.content = content
  }

  private renderReader(state: AppState): void {
    const articles = state.filteredArticles.length > 0 ? state.filteredArticles : state.articles
    const article = articles[state.selectedArticleIndex]
    if (!article) {
      this.renderList(state)
      return
    }

    this.container.title = state.zenMode ? '' : ` ${truncate(article.title, 40)} `
    this.container.titleAlignment = 'left'

    this.contentText.visible = false

    if (!this.scrollBox) {
      this.createScrollBox()
    }

    if (this.scrollBox) {
      this.scrollBox.visible = true
      this.updateScrollBoxContent(state, article)
    }
  }

  private createScrollBox(): void {
    this.scrollBox = new ScrollBoxRenderable(this.ctx, {
      id: 'article-reader-scroll',
      width: '100%',
      height: '100%',
      scrollY: true,
      scrollX: false,
      viewportCulling: true,
    })

    this.container.add(this.scrollBox)
  }

  private updateScrollBoxContent(state: AppState, article: Article): void {
    if (!this.scrollBox) return

    this.scrollBox.destroyRecursively()
    this.createScrollBox()
    if (!this.scrollBox) return

    const titleText = new TextRenderable(this.ctx, {
      id: 'reader-title',
      fg: COLORS.text,
      wrapMode: 'word',
      width: '100%',
    })

    const metaText = new TextRenderable(this.ctx, {
      id: 'reader-meta',
      fg: COLORS.textDim,
      wrapMode: 'word',
      width: '100%',
    })

    const separatorText = new TextRenderable(this.ctx, {
      id: 'reader-separator',
      fg: COLORS.textDim,
      wrapMode: 'none',
      width: '100%',
    })

    const bodyText = new TextRenderable(this.ctx, {
      id: 'reader-body',
      fg: COLORS.text,
      wrapMode: 'word',
      width: '100%',
    })

    if (!state.zenMode) {
      titleText.content = article.title || 'Untitled'
      titleText.attributes = TextAttributes.BOLD
      this.scrollBox.add(titleText)

      const metaParts: string[] = []
      if (article.author) {
        metaParts.push(`by ${article.author}`)
      }
      if (article.published) {
        const date = new Date(article.published * 1000)
        metaParts.push(
          date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        )
      }

      const isRead = article.categories?.includes('user/-/state/com.google/read')
      const isStarred = article.categories?.includes('user/-/state/com.google/starred')

      if (isRead) {
        metaParts.push('✓ read')
      }
      if (isStarred) {
        metaParts.push('★ starred')
      }

      if (metaParts.length > 0) {
        metaText.content = '\n' + metaParts.join(' · ')
        this.scrollBox.add(metaText)
      }

      separatorText.content = '\n' + '─'.repeat(Math.min(60, this.container.width - 4)) + '\n'
      this.scrollBox.add(separatorText)
    }

    const articleContent = article.content || article.summary?.content || 'No content available'
    bodyText.content = '\n' + stripHtml(articleContent)
    this.scrollBox.add(bodyText)
  }

  scrollUp(lines: number = 5): void {
    if (this.scrollBox) {
      this.scrollBox.scrollBy(-lines)
    }
  }

  scrollDown(lines: number = 5): void {
    if (this.scrollBox) {
      this.scrollBox.scrollBy(lines)
    }
  }

  scrollToTop(): void {
    if (this.scrollBox) {
      this.scrollBox.scrollTo(0)
    }
  }

  scrollToBottom(): void {
    if (this.scrollBox) {
      this.scrollBox.scrollTo({ x: 0, y: 999999 })
    }
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
