<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FormForge (PDF 表单编辑器)

FormForge 是一个基于 React + Vite 的 PDF 表单/批注编辑器，使用 [pdfjs](https://github.com/mozilla/pdf.js) 进行 PDF 渲染，以及 [pdf-lib](https://github.com/Hopding/pdf-lib) 进行 PDF 操作。 支持在 PDF 上创建和编辑表单控件（Text/Checkbox/Radio/Dropdown/Signature）与批注（Highlight/Ink/Comment/FreeText），并可导出回写到 PDF。

该项目同时支持：

- **Web 版**：浏览器中运行（使用 File System Access API）
- **桌面版**：通过 **Tauri** 打包（使用 Tauri fs API）

## 快速开始

**Prerequisites:** Node.js（推荐使用 Bun）

1. 安装依赖
   - `bun install`

2. （可选）配置 AI / 翻译相关环境变量

   在 `.env.local` 中设置：
   - `GEMINI_API_KEY=...`
   - `OPENAI_API_KEY=...`
   - `OPENAI_API_URL=...`（可选，用于自定义 OpenAI 兼容接口地址）

   说明：构建时会在 `vite.config.ts` 中将这些变量注入为 `process.env.*`，其中 `GEMINI_API_KEY` 同时会映射到 `process.env.API_KEY` / `process.env.GEMINI_API_KEY`。

3. 启动 Web 开发服务器
   - `bun run dev`

4. 启动 Tauri 桌面版开发
   - `bun run dev:app`

## 文档

- 项目架构、目录结构、核心数据流、扩展点：[ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Fonts

This project bundles **Noto Sans SC** (sans-serif) and **Source Han Serif SC** (serif) for CJK text rendering/export.

See [NOTICE.txt](public/fonts/NOTICE.txt) for license and attribution details.
