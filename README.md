<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FormForge (PDF 表单编辑器)

FormForge 是一个基于 React + Vite 的 PDF 表单/批注编辑器，支持在 PDF 上创建和编辑表单控件（Text/Checkbox/Radio/Dropdown/Signature）与批注（Highlight/Ink/Comment/FreeText），并可导出回写到 PDF。

该项目同时支持：

- **Web 版**：浏览器中运行（文件通过 File System Access API 或下载保存）
- **桌面版**：通过 **Tauri** 打包（支持从路径打开、保存到本地路径、最近文件列表等）

## 快速开始

**Prerequisites:** Node.js（项目 `packageManager` 标记为 `bun`）

1. 安装依赖
   - `bun install`

2. （可选）配置 Gemini API Key（用于 AI 自动识别表单区域）

   在 `.env.local` 中设置：
   - `GEMINI_API_KEY=...`

   说明：构建时会在 `vite.config.ts` 中将 `GEMINI_API_KEY` 注入为 `process.env.API_KEY` / `process.env.GEMINI_API_KEY`，供 `src/services/geminiService.ts` 使用。

3. 启动 Web 开发服务器
   - `bun run dev`
   - 或 `npm run dev`

4. 启动 Tauri 桌面版开发（可选）
   - `bun run dev:app`
   - 或 `npm run dev:app`

## Tauri / 桌面端（src-tauri）

桌面版相关配置与入口都在 `src-tauri/`，前端侧通过 `@tauri-apps/api` + `@tauri-apps/plugin-*` 访问能力。

### 关键配置文件

- **`src-tauri/tauri.conf.json`**
  - `build.devUrl`: `http://localhost:3000`（对应 Vite dev server）
  - `build.beforeDevCommand`: `bun dev`（启动 Vite）
  - `app.windows[].dragDropEnabled`: `true`（启用拖拽文件事件）
  - `plugins.cli.args`: 定义 CLI 参数 `source`（用于“从路径启动并打开 PDF”）

- **`src-tauri/capabilities/default.json`**
  - 桌面端权限声明（window/cli/dialog/fs）。
  - 当前包含 `fs:allow-read-file` / `fs:allow-write-file` 且 `path: "**"`。
    如果后续要收紧安全边界，应优先从这里改权限范围，而不是在业务代码里做分散的路径判断。

### 桌面端能力对应的前端实现位置（避免重复造轮子）

- **打开/保存文件**：`src/services/fileOps.ts`
  - Tauri：`@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs`
  - Web：File System Access API（或降级为 download）

- **从命令行参数打开 PDF**：
  - Tauri 侧参数定义：`src-tauri/tauri.conf.json` → `plugins.cli.args[].name = "source"`
  - 前端读取参数：`src/services/fileOps.ts` → `getStartupOpenPdfArg()`（内部用 `@tauri-apps/plugin-cli`）
  - App 启动时加载：`src/App.tsx` 的初始化逻辑会尝试读取并打开该路径

- **拖拽打开 PDF（桌面端）**：
  - 前端监听：`src/App.tsx` → `getCurrentWebview().onDragDropEvent(...)`
  - 行为约束：如果当前已有打开文档，会先弹出“是否替换”一类的确认流程（避免误覆盖）

### 命令

- **桌面端开发**：`bun run dev:app` / `npm run dev:app`
- **桌面端打包**：`bun run build:app` / `npm run build:app`

## 项目结构（建议先看这里，避免重复造轮子）

下面列出的是“架构关键路径”，日常开发大多围绕这些目录扩展：

```text
src/
  index.tsx                  # 应用入口：Provider + Router + registerControls
  App.tsx                    # 应用编排：打开/解析/导出/草稿恢复/AI 识别/路由跳转
  AppRoutes.tsx              # 路由与 editor 访问保护
  pages/
    LandingPage.tsx          # 首页：上传/打开、最近文件（桌面）、恢复草稿
    EditorPage.tsx           # 编辑器页面：Toolbar/Sidebar/Workspace/PropertiesPanel
  store/
    useEditorStore.ts        # Zustand：编辑器“单一状态源”(SSOT) + undo/redo + UI 持久化
  services/
    fileOps.ts               # 文件打开/保存抽象（Web vs Tauri）
    storageService.ts        # Web 草稿存储（IndexedDB）
    recentFilesService.ts    # 桌面最近文件（localStorage）
    geminiService.ts         # AI 识别：从页面截图推断字段位置/类型
    pdfWorkerService.ts      # 渲染 worker 编排层（给 workspace 使用）
    pdfService.ts            # PDF 解析/渲染/导出中心（pdfjs-dist + pdf-lib）
    pdf/                     # PDF“领域层”实现（导入/导出/资源解析的可扩展管线）
      parsers/               # 将 PDF 原生对象 -> FormField/Annotation
      exporters/             # 将 FormField/Annotation -> 写回 PDF
      lib/                   # PDF 资源/字体/appearance/outline 等工具库
      types.ts               # Parser/Exporter 的接口与上下文类型
  components/
    workspace/               # 编辑器画布：PDF 页渲染 + 控件叠加 + 交互
      Workspace.tsx          # 交互中心：选中/拖拽/缩放/绘制批注
      PDFPageWithProxy.tsx   # 单页渲染入口（会走 worker 渲染）
      controls/              # 控件系统：registry + renderer + wrapper + properties
    properties-panel/        # 右侧属性面板（文档属性 + 控件属性）
    sidebar/                 # 左侧面板：页面缩略图、字段/批注列表、outline
    toolbar/                 # 顶部工具栏/快捷键入口
    ui/                      # 通用 UI 组件（button/dialog/popover/...）
  hooks/                     # 交互/性能相关 hooks（panning/ink/autoscroll/...）
  lib/                       # 跨模块基础能力（tool 行为、字体、通用 utils）
  utils/                     # 纯工具函数（颜色、PDF date 解析等）
  workers/                   # Web Worker（如 pdf-render.worker.ts）
  styles/                    # 样式资源（Tailwind/全局样式补充）
  types.ts                   # 核心数据结构：EditorState/FormField/Annotation/Tool 等
  locales/                   # i18n 字典（按语言拆分）
src-tauri/                   # Tauri 桌面端（Rust）
  tauri.conf.json            # 桌面端配置（窗口/dragDrop/CLI args/build）
  capabilities/              # 权限声明（fs/dialog/cli/window 等）
  src/
    main.rs                  # 极薄入口：转发到 lib.rs
    lib.rs                   # 插件初始化（dialog/fs/cli/log）
public/
  pdfjs/                     # pdfjs 的 cmaps/standard_fonts（由 viteStaticCopy 复制）
  fonts/                     # 项目内置字体（用于 CJK 渲染/导出）
```

