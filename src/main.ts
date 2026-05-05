import { loadConfig, ConfigError } from './config/index.ts'
import { App } from './ui/app.ts'

async function main() {
  try {
    const config = loadConfig()

    const app = new App(config)
    await app.start()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error('Configuration error:', error.message)
      process.exit(1)
    }

    console.error('Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
