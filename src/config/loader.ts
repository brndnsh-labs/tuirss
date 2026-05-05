import { parse } from 'smol-toml'
import type { Config } from './schema.ts'
import { configSchema, defaultConfig } from './schema.ts'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

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

interface ParsedToml {
  server?: Record<string, string>
  sync?: Record<string, number>
  ui?: Record<string, unknown>
  keybindings?: Record<string, string>
}

export function loadConfig(configPath?: string): Config {
  const path = configPath || getConfigPath()
  
  if (!existsSync(path)) {
    throw new ConfigError(
      `Configuration file not found: ${path}\n\n` +
      `Please create a config file at:\n` +
      `  ${getConfigPath()}\n\n` +
      `See config.example.toml for an example configuration.`
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
      const issues = result.error.issues.map((e) => 
        `  - ${e.path.join('.')}: ${e.message}`
      ).join('\n')
      
      throw new ConfigError(
        `Invalid configuration in ${path}:\n${issues}`
      )
    }
    
    return result.data
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error
    }
    
    if (error instanceof Error && error.message.includes('TOML')) {
      throw new ConfigError(
        `Failed to parse TOML in ${path}:\n${error.message}`
      )
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
