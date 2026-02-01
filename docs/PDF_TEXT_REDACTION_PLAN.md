# B1：扁平化导出时剔除被覆盖的底层文本（Content Stream Rewriting）实现计划

## 背景与目标

当我们把 `FreeText` 扁平化（flatten）导出到页面内容流时，**视觉上**可以用背景/文字覆盖原文，但原 PDF 的底层文字对象依然存在，因此在浏览器/阅读器中仍会出现在 **可选中/可复制/搜索** 的“文本层”里，干扰选择。

本计划的目标是实现 **B1**：在导出时对页面的 **content stream** 做“定点改写”，把被指定区域（例如 FreeText 框）覆盖的底层文字绘制指令剔除（或替换为无文本绘制），从而让这些底层文字在阅读器中不再干扰选择。

同时，该能力需要为后续“涂黑/脱敏（Redaction）”功能复用：

- **Apply Redaction**：真正移除内容（或替换为不可恢复的形式）
- **Redaction Mark**：仅标记（annotation），不应用

## 非目标（第一期不做）

- 不做整页栅格化（B2）
- 不保证对所有 PDF 生成器/所有内容结构 100% 生效（会分阶段覆盖）
- 第一版不做精确到“单个字符”的裁剪删除（可以先做到 text-run 粗粒度）

## 总体思路（高层设计）

在 `exportPDF(...)` 导出流程中，新增一个阶段：

1. **收集剔除区域**（redaction regions）
   - 来源：本次导出中需要扁平化的 `FreeText`（以及未来的 Redaction 标注）
   - 将 UI 坐标/rect 转为 PDF 坐标下的区域（AABB 或 polygon）
2. **读取并解析页面内容流**（page content streams）
   - 解码 stream（FlateDecode 等）
   - Tokenize → parse operators
3. **解释执行（轻量解释器）**
   - 维护 graphics state / text state / CTM
   - 识别 `BT..ET` 内的 text-showing 操作（`Tj`/`TJ`/`'`/`"`）
   - 为每个 text-show 估算在页面坐标中的包围盒（bbox/quad）
4. **命中判定**：bbox 与任意剔除区域相交 → 标记为“需要剔除”
5. **重写内容流**
   - 删除命中的 text-show 操作（或替换为不绘制的等价指令）
   - 保留其它绘制（线条/图片/未命中文本）
6. 用 pdf-lib 写回新的内容流，再进行后续的扁平化绘制（`page.drawText` 等）

> 关键点：我们要剔除的是“底层文字绘制指令”，而不是只盖一层。

## 代码落点（建议）

建议在 `src/services/pdfService/lib/` 下新增模块（未来实现时再创建文件）：

- `contentStream.ts`
  - decode/encode helpers
  - tokenizer/parser（PDF content stream subset）
- `contentStreamInterpreter.ts`
  - graphics state + text state
  - text bbox 估算
- `textRedaction.ts`
  - region collection
  - operator filtering
  - rewrite & writeback

导出流程挂载点：`src/services/pdfService/index.ts` 的 `exportPDF(...)`：

- 在 `// 2. Export Annotations` 前（或至少在 `FreeTextExporter` flatten 绘制前）
  - 对每个 pageIndex：`applyTextRedactionsToPage(pdfDoc, page, regions)`

## 输入数据与坐标体系

### 剔除区域来源

- 短期（B1 MVP）：
  - 所有 `annotation.type === "freetext" && annotation.flatten === true` 的 `annotation.rect`
- 中期（面向涂黑）：
  - 新增 `annotation.type === "redaction"` 或复用现有 `shape`/`rects` 数据结构

### 坐标转换

- UI -> PDF：使用现有 `uiRectToPdfBounds(page, rect, viewport)`
- 对旋转 FreeText：
  - 第一版可以直接使用其 AABB（扁平化前我们也使用 AABB 做绘制布局）
  - 后续可升级为 polygon（由 rect + rotationDeg 推导四角点）

## Content Stream 解码（必须先解决的工程问题）

PDF 页面内容流 `/Contents` 可能是：

