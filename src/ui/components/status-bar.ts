import { TextRenderable } from '@opentui/core'
import type { RenderContext } from '@opentui/core'
import type { AppState } from '../state.ts'

export class StatusBar {
  readonly text: TextRenderable

  constructor(ctx: RenderContext) {
    this.text = new TextRenderable(ctx, {
      id: 'status-bar',
      height: 1,
      fg: '#ffffff',
      bg: '#4a4a4a',
      wrapMode: 'none',
      truncate: true,
    })
  }

  update(state: AppState): void {
    const parts: string[] = []

    if (state.syncing) {
      parts.push('⟳ Syncing...')
    } else if (state.errorMessage) {
      parts.push(`✗ ${state.errorMessage}`)
    } else if (state.statusMessage) {
      parts.push(state.statusMessage)
    }

    const totalUnread = state.feeds.reduce((sum, f) => sum + (f.unreadCount ?? 0), 0)
    parts.push(`Unread: ${totalUnread}`)

    const paneLabel = state.activePane === 'feeds' ? 'Feeds' : 'Articles'
    parts.push(`[${paneLabel}]`)

    parts.push('j/k:navigate  h/l:switch  Enter:select  m:read  s:star  r:refresh  q:quit')

    this.text.content = parts.join('  │  ')
  }
}
