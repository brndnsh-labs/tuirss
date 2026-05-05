import { z } from 'zod'

/**
 * Configuration schema for TUIRSS
 * Validated at runtime with Zod for type safety
 */
export const configSchema = z.object({
  server: z.object({
    url: z.string().url().describe('FreshRSS API URL (e.g., http://docker01:8080/api/)'),
    username: z.string().describe('FreshRSS username'),
    password: z.string().describe('FreshRSS API password (not your login password)'),
  }),
  
  sync: z.object({
    interval: z.number().min(60).default(300).describe('Sync interval in seconds'),
    retention_days: z.number().min(1).default(30).describe('How long to keep articles (days)'),
  }).default({}),
  
  ui: z.object({
    list_width: z.union([z.number(), z.string()]).default(40).describe('Width of feed/article list (columns or %)'),
    show_unread_counts: z.boolean().default(true).describe('Show unread counts next to feeds'),
    date_format: z.string().default('%Y-%m-%d %H:%M').describe('Date format for articles (strftime)'),
  }).default({}),
  
  keybindings: z.object({
    nav_down: z.string().default('j').describe('Navigate down'),
    nav_up: z.string().default('k').describe('Navigate up'),
    nav_left: z.string().default('h').describe('Navigate left / go back'),
    nav_right: z.string().default('l').describe('Navigate right / select'),
    mark_read: z.string().default('m').describe('Mark article as read/unread'),
    star: z.string().default('s').describe('Star/unstar article'),
    refresh: z.string().default('r').describe('Refresh/sync feeds'),
    quit: z.string().default('q').describe('Quit application'),
  }).default({}),
})

export type Config = z.infer<typeof configSchema>

/**
 * Default configuration values
 */
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
