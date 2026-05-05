# TUIRSS

A terminal-based FreshRSS client with Reeder-inspired UX, built with [OpenTUI](https://github.com/anomalyco/opentui).

## Features

- 🗞️ **Feed browsing** with folder support
- 📖 **Article reading** with clean layout
- ✅ **Mark as read/unread/starred**
- 🔄 **Sync with FreshRSS** using Google Reader API
- ⌨️ **Keyboard navigation** (vim-style)
- 🔍 **Search/filter** (planned)
- 💾 **Local SQLite cache** for offline reading

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/tuirss.git
cd tuirss

# Install dependencies
bun install
```

## Configuration

1. Copy the example config:
```bash
mkdir -p ~/.config/tuirss
cp config.example.toml ~/.config/tuirss/config.toml
```

2. Edit `~/.config/tuirss/config.toml` with your FreshRSS details:
```toml
[server]
url = "http://docker01:8080/api/"
username = "your-username"
password = "your-api-password"
```

To get your API password:
1. Log into FreshRSS web interface
2. Go to Profile settings
3. Set an "API password" (different from your login password)
4. Use this password in the config

## Usage

```bash
# Run in development mode
bun run dev

# Or build and run
bun run build
bun run ./dist/main.js
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `↓` | Navigate down |
| `k` / `↑` | Navigate up |
| `h` / `←` | Go back |
| `l` / `→` / `Enter` | Select/open |
| `m` | Toggle read/unread |
| `s` | Toggle star |
| `r` | Refresh/sync |
| `q` | Quit |

## Architecture

- **Config**: TOML with Zod validation
- **API**: FreshRSS Google Reader API client
- **Cache**: SQLite for offline storage
- **UI**: OpenTUI with 2-column layout
- **Sync**: Efficient incremental sync

## Development

```bash
# Type check
bun run typecheck

# Run
bun run dev
```

## License

MIT
