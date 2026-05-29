# Changelog

All notable changes to Trove are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and Trove uses
[Semantic Versioning](https://semver.org/).

The entry for each version becomes its **public GitHub Release notes**. Its
Chinese mirror in [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md) becomes the **in-app
updater notes**. Before running `npm run release x.y.z`, add a matching
`## [x.y.z]` section to **both** files.

## [Unreleased]

## [0.3.0] - 2026-05-30
### Added
- Messages now show timestamps, with a per-day date header that sticks to the top as you scroll and fades out while you read.
- Open a video or image in its own standalone window (right-click → open in new window): drag it out of the main window, resize it, and view several at once.

## [0.2.0] - 2026-05-30
### Added
- Right-click a message to delete it, with the option to also move the original file to the Recycle Bin.
- Repeat-click a conversation to toggle its selection on or off.

### Security
- Moved the Google OAuth credentials out of source code; they are now injected at build time.
- Rotated the updater signing key.

## [0.1.0] - 2026-05-29
### Added
- Conversations, message stream, media import, lightbox viewer, and full-text search.
- Folder bulk import and live `folder_watch` synchronization.
- Volume identification with a broken/live state machine.
- Vault encryption (SQLCipher) with a per-conversation key.
- Automatic rename-following and media repair.
- Google sign-in (PKCE) with refresh-token vault encryption.
- `.trovebackup` export/import with a rollback safety net.
- In-app updater backed by GitHub Releases.
- Settings reorganized into a sidebar with per-section panes, plus a unified broken-files manager.
