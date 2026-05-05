import type { KeyEvent } from '@opentui/core'
import type { Pane, ArticleViewMode } from './state.ts'

export type Action =
  | 'navDown'
  | 'navUp'
  | 'navLeft'
  | 'navRight'
  | 'select'
  | 'quit'
  | 'refresh'
  | 'markRead'
  | 'star'
  | 'goBack'

export interface KeyBinding {
  key: string
  action: Action
}

const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  { key: 'j', action: 'navDown' },
  { key: 'down', action: 'navDown' },
  { key: 'k', action: 'navUp' },
  { key: 'up', action: 'navUp' },
  { key: 'h', action: 'navLeft' },
  { key: 'left', action: 'navLeft' },
  { key: 'l', action: 'navRight' },
  { key: 'right', action: 'navRight' },
  { key: 'enter', action: 'select' },
  { key: 'q', action: 'quit' },
  { key: 'r', action: 'refresh' },
  { key: 'm', action: 'markRead' },
  { key: 's', action: 'star' },
  { key: 'escape', action: 'goBack' },
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
      if (binding.key === keyName && !key.ctrl && !key.meta) {
        return binding.action
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
  pane: Pane,
  viewMode: ArticleViewMode
): Action | null {
  if (action === 'navRight') {
    if (pane === 'feeds') return 'select'
    return null
  }

  if (action === 'navLeft') {
    if (pane === 'articles' && viewMode === 'detail') return 'goBack'
    if (pane === 'articles') return 'navLeft'
    return null
  }

  if (action === 'goBack') {
    if (pane === 'articles' && viewMode === 'detail') return 'goBack'
    if (pane === 'articles') return 'navLeft'
    return null
  }

  return action
}
