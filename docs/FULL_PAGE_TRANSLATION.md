# 全页翻译（Page Translation）实现方案（草案）

## 目标

在 Legir 中提供“全页翻译”能力：

- 从 **文本层（PDF.js TextContent）** 或 **OCR** 获取页面文字与版面几何信息。
- 调用翻译模型（可选：传统翻译 API / LLM）生成翻译结果。
- 将翻译结果以 **`Annotation.type="freetext"`** 形式叠加到页面：
  - 默认用 **白色背景**（`backgroundColor="#ffffff"`）遮盖底下原文字。
  - **字号尽量匹配** 文本层原字号（`Annotation.size`）。
  - 用户可使用现有 FreeText 控件能力 **拖拽/缩放/编辑** 微调位置。
- 在右侧栏新增一个 **独立的功能项（tab）** 用于配置：模型、目标语言、页范围、提示词（针对 AI 模型）、执行/取消、进度等。

本文件仅描述可落地的实现步骤与接口思路，不包含代码。

---

## 现状（与现有 translate 功能的关系）

当前工程内已有两块“翻译相关能力”：

- **`src/services/translateService.ts`**：翻译 option registry + `translate()` / `translateStream()`，默认实现为 Google Cloud Translation v2。
- **选中文本翻译浮窗**：
  - `RightPanelTabDock.tsx` 点击 `translate` 会触发事件 `workspace:openTranslate`。
  - `src/pages/EditorPage.tsx` 监听 `workspace:openTranslate`，打开 `TranslationFloatingWindow`。
  - `TranslationFloatingWindow` 用 `translateService` 翻译一段纯文本（不涉及页面几何、也不会生成注释）。

因此“全页翻译”建议作为 **新的 tab**（避免与现有“选中文本翻译浮窗”语义冲突），并复用 `translateService` 作为底层“文本->翻译文本”的能力来源。

---

## MVP 范围（第一版建议）

- **文字来源**：只实现 TextLayer 路线（`pdfWorkerService.getTextContent`），OCR 只提供接口占位。
- **输出形式**：每页生成多条 `freetext` 注释（建议按“行/块”粒度，而不是按字粒度）。
- **遮盖策略**：默认背景白色；可选透明开关（后续）。
- **用户可调**：注释可拖拽/缩放/编辑（现有 `FreetextControl` 支持）。
- **配置 UI**：右侧栏 tab，包含：
  - 模型/Provider 选择（复用 `translateService` option groups）
  - 目标语言
  - 页范围
  - AI 提示词（若选中 LLM 类模型）
  - Start / Cancel
  - 进度与错误

---

## 数据与接口设计（建议）

### 1) 文本抽取统一数据结构

建议把“页面文字 + 几何信息”抽象成统一块（TextBlock），用于后续翻译与注释生成：

- `pageIndex: number`
- `text: string`
- `rect: { x: number; y: number; width:  number; height: number }`
  - 坐标空间应与现有 Workspace/Annotation 一致（即“页面内 UI 坐标（top-left origin）/PDF space 的约定”，并能直接写入 `Annotation.rect`）。
- `fontSize: number`（对应 `Annotation.size`）
- `fontFamily?: string`（对应 `Annotation.fontFamily`，若能解析）
- `rotation?: number`（可选，先不做旋转文本覆盖也可以，但需记录用于后续迭代）
- `source: "textLayer" | "ocr"`
- `readingOrderKey?: string | number`（可选，用于排序/回放）

### 2) TextLayer 抽取接口（建议放 `src/services/`）

> 不实现代码，先定接口。

- `extractPageTextFromTextLayer({ pageIndex, signal }): Promise<TextBlock[]>`
  - 内部复用：
    - `pdfWorkerService.getTextContent({ pageIndex, signal })`
    - 复用/抽取 `src/components/workspace/lib/pdfTextLayer.ts` 的排版计算逻辑（避免自己重新推导 transform 导致 rect/字号与页面不一致）。

#### 关键实现点（TextItem -> rect/fontSize）

`pdfTextLayer.ts` 在构建 DOM 时已经做了：

- 根据 `TextItem.transform` + `viewport` 计算角度/位置。
- 根据矩阵计算 `fontHeight`，并结合字体 ascent 得到布局。

建议把这套计算抽出成纯函数，例如：

- `computeTextItemGeometry(item, textContent.styles, viewport) -> { text, rect, fontSize, fontFamily, rotation }`

这样既能继续用于 DOM TextLayer，也能用于“全页翻译”生成 TextBlock。

### 3) OCR 抽取接口（占位）

- `extractPageTextFromOcr({ pageIndex, signal }): Promise<TextBlock[]>`

第一版不实现，但 UI 侧可以先提供“来源：TextLayer/OCR”的选项，OCR 选中时提示“暂未实现”。

### 4) 翻译接口（复用 translateService + 扩展点）

当前 `translateService.translateStream(text, { translateOption, targetLanguage, ... })` 已能工作。

为了支持“AI 模型 + 用户提示词”，建议后续扩展两种方式之一：

