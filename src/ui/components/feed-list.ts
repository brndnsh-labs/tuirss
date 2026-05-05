import { BoxRenderable, TextRenderable } from '@opentui/core'
import type { RenderContext } from '@opentui/core'
import type { AppState } from '../state.ts'
import type { Feed } from '../../api/types.ts'

export class FeedList {
  readonly container: BoxRenderable
  private contentText: TextRenderable

  constructor(ctx: RenderContext) {
    this.container = new BoxRenderable(ctx, {
      id: 'feed-list-container',
      border: true,
      borderStyle: 'single',
      title: ' Feeds ',
      shouldFill: true,
      backgroundColor: '#1a1a2e',
    })

    this.contentText = new TextRenderable(ctx, {
      id: 'feed-list-text',
      fg: '#aaaaaa',
      wrapMode: 'word',
    })

    this.container.add(this.contentText)
  }

  update(state: AppState): void {
    const innerWidth = this.container.width - 2
    if (innerWidth > 0) {
      this.contentText.width = innerWidth
    }
    this.contentText.content = this.renderContent(state)
  }

  private renderContent(state: AppState): string {
    if (state.loadingFeeds) {
      return 'Loading feeds...'
    }

    if (state.feeds.length === 0) {
      return 'No feeds found. Press r to refresh.'
    }

    const lines: string[] = []
    for (let i = 0; i < state.feeds.length; i++) {
      const feed = state.feeds[i] as Feed
      const isSelected = i === state.selectedFeedIndex && state.activePane === 'feeds'
      const unread = feed.unreadCount ?? 0
      const unreadBadge = unread > 0 ? ` (${unread})` : ''
      const prefix = isSelected ? '▸ ' : '  '
      lines.push(`${prefix}${feed.title || 'Untitled'}${unreadBadge}`)
    }

    return lines.join('\n')
  }
}
