# Changelog

All notable changes to Trove are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and Trove uses
[Semantic Versioning](https://semver.org/).

The entry for each version becomes its **public GitHub Release notes**. Its
Chinese mirror in [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md) becomes the **in-app
updater notes**. Before running `npm run release x.y.z`, add a matching
`## [x.y.z]` section to **both** files.

## [Unreleased]

## [0.6.0] - 2026-11-23
### Added
- **Info panel** in the viewer (press I): caption, capture time, file details, camera, location, and viewing history. Captions can be edited in place.
- **Favorites and tags** for any file, with a Favorites view in the sidebar.
- **Audio recordings**: inline playback with a waveform, playback speed, and resume.
- **Statistics** page with monthly and yearly recaps.
- **Drag and drop**: drop files into a conversation, or paste files copied in File Explorer.
- **Capture time** is read from photo and video metadata. Sync folders are sorted by it.

### Changed
- Libraries are renamed to spaces. Space settings are organized into General, Security, and Data.
- The map now uses vector tiles, with light and dark styles and thumbnail markers.
- Default conversation avatars use the space color. Custom avatars are stored inside the space.
- Imported files no longer use their file name as the caption.
- HEIC photos are decoded by the system and open several times faster.
- Viewer zoom is smoother, works from the first open, and supports videos.

### Fixed
- Blank video thumbnails.
- Thumbnails not appearing until the conversation was reopened.
- Disks no longer in use staying in the disk list.
- Relink on a missing file now opens the missing files dialog.

### Upgrade notes
- Spaces are upgraded to a new format on first launch and can no longer be opened by earlier versions. Export a backup before updating if you may need to go back.

## [0.5.0] - 2026-11-13
### Added
- Multiple libraries, switched from a bar on the left. Conversations can be moved between them.
- Thumbnails in the message stream and media grid.
- Zoom and pan in the photo viewer.
- Right-click a message to open it with its default app, show it in its folder, copy its path, or set it as the conversation picture.
- Light and dark themes, and a new look throughout the app.
- Stable and preview update channels, a daily background check, download progress, and a feedback link.
- Optional passwords for Trove, libraries, and backups.
- A log file to attach to bug reports.

### Changed
- Your existing library is upgraded to the new format on first launch.
- Media on a disconnected drive shows as offline instead of missing.
- The online map background can be turned off.
- Launching Trove again brings the open window forward instead of starting a second copy.
- The Google account page is hidden for now.

### Fixed
- The viewer and media grid now reach every photo in a conversation, not just the newest ones.
- Background folder sync no longer jumps you back to the newest messages while you read older ones.
- The conversation list updates after you send or import something.
- A startup failure shows an error screen instead of closing silently.
- Lower memory use when viewing many HEIC photos.

## [0.4.2] - 2026-08-29
### Changed
- Redesigned the Trove app icon with a new double-eye mark across Windows, macOS, iOS, and Android assets.

## [0.4.1] - 2026-07-10
### Fixed
- In the standalone photo/video window, the picture now scales with the window as you resize it, instead of staying stuck at its original size while only the window grew.

## [0.4.0] - 2026-06-30
### Added
- Photo map: revisit your photos and videos by where they were taken. A new Map view clusters geotagged media on an interactive map (like Apple Photos) — tap a location to see everything shot there, then jump back to its conversation.
- Rotate a photo or video while viewing it, without changing the original file — in the chat viewer, the map viewer, and the standalone window.
- A redesigned video control bar: a scrubbable progress bar with buffering and hover preview, skip ±10s, playback speed (0.5×–2×), a volume slider, a loading spinner, auto-hiding controls, fullscreen, and keyboard shortcuts (space / M / F).
- Rename a conversation and pin it to the top of the list.

## [0.3.1] - 2026-05-31
### Fixed
- HEIC/HEIF photos (the format iPhones use) now display correctly in the message stream and the profile media grid, instead of showing as broken images.

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