- **方案 A（推荐）**：继续复用 `translateService` registry，但让 `TranslateTextOptions` 支持 `prompt?: string`（可选）
  - LLM 类 option group 内部使用 prompt 组装 system/user messages。
- **方案 B**：在 `src/services` 新增 `pageTranslateModelService`，面向“整页翻译”单独处理提示词与模型编排。

第一版文档建议采用 **方案 A**，因为 UI/状态已经有 `translateOption`、并且 `TranslationFloatingWindow` 也能复用 provider 列表。

---

## 翻译到 FreeText 的映射策略

### 为什么用 FreeText

- 现有 `Annotation.type="freetext"` 已具备：
  - `rect`：可移动/缩放
  - `text`：可编辑
  - `size/fontFamily/color/backgroundColor/opacity`：可表现“遮盖 + 翻译文本”
  - 导出路径：`FreeTextExporter` 已支持 `backgroundColor` 绘制白底（AP 中 `rg ... re f`），并支持透明度。

### 建议的粒度：按“行/块”生成

- 按 TextLayer 的 `TextItem` 做行聚合：
  - 先对 items 按 Y（从上到下）再按 X（从左到右）排序。
  - 用 `y` 的阈值把 items 聚成行（阈值建议与 fontSize 相关）。
  - 行内把 `str` 拼接成 `text`（考虑空格、连字符等可后续优化）。
- 每一行生成一个 FreeText：
  - `rect`：行内 items 的 bbox（minX/minY/maxX/maxY）
  - `size`：行内 fontSize 的中位数/均值
  - `fontFamily`：优先取出现频率最高的 fontFamily；否则不填（走默认 Helvetica）
  - `backgroundColor`：默认 `#ffffff`
  - `opacity`：默认 `1`
  - `color`：默认 `#000000`（后续可选跟随原文字颜色，但 pdf.js text layer 不一定提供可靠颜色）

### 处理换行与高度

FreeText exporter 里 lineHeight 取 `fontSize`，UI 里 `FreetextControl` lineHeight 为 1.4。

为了让“遮盖区域”更稳：

- `rect.height` 建议略大于 text bbox（例如加 padding），避免底下原字露边。
- `rect.width` 同理可略加宽。

第一版可先采取保守策略：

- `rect = bbox + padding(1~2px in page space)`

---

## 右侧栏 UI（新 tab）设计

### Tab 入口

在 `src/components/properties-panel/RightPanelTabDock.tsx` 增加新的 tab（建议 id 不要复用现有 `translate`）：

- 建议 id：`"page_translate"`
- Icon：`Languages`（或新 icon）
- title：例如 `t("page_translate.title")`

说明：现有 `translate` tab 会打开 `TranslationFloatingWindow`（选中文本翻译）。全页翻译应走独立 panel，避免点击 tab 直接弹浮窗的行为干扰。

### Panel 参考实现

参考 `src/components/properties-panel/AIDetectionPanel.tsx` 的结构：

- 用 `PanelLayout`
- 提供 footer（Start/Cancel/提示）
- 主体用一个 OptionsForm 组件（可仿 `AIDetectionOptionsForm` 做 page range 校验）

### Panel 字段（建议）

- **来源**：`TextLayer` / `OCR`（OCR 暂不可用时 disabled 并提示）
- **目标语言**：复用现有 target lang options（或更全的语言列表）
- **模型/Provider**：复用 `translateService.getOptionGroups()`
- **页范围**：输入框，格式同 AI detection（`All` 或 `1-5,8`）
- **提示词**：
  - 仅当 option group 属于 LLM（或 capability 标记为支持 prompt）时显示
  - 否则隐藏或 disabled
- **输出策略**：
  - `Replace`（清理选定页面已有的“翻译注释”后重建）
  - `Append`（追加）
  - 这需要我们能识别哪些 freetext 是“翻译生成的”（见下文元信息策略）

- **按钮**：
  - Start
  - Cancel
  - Clear (optional)

- **状态**：
  - `isProcessing` + 进度（例如 `page 3/10`）
  - 错误展示

---

## 元信息策略：如何识别“这是翻译生成的注释”

当前 `Annotation` 结构没有自定义 metadata 字段。

可选策略：

- **策略 A（最小改动）**：用 `id` 前缀约定
  - 例如：`id = page_translate_${docId?}_${pageIndex}_${blockIndex}_${timestamp}`
  - 清理/替换时按前缀过滤。
- **策略 B（更干净，但需要扩展 types）**：给 `Annotation` 增加 `meta?: { kind: "page_translate"; ... }`
  - 需要同步 exporter/parser（通常 exporter 会忽略 meta，但 types/序列化要考虑）。

第一版建议用 **策略 A**。

---

## 与 store / Workspace 的集成点

### 状态保存

建议将全页翻译配置存到 `useEditorStore`（类似现有 translateOption）：

