# Shapes Annotations（形状类型注释）实现规划

本文档是 Legir 的“形状批注（Shapes Annotations）”功能实施蓝图。目标是新增并完善 PDF 形状注释的：

- 导入解析（Import）
- 在 Workspace 渲染（Render）
- 导出写回（Export）
- 编辑（Edit：选择/移动/缩放/样式/点编辑）
- 创建（Create：多种形状工具）

约束：本文档只描述规划与实现方法，不包含具体代码实现。

---

## 0. 背景与现状对齐（你当前代码的扩展点）

- **数据模型**：`src/types.ts` 的 `Annotation` 目前包含 `highlight/ink/comment/freetext/link`
- **PDF 导入**：
  - `src/services/pdfService/index.ts` 用 `pdf-lib` 扫 `page.node.Annots()`，把 `Highlight/Text/FreeText/Link` 组装到 `pageAnnotations`（`PdfJsAnnotation` 结构）
  - `src/services/pdfService/parsers/AnnotationParsers.ts` 将 `pageAnnotations` 转为内部 `Annotation[]`
  - `Ink` 单独走 `InkParser`（直接用 `pdf-lib` 提取 `InkList`）
- **PDF 导出**：
  - `src/services/pdfService/exporters/AnnotationExporters.ts` 写回 `Highlight/Text/FreeText/Ink` 等
  - `src/services/pdfService/index.ts#exportPDF` 在导出前会清理旧注释（并保留未编辑导入项：`keepAnnotRefKeysByPage`）
- **Workspace 渲染/交互**：
  - `src/components/workspace/controls/index.ts` 注册注释控制（`highlight/comment/freetext/ink/link`）
  - `src/components/workspace/Workspace.tsx` 对所有注释统一渲染：`page.pageAnnotations.map(...) -> <ControlRenderer ... />`
  - 移动/缩放对注释的实现基本依赖 `annotation.rect`：
    - `updateMovingAnnotation(...)` / `updateResizingAnnotation(...)`

---

## 1. 功能范围（第一版建议）

### 1.1 支持的 PDF Subtype → 内部 shapeType

- `Square` → `shapeType: "square"`（矩形/方框）
- `Circle` → `shapeType: "circle"`（圆/椭圆）
- `Line` → `shapeType: "line"`（直线）
- `PolyLine` → `shapeType: "polyline"`（折线）
- `Polygon` → `shapeType: "polygon"`（多边形）

说明：PDF 里 `Square/Circle` 的“圆角/椭圆”等细节在不同生成器里差异较大，第一版优先保证**位置与边框**正确。

### 1.2 内部数据模型（建议）

在 `src/types.ts` 的 `Annotation` 中扩展（具体如何落地由实现阶段决定）：

- **新增类型**：`type: "shape"`
- **区分形状**：`shapeType: "square" | "circle" | "line" | "polyline" | "polygon"`
- **强制有 bounding box**：`rect` 必填
  - 原因：Workspace 现有的移动/缩放逻辑基本只更新 `rect`，保持 `rect` 必填可以最大化复用交互代码。
- **点数据**：对 `line/polyline/polygon` 增加 `shapePoints`
  - 强烈建议存为“相对 `rect` 的归一化点（0..1）”
  - 好处：
    - 移动/缩放只改 `rect` 就能带动形状整体变换
    - 后续实现点编辑时也更容易做坐标转换

样式建议复用现有字段：

- `color`：stroke 颜色
- `thickness`：线宽
- `opacity`：整体透明度
- `backgroundColor`：fill（可选；Square/Circle/Polygon 有意义）

---

## 2. 实施顺序（你要求的顺序）

你希望的顺序是：

1. **解析（Import）**
2. **在 `src/components/workspace/Workspace.tsx` 渲染**（用于验证解析结果可视化）
3. **导出（Export）**
4. **编辑（Edit）**
5. **创建（Create）**

下面按这个顺序给出详细规划。

---

## 3. Step 1：解析（Import）形状注释

目标：打开包含 shapes 的 PDF 时，`loadPDF()` 能把 shapes 转成内部 `Annotation`（type="shape"），并携带足够信息供渲染与后续导出。

### 3.1 需要新增/调整的导入数据源（pdfService/index.ts）

文件：`src/services/pdfService/index.ts`

现状：扫描 annots 时只把以下 subtype 进入 `pageAnnotations`：

- `Link`
- `Highlight`
- `Text`
- `FreeText`

规划：在同一层（扫描 `page.node.Annots()`）把以下 subtype 也 push 到 `pageAnnotations`：

- `Square` / `Circle`
- `Line`
- `PolyLine`
- `Polygon`

提取字段建议：

- **通用**：
  - `Rect`
  - `C`（stroke color）
  - `CA/ca`（opacity）
  - `T`（author/title）、`Contents`、`M`（modified date）
  - `sourcePdfRef`（用于导出时 keepKeys 策略）
- **Line**：`L`（[x1 y1 x2 y2]）
- **PolyLine/Polygon**：`Vertices`（[x1 y1 x2 y2 ...]）
- **fill（可选）**：`IC`（interior color）

