import { BoxRenderable, TextRenderable, ScrollBoxRenderable } from '@opentui/core'
import type { RenderContext } from '@opentui/core'
import type { AppState } from '../state.ts'
import type { Feed } from '../../api/types.ts'

export class FeedList {
  readonly container: BoxRenderable
  private scrollBox: ScrollBoxRenderable
  private contentBox: BoxRenderable
  private feedItems: TextRenderable[] = []

  constructor(ctx: RenderContext) {
    this.container = new BoxRenderable(ctx, {
      id: 'feed-list-container',
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      title: ' Feeds ',
      shouldFill: true,
      backgroundColor: '#1a1a2e',
    })

    this.scrollBox = new ScrollBoxRenderable(ctx, {
      id: 'feed-list-scroll',
      scrollY: true,
      scrollX: false,
      shouldFill: true,
      flexGrow: 1,
    })

    this.contentBox = new BoxRenderable(ctx, {
      id: 'feed-list-content',
      flexDirection: 'column',
      shouldFill: true,
    })

    this.scrollBox.content.add(this.contentBox)
    this.container.add(this.scrollBox)
  }

  update(state: AppState): void {
    this.rebuildFeedItems(state)
  }

  private rebuildFeedItems(state: AppState): void {
    for (const item of this.feedItems) {
      this.contentBox.remove(item.id)
      item.destroy()
    }
    this.feedItems = []

    if (state.loadingFeeds) {
      const loadingText = new TextRenderable(this.container.ctx, {
        id: 'feed-loading',
        content: '  Loading feeds...',
        fg: '#888888',
        height: 1,
        wrapMode: 'none',
        truncate: true,
      })
      this.contentBox.add(loadingText)
      this.feedItems.push(loadingText)
      return
    }

    if (state.feeds.length === 0) {
      const emptyText = new TextRenderable(this.container.ctx, {
        id: 'feed-empty',
        content: '  No feeds found. Press r to refresh.',
        fg: '#888888',
        height: 1,
        wrapMode: 'none',
        truncate: true,
      })
      this.contentBox.add(emptyText)
      this.feedItems.push(emptyText)
      return
    }

    for (let i = 0; i < state.feeds.length; i++) {
      const feed = state.feeds[i] as Feed
      const isSelected = i === state.selectedFeedIndex && state.activePane === 'feeds'
      const item = this.createFeedItem(feed, i, isSelected)
      this.contentBox.add(item)
      this.feedItems.push(item)
    }
  }

  private createFeedItem(feed: Feed, index: number, isSelected: boolean): TextRenderable {
    const unread = feed.unreadCount ?? 0
    const unreadBadge = unread > 0 ? ` (${unread})` : ''
    const prefix = isSelected ? '▸ ' : '  '
    const title = feed.title || 'Untitled'
    const displayText = `${prefix}${title}${unreadBadge}`

    const item = new TextRenderable(this.container.ctx, {
      id: `feed-item-${index}`,
      content: displayText,
      height: 1,
      wrapMode: 'none',
      truncate: true,
      fg: isSelected ? '#ffffff' : '#aaaaaa',
      bg: isSelected ? '#3a3a5c' : undefined,
    })

    return item
  }

  scrollToSelected(state: AppState): void {
    if (state.feeds.length === 0) return
    const targetId = `feed-item-${state.selectedFeedIndex}`
    this.scrollBox.scrollChildIntoView(targetId)
  }
}
