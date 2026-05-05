import {
  BoxRenderable,
  TextRenderable,
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
import type { Feed } from '../../api/types.ts'

const COLORS = {
  background: '#1a1a2e',
  text: '#e0e0e0',
  textDim: '#888888',
  accent: '#7aa2f7',
  border: '#3b4261',
  borderUnfocused: '#24283b',
  selectedBg: '#2a2a4a',
  selectedFg: '#ffffff',
  categoryDim: '#565f89',
  unreadDot: '#7aa2f7',
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
      borderColor: COLORS.borderUnfocused,
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

    this.container.title = ' Feeds '
    this.renderContent(state)
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
      this.contentText.content = t`${dim('Loading feeds...')}`
      this.contentText.attributes = TextAttributes.DIM
      return
    }

    if (state.feeds.length === 0) {
      this.contentText.content = t`${dim('No feeds found. Press r to refresh.')}`
      this.contentText.attributes = TextAttributes.DIM
      return
    }

    this.contentText.attributes = 0

    const categories = this.groupFeedsByCategory(state.feeds)

    const allChunks: TextChunk[] = []

    const allUnread = state.feeds.reduce((sum, f) => sum + (f.unreadCount ?? 0), 0)
    const isAllSelected = !state.selectedFeedId

    if (isAllSelected) {
      const line = t`${bold(fg(COLORS.selectedFg)('▸ All'))} ${bold(fg(COLORS.selectedFg)(`(${allUnread})`))}`
      allChunks.push(...line.chunks)
    } else {
      const line = t`  All ${fg(COLORS.unreadDot)(`(${allUnread})`)}`
      allChunks.push(...line.chunks)
    }

    for (const category of categories) {
      const isExpanded = state.expandedCategories.has(category.id)

      allChunks.push(...stringToStyledText('\n\n').chunks)

      const expandIcon = isExpanded ? '▼' : '▶'
      const categoryUnreadStr = category.totalUnread > 0 ? ` (${category.totalUnread})` : ''

      const catLine = t`${dim('  ' + expandIcon + ' ')}${fg(COLORS.categoryDim)(category.label)}${fg(COLORS.categoryDim)(categoryUnreadStr)}`
      allChunks.push(...catLine.chunks)

      if (isExpanded) {
        for (const feed of category.feeds) {
          const isSelected = state.selectedFeedId === feed.id
          const unread = feed.unreadCount ?? 0
          const feedUnreadStr = unread > 0 ? ` (${unread})` : ''

          allChunks.push(...stringToStyledText('\n').chunks)

          if (isSelected) {
            const feedLine = t`${bold(fg(COLORS.accent)('    ▸ '))}${bold(fg(COLORS.selectedFg)(feed.title || 'Untitled'))}${fg(COLORS.unreadDot)(feedUnreadStr)}`
            allChunks.push(...feedLine.chunks)
          } else {
            const feedLine = t`      ${feed.title || 'Untitled'}${fg(COLORS.unreadDot)(feedUnreadStr)}`
            allChunks.push(...feedLine.chunks)
          }
        }
      }
    }

    this.contentText.content = new StyledText(allChunks)
  }
}
