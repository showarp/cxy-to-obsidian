# 更新日志

## v0.2.0

### 新增功能

- **Safari Userscripts 兼容** — 当 `GM_getValue` / `GM_setValue` / `GM_registerMenuCommand` 不可用（如 Safari Userscripts）时，自动回退到 `localStorage`，无需额外配置即可使用。
- **设置按钮** — 在底部操作栏的 Obsidian 按钮右侧新增齿轮图标设置按钮，点击即可打开配置面板，不再依赖油猴菜单命令。
- **按钮分隔线** — Obsidian 按钮组与网站原生按钮（收藏、错题、掌握等）之间增加竖线分隔，视觉层级更清晰。

### 优化改进

- **深色主题适配** — 导出按钮和配置面板均会自动检测页面背景亮度，在深色模式下自动切换为暗色样式（深色背景、浅色文字、半透明白色边框）。
- **标签去重** — `category_full_path` 和 `题源` 生成的标签现在通过 `Set` 去重，避免重复。
- **分类名精简** — `{category_name}` 占位符现在只取路径的最后一段，笔记标题更简洁。

## v0.1.0

- 初始版本：支持将 cxyonly.fans 题目通过 `obsidian://` 协议导出到 Obsidian。