- 单个 stream
- 多个 stream 的数组（PDFArray）

每个 stream 可能带 Filter（常见 `FlateDecode`）。目前代码库中已经有 `decodePdfStreamToText`（`pdf-import-utils.ts`），它：

- 只在 runtime 存在 `DecompressionStream` 时尝试解压
- 对 `FlateDecode` 做 best-effort

导出侧（Tauri/Web）是否总有 `DecompressionStream` 不确定，因此需要明确策略：

- **策略 1（优先）**：使用 `DecompressionStream`（浏览器环境通常可用）
- **策略 2（兜底）**：引入纯 JS inflate（例如 pako）用于 FlateDecode（成本：新增依赖）
- **策略 3（降级）**：无法解码则跳过 B1，并给 UI 报警告（不推荐，但可作为安全网）

## 内容流解析范围（subset parser）

我们不需要实现完整的 PDF content stream 规范，第一期只需要覆盖能影响文字位置的核心操作符：

- **文本对象**：`BT`, `ET`
- **文本绘制**：`Tj`, `TJ`, `'`, `"`
- **文本状态**：`Tf`, `Tc`, `Tw`, `Tz`, `TL`, `Ts`, `Tr`
- **文本定位**：`Td`, `TD`, `Tm`, `T*`
- **图形状态/变换**：`q`, `Q`, `cm`
- **XObject**：`Do`（第一版可以不深入递归，但要在文档里规划）

Token 类型需要支持：

- number（含负号、小数）
- name（`/F1`）
- string（`(...)`）与 hex string（`<...>`）
- array（`[...]`）用于 `TJ`

## 轻量解释器：如何计算 text-run 的 bbox

### 状态维护

- Graphics state stack：
  - CTM（current transformation matrix）
- Text state：
  - textMatrix / lineMatrix
  - font + fontSize
  - charSpacing / wordSpacing / hScale / leading / rise

### bbox 估算（MVP）

MVP 只需要粗粒度避免“选择干扰”，可以接受稍微多删：

- 对每个 text-show 操作，计算一个近似矩形：
  - 高度：取 `fontSize`（或结合 `Tf` + ascent ratio 的经验值）
  - 宽度：
    - 简化：按字符数 _ fontSize _ 常数系数（例如 0.5~0.6）
    - 更好：如果能从字体字宽计算（需要解析 font dict / widths），再升级
- 位置：由 `textMatrix` \* `CTM` 推导出基线起点
- 旋转/斜切：
  - 第一版可以用 AABB 包住旋转后的矩形

### bbox 估算（升级版，面向涂黑）

- 解析 `Tf` 对应的 font 资源，读取：
  - `Widths`、`FirstChar/LastChar`（简单字体）
  - 或 CMap/ToUnicode（复杂字体）
- 对 `TJ`：按每段 string + kerning 调整推进，生成更精确的 run 盒
- 最终输出：quad（4 点）而不是 AABB

## 命中规则（区域与文本的相交判定）

- MVP：AABB vs AABB intersection
- 升级：polygon vs quad intersection

剔除策略建议支持 2 个模式（未来涂黑也需要）：

- **cover**：bbox 与区域相交就剔除（更保守，删得多）
- **inside**：bbox 大部分面积落在区域内才剔除（更精确，删得少）

## 重写策略（如何“剔除”）

### 方案 R1：删除 text-show 操作符（推荐）

- 命中则移除对应的 `Tj`/`TJ`/`'`/`"`
- 保留 BT/ET 结构与其它状态设置（Tf/Tm/cm 等）

优点：

- 语义清晰：没有 text-show，通常就不会进入 text extraction/selection

风险：

- 若某些阅读器对状态变化依赖较强，可能出现少量副作用（一般很小）

### 方案 R2：替换为等宽空白（次选）

- 将 string 替换为同长度空格，保留推进

优点：

- 更不影响后续文字位置（但我们是在删除被覆盖的文字，位置影响通常不重要）

缺点：

- 可能仍被文本层提取成空白/占位（不同阅读器行为不一致）

### 方案 R3：使用 `3 Tr`（invisible text）

