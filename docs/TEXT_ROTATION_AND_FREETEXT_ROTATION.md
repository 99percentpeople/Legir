# 文字旋转识别 + FreeText 旋转贯通：实现步骤

## 目标

- **Page Translation**（全页翻译）在从 TextContent 提取文字几何时，能识别并携带每个文字块/行的 **旋转角**。
- **FreeText** 注释在以下链路中支持旋转参数：
  - **导入（Import）**：从 PDF 注释中解析 rotation
  - **显示（Render）**：Workspace 中 FreeText 控件按 rotation 旋转渲染
  - **导出（Export）**：写回 PDF 时保留 rotation
  - **交互（Edit）**：在 `ControlWrapper.tsx` 添加可选旋转手柄，允许用户旋转
  - **属性面板（Properties）**：在右侧面板中可编辑 FreeText rotation

## 非目标（本次不做/可后续迭代）

- 不强制实现“旋转后 bbox 的精确命中/缩放手柄也随旋转轴对齐”的完整几何编辑（第一版允许仍然用 axis-aligned `rect` 做移动/缩放）。
- 不强制实现对所有 annotation 类型的旋转（第一期先聚焦 `type="freetext"`）。

---

## 统一数据模型（核心改动）

### 1) `Annotation` 增加旋转字段

文件：`src/types.ts`

- 在 `export interface Annotation` 增加：
  - `rotationDeg?: number;`

约定：

- 单位：**degree**（度）
- 方向：CSS/数学统一使用**顺时针为正 / 逆时针为负**（与 `transform: rotate(deg)` 一致）
- 默认：未设置时视为 `0`

兼容策略：

- 老文档/老导入不会有该字段，渲染/导出时都以 0 处理。

---

## A. Page Translation：文字旋转识别与传递

你提到需要识别文字旋转的模块：

- `src/hooks/usePageTranslation.ts`
- `src/services/pageTranslationService.ts`
- `src/services/pdfService/*`

### A1) 在 text block 级别识别旋转

文件：`src/services/pageTranslationService.ts`

现状：

- `extractTextBlocks(textContent, page)` 内已经计算了 `angle = atan2(tx[1], tx[0])`，但 **没有把 angle 输出**。

步骤：

1. 修改 `PageTranslationTextBlock` 增加字段：
   - `rotationDeg: number`（或可选 `rotationDeg?: number`）

2. 在 `extractTextBlocks(...)` 里把 `angle` 转换成 `rotationDeg`：
   - `rotationDeg = angle * 180 / Math.PI`
   - 建议做一次归一化：
     - 例如归一化到 `(-180, 180]`，便于比较/聚合

3. 竖排/vertical 字体：
   - 现有代码对 `style.vertical` 已做 `angle += PI/2`，这一点应保留并纳入 `rotationDeg`。

4. 输出到 block：
   - `blocks.push({ ..., rotationDeg })`

### A2) line/segment 聚合时考虑旋转

文件：`src/services/pageTranslationService.ts`

现状：

- `buildLinesFromBlocks` 仅按 `rect.y/x` 聚合“行”，**假设水平排版**。

第一期建议（最小增量且可落地）：

1. `PageTranslationLine` 增加 `rotationDeg?: number`
2. 每条 line/segment 的 `rotationDeg` 取其 blocks 的：
   - 中位数 / 众数（建议众数或中位数）
3. 行聚合时过滤“旋转差异太大”的 blocks，避免竖排混入横排（类似你在 text selection 修复里做的 rotation 过滤）：
   - 例如：`abs(deltaDeg) <= 15` 才允许归到同一行

（后续增强）

- 对竖排/斜排的“行”定义应改成沿主轴聚合（需要更大改动，可后续做）。

### A3) 将 rotation 传递到生成的 freetext

文件：`src/services/pageTranslationService.ts`

现状：

- `buildFreetextAnnotationsFromTranslation(...)` 生成的注释不含 rotation。

步骤：

1. 在生成每个 `Annotation(type="freetext")` 时补充：
   - `rotationDeg: line.rotationDeg ?? 0`

2. 对 `rect` 的策略（第一期）：
   - 保持现有 AABB `rect`（axis-aligned）
   - 渲染时让文字在该 rect 内旋转（见后文）

3. 如果需要更贴近的遮盖区域（可选增强）：
   - 记录 quad/四角点，然后用 OBB 推导更紧的 rect（或保持 AABB 但减小 padding）

### A4) `usePageTranslation.ts` 需要改什么？

文件：`src/hooks/usePageTranslation.ts`