- `pageTranslateOption: TranslateOptionId`（或复用 `translateOption`）
- `pageTranslateTargetLanguage: string | null`（或复用 `translateTargetLanguage`）
- `pageTranslatePageRange: string`（UI 偏好）
- `pageTranslatePrompt: string`（UI 偏好）
- `pageTranslateSource: "textLayer" | "ocr"`

同时新增运行时状态（不需要持久化）：

- `isPageTranslating: boolean`
- `pageTranslateProgress?: { done: number; total: number; pageIndex?: number }`
- `pageTranslateLastError?: string`

### 执行流程（高层）

1. Panel 点击 Start。
2. 解析页范围（可直接复用 `AIDetectionOptionsForm` 的解析逻辑，或抽成 util）。
3. 对每个页面：
   - `extractPageText...(pageIndex)` -> `TextBlock[]`
   - 聚合成待翻译 segments（按行/块）
   - 逐段调用 `translateService.translateStream/translate`
   - 生成对应的 `Annotation`（freetext）并 `addAnnotation`
4. 允许 Cancel：用 `AbortController`，并把 signal 传递到：
   - `pdfWorkerService.getTextContent`
   - `translateService.translateStream`

### Workspace 渲染

无需修改 Workspace 的渲染机制：

- `freetext` 已经由 `ControlRegistry` 渲染。
- `FreetextControl` 支持背景色、字号、编辑。

---

## 实现步骤（建议按阶段落地）

### Phase 0：对齐约束与 UI 决策

- 确定：新 tab id/name（建议 `page_translate`）。
- 确定：是否复用现有 `translateOption/translateTargetLanguage` 还是新增独立配置。
- 确定：输出策略（Replace/Append）是否要进 MVP。

### Phase 1：TextLayer 抽取 + 版面分块

- 在 `src/services/` 设计并实现 TextLayer 抽取服务（仅 textLayer 路线）：
  - 调用 `pdfWorkerService.getTextContent`。
  - 复用/抽取 `pdfTextLayer.ts` 的计算逻辑，把 `TextItem` 变成 `TextBlock`。
  - 做行聚合（line grouping）并输出 blocks。

### Phase 2：翻译编排 + FreeText 生成

- 在 `src/services/` 新增“全页翻译编排器”（可以叫 `pageTranslationService`）：
  - 输入：pageIndices、translateOption、targetLanguage、prompt(可选)、source(textLayer/ocr)
  - 输出：批量创建的 annotations（或边翻译边 `addAnnotation`）
  - 内置：并发限制、重试（可选）、取消。

- 将 TextBlock 映射为 `Annotation`：
  - `type: "freetext"`
  - `rect: bbox + padding`
  - `size: block.fontSize`
  - `fontFamily: block.fontFamily (可选)`
  - `backgroundColor: "#ffffff"`
  - `opacity: 1`
  - `text: translatedText`
  - `id` 使用前缀 `page_translate_...`

### Phase 3：右侧栏 Panel

- 新建 `PageTranslatePanel`（命名可调整），结构参考 `AIDetectionPanel`：
  - `PanelLayout` + footer Start/Cancel
  - options form（page range 校验、来源选择、模型选择、目标语言、prompt）

- 在 `EditorPage.tsx` 接入该 panel（与 `isRightPanelOpen/rightPanelDockTab` 体系一致）。

---

## 风险与后续迭代

- **阅读顺序/分块准确性**：PDF text item 顺序不一定是自然阅读顺序。需要更强的行聚合、段落聚合、列布局识别。
- **旋转文本/竖排文本**：第一版可先忽略复杂旋转，后续利用 `rotation` 做旋转 FreeText 或创建更贴合的 bbox。
- **字体匹配**：pdf.js text styles 的 `fontFamily` 可能是 substitution；与导出 PDF 的字体 embed 机制需要评估。
- **遮盖效果**：白底会覆盖表格线/背景图。后续可以提供：
  - 背景透明度
  - 仅对文本区域 padding 最小化
  - 或用“mask + text”更复杂方案
- **性能**：大文档翻译需要：
  - 并发限制
  - 分页进度
  - 可取消
  - 可能还需要缓存 text blocks

---

## 需要改动的文件点位（实施时）

- **TextLayer/抽取**：
  - `src/components/workspace/layers/PDFTextLayer.tsx`（现状：拿 textContent 并 buildTextLayer）
  - `src/components/workspace/lib/pdfTextLayer.ts`（建议抽纯函数用于 geometry）
  - `src/services/pdfService/pdfWorkerService.ts`（现状：提供 `getTextContent`）

- **全页翻译服务（新增）**：
  - `src/services/*`（新增 page translation orchestrator + OCR 接口占位）

- **右侧栏 tab 与 panel（新增）**：
  - `src/components/properties-panel/RightPanelTabDock.tsx`
  - `src/pages/EditorPage.tsx`（挂载 panel 并调用服务）
  - 新 panel 文件可参考：`src/components/properties-panel/AIDetectionPanel.tsx`

- **翻译模型选择**：
  - `src/services/translateService.ts`（复用；后续可注册 LLM group）
