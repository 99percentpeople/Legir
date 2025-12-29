# FormForge 架构与开发指南

本文档收纳 FormForge 的架构、目录结构、核心数据流、扩展点以及 Tauri 桌面端开发说明。

## 快速索引

- **架构入口**：`src/index.tsx`
- **应用编排**：`src/App.tsx`
- **编辑器页面**：`src/pages/EditorPage.tsx`
- **画布/交互核心**：`src/components/workspace/Workspace.tsx`
- **控件系统**：`src/components/workspace/controls/*`
- **编辑器状态（SSOT）**：`src/store/useEditorStore.ts`
- **PDF 管线**：`src/services/pdfService.ts` + `src/services/pdf/*`
- **文件打开/保存（Web vs Tauri）**：`src/services/fileOps.ts`

---

## 运行方式（Web / Tauri）

**Prerequisites:** Node.js（项目 `packageManager` 标记为 `bun`）

- Web dev：`bun run dev`
- Tauri dev：`bun run dev:app`
- Web build：`bun run build`
- Tauri build：`bun run build:app`

### Gemini API Key（可选）

用于 AI 自动识别字段（见 `src/services/geminiService.ts`）。在 `.env.local` 中设置：

- `GEMINI_API_KEY=...`

构建时会在 `vite.config.ts` 中注入为 `process.env.API_KEY` / `process.env.GEMINI_API_KEY`。

---

## 目录结构（关键路径）

```text
src/
  index.tsx                  # 应用入口：Provider + Router
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
    pdfService/
      index.ts               # PDF 解析/渲染/导出中心（pdfjs-dist + pdf-lib）
      pdfWorkerService.ts    # 渲染 worker 编排层（给 workspace 使用）
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

---

## 核心数据流

### 1) 打开 PDF → 进入编辑器

- **入口**：`src/App.tsx`
- **解析**：`src/services/pdfService.loadPDF(input)`
  - `pdfjs-dist`：页面信息/outline/渲染侧资源
  - `pdf-lib`：资源解析（字体映射、DA 等）与导出写回
- **落地状态**：`src/store/useEditorStore.ts` 的 `loadDocument(...)`
- **路由**：`src/AppRoutes.tsx` 控制是否可进入编辑器

### 2) Workspace 渲染：PDF 页 + 控件叠加

- **PDF 页渲染**：`components/workspace/PDFPageWithProxy`（通过 `pdfWorkerService` 走 worker 渲染）
- **控件渲染**：`components/workspace/controls/ControlRenderer.tsx`
  - 根据 `data.type` 从 `ControlRegistry` 取对应组件

### 3) 编辑状态：单一状态源（SSOT）

- 状态统一由 `useEditorStore` 管理（文档 + UI）。
- Undo/Redo 通过 `past/future` 快照。
- UI 状态会持久化到 localStorage；大对象/二进制不在 store 持久化。

### 4) 保存/导出

- **导出 PDF bytes**：`services/pdfService.exportPDF(...)`
- **写入目标**：`services/fileOps.writeToSaveTarget(...)`
  - Web：File Picker / download
  - Tauri：filesystem plugin 写文件
- **Web 草稿**：`services/storageService`（IndexedDB）

### 5) AI 自动识别字段

- `services/geminiService.analyzePageForFields(...)`
- 无 API Key 会抛错；UI 侧应提示用户设置 `.env.local`。

---

## 扩展点（避免重复实现）

### 添加新的“表单控件类型”

- 在 `src/types.ts` 的 `FieldType` 中新增类型
- 在 `src/components/workspace/controls/` 下新增
  - Canvas 渲染组件（如 `./form/*`）
  - 属性面板组件（如 `./properties/*`）
- 在 `src/components/workspace/controls/index.ts` 的 `registerControls()` 注册

**如果需要导入/导出到 PDF 原生对象**：

- 增加 parser：`src/services/pdf/parsers/*`
- 增加 exporter：`src/services/pdf/exporters/*`
- 由 `src/services/pdfService.ts` 将其装配进 parser/exporter 数组

### 添加新的“批注类型”

- 同样通过 `ControlRegistry` 注册（type 为字符串，如 `highlight`/`ink`）
- PDF 导入/导出同样走 annotation parser/exporter

### 添加新工具（Tool）或快捷键行为

- `src/types.ts`：扩展 `Tool`
- `src/lib/tool-behavior.ts`：工具行为/光标/用后切回 select 规则
- `src/pages/EditorPage.tsx`：键盘事件分发

### i18n

- `src/components/language-provider.tsx` 使用 `import.meta.glob` 动态加载 `src/locales/*.ts`
- 新增语言：增加 `src/locales/<lang>.ts`

---

## Tauri / 桌面端（src-tauri）

### 关键配置

- `src-tauri/tauri.conf.json`
  - `app.windows[].dragDropEnabled: true`
  - `plugins.cli.args`：定义 `source` 参数
- `src-tauri/capabilities/default.json`
  - 权限声明（fs/dialog/cli/window）
  - 当前 `fs:allow-read-file` / `fs:allow-write-file` 的 `path: "**"` 权限较宽，收紧时优先从 capabilities 做。

### 桌面端能力对应的前端实现

- 打开/保存：`src/services/fileOps.ts`（统一做 Web vs Tauri 分支）
- 启动参数打开 PDF：`src/services/fileOps.ts#getStartupOpenPdfArg()` → `src/App.tsx` 初始化流程
- 拖拽打开 PDF：`src/App.tsx` 使用 `getCurrentWebview().onDragDropEvent(...)`

---

## Fonts

项目内置 **Noto Sans SC**（sans-serif）与 **Source Han Serif SC**（serif）用于 CJK 渲染/导出。

字体 license/attribution 见 `public/fonts/NOTICE.txt`。
