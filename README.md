<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Trove icon">
</p>

<h1 align="center">Trove</h1>

<p align="center">
  A local-first media management desktop app with a chat-style interface.
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/fineyh/Trove?style=flat-square" alt="Latest Release">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
</p>

---

## What is Trove?

Trove organizes your local photos and videos in a **chat-like interface** inspired by Telegram and WeChat. Instead of traditional folder trees or grid galleries, every media group is a "conversation" — you scroll through images and videos the same way you scroll through messages.

**Your files never leave your machine.** Trove only stores metadata; media stays exactly where it is on disk.

## Features

### Chat-style browsing

- Three-pane layout: sidebar → conversation list → chat view
- Media displayed as message bubbles in a scrollable timeline
- Text captions alongside images and videos
- Pin and archive conversations to stay organized

### Smart video playback

- Videos auto-preview (muted) as you scroll, just like Telegram
- Click to open a full-screen player with controls, keyboard navigation, and play count tracking
- Pop out any video into a floating standalone window

### Flexible media import

- **Manual conversations** — drag-and-drop or pick files to add media freely
- **Folder import** — bulk-create a conversation from an existing folder
- **Folder watch** — bind a folder so new files sync in automatically via filesystem monitoring

### External drive awareness

- Automatically identifies USB drives and external disks by volume serial number
- When a drive is disconnected, its media gracefully hides; plug it back in and everything reappears
- Smart path following: if you rename or move files while Trove is running, it tracks the changes automatically

### File repair & recovery

- Detects broken file references on startup and in real-time
- One-click auto-repair by matching file size + BLAKE3 hash
- Manual repair with file picker for relocated media
- Dedicated management panel to review all broken references at once

### Map view

- Browse geotagged photos and videos on an interactive map
- Marker clustering for locations with many shots
- Click a cluster to browse all media from that spot
- Supports GPS data from JPEG, HEIC, MOV, and MP4 files

### Full-text search

- Instant search across conversation names and media captions
- Powered by SQLite FTS5

### Backup & restore

- Export all metadata to a portable `.trovebackup` archive
- Import with automatic safety backup of current data
- Your media files are never duplicated — backups only contain metadata and thumbnails

### Auto-update

- Built-in update checker with one-click install
- Signed updates via GitHub Releases

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri 2](https://v2.tauri.app/) (Rust backend + WebView frontend) |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| State | Zustand |
| Database | SQLite (via rusqlite) |
| File hashing | BLAKE3 |
| Filesystem | notify v6 (cross-platform file watcher) |
| Maps | Leaflet + leaflet.markercluster |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Rust](https://rustup.rs/) (stable toolchain)
- **Windows only**: [Strawberry Perl](https://strawberryperl.com/) + [NASM](https://www.nasm.us/) in PATH (required for building OpenSSL from source)

### Development

```bash
# Install frontend dependencies
npm install

# Start the dev server (frontend + Tauri backend)
npm run tauri:dev
```

### Build

```bash
# Production build
npm run tauri:build
```

The installer will be generated in `src-tauri/target/release/bundle/`.

## Project Structure

```
Trove/
├── src/                    # React frontend
│   ├── components/         #   UI components (layout, chat, profile, settings, map, dialogs)
│   ├── stores/             #   Zustand state management
│   ├── ipc/                #   Typed Tauri command wrappers
│   ├── hooks/              #   React hooks
│   ├── player/             #   Standalone video player window
│   └── lib/                #   Utilities
├── src-tauri/              # Rust backend
│   └── src/
│       ├── commands/       #   Tauri IPC command handlers
│       ├── db/             #   Database schema & migrations
│       └── services/       #   Core services (hashing, file watching, volume detection, etc.)
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## License

[MIT](LICENSE)