## 核心数据流（理解这条链路就能快速定位问题）

### 1) 打开 PDF → 进入编辑器

- **入口**：`src/App.tsx`
- **解析**：`services/pdfService.loadPDF(input)`
  - 使用 `pdfjs-dist` 提取页面信息/outline，并负责渲染侧资源
  - 使用 `pdf-lib` 解析可编辑资源（字体映射、DA 等），并用于导出回写
- **落地状态**：`store/useEditorStore.ts` 的 `loadDocument(...)`
- **路由**：`AppRoutes.tsx` 控制是否可进入 `/editor`

### 2) Workspace 渲染：PDF 页 + 控件叠加

- **PDF 页渲染**：`components/workspace/PDFPageWithProxy`（内部会使用 `pdfWorkerService` 做离屏渲染/分块渲染）
- **控件渲染**：`components/workspace/controls/ControlRenderer.tsx`
  - 按 `data.type` 从 `ControlRegistry` 取组件
  - 未注册类型在 dev 下会 `console.warn`，避免“悄悄不显示”

### 3) 编辑状态：单一状态源（SSOT）

- **统一状态**：`useEditorStore` 维护 `EditorState`（pages/fields/annotations/metadata/选中项/工具/缩放等）
- **撤销重做**：通过 `past/future` 快照实现（字段/批注/元数据）
- **UI 持久化**：只持久化 UI 相关字段（侧边栏开关/宽度/Tab 等），避免把大 PDF 数据写进 localStorage

### 4) 保存/导出

- **导出 PDF**：`services/pdfService.exportPDF(...)` 生成新的 PDF bytes
- **写入**：`services/fileOps.writeToSaveTarget(...)`（Web：File Picker；Tauri：写文件）
- **Web 草稿**：`services/storageService.saveDraft/getDraft/clearDraft`（IndexedDB）

### 5) AI 自动识别字段

- **入口**：`services/geminiService.analyzePageForFields(...)`
- **输入**：页面截图（base64）、页面尺寸、已有字段（用于增量/纠错）
- **输出**：推断出的 `FormField[]`（带坐标/类型/样式倾向）
- **注意**：无 API Key 时会直接抛错（UI 侧需要捕获并提示）

## 扩展点（强烈建议先看：避免重复实现模块）

### 添加新的“表单控件类型”（推荐的最短路径）

- **Step 1**：在 `src/types.ts` 的 `FieldType` 中新增枚举值
- **Step 2**：在 `src/components/workspace/controls/` 下新增
  - 控件渲染组件（Canvas 上的样式/交互）
  - 属性面板组件（右侧可编辑属性）
- **Step 3**：在 `src/components/workspace/controls/index.ts` 的 `registerControls()` 注册
- **Step 4**：如果需要导出/导入到真实 PDF 表单
  - 在 `src/services/pdf/parsers/ControlParsers` 增加 parser
  - 在 `src/services/pdf/exporters/ControlExporters` 增加 exporter
  - 并由 `services/pdfService.ts` 的注册数组装配进管线

### 添加新的“批注类型”

- 批注渲染/属性面板同样走 `ControlRegistry`（type 为字符串，比如 `highlight`/`ink`）
- PDF 导入/导出同样由 Annotation parser/exporter 管线负责

### 添加新的工具（Tool）或快捷键行为

- `src/types.ts`：扩展 `Tool` 联合类型
- `src/lib/tool-behavior`：工具行为/光标/用后切回 select 等规则
- `EditorPage.tsx`：键盘事件分发（例如 `Ctrl+S`、方向键微调等）

### i18n 文案

- `src/components/language-provider.tsx` 使用 `import.meta.glob` 动态加载 `src/locales/*.ts`
- 新增语言：增加 `src/locales/<lang>.ts` 并在 `LANGUAGES` 中加入配置

## Fonts

This project bundles **Noto Sans SC** (sans-serif) and **Source Han Serif SC** (serif) for CJK text rendering/export.

See `public/fonts/NOTICE.txt` for license and attribution details.