- 该 hook 主要负责 orchestrate（调用 service + addAnnotations）。
- 若 rotation 已在 `pageTranslationService` 内生成到 annotation 上，hook 侧通常无需额外处理。

---

## B. FreeText：导入（Import）支持 rotation

要点：FreeText rotation 的来源可能有多种（不同 PDF 生成器差异很大）。

### B1) 在 `PdfJsAnnotation` 中承载 rotation

文件：`src/services/pdfService/types.ts`

步骤：

1. 在 `export type PdfJsAnnotation` 增加：
   - `rotation?: number;`（degree）

### B2) 在 `pdfService/index.ts` 扫描注释时读取 rotation

文件：`src/services/pdfService/index.ts`

现状：

- `buildPdfLibAnnotsByPageIndex` 会把 pdf-lib 的 annot dict 转成 `PdfJsAnnotation`。

步骤（建议按优先级读取）：

1. 读取注释 dict 的 `Rotate`（如存在）
2. 读取 `MK`（appearance characteristics）中的 `R`
3. 将读取到的 rotation 填到 `PdfJsAnnotation.rotation`

注意：

- rotation 常见取值：`0/90/180/270`，但也可能是任意角度（取决于生成器）。

### B3) `FreeTextParser` 把 rotation 写入内部 Annotation

文件：`src/services/pdfService/parsers/AnnotationParsers.ts`

步骤：

1. 在 `annotation.subtype === "FreeText"` 分支里：
   - 读取 `annotation.rotation`
   - `annotations.push({ ..., rotationDeg: rotation ?? 0 })`

（可选增强）

- 如果 `rotation` 不存在，但 AP stream 内有旋转矩阵（`cm`），可以解析 AP 来推导 rotation；这是高复杂度，建议后续迭代。

---

## C. FreeText：显示（Render）支持 rotation

核心原则：

- 数据仍以 `rect` 作为“轴对齐布局框”，rotation 只影响渲染 transform。

### C1) `FreetextControl.tsx` 应用旋转

文件：`src/components/workspace/controls/annotation/FreetextControl.tsx`

步骤：

1. 从 `data.rotationDeg ?? 0` 取角度
2. 在外层（推荐是 `ControlWrapper` 或其 children 顶层容器）增加：
   - `transform: rotate(${rotationDeg}deg)`
   - `transformOrigin: "50% 50%"`

建议落点：

- 如果旋转手柄/选框也要一起旋转，建议把 transform 放到 `ControlWrapper` 的最外层容器上（见下一节）。

---

## D. FreeText：导出（Export）支持 rotation

文件：`src/services/pdfService/exporters/AnnotationExporters.ts`（`FreeTextExporter`）

现状：

- Exporter 已能写入 freetext 的背景/文字等，但 **未写入 rotation**。

实现策略（建议分两条路径，按现有 exporter 实现选择其一）：

### 策略 1（推荐优先）：写入 Annot dict 的 rotation（MK.R 或 Rotate）

步骤：

1. 在构造 FreeText annot dict 时加入：
   - `MK: { R: rotationDeg }` 或 `Rotate: rotationDeg`
2. 保持 AP 生成逻辑不变（由 PDF 阅读器负责旋转 appearance）。

优点：

- 改动小
- 不需要重写 AP stream

风险：

- 部分阅读器对 `MK.R`/`Rotate` 支持差异，需要验证。

### 策略 2：在 AP stream 内应用旋转矩阵

步骤：

1. 在 appearance stream 的绘制指令外包裹：
   - `q`（save graphics state）
   - `cm`（以注释 bbox 中心为 pivot 的旋转矩阵）
   - 原有绘制 ops
   - `Q`

2. pivot 计算（示例）：
   - 以 PDF 坐标 `x,y,w,h`：中心点 `(x + w/2, y + h/2)`
   - 旋转矩阵：
     - `cos θ  sin θ  -sin θ  cos θ  tx  ty`

优点：

- 更一致的跨阅读器表现

风险：

- AP stream 生成复杂度增加

### flatten 分支

现状：

- `annotation.flatten` 为 true 时会直接 `page.drawRectangle` / `page.drawText`。

步骤：

- 需要在 `drawRectangle/drawText` 时同样应用 rotation。
- 若 pdf-lib API 支持 `rotate` 参数：直接使用。
- 否则同样需要 `pushGraphicsState` + `concatTransformationMatrix`（或等价 API）。

---

## E. 交互：`ControlWrapper.tsx` 添加可选旋转手柄

文件：`src/components/workspace/controls/ControlWrapper.tsx`

目标：

- 选中 `freetext` 时显示一个旋转 handle（例如在 top-center 外侧）
- 拖动该 handle 更新 `annotation.rotationDeg`

