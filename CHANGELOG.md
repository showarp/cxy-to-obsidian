# Changelog

## v0.2.0

### New Features

- **Safari Userscripts Support** — Added `localStorage` fallback when GM API (`GM_getValue` / `GM_setValue` / `GM_registerMenuCommand`) is unavailable, so the script now works out of the box in Safari Userscripts.
- **Inline Settings Button** — A gear icon button is now injected next to the Obsidian export button in the bottom toolbar, providing a quick way to open the config panel without relying on the userscript manager menu.
- **Visual Divider** — A vertical line separates the Obsidian / Settings button group from the website's native action buttons (收藏, 错题, 掌握, etc.).

### Improvements

- **Dark Theme Adaptation** — Both the export buttons and the configuration modal now auto-detect the page's background brightness and switch to dark colors when appropriate (dark background `#1e1e1e`, light text, muted borders).
- **Tag Deduplication** — Tags generated from `category_full_path` and `题源` are now deduplicated via `Set`.
- **Category Name Trimming** — `{category_name}` now uses only the last segment of the path, producing cleaner note titles.

## v0.1.0

- Initial release: Export cxyonly.fans questions to Obsidian via `obsidian://` URI.
