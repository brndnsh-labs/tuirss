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

    const shortcuts: string[] = ['j/k:navigate']

    switch (state.viewMode) {
      case 'feeds':
        shortcuts.push('l/Enter:articles')
        break
      case 'articles':
        shortcuts.push('l/Enter:read', 'h:back')
        break
      case 'reader':
        shortcuts.push('h:back', 'z:zen')
        break
    }

    if (state.viewMode !== 'feeds') {
      shortcuts.push('m:read', 's:star')
    }

    shortcuts.push('r:refresh', 'q:quit')

    if (state.layoutMode !== 'single' && state.viewMode !== 'reader') {
      shortcuts.push('\\:sidebar')
    }

    parts.push(shortcuts.join('  '))

    this.text.content = parts.join('  │  ')
  }
}
