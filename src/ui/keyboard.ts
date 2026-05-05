import type { KeyEvent } from '@opentui/core'
import type { NavigationDepth } from './state.ts'

export type Action =
  | 'navDown'
  | 'navUp'
  | 'select'
  | 'goBack'
  | 'goDeeper'
  | 'quit'
  | 'refresh'
  | 'markRead'
  | 'star'
  | 'toggleZenMode'
  | 'scrollDown'
  | 'scrollUp'
  | 'pageDown'
  | 'pageUp'
  | 'scrollToTop'
  | 'scrollToBottom'
  | 'search'
  | 'clearSearch'
  | 'expandCollapse'
  | 'loadMore'
  | 'exportOpml'
  | 'showAllArticles'

export interface KeyBinding {
  key: string
  action: Action
}

const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  { key: 'j', action: 'navDown' },
  { key: 'down', action: 'navDown' },
  { key: 'k', action: 'navUp' },
  { key: 'up', action: 'navUp' },
  { key: 'l', action: 'goDeeper' },
  { key: 'right', action: 'goDeeper' },
  { key: 'enter', action: 'select' },
  { key: 'h', action: 'goBack' },
  { key: 'left', action: 'goBack' },
  { key: 'escape', action: 'goBack' },
  { key: 'q', action: 'quit' },
  { key: 'r', action: 'refresh' },
  { key: 'm', action: 'markRead' },
  { key: 's', action: 'star' },
  { key: 'z', action: 'toggleZenMode' },
  { key: 'ctrl+d', action: 'pageDown' },
  { key: 'ctrl+u', action: 'pageUp' },
  { key: 'pagedown', action: 'pageDown' },
  { key: 'pageup', action: 'pageUp' },
  { key: 'g', action: 'scrollToTop' },
  { key: 'G', action: 'scrollToBottom' },
  { key: 'space', action: 'pageDown' },
  { key: '/', action: 'search' },
  { key: 'ctrl+c', action: 'clearSearch' },
  { key: 'tab', action: 'expandCollapse' },
  { key: 'n', action: 'loadMore' },
  { key: 'ctrl+e', action: 'exportOpml' },
  { key: 'a', action: 'showAllArticles' },
]

export class KeyboardHandler {
  private bindings: KeyBinding[]
  private actionHandler: ((action: Action) => void) | null = null

  constructor(customBindings?: Partial<Record<string, Action>>) {
    this.bindings = [...DEFAULT_KEYBINDINGS]

    if (customBindings) {
      for (const [key, action] of Object.entries(customBindings)) {
        if (!action) continue
        const existing = this.bindings.findIndex((b) => b.key === key)
        if (existing >= 0) {
          this.bindings[existing] = { key, action: action as Action }
        } else {
          this.bindings.push({ key, action: action as Action })
        }
      }
    }
  }

  onAction(handler: (action: Action) => void): void {
    this.actionHandler = handler
  }

  handleKey(key: KeyEvent): boolean {
    const action = this.resolveAction(key)
    if (action && this.actionHandler) {
      this.actionHandler(action)
      return true
    }
    return false
  }

  resolveAction(key: KeyEvent): Action | null {
    const keyName = key.name

    for (const binding of this.bindings) {
      const bindingKey = binding.key

      if (bindingKey.includes('+')) {
        const parts = bindingKey.split('+')
        const hasCtrl = parts.includes('ctrl')
        const hasShift = parts.includes('shift')
        const baseKey = parts[parts.length - 1]

        if (key.name === baseKey && key.ctrl === hasCtrl && key.shift === hasShift && !key.meta) {
          return binding.action
        }
      } else {
        if (bindingKey === keyName && !key.ctrl && !key.meta) {
          return binding.action
        }
      }
    }

    if (key.ctrl && keyName === 'c') {
      return 'quit'
    }

    return null
  }
}

export function resolveActionForContext(
  action: Action,
  navigationDepth: NavigationDepth
): Action | null {
  // At feeds depth, j/k navigate feeds, l/enter selects feed and goes deeper
  if (navigationDepth === 'feeds') {
    if (
      action === 'scrollDown' ||
      action === 'scrollUp' ||
      action === 'pageDown' ||
      action === 'pageUp' ||
      action === 'scrollToTop' ||
      action === 'scrollToBottom'
    ) {
      return null
    }
    if (action === 'goDeeper') {
      return 'goDeeper'
    }
    if (action === 'goBack') {
      return null
    }
  }

  // At content depth, j/k scroll content, h goes back to articles
  if (navigationDepth === 'content') {
    if (action === 'navDown') {
      return 'navDown'
    }
    if (action === 'navUp') {
      return 'navUp'
    }
    if (action === 'select') {
      return null
    }
  }

  // At articles depth, j/k navigate articles, l goes to content, h goes to feeds
  if (navigationDepth === 'articles') {
    if (
      action === 'scrollDown' ||
      action === 'scrollUp' ||
      action === 'pageDown' ||
      action === 'pageUp' ||
      action === 'scrollToTop' ||
      action === 'scrollToBottom'
    ) {
      return null
    }
  }

  return action
}
