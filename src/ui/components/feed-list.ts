import { BoxRenderable, TextRenderable, TextAttributes } from '@opentui/core'
import type { RenderContext } from '@opentui/core'
import type { AppState } from '../state.ts'
import type { Feed } from '../../api/types.ts'

const COLORS = {
  background: '#1a1a2e',
  text: '#e0e0e0',
  textDim: '#888888',
  accent: '#7aa2f7',
  border: '#3b4261',
}

interface CategoryGroup {
  id: string
  label: string
  feeds: Feed[]
  totalUnread: number
}

export class FeedList {
  readonly container: BoxRenderable
  private contentText: TextRenderable

  constructor(ctx: RenderContext) {
    this.container = new BoxRenderable(ctx, {
      id: 'feed-list-container',
      border: true,
      borderStyle: 'rounded',
      borderColor: COLORS.border,
      title: ' Feeds ',
      titleAlignment: 'left',
      shouldFill: true,
      backgroundColor: COLORS.background,
    })

    this.contentText = new TextRenderable(ctx, {
      id: 'feed-list-text',
      fg: COLORS.textDim,
      wrapMode: 'word',
    })

    this.container.add(this.contentText)
  }

  update(state: AppState): void {
    const innerWidth = this.container.width - 2
    if (innerWidth > 0) {
      this.contentText.width = innerWidth
    }

    if (!this.container.visible) {
      return
    }

    if (state.sidebarCollapsed) {
      this.container.title = '▶'
      this.renderCollapsedContent(state)
    } else {
      this.container.title = ' Feeds '
      this.renderContent(state)
    }
  }

  private renderCollapsedContent(state: AppState): void {
    const totalUnread = state.feeds.reduce((sum, f) => sum + (f.unreadCount ?? 0), 0)
    if (totalUnread > 0) {
      this.contentText.content = `●\n${totalUnread}`
    } else {
      this.contentText.content = '●'
    }
  }

  private groupFeedsByCategory(feeds: Feed[]): CategoryGroup[] {
    const groups = new Map<string, CategoryGroup>()
    const uncategorized: Feed[] = []

    for (const feed of feeds) {
      if (feed.categories && feed.categories.length > 0) {
        for (const category of feed.categories) {
          const id = category.id || 'uncategorized'
          const label = category.label || 'Uncategorized'

          if (!groups.has(id)) {
            groups.set(id, { id, label, feeds: [], totalUnread: 0 })
          }

          const group = groups.get(id)!
          group.feeds.push(feed)
          group.totalUnread += feed.unreadCount ?? 0
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
        totalUnread: uncategorized.reduce((sum, f) => sum + (f.unreadCount ?? 0), 0),
      })
    }

    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  private renderContent(state: AppState): void {
    if (state.loadingFeeds) {
      this.contentText.content = 'Loading feeds...'
      this.contentText.attributes = TextAttributes.DIM
      return
    }

    if (state.feeds.length === 0) {
      this.contentText.content = 'No feeds found. Press r to refresh.'
      this.contentText.attributes = TextAttributes.DIM
      return
    }

    this.contentText.attributes = 0

    const categories = this.groupFeedsByCategory(state.feeds)
    const currentFeedIndex = state.selectedFeedIndex
    let currentIndex = 0

    let content = ''

    for (const category of categories) {
      const isExpanded = state.expandedCategories.has(category.id)

      if (content) content += '\n'

      const expandIcon = isExpanded ? '▼' : '▶'
      content += '  ' + expandIcon + ' '

      content += category.label

      if (category.totalUnread > 0) {
        content += ` (${category.totalUnread})`
      }

      if (isExpanded) {
        for (const feed of category.feeds) {
          const isSelected = currentIndex === currentFeedIndex && state.viewMode === 'feeds'

          content += '\n'

          if (isSelected) {
            content += '    ▸ '
          } else {
            content += '      '
          }

          content += feed.title || 'Untitled'

          const unread = feed.unreadCount ?? 0
          if (unread > 0) {
            content += ` (${unread})`
          }

          currentIndex++
        }
      } else {
        currentIndex += category.feeds.length
      }
    }

    this.contentText.content = content
  }
}
