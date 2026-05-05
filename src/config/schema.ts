import { z } from 'zod'

const syncSchema = z.object({
  interval: z.number().min(60).default(300),
  retention_days: z.number().min(1).default(30),
})

const uiSchema = z.object({
  list_width: z.union([z.number(), z.string()]).default(40),
  show_unread_counts: z.boolean().default(true),
  date_format: z.string().default('%Y-%m-%d %H:%M'),
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
  ui: uiSchema.default({ list_width: 40, show_unread_counts: true, date_format: '%Y-%m-%d %H:%M' }),
  keybindings: keybindingsSchema.default({
    nav_down: 'j', nav_up: 'k', nav_left: 'h', nav_right: 'l',
    mark_read: 'm', star: 's', refresh: 'r', quit: 'q'
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
