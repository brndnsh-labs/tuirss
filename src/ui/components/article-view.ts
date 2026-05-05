import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  t,
  fg,
  bold,
  dim,
  StyledText,
  stringToStyledText,
  type TextChunk,
} from '@opentui/core'
import type { RenderContext } from '@opentui/core'
import type { AppState } from '../state.ts'
import { getDisplayArticles } from '../state.ts'
import type { Article } from '../../api/types.ts'

const COLORS = {
  background: '#1a1a2e',
  text: '#e0e0e0',
  textDim: '#888888',
  textMuted: '#666666',
  accent: '#7aa2f7',
  border: '#3b4261',
  borderFocused: '#7aa2f7',
  borderUnfocused: '#24283b',
  success: '#9ece6a',
  warning: '#e0af68',
  star: '#e0af68',
  selectedBg: '#2a2a4a',
  selectedFg: '#ffffff',
  unreadDot: '#7aa2f7',
}

export class ArticleView {
  readonly container: BoxRenderable
  readonly articleListContainer: BoxRenderable
  readonly contentContainer: BoxRenderable
  private articleListText: TextRenderable
  private contentText: TextRenderable
  private scrollBox: ScrollBoxRenderable | null = null
  private ctx: RenderContext
  private contentOnlyMode = false

  constructor(ctx: RenderContext) {
    this.ctx = ctx

    this.container = new BoxRenderable(ctx, {
      id: 'article-view',
      flexDirection: 'row',
      flexGrow: 1,
      shouldFill: true,
      backgroundColor: COLORS.background,
    })

    this.articleListContainer = new BoxRenderable(ctx, {
      id: 'article-list-container',
      border: true,
      borderStyle: 'rounded',
      borderColor: COLORS.borderFocused,
      title: ' Articles ',
      titleAlignment: 'left',
      shouldFill: true,
      backgroundColor: COLORS.background,
      width: 35,
    })

    this.articleListText = new TextRenderable(ctx, {
      id: 'article-list-text',
      fg: COLORS.text,
      wrapMode: 'word',
    })

    this.articleListContainer.add(this.articleListText)

    this.contentContainer = new BoxRenderable(ctx, {
      id: 'content-container',
      border: true,
      borderStyle: 'rounded',
      borderColor: COLORS.borderUnfocused,
      title: ' Content ',
      titleAlignment: 'left',
      shouldFill: true,
      backgroundColor: COLORS.background,
      flexGrow: 1,
    })

    this.contentText = new TextRenderable(ctx, {
      id: 'content-text',
      fg: COLORS.text,
      wrapMode: 'word',
    })

    this.contentContainer.add(this.contentText)

    this.container.add(this.articleListContainer)
    this.container.add(this.contentContainer)
  }

  showArticleListAndContent(): void {
    this.contentOnlyMode = false
    this.articleListContainer.visible = true
    this.contentContainer.visible = true
    this.contentContainer.flexGrow = 1
  }

  showContentOnly(): void {
    this.contentOnlyMode = true
    this.articleListContainer.visible = false
    this.contentContainer.visible = true
    this.contentContainer.width = '100%'
    this.contentContainer.flexGrow = 1
  }

  setArticleListWidth(width: number): void {
    this.articleListContainer.width = width
    this.articleListContainer.flexGrow = 0
  }

  update(state: AppState): void {
    if (!this.container.visible) {
      return
    }

    const innerListWidth = this.articleListContainer.width - 2
    if (innerListWidth > 0) {
      this.articleListText.width = innerListWidth
    }

    const innerContentWidth = this.contentContainer.width - 2
    if (innerContentWidth > 0) {
      this.contentText.width = innerContentWidth
    }

    this.renderArticleList(state)
    this.renderContent(state)
  }

  private renderArticleList(state: AppState): void {
    if (!this.articleListContainer.visible) {
      return
    }

    if (state.isSearching) {
      this.articleListContainer.title = ' Search '
      this.articleListText.attributes = 0
      this.articleListText.fg = COLORS.text
      this.articleListText.content = `Search: ${state.searchQuery}_`
      return
    }

    const articles = getDisplayArticles(state)

    if (state.selectedFeedId) {
      const feed = state.feeds.find((f) => f.id === state.selectedFeedId)
      this.articleListContainer.title = feed ? ` ${feed.title} ` : ' Articles '
    } else {
      this.articleListContainer.title = ' All Articles '
    }

    if (state.loadingArticles) {
      this.articleListText.content = t`${dim('Loading articles...')}`
      this.articleListText.fg = COLORS.textDim
      this.articleListText.attributes = TextAttributes.DIM
      return
    }

    if (articles.length === 0) {
      if (state.filteredArticles.length > 0) {
        this.articleListText.content = t`${dim(`No articles matching "${state.searchQuery}"`)}`
      } else {
        this.articleListText.content = t`${dim('No unread articles')}`
      }
      this.articleListText.fg = COLORS.textDim
      this.articleListText.attributes = TextAttributes.DIM
      return
    }

    this.articleListText.attributes = 0
    this.articleListText.fg = COLORS.text

    const listWidth = this.articleListContainer.width || 35
    const maxTitleLen = Math.max(10, listWidth - 8)

    const allChunks: TextChunk[] = []

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i] as Article
      const isRead = article.categories?.includes('user/-/state/com.google/read')
      const isStarred = article.categories?.includes('user/-/state/com.google/starred')
      const isSelected = i === state.selectedArticleIndex

      const title = article.title || 'Untitled'
      const truncatedTitle = truncate(title, maxTitleLen)

      if (i > 0) {
        allChunks.push(...stringToStyledText('\n').chunks)
      }

      if (isSelected) {
        const line = t`${bold(fg(COLORS.accent)('▸'))} ${!isRead ? fg(COLORS.unreadDot)('●') + ' ' : '  '}${isStarred ? fg(COLORS.star)('★') + ' ' : '  '}${bold(fg(COLORS.selectedFg)(truncatedTitle))}`
        allChunks.push(...line.chunks)
      } else {
        const unreadPart = !isRead ? fg(COLORS.unreadDot)('●') + ' ' : dim('· ')
        const starPart = isStarred ? fg(COLORS.star)('★') + ' ' : '  '
        const titlePart = isRead ? dim(truncatedTitle) : truncatedTitle
        const line = t`  ${unreadPart}${starPart}${titlePart}`
        allChunks.push(...line.chunks)
      }
    }

    if (state.hasMoreArticles && !state.loadingArticles) {
      allChunks.push(...stringToStyledText('\n\n').chunks)
      allChunks.push(...t`${dim('  ── Press n to load more ──')}`.chunks)
    }

    this.articleListText.content = new StyledText(allChunks)
  }

  private renderContent(state: AppState): void {
    if (!this.contentContainer.visible) {
      return
    }

    const articles = getDisplayArticles(state)
    const article = articles[state.selectedArticleIndex]

    if (!article) {
      this.contentContainer.title = ' Content '
      this.contentText.visible = true
      if (this.scrollBox) {
        this.scrollBox.visible = false
      }
      this.contentText.content = 'Select an article to read'
      this.contentText.fg = COLORS.textDim
      this.contentText.attributes = TextAttributes.DIM
      return
    }

    this.contentContainer.title = state.zenMode ? '' : ` ${truncate(article.title, 40)} `
    this.contentContainer.titleAlignment = 'left'

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

    this.contentContainer.add(this.scrollBox)
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
      if (article.origin?.title) {
        metaParts.push(`from ${article.origin.title}`)
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

      separatorText.content =
        '\n' + '─'.repeat(Math.min(60, this.contentContainer.width - 4)) + '\n'
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
