import { TextRenderable } from '@opentui/core'
import type { RenderContext } from '@opentui/core'
import type { AppState } from '../state.ts'

const COLORS = {
  fg: '#e0e0e0',
  bg: '#2a2a3e',
  accent: '#7aa2f7',
  success: '#9ece6a',
  error: '#f7768e',
  warning: '#e0af68',
}

export class StatusBar {
  readonly text: TextRenderable

  constructor(ctx: RenderContext) {
    this.text = new TextRenderable(ctx, {
      id: 'status-bar',
      height: 1,
      fg: COLORS.fg,
      bg: COLORS.bg,
      wrapMode: 'none',
      truncate: true,
    })
  }

  update(state: AppState): void {
    let content = ''

    if (state.isSearching) {
      content += 'Type to search, Enter to search, Esc to cancel'
      content += `  │  query: ${state.searchQuery || '(empty)'}`
      this.text.content = content
      return
    }

    if (!state.isOnline) {
      content += '⚠ offline'
    } else if (state.syncing) {
      content += '⟳ syncing...'
    } else if (state.errorMessage) {
      content += `✗ ${state.errorMessage}`
    } else if (state.statusMessage) {
      content += state.statusMessage
    }

    if (state.lastSyncTime && !state.syncing && state.isOnline) {
      const lastSync = new Date(state.lastSyncTime)
      const now = new Date()
      const diffMinutes = Math.floor((now.getTime() - lastSync.getTime()) / 60000)

      if (diffMinutes > 60) {
        const diffHours = Math.floor(diffMinutes / 60)
        if (content) content += '  '
        content += `last sync: ${diffHours}h ago`
      }
    }

    const totalUnread = state.feeds.reduce((sum, f) => sum + (f.unreadCount ?? 0), 0)
    if (content) content += '  '
    content += `unread: ${totalUnread}`

    let shortcuts = 'j/k:navigate'

    switch (state.viewMode) {
      case 'feeds':
        shortcuts += '  l/Enter:articles'
        break
      case 'articles':
        shortcuts += '  l/Enter:read  h:back  /:search'
        break
      case 'reader':
        shortcuts += '  h:back  z:zen'
        break
    }

    if (state.viewMode !== 'feeds') {
      shortcuts += '  m:read  s:star'
    }

    shortcuts += '  r:refresh  ^e:export  q:quit'

    if (state.layoutMode !== 'single' && state.viewMode !== 'reader') {
      shortcuts += '  \\:sidebar'
    }

    content += `  │  ${shortcuts}`

    this.text.content = content
  }
}