### E1) 扩展 ControlWrapper Props（推荐）

方式 A（更清晰）：新增 rotate callback

- 在 `BaseControlProps` 增加可选：
  - `onRotateStart?: (e: React.PointerEvent) => void`
  - 或 `onRotateStart?: (e, data) => void`（走 ControlRenderer 的模式）

方式 B（复用现有 resize callback）：

- 仍然用 `onResizeStart(handle, e)`，并新增 handle id：`"rotate"`
- Workspace 中识别 `handle === "rotate"` 进入 rotate session

建议：优先方式 B（侵入更少、与现有 session 体系一致）。

### E2) ControlWrapper 渲染 rotate handle

步骤：

1. 增加 `rotatable?: boolean`（或根据 `data.type === "freetext"` 自动启用）
2. 当 `showBorder && rotatable` 时渲染一个小圆点 handle：
   - className 可复用现有 resize handle 的风格
   - 位置：`absolute left-1/2 -top-... translate-x-1/2`
3. `onPointerDown`：
   - `e.stopPropagation(); e.preventDefault();`
   - 调用 `onResizeStart("rotate", e)` 或 `onRotateStart(e)`

### E3) Workspace 中实现 rotate session

文件：`src/components/workspace/Workspace.tsx`

步骤（建议流程）：

1. 在 `onControlResizeStart(handle, e, data)`（或对应回调）中：
   - if `handle === "rotate"`：进入 rotate session
2. rotate session state（ref）：
   - target id
   - 起始 rotation
   - pivot（rect center, UI space）
   - pointer down 时的起始角度（atan2）
3. pointermove：
   - 当前角度 - 起始角度 + 起始 rotation => next rotation
   - 可做 snap：例如按住 shift 每 15° 吸附
4. pointerup：结束 session，并触发 `onTriggerHistorySave`（或在开始时触发一次保存）

### E4) 渲染旋转本体

- 最外层 wrapper 容器加 transform rotate（保持 bbox 不变）
- 选框/resize handles 是否要跟随旋转：
  - 第一版：允许不旋转（更简单）
  - 若要一起旋转：把 overlay 放到同一个旋转容器下

---

## F. Properties：让 FreeText 支持旋转

文件：

- `src/components/properties-panel/PropertiesPanel.tsx`（不需要直接改，真正的 freetext panel 在 registry）
- `src/components/workspace/controls/properties/FreetextProperties.tsx`（需要改）

步骤：

1. 在 `FreetextProperties.tsx` 增加一组 rotation UI：
   - `Label`: Rotation
   - `Input type="number"` 或 `Slider`
   - 值：`data.rotationDeg ?? 0`
   - onChange：`onChange({ rotationDeg: next })`
   - onMouseDown/onValueCommit：触发 `onTriggerHistorySave`

建议交互：

- 输入范围：`-180 ~ 180`（或 `0~359`，但需统一）
- 步进：1°
- 可选：提供 quick actions（0/90/180/270）

---

## G. 回归验证清单

### 功能回归

- 导入：打开含 FreeText rotation 的 PDF，旋转角能被解析并在 UI 中正确显示
- 编辑：
  - 旋转手柄拖动角度正确
  - Properties 输入角度能即时更新
- 导出：导出后用外部阅读器打开，FreeText 旋转保持一致
- flatten：`flatten=true` 的 freetext 导出后旋转仍正确

### 版面/坐标回归

- 缩放（scale 0.5/1/2）下旋转角不漂移
- page rotation（PDF page rotation=0/90/180/270）下 rotation 仍正确

### Page Translation 回归

- 混排（0° / -90° / -45°）页面：
  - 旋转文字的 line rotationDeg 合理
  - 生成的 freetext rotationDeg 与原文方向一致

---

## 需要改动的文件汇总（按模块）

- 数据模型：
  - `src/types.ts`

- Page Translation：
  - `src/services/pageTranslationService.ts`
  - `src/hooks/usePageTranslation.ts`（通常无需改，除非要 UI 显示 rotation 信息）

- PDF 导入/导出：
  - `src/services/pdfService/types.ts`
  - `src/services/pdfService/index.ts`
  - `src/services/pdfService/parsers/AnnotationParsers.ts`
  - `src/services/pdfService/exporters/AnnotationExporters.ts`

- Workspace 渲染/交互：
  - `src/components/workspace/controls/annotation/FreetextControl.tsx`
  - `src/components/workspace/controls/ControlWrapper.tsx`
  - `src/components/workspace/Workspace.tsx`

- Properties：
  - `src/components/workspace/controls/properties/FreetextProperties.tsx`
