import { loadConfig, ConfigError } from './config/index.ts'
import { FreshRSSClient } from './api/index.ts'
import { Cache } from './cache/index.ts'

async function main() {
  try {
    const config = loadConfig()

    console.log('TUIRSS starting...')
    console.log(`Server: ${config.server.url}`)
    console.log(`User: ${config.server.username}`)

    const client = new FreshRSSClient(
      config.server.url,
      config.server.username,
      config.server.password
    )

    await client.login()
    console.log('✓ Authenticated with FreshRSS')

    const cache = new Cache()
    console.log('✓ Cache initialized')

    const feeds = await client.getFeeds()
    console.log(`✓ Fetched ${feeds.length} feeds`)

    cache.saveFeeds(feeds)
    console.log('✓ Feeds cached')

    const unreadCounts = await client.getUnreadCounts()
    console.log(`✓ Unread counts: ${unreadCounts.reduce((sum, u) => sum + u.count, 0)} total`)

    const articles = await client.getArticles({ unreadOnly: true, count: 10 })
    console.log(`✓ Fetched ${articles.items.length} unread articles`)

    cache.saveArticles(articles.items)
    console.log('✓ Articles cached')

    console.log('\nTUIRSS initialized successfully!')
    console.log('Next: Implement the TUI interface with OpenTUI')

    cache.close()
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
