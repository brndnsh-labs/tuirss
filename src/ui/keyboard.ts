import type { KeyEvent } from '@opentui/core'
import type { ViewMode } from './state.ts'

export type Action =
  | 'navDown'
  | 'navUp'
  | 'select'
  | 'goBack'
  | 'quit'
  | 'refresh'
  | 'markRead'
  | 'star'
  | 'toggleSidebar'
  | 'toggleZenMode'

export interface KeyBinding {
  key: string
  action: Action
}

const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  { key: 'j', action: 'navDown' },
  { key: 'down', action: 'navDown' },
  { key: 'k', action: 'navUp' },
  { key: 'up', action: 'navUp' },
  { key: 'l', action: 'select' },
  { key: 'right', action: 'select' },
  { key: 'enter', action: 'select' },
  { key: 'h', action: 'goBack' },
  { key: 'left', action: 'goBack' },
  { key: 'escape', action: 'goBack' },
  { key: 'q', action: 'quit' },
  { key: 'r', action: 'refresh' },
  { key: 'm', action: 'markRead' },
  { key: 's', action: 'star' },
  { key: '\\', action: 'toggleSidebar' },
  { key: 'z', action: 'toggleZenMode' },
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

export function resolveActionForContext(action: Action, viewMode: ViewMode): Action | null {
  if (action === 'select' && viewMode === 'reader') {
    return null
  }

  if (action === 'goBack' && viewMode === 'feeds') {
    return null
  }

  return action
}