- 命中区域内先 `3 Tr` 再绘制，再恢复 `0 Tr`

注意：

- 是否能避免 PDF.js 的 text extraction 不确定；不作为第一选择

## XObject（Do）与递归（重要但可分期）

大量 PDF 会把内容放在 Form XObject 里（`Do /X1`），文字绘制可能发生在 XObject stream 内。

分期建议：

- **P1**：只处理页面顶层 content stream（不递归 Do）
- **P2**：对 Form XObject 做递归解析与重写
  - 需要维护资源字典查找（XObject -> stream）
  - 需要考虑 XObject 自己的 Matrix

## 与未来“涂黑（Redaction）”复用点

B1 的核心资产可直接复用于涂黑：

- 同一套：content stream decode → tokenize → interpret → bbox → rewrite
- 差异点：
  - “涂黑 apply”通常需要：
    - 删除命中文本
    - 删除或栅格化命中图片（可后续扩展）
    - 在区域上方画黑块（这是视觉层）

建议涂黑功能的数据模型：

- `annotation.type = "redaction"`
- `rect` 或 `quadPoints`
- `mode`: `apply` / `mark`

## 分阶段里程碑（建议）

### Milestone 0：样本与验证基线

- 收集 10 份 PDF：
  - pdf.js 生成、Word 导出、扫描 OCR、含旋转文字、含 XObject 的
- 明确验证手段：
  - Chrome/Edge 内置阅读器：框区域拖拽选择，不应再选到被覆盖文字
  - 搜索：覆盖区域内的词不应被搜索命中（或至少不高亮/不跳转）

### Milestone 1（MVP）：顶层内容流 + 粗 bbox + 删除 Tj/TJ

- 仅处理 page `/Contents` 顶层
- 支持 BT/ET、Tf、Tm/Td/T\*、cm、q/Q、Tj/TJ
- bbox：fontSize \* 经验系数
- 命中：AABB 相交

### Milestone 2：更可靠的 bbox

- 引入字体宽度估算（优先覆盖简单字体）
- 对 `TJ` kerning 做推进

### Milestone 3：递归处理 Form XObject

- 支持 `Do` + 资源字典解析
- 在 XObject 内重复 Milestone 1~2

### Milestone 4：涂黑 apply（文本 + 黑块）

- 复用剔除逻辑
- 在区域上方画 black rectangle（可选带 padding）

## 风险与注意事项

- **流解码不可用**：需要明确 DecompressionStream 的可用性或引入 inflate 依赖
- **过度删除**：MVP 可能删多，需允许用户接受或加开关
- **内容流写回**：替换 stream 可能影响增量更新结构，但对导出新 PDF 是可接受的
- **性能**：大 PDF 多页解析需做：
  - 仅处理存在覆盖区域的页面
  - 对解析/重写做缓存或分段

## 与现有代码的集成点（导出）

当前导出主流程在：`src/services/pdfService/index.ts` 的 `exportPDF(...)`。

建议新增步骤顺序：

1. 载入 pdfDoc
2. 清理旧 annotations（已有）
3. **对每页应用 B1 文本剔除（仅当该页存在需要覆盖的 region）**
4. 导出 annotations（其中 flatten freetext 通过 `page.drawText` 画在新内容上）
5. 保存

## 验证清单

- **选择干扰**：框内拖选不再“卡住底层字”
- **复制/搜索**：框内底层词不再可复制/可搜索（尽量）
- **其它文字不受影响**：框外选择/复制正常
- **旋转/缩放页面**：page rotation=90/180/270 的 PDF 不崩

---

## 下一步

- 如果你确认要开始做 Milestone 1：我会先在 `pdfService` 里实现“读取/拼接 page contents → tokenizer → 只识别 BT/ET/Tj/TJ/Tm/Td/cm/q/Q 的最小解释器 → 删除命中 Tj/TJ → 写回新的单 stream”。
- 同时在 UI（导出选项）里加一个开关：
  - `Flatten FreeText`（已有）
  - `Remove underlying text under flattened FreeText`（新增）