注意：这里的 `pageAnnotations` 是你项目自定义的 `PdfJsAnnotation`（见 `src/services/pdfService/types.ts`），需要扩充其可选字段以承载 `L/Vertices/IC`。

### 3.2 将 pageAnnotations → 内部 Annotation（ShapeParser）

文件：`src/services/pdfService/parsers/AnnotationParsers.ts`

新增：`ShapeParser implements IAnnotationParser`

实现方法（建议）：

- 读取 `context.pageAnnotations`，筛选 `annotation.subtype` in `Square/Circle/Line/PolyLine/Polygon`
- 坐标转换：
  - PDF → UI 使用 `viewport.convertToViewportPoint(x, y)`
- 输出内部 Annotation：
  - `type: "shape"`
  - `shapeType`：按 subtype 映射
  - `rect`：
    - `Square/Circle`：用 PDF `Rect` 转 UI `rect`（可以复用 `pdfJsRectToUiRect` 或类似方法）
    - `Line/PolyLine/Polygon`：优先由 `L/Vertices` 转为 UI 点后计算 bbox；bbox 作为 `rect`
  - `shapePoints`：
    - 先得到 UI 点数组 `uiPts`
    - 计算 bbox `rect`
    - 将 `uiPts` 归一化：
      - `nx = (x - rect.x) / rect.width`
      - `ny = (y - rect.y) / rect.height`
- 样式：
  - `color`：复用现有 `normalizePdfColorToRgb255` + `rgbArrayToHex`
  - `opacity`：读 `CA/ca` 并 clamp 0..1
  - `thickness`：第一版可先读 `BS.W`（如你在导入阶段能拿到），否则默认值（例如 2）
  - `backgroundColor`：如解析 `IC` 则填充

### 3.3 完成标准（DoD）

- 打开 PDF：`loadPDF()` 返回的 `annotations` 包含 `type:"shape"`
- `rect` 一定存在（至少对第一版所有 shapes）
- 对 `line/polyline/polygon`：`shapePoints` 存在且点数正确

---

## 4. Step 2：在 Workspace 渲染 shapes（补齐你指出的关键步骤）

目标：解析出来的 shapes 能在 `Workspace.tsx` 中被渲染出来，先不做创建/编辑，只要能“看见”。

### 4.1 控件注册（ControlRegistry）

文件：`src/components/workspace/controls/index.ts`

规划：新增一个注释 control：

- `type: "shape"`
- `component: ShapeControl`（新增文件）
- `propertiesComponent: ShapeProperties`（可先占位，Phase 4 再做完善；但建议一起上，方便调试）

### 4.2 ShapeControl（渲染实现方法）

建议新增文件：

- `src/components/workspace/controls/annotation/ShapeControl.tsx`

渲染策略：用 SVG，在 `ControlWrapper` 内渲染具体形状。

- 通用：
  - `ControlWrapper` 使用 `data.rect` 定位
  - SVG `viewBox` 建议设成 `0 0 rect.width rect.height`
- `square`：`<rect x=0 y=0 width=... height=... />`
- `circle`：`<ellipse cx=... cy=... rx=... ry=... />`
- `line`：从 `shapePoints[0..1]` 还原为 rect 内坐标，再 `<line x1 y1 x2 y2 />`
- `polyline`：`<polyline points="x,y ..." fill="none" />`
- `polygon`：`<polygon points="..." />`

样式映射：

- `stroke = data.color`
- `strokeWidth = data.thickness`
- `opacity = data.opacity`
- `fill = data.backgroundColor`（若无则 `none`）

### 4.3 Workspace.tsx 无需大改的原因（但要确认的点）

文件：`src/components/workspace/Workspace.tsx`

你当前 Workspace 的渲染通路是：

- `page.pageAnnotations.map((annot) => <ControlRenderer data={annot} ... />)`

只要：

1. `annot.type === "shape"`
2. `controls/index.ts` 注册了 `type:"shape"`
3. `ShapeControl` 依赖 `rect` 渲染

那么 Workspace 会自动渲染 shapes。

需要注意：

- `ControlWrapper` 会根据 `data.type` 判定是否是 annotation（目前列表里没有 `shape`），因此：
  - **需要把 `shape` 也视为 annotation**（否则一些行为如 elementId/label 可能不一致）
  - 具体在实现时修改 `ControlWrapper.tsx` 的 `isAnnotation` 列表，把 `shape` 加进去

### 4.4 完成标准（DoD）

- 打开含 shapes 的 PDF：页面上能看到 shapes
- 不要求可编辑（仅可见即可）
- 形状位置基本正确（允许线宽/填充等细节后续迭代）

---

## 5. Step 3：导出（Export）形状注释写回 PDF

目标：导出后在外部阅读器（Chrome PDF/Acrobat）可见 shapes，且不会重复叠加。

### 5.1 ShapeExporter

文件：`src/services/pdfService/exporters/AnnotationExporters.ts`

