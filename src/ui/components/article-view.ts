import { BoxRenderable, TextRenderable, ScrollBoxRenderable, TextAttributes } from '@opentui/core'
import type { RenderContext } from '@opentui/core'
import type { AppState } from '../state.ts'
import type { Article } from '../../api/types.ts'

export class ArticleView {
  readonly container: BoxRenderable
  private scrollBox: ScrollBoxRenderable
  private contentBox: BoxRenderable
  private items: TextRenderable[] = []

  constructor(ctx: RenderContext) {
    this.container = new BoxRenderable(ctx, {
      id: 'article-view-container',
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      title: ' Articles ',
      shouldFill: true,
      backgroundColor: '#1a1a2e',
    })

    this.scrollBox = new ScrollBoxRenderable(ctx, {
      id: 'article-view-scroll',
      scrollY: true,
      scrollX: false,
      shouldFill: true,
      flexGrow: 1,
    })

    this.contentBox = new BoxRenderable(ctx, {
      id: 'article-view-content',
      flexDirection: 'column',
      shouldFill: true,
    })

    this.scrollBox.content.add(this.contentBox)
    this.container.add(this.scrollBox)
  }

  update(state: AppState): void {
    if (state.articleViewMode === 'detail') {
      this.renderDetail(state)
    } else {
      this.renderList(state)
    }
  }

  private renderList(state: AppState): void {
    this.container.title = ' Articles '
    this.clearItems()

    if (state.activePane === 'feeds' && state.articles.length === 0) {
      this.showPlaceholder('Select a feed to view articles')
      return
    }

    if (state.loadingArticles) {
      this.showPlaceholder('Loading articles...')
      return
    }

    if (state.articles.length === 0) {
      const feed = state.feeds[state.selectedFeedIndex]
      this.showPlaceholder(feed ? `No articles in ${feed.title}` : 'No articles')
      return
    }

    for (let i = 0; i < state.articles.length; i++) {
      const article = state.articles[i] as Article
      const isSelected = i === state.selectedArticleIndex && state.activePane === 'articles'
      const item = this.createArticleListItem(article, i, isSelected)
      this.contentBox.add(item)
      this.items.push(item)
    }
  }

  private renderDetail(state: AppState): void {
    const article = state.articles[state.selectedArticleIndex]
    if (!article) {
      this.renderList(state)
      return
    }

    this.container.title = ` ${truncate(article.title, 40)} `
    this.clearItems()

    const titleText = new TextRenderable(this.container.ctx, {
      id: 'article-detail-title',
      content: article.title || 'Untitled',
      fg: '#ffffff',
      height: 1,
      wrapMode: 'word',
      attributes: TextAttributes.BOLD,
    })
    this.contentBox.add(titleText)
    this.items.push(titleText)

    const metaParts: string[] = []
    if (article.author) metaParts.push(`By ${article.author}`)
    if (article.published) {
      const date = new Date(article.published * 1000)
      metaParts.push(date.toLocaleDateString())
    }
    const isRead = article.categories?.includes('user/-/state/com.google/read')
    const isStarred = article.categories?.includes('user/-/state/com.google/starred')
    const statusIcons: string[] = []
    if (isRead) statusIcons.push('✓')
    if (isStarred) statusIcons.push('★')
    if (statusIcons.length > 0) metaParts.push(statusIcons.join(' '))

    if (metaParts.length > 0) {
      const metaText = new TextRenderable(this.container.ctx, {
        id: 'article-detail-meta',
        content: metaParts.join(' │ '),
        fg: '#888888',
        height: 1,
        wrapMode: 'none',
        truncate: true,
      })
      this.contentBox.add(metaText)
      this.items.push(metaText)
    }

    const separator = new TextRenderable(this.container.ctx, {
      id: 'article-detail-separator',
      content: '─'.repeat(80),
      fg: '#444444',
      height: 1,
      wrapMode: 'none',
      truncate: true,
    })
    this.contentBox.add(separator)
    this.items.push(separator)

    const content = article.content || article.summary?.content || 'No content available'
    const plainContent = stripHtml(content)

    const contentText = new TextRenderable(this.container.ctx, {
      id: 'article-detail-content',
      content: plainContent,
      fg: '#cccccc',
      wrapMode: 'word',
    })
    this.contentBox.add(contentText)
    this.items.push(contentText)
  }

  private createArticleListItem(
    article: Article,
    index: number,
    isSelected: boolean
  ): TextRenderable {
    const isRead = article.categories?.includes('user/-/state/com.google/read')
    const isStarred = article.categories?.includes('user/-/state/com.google/starred')

    const readMarker = isRead ? '  ' : '● '
    const starMarker = isStarred ? '★ ' : '  '
    const prefix = isSelected ? '▸ ' : '  '
    const title = article.title || 'Untitled'

    const dateStr = article.published ? new Date(article.published * 1000).toLocaleDateString() : ''

    const displayText = `${prefix}${readMarker}${starMarker}${title}  ${dateStr}`

    const item = new TextRenderable(this.container.ctx, {
      id: `article-item-${index}`,
      content: displayText,
      height: 1,
      wrapMode: 'none',
      truncate: true,
      fg: isSelected ? '#ffffff' : isRead ? '#666666' : '#cccccc',
      bg: isSelected ? '#3a3a5c' : undefined,
    })

    return item
  }

  private showPlaceholder(message: string): void {
    const placeholder = new TextRenderable(this.container.ctx, {
      id: 'article-placeholder',
      content: `  ${message}`,
      fg: '#888888',
      height: 1,
      wrapMode: 'none',
      truncate: true,
    })
    this.contentBox.add(placeholder)
    this.items.push(placeholder)
  }

  private clearItems(): void {
    for (const item of this.items) {
      this.contentBox.remove(item.id)
      item.destroy()
    }
    this.items = []
  }

  scrollToSelected(state: AppState): void {
    if (state.articleViewMode === 'detail') return
    if (state.articles.length === 0) return
    const targetId = `article-item-${state.selectedArticleIndex}`
    this.scrollBox.scrollChildIntoView(targetId)
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
