import { BoxRenderable, TextRenderable } from '@opentui/core'
import type { RenderContext } from '@opentui/core'
import type { AppState } from '../state.ts'
import type { Article } from '../../api/types.ts'

export class ArticleView {
  readonly container: BoxRenderable
  private contentText: TextRenderable

  constructor(ctx: RenderContext) {
    this.container = new BoxRenderable(ctx, {
      id: 'article-view-container',
      border: true,
      borderStyle: 'single',
      title: ' Articles ',
      shouldFill: true,
      backgroundColor: '#1a1a2e',
    })

    this.contentText = new TextRenderable(ctx, {
      id: 'article-view-text',
      fg: '#cccccc',
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
    this.container.title = ' Articles '

    if (state.loadingArticles) {
      this.contentText.content = 'Loading articles...'
      this.contentText.fg = '#888888'
      return
    }

    if (state.articles.length === 0) {
      const feed = state.feeds[state.selectedFeedIndex]
      this.contentText.content = feed ? `No unread articles in ${feed.title}` : 'No articles'
      this.contentText.fg = '#888888'
      return
    }

    const lines: string[] = []
    for (let i = 0; i < state.articles.length; i++) {
      const article = state.articles[i] as Article
      const isRead = article.categories?.includes('user/-/state/com.google/read')
      const isStarred = article.categories?.includes('user/-/state/com.google/starred')

      const readMarker = isRead ? '  ' : '● '
      const starMarker = isStarred ? '★ ' : '  '
      const prefix = i === state.selectedArticleIndex ? '▸ ' : '  '
      const title = article.title || 'Untitled'
      const dateStr = article.published
        ? new Date(article.published * 1000).toLocaleDateString()
        : ''

      lines.push(`${prefix}${readMarker}${starMarker}${title}  ${dateStr}`)
    }

    this.contentText.content = lines.join('\n')
    this.contentText.fg = '#cccccc'
  }

  private renderReader(state: AppState): void {
    const article = state.articles[state.selectedArticleIndex]
    if (!article) {
      this.renderList(state)
      return
    }

    this.container.title = state.zenMode ? '' : ` ${truncate(article.title, 40)} `

    const parts: string[] = []

    if (!state.zenMode) {
      parts.push(article.title || 'Untitled')
      parts.push('')

      const metaParts: string[] = []
      if (article.author) metaParts.push(`By ${article.author}`)
      if (article.published) {
        const date = new Date(article.published * 1000)
        metaParts.push(date.toLocaleDateString())
      }
      const isRead = article.categories?.includes('user/-/state/com.google/read')
      const isStarred = article.categories?.includes('user/-/state/com.google/starred')
      const statusIcons: string[] = []
      if (isRead) statusIcons.push('✓ Read')
      if (isStarred) statusIcons.push('★ Starred')
      if (statusIcons.length > 0) metaParts.push(statusIcons.join(' | '))

      if (metaParts.length > 0) {
        parts.push(metaParts.join(' │ '))
      }

      parts.push('─'.repeat(Math.min(60, this.container.width - 4)))
    }

    const content = article.content || article.summary?.content || 'No content available'
    parts.push(stripHtml(content))

    this.contentText.content = parts.join('\n')
    this.contentText.fg = '#cccccc'
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
