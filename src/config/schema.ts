import { z } from 'zod'

const syncSchema = z.object({
  interval: z.number().min(60).default(300),
  retention_days: z.number().min(1).default(30),
})

const themeSchema = z.object({
  name: z.enum(['default', 'dark', 'light', 'monokai', 'nord']).default('default'),
  background: z.string().default('#1a1a2e'),
  text: z.string().default('#e0e0e0'),
  text_dim: z.string().default('#888888'),
  accent: z.string().default('#7aa2f7'),
  border: z.string().default('#3b4261'),
  success: z.string().default('#9ece6a'),
  warning: z.string().default('#e0af68'),
  error: z.string().default('#f7768e'),
  star: z.string().default('#e0af68'),
  status_bg: z.string().default('#2a2a3e'),
})

const uiSchema = z.object({
  list_width: z.union([z.number(), z.string()]).default(40),
  show_unread_counts: z.boolean().default(true),
  date_format: z.string().default('%Y-%m-%d %H:%M'),
  theme: themeSchema.default({
    name: 'default',
    background: '#1a1a2e',
    text: '#e0e0e0',
    text_dim: '#888888',
    accent: '#7aa2f7',
    border: '#3b4261',
    success: '#9ece6a',
    warning: '#e0af68',
    error: '#f7768e',
    star: '#e0af68',
    status_bg: '#2a2a3e',
  }),
})

const keybindingsSchema = z.object({
  nav_down: z.string().default('j'),
  nav_up: z.string().default('k'),
  nav_left: z.string().default('h'),
  nav_right: z.string().default('l'),
  mark_read: z.string().default('m'),
  star: z.string().default('s'),
  refresh: z.string().default('r'),
  quit: z.string().default('q'),
})

export const configSchema = z.object({
  server: z.object({
    url: z.string().url(),
    username: z.string(),
    password: z.string(),
  }),
  sync: syncSchema.default({ interval: 300, retention_days: 30 }),
  ui: uiSchema.default({
    list_width: 40,
    show_unread_counts: true,
    date_format: '%Y-%m-%d %H:%M',
    theme: {
      name: 'default',
      background: '#1a1a2e',
      text: '#e0e0e0',
      text_dim: '#888888',
      accent: '#7aa2f7',
      border: '#3b4261',
      success: '#9ece6a',
      warning: '#e0af68',
      error: '#f7768e',
      star: '#e0af68',
      status_bg: '#2a2a3e',
    },
  }),
  keybindings: keybindingsSchema.default({
    nav_down: 'j',
    nav_up: 'k',
    nav_left: 'h',
    nav_right: 'l',
    mark_read: 'm',
    star: 's',
    refresh: 'r',
    quit: 'q',
  }),
})

export type Config = z.infer<typeof configSchema>

export const defaultConfig: Config = {
  server: {
    url: '',
    username: '',
    password: '',
  },
  sync: {
    interval: 300,
    retention_days: 30,
  },
  ui: {
    list_width: 40,
    show_unread_counts: true,
    date_format: '%Y-%m-%d %H:%M',
    theme: {
      name: 'default',
      background: '#1a1a2e',
      text: '#e0e0e0',
      text_dim: '#888888',
      accent: '#7aa2f7',
      border: '#3b4261',
      success: '#9ece6a',
      warning: '#e0af68',
      error: '#f7768e',
      star: '#e0af68',
      status_bg: '#2a2a3e',
    },
  },
  keybindings: {
    nav_down: 'j',
    nav_up: 'k',
    nav_left: 'h',
    nav_right: 'l',
    mark_read: 'm',
    star: 's',
    refresh: 'r',
    quit: 'q',
  },
}
