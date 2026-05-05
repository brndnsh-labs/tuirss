import { parse } from 'smol-toml'
import type { Config } from './schema.ts'
import { configSchema, defaultConfig } from './schema.ts'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME
  if (xdgConfig) {
    return join(xdgConfig, 'tuirss')
  }
  return join(homedir(), '.config', 'tuirss')
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.toml')
}

export function getDataDir(): string {
  const xdgData = process.env.XDG_DATA_HOME
  if (xdgData) {
    return join(xdgData, 'tuirss')
  }
  return join(homedir(), '.local', 'share', 'tuirss')
}

const DEFAULT_CONFIG_TEMPLATE = `# TUIRSS Configuration
# Created automatically on first run
# Please fill in your FreshRSS details below

[server]
# Your FreshRSS instance URL
# Example: http://docker01:8080/api/ or https://rss.example.com/api/
# The /greader.php path will be added automatically if missing
url = ""

# Your FreshRSS username
username = ""

# Your FreshRSS API password (set in FreshRSS Profile settings)
password = ""

[sync]
interval = 300
retention_days = 30

[ui]
list_width = 40
show_unread_counts = true
date_format = "%Y-%m-%d %H:%M"

[keybindings]
nav_down = "j"
nav_up = "k"
nav_left = "h"
nav_right = "l"
mark_read = "m"
star = "s"
refresh = "r"
quit = "q"
`

function createDefaultConfig(path: string): void {
  const dir = dirname(path)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(path, DEFAULT_CONFIG_TEMPLATE, 'utf-8')
}

interface ParsedToml {
  server?: Record<string, string>
  sync?: Record<string, number>
  ui?: Record<string, unknown>
  keybindings?: Record<string, string>
}

export function loadConfig(configPath?: string): Config {
  const path = configPath || getConfigPath()

  if (!existsSync(path)) {
    createDefaultConfig(path)
    throw new ConfigError(
      `Welcome to TUIRSS!\n\n` +
        `A default configuration file has been created at:\n` +
        `  ${path}\n\n` +
        `Please edit this file and add your FreshRSS credentials:\n` +
        `  1. Set your server URL (e.g., http://docker01:8080/api/)\n` +
        `  2. Set your username\n` +
        `  3. Set your API password (from FreshRSS Profile settings)\n\n` +
        `Then run TUIRSS again.`
    )
  }

  try {
    const content = readFileSync(path, 'utf-8')
    const parsed = parse(content) as ParsedToml

    const merged: Config = {
      server: { ...defaultConfig.server, ...(parsed.server || {}) },
      sync: { ...defaultConfig.sync, ...(parsed.sync || {}) },
      ui: { ...defaultConfig.ui, ...(parsed.ui || {}) },
      keybindings: { ...defaultConfig.keybindings, ...(parsed.keybindings || {}) },
    }

    const result = configSchema.safeParse(merged)

    if (!result.success) {
      const issues = result.error.issues
        .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
        .join('\n')

      throw new ConfigError(`Invalid configuration in ${path}:\n${issues}`)
    }

    return result.data
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error
    }

    if (error instanceof Error && error.message.includes('TOML')) {
      throw new ConfigError(`Failed to parse TOML in ${path}:\n${error.message}`)
    }

    throw new ConfigError(
      `Failed to load configuration from ${path}:\n${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}
