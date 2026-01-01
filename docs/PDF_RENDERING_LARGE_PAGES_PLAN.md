# 大页面渲染优化计划（PDF Rendering Large Pages Plan）

## 目标与范围

本计划关注“打开/浏览/缩放包含超大页面（Large Page）PDF 时的渲染性能与稳定性”，目标是减少卡顿、降低峰值内存占用，并确保在连续滚动、快速缩放、文档切换时渲染行为可预测。

范围划分：

- **位图渲染（Canvas / Thumbnails / DataURL 预览）**：已迁移至 `pdfWorkerService` + `pdf-render.worker.ts`，本计划主要优化这里的切片、队列、降采样、缓存与取消策略。
- **文字层（TextLayer）**：仍在主线程 `PDFTextLayer.tsx`。本计划提出优化策略，但不强制立刻迁移到 worker（迁移成本与可维护性需评估）。

非目标：

- 不在本计划中重写 pdf.js 内部渲染实现。
- 不在本计划中改变编辑器的功能行为（字段/批注逻辑、导出逻辑）。

---

## 现状（关键结论）

### 位图渲染链路

- 编辑器页面 Canvas 渲染：
  - `src/components/workspace/layers/PDFCanvasLayer.tsx`
  - `transferControlToOffscreen()` + `pdfWorkerService.renderPage(...)`
- 缩略图渲染：
  - `src/components/sidebar/ThumbnailsPanel.tsx`
  - `transferControlToOffscreen()` + `pdfWorkerService.renderPage(...)`
- DataURL/图片导出类渲染：
  - `src/services/pdfService/pdfRenderer.ts`
  - `pdfWorkerService.renderPageImage(...)`（worker 返回 bytes）+ 主线程 bytes->DataURL

位图渲染的 `page.render(...)` 仅出现在：

- `src/workers/pdf-render.worker.ts`

### TextLayer 链路

- `src/components/workspace/layers/PDFTextLayer.tsx` 使用 `pdfjsLib.TextLayer` 在主线程构建 DOM。
- 大页卡顿通常来自：
  - `streamTextContent` 解析 + 大量 DOM span 创建 + layout/paint 成本。

---

## 性能问题画像（Large Page 常见瓶颈）

- **像素量爆炸**：超大页面在高 DPR/高 scale 下会产生极大的 bitmap（width*height*4）。
- **短时间高并发**：快速滚动/缩放会触发多页、多次渲染请求，导致 worker 队列堆积。
- **无效渲染浪费**：缩放变化时旧任务仍在跑，渲染完成也不再可见。
- **TextLayer DOM 过大**：大页可能包含大量文字对象，主线程 DOM 创建/更新成为瓶颈。

---

## 里程碑计划（分阶段实施）

### Milestone A：建立可观测性（先量化，再优化）

目标：在不改变行为的前提下，获得“哪些页面/缩放导致慢、慢在哪里”的数据。

实施要点：

- 为 worker 渲染任务增加轻量统计：
  - 任务排队时间、执行耗时、输出尺寸、是否被取消
  - 记录触发源（workspace / thumbnails / preview）
- 在开发模式下可选输出到 console 或 store（受 debugOptions 控制）。

需要修改的文件：

- `src/workers/pdf-render.worker.ts`
  - 在执行 render 前后打点（start/end/duration）
  - 在取消时记录 cancel reason（缩放变化、doc unload、显式 abort）
- `src/services/pdfService/pdfWorkerService.ts`
  - 扩展消息协议（可选）用于携带 `source`、`requestedDpr`、`requestedScale` 等元数据
- `src/store/useEditorStore.ts`（可选）
  - 增加 debug 状态（仅 UI 展示，不持久化）

风险：低。

---

### Milestone B：渲染策略升级（大页降采样 + 像素预算）

目标：对超大页面进行“像素预算（pixel budget）”控制，避免单次渲染产生巨大 bitmap。

核心策略（建议优先级由高到低）：

1. **像素预算**：

- 设定 `MAX_PIXELS_PER_TILE` 与 `MAX_PIXELS_PER_PAGE_RENDER`（例如 8M~16M）
- 当 `viewport.width * viewport.height > budget` 时：
  - 降低有效 scale（clamp）或
  - 自动启用 tile 渲染（分块）

2. **DPR 上限与动态 DPR**：

- 当前 `PDFCanvasLayer` 已把 DPR clamp 到 2。
- 对超大页可进一步：
  - 默认先用 `dpr=1` 渲染快速预览
  - 停止交互后（scroll/zoom idle）再升级到 `dpr=2`

3. **渐进式渲染**：

- 先渲染低清（更低 scale 或更低 DPR）
- 再渲染高清覆盖

需要修改的文件：

- `src/components/workspace/layers/PDFCanvasLayer.tsx`
  - 增加“大页判定”（基于 page 尺寸 + scale + dpr 估算像素）
  - 增加“交互中/静止后升级”的策略（可复用现有 state，如 isInteracting/scrolling 的概念）
  - 增加渲染请求参数：`requestedDpr`、`qualityTier`（低清/高清）
- `src/services/pdfService/pdfWorkerService.ts`
  - 扩展 render 消息：允许携带 `qualityTier` 或 `maxPixels` 建议值
- `src/workers/pdf-render.worker.ts`
  - 在 worker 内最终决定实际 scale（clamp）
  - 或在 tile 模式下按块渲染（见 Milestone C）

风险：中。

---

### Milestone C：Tile 渲染（分块渲染大页面）

目标：对超大页面使用分块渲染，降低单次 bitmap 尺寸，并允许“先渲染可视区域”。

核心设计：