新增：`ShapeExporter implements IAnnotationExporter`

实现方法：

- `shouldExport`：`annotation.type === "shape"`
- 生成 PDF coords：
  - bbox：使用 `uiRectToPdfBounds(page, rect, viewport)`
  - 点：把归一化点还原为 UI 点，再 `uiPointToPdfPoint(page, pt, viewport)`
- 写 annot dict：
  - `Subtype` 根据 `shapeType` 映射
  - `Rect`：bbox（建议 padding = thickness，避免 stroke 被裁）
  - `C`：stroke color
  - `CA`：opacity
  - `BS: { W: thickness, S: "S" }`
  - `Line`: `L: [x1, y1, x2, y2]`
  - `PolyLine/Polygon`: `Vertices: [x1,y1,x2,y2,...]`
  - fill（可选）：`IC`

### 5.2 注册与导出前清理

文件：`src/services/pdfService/index.ts`

- 注册：把 `new ShapeExporter()` 放到 `annotationExporters` 数组
- 清理：当前清理列表为 `Ink/Highlight/Text/FreeText`，需要加入：
  - `Square/Circle/Line/PolyLine/Polygon`
- 保留导入未编辑项：复用现有 `keepAnnotRefKeysByPage` 策略（sourcePdfRef + isEdited）

### 5.3 完成标准（DoD）

- 打开 PDF → 能看到 shapes
- 导出 → 重新打开导出文件 → shapes 仍然存在
- 未编辑的 imported shapes 不会被重复写入

---

## 6. Step 4：编辑（Edit）形状注释

目标：形状可被选中、移动、缩放、调整样式；部分形状支持“点编辑”。

### 6.1 基础编辑：移动/缩放复用 rect

文件：`src/components/workspace/Workspace.tsx`

现状：

- 移动注释：`updateMovingAnnotation` 只对 `annot.rect` 生效
- 缩放注释：`updateResizingAnnotation` 只对 `annot.rect` 生效

因此第一版 shapes 编辑应遵循：

- 所有 shapes 都必须有 `rect`
- `line/polyline/polygon` 的 `shapePoints` 使用归一化点，不随 move/resize 改动

### 6.2 ShapeProperties（样式编辑）

建议新增：`src/components/workspace/controls/properties/ShapeProperties.tsx`

字段：

- color
- thickness
- opacity
- backgroundColor（可选）

### 6.3 点编辑（第二阶段中的增强项）

- 仅对 `line/polyline/polygon` 支持
- UI：在选中时显示点控制柄（handles）
- 交互：拖动 handle 更新 `shapePoints`（归一化坐标）

落点建议：

- `ShapeControl.tsx` 内渲染 handles
- `Workspace.tsx` 或新增 hook 处理“拖动点”的 pointer session（与现有 move/resize session 隔离）

### 6.4 橡皮擦命中（可选增强）

文件：`src/components/workspace/hooks/useWorkspaceEraser.ts`

现状：

- 非 ink：只按 `rect` 命中

问题：

- 细线（Line/PolyLine）用 bbox 命中会偏大

增强方案：

- 对 `shapeType === line/polyline`：按线段距离命中（复用现有 ink 的 distToSegmentSquared 思路）

---

## 7. Step 5：创建（Create）不同形状类型

目标：提供工具创建 `square/circle/line/polyline/polygon`。

### 7.1 Tool 设计

文件：`src/types.ts`

新增 tool：

- `draw_shape_rect`
- `draw_shape_ellipse`
- `draw_shape_line`
- `draw_shape_polyline`
- `draw_shape_polygon`

文件：`src/lib/tool-behavior.ts`

- `rect/ellipse/line`：通常非连续（用后切回 select）
- `polyline/polygon`：建议连续（进入会话，完成/取消后再切回）

### 7.2 Workspace 创建交互实现路径

文件：`src/components/workspace/Workspace.tsx`

- `rect/ellipse`：复用现有 dragStart/dragCurrent 的矩形创建通道
  - pointer up 生成 `Annotation(type:"shape")` + `shapeType` + `rect`
- `line`：
  - pointer down 记录起点
  - pointer move 显示预览
  - pointer up 生成 bbox `rect` + 两点归一化 `shapePoints`
- `polyline/polygon`（会话式）：
  - click 添加点
  - move 显示最后一段预览
  - Enter/双击完成
  - Esc 取消
  - 完成时计算 bbox `rect`，归一化点

### 7.3 完成标准（DoD）

- 五种形状都能创建
- 创建后可立刻被选中并调整样式
- 导出后外部阅读器可见

---

## 8. 兼容性与风险清单

- **AP 外观流差异**：部分 PDF 依赖 AP 渲染，字段缺失时可能需要 AP 兜底（后续迭代项）
- **旋转页坐标**：必须始终用 `viewport.convertToViewportPoint` / `uiPointToPdfPoint`
- **导出清理**：必须纳入 shapes subtype，否则重复叠加
- **命中测试**：线类形状 bbox 命中偏差，建议后续升级为线段距离命中