- 以 `Tile` 为接口（现已有字段）
- 每次渲染只输出一个 tile 到同一个 OffscreenCanvas
- 需要约定：
  - tile 的 viewport/transform
  - 画布尺寸与绘制偏移（在 worker 内完成）

建议实现方式：

- **Workspace**：
  - 先渲染可视区 tile（priority 高）
  - 周边 tile（priority 低）
- **缩略图**：
  - 不需要 tile，直接低清渲染即可

需要修改的文件：

- `src/components/workspace/layers/PDFCanvasLayer.tsx`
  - 计算可视区域对应 tile 列表
  - 按优先级向 worker 提交多个 tile 任务
  - 管理取消：scale/pageIndex 变化时 abort 旧 tile 任务
- `src/services/pdfService/pdfWorkerService.ts`
  - 允许同一 canvasId 多 tile 请求并发/串行（建议串行 per-canvas）
  - 统一取消策略（AbortSignal -> worker cancel）
- `src/workers/pdf-render.worker.ts`
  - 正确处理 tile 渲染的绘制偏移/裁剪
  - 确保 tile 渲染不会因为重复 resize 导致明显闪烁

风险：中到高（tile 的坐标系与视觉一致性是关键）。

---

### Milestone D：队列与取消策略（避免无效工作）

目标：缩放/滚动过程中快速取消旧任务，保证“最新请求优先”。

策略：

- **Per-canvas 串行化**：同一个 `canvasId` 同时只跑一个 render，后来的替换前面的。
- **Scale epoch**：缩放变化时生成新 epoch，旧 epoch 的任务直接丢弃/取消。
- **Doc unload**：切文档时取消该 doc 的所有 pending。

需要修改的文件：

- `src/workers/pdf-render.worker.ts`
  - taskQueue 的丢弃策略精确化（按 canvasId + epoch）
  - 在接收新任务时主动 cancel 旧任务
- `src/services/pdfService/pdfWorkerService.ts`
  - 给 render 请求携带 `epoch`（例如 `${pageIndex}:${scaleBucket}`）
- `src/components/workspace/layers/PDFCanvasLayer.tsx`
  - 维护本页本 scale 的 epoch（scale 改变即 epoch++）

风险：中。

---

### Milestone E：TextLayer 优化（主线程）

目标：降低主线程 TextLayer 带来的卡顿，尤其是大页。

可选策略（按成本由低到高）：

1. **仅在需要时渲染 TextLayer**

- 例如：只有在 select mode / text selection 开启时才渲染
- 或在页面静止后延迟渲染

2. **降低更新频率**

- 缩放时不即时 update，等用户停止缩放再 update
- 对大页直接跳过部分缩放中间态

3. **分页/分块 text 渲染（更复杂）**

- 不建议短期做，成本高

需要修改的文件：

- `src/components/workspace/layers/PDFTextLayer.tsx`
  - 增加“启用条件”（mode/debugOption/交互状态）
  - 增加 debounce/idle 调度（requestIdleCallback 或 setTimeout）
- `src/store/useEditorStore.ts`
  - 增加/复用 `options.debugOptions.pdfTextLayer` 或新增 text layer 策略开关
- `src/components/workspace/Workspace.tsx`（可选）
  - 提供滚动/缩放交互状态给 TextLayer

风险：低到中（取决于是否改变默认行为）。

---

## 文件改动清单（按模块）

### Worker 渲染核心

- `src/workers/pdf-render.worker.ts`
  - 增加统计与调试输出（Milestone A）
  - 实现像素预算/scale clamp（Milestone B）
  - tile 渲染坐标/裁剪（Milestone C）
  - 队列丢弃/取消策略（Milestone D）

### Worker 编排层

- `src/services/pdfService/pdfWorkerService.ts`
  - 扩展消息协议：source/epoch/qualityTier/maxPixels
  - 统一取消策略（AbortSignal -> cancel message）

### Workspace 渲染触发层

- `src/components/workspace/layers/PDFCanvasLayer.tsx`
  - 估算像素/大页判定
  - 低清占位 + 静止后升级
  - tile 列表生成与任务提交
  - 取消旧任务

### Thumbnails / Preview

- `src/components/sidebar/ThumbnailsPanel.tsx`
  - 对大页缩略图采用低清渲染策略（避免不必要高清）
- `src/services/pdfService/pdfRenderer.ts`
  - 对 renderPageImage 加入“最大像素”限制参数（如需要）

### TextLayer（主线程）

- `src/components/workspace/layers/PDFTextLayer.tsx`
  - 增加延迟渲染/按需渲染策略

### 文档与配置

- `docs/PDF_RENDERING_LARGE_PAGES_PLAN.md`（本文件）
- `docs/ARCHITECTURE.md`（可选）
  - 在 PDF 管线章节添加指向本计划文档的链接

---

## 验收标准（建议）

- 打开包含超大页面的 PDF：
  - 首屏在 1s 内出现低清页面（或至少不白屏）
  - 3s 内逐步提升清晰度（静止后）
- 快速缩放：
  - UI 不冻结
  - 渲染任务队列不会无限增长
  - 缩放停止后最终清晰度正确
- 快速滚动：
  - 可视区优先渲染
  - 离屏页不会抢占资源
- 连续切换文档：
  - 不出现“PDF Document not loaded”
  - 内存不会持续增长

---

## 备注：实现顺序建议

推荐顺序：A -> B -> D -> C -> E

原因：

- A 先建立数据，避免“凭感觉优化”。
- B/D 低风险且收益高（限制像素 + 取消无效任务）。
- C tile 渲染最复杂，建议最后做。
- E TextLayer 可能影响交互体验，需谨慎分阶段。
