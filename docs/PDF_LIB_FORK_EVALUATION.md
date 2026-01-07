# 迁移评估：从 `pdf-lib@1.17.1` 迁移到 Cantoo fork（`cantoo-scribe/pdf-lib` / `@cantoo/pdf-lib`）

## 背景与问题

当前项目依赖 `pdf-lib@1.17.1`，在 `src/services/pdfService/index.ts` 的 `exportPDF()` 中会：

- `PDFDocument.load(originalBytes, { ignoreEncryption: true })`
- 修改元数据、表单、注释等
- 最后 `return await pdfDoc.save()`

你反馈“使用 pdf-lib 导出的文件会出错，无法打开”。在没有具体样例/错误日志前，无法 100% 断言根因，但有几个高概率来源：

- **加密/受权限限制的 PDF**：上游 `pdf-lib@1.x` 明确不支持处理加密文档；`ignoreEncryption: true` 只是“绕过报错”，并不等价于“解密后安全编辑”。这类情况下导出结果在部分阅读器/校验器中可能被判定为不可打开或损坏。
- **输出兼容性（对象流 / xref stream）**：`pdfDoc.save()` 默认使用对象流（`useObjectStreams: true`）。大部分现代阅读器支持，但如果目标环境使用较老/严格的解析器，可能更容易报错。即使不迁移，也可以尝试 `pdfDoc.save({ useObjectStreams: false })` 作为快速验证手段。
- **导出逻辑写入了不被兼容的结构**：项目导出过程中包含较多“手工清理/写入”逻辑（删除 AcroForm 字段、清理 Annots、写入 appearance stream 等）。如果写入了不符合规范的对象引用，也可能导致文件整体不可打开。这个问题即便迁移 fork 也未必自动解决。

## Cantoo fork 概览

仓库：`https://github.com/cantoo-scribe/pdf-lib`

该 fork 的 `package.json` 显示其 npm 包名为 **`@cantoo/pdf-lib`**，版本示例为 **`2.5.3`**，License 为 **MIT**。

### 关键差异（对本项目最相关）

1. **支持“打开加密 PDF（提供密码）”**

- fork 在 `LoadOptions` 中增加了 `password?: string`。
- `PDFDocument.load()` 在检测到 `Encrypt` 且提供了 `password` 时，会走解密路径（内部使用 `CipherTransformFactory`）。

2. **支持“导出加密 PDF（设置密码）”**

- fork 增加了 `pdfDoc.encrypt(options)`，内部通过 `PDFSecurity` + `crypto-js` 写入标准加密字典，并在序列化时对对象流做加密。
- `SecurityOptions` 支持：
  - `ownerPassword?: string`
  - `userPassword?: string`
  - `permissions?: { printing/modifying/copying/... }`

3. **SVG 相关能力（额外收益）**

- fork 中存在 `embedSvg()` / `PDFSvg` 等实现，并引入 `node-html-better-parser` 用于解析 SVG。
- 这对“将 SVG 渲染进 PDF”是潜在能力增量（但本项目当前主要写入的是表单/注释，不一定立刻需要）。

## 对“导出文件无法打开”的改善预期

### 场景 A：源文件是加密 PDF

如果当前“无法打开”的导出文件主要来自 **加密/受权限控制 PDF**：

- 迁移到 Cantoo fork 后，**可以在 `PDFDocument.load` 阶段提供 `password` 进行解密再编辑**。
- 这通常能显著提升导出文件的可读性（因为编辑的是“解密后的上下文”，而不是在“未解密但强行忽略加密”的上下文上写入）。

### 场景 B：源文件未加密，但导出仍损坏

这种情况下 fork **不保证**能修复。

- 如果根因是我们导出逻辑写入了不规范对象/引用，迁移库也可能仍然输出坏文件。
- 不过 fork 提供了一些更强的解析/告警参数（如 `warnOnInvalidObjects` 等），有机会帮助定位“哪些对象解析异常”。

## 迁移可行性评估

### 1) 依赖替换策略

项目目前所有 import 都来自 `"pdf-lib"`。

**推荐策略：使用 npm alias 把 `pdf-lib` 指向 `@cantoo/pdf-lib`，尽量不改业务代码 import。**

- `package.json` 依赖写法（示例）：
  - `"pdf-lib": "npm:@cantoo/pdf-lib@2.5.3"`

这样 `import { PDFDocument } from "pdf-lib"` 仍然成立，但底层实际用的是 Cantoo fork。

### 2) 需要注意的兼容性风险（重要）

1. **子路径 deep import 可能被 exports 限制**

- Cantoo fork 的 `package.json` 使用了 `exports: { ".": ... }`。
- 这意味着类似 `import type { Fontkit } from "pdf-lib/cjs/types/fontkit"` 这类 deep import 在某些构建器/运行时会失败。
- 本项目存在该用法：`src/services/pdfService/lib/built-in-fonts.ts`。

建议改法：

- 不再从 `pdf-lib/cjs/...` 引类型，改从 `fontkit`（或项目已使用的 fontkit 包）引入类型；或在项目内部定义一个最小类型以避免 deep import。

2. **bundle 体积与浏览器兼容性**

- fork 增加了 `crypto-js`、`node-html-better-parser` 等依赖。
- 如果你们打包目标包含 Web（Vite）与 Tauri（WebView），一般可行，但会带来：
  - 更大的包体
  - 更复杂的依赖（需确认 `node-html-better-parser` 在浏览器侧没有 Node-only API 依赖）

3. **维护与风险**

- fork 不是上游官方发布包（上游原作者维护状态也不活跃）。
- 加密实现涉及规范与互操作性：需要用 Acrobat/Chrome/PDFium/pdf.js 等多阅读器回归测试。

## 如果迁移，项目中“可以实现/更容易实现”的功能

1. **稳定处理加密 PDF 的导出（核心）**

- 打开时记录的 `pdfOpenPassword` 可以用于：
  - `PDFDocument.load(originalBytes, { ignoreEncryption: true, password: openPassword })`
- 目标：避免“忽略加密导致导出损坏”。

2. **导出加密 PDF（设置导出密码）**

- 可在导出末尾调用：
  - `pdfDoc.encrypt({ userPassword, ownerPassword, permissions })`
  - `await pdfDoc.save()`
- 这能真正实现“导出时设置密码/权限”。

3. **导出时移除密码（解密后保存为无密码 PDF）**

- 如果源文件加密，且你提供了密码：
  - load 解密 -> 不调用 `encrypt()` -> save
- 结果通常是“无密码可打开”的新 PDF（取决于实现细节与是否保留 Encrypt 字典）。

4. **SVG 相关（潜在）**

- 支持将 SVG 转为可嵌入对象（对未来一些图形控件可能有价值）。

## 迁移后“仍然无法实现/不一定解决”的功能

- **编辑页面普通文本（非表单字段）**：fork 与上游一样，仍然没有“任意页面文本编辑/提取”这类高阶能力。
- **保证修复所有“导出损坏”**：如果损坏来自我们自定义导出逻辑写错对象结构，迁移库未必修复，需要针对性 debug。

## 建议的落地路线（最小风险）

1. **先做可回滚的依赖切换试验**

- 用 alias 把 `pdf-lib` 指向 `@cantoo/pdf-lib`。
- 修复项目里所有 deep import（尤其是 `pdf-lib/cjs/...`）。

2. **把导出链路补齐密码传递**

- 在 `exportPDF()` 的 `PDFDocument.load` 传入 `password`（从 store 的 `pdfOpenPassword` 或 export 设置获得）。

3. **建立回归用例**

- 至少覆盖：
  - 普通 PDF 导出
  - 加密 PDF（正确密码）导出
  - 加密 PDF（错误密码）导出
  - 导出后用 pdf.js/Acrobat/Chrome 打开校验

4. **如果仍然出现“无法打开”**

- 先尝试 `save({ useObjectStreams: false })` 判断是否是对象流兼容性问题。
- 再针对“导出逻辑写入对象”做 PDF 结构定位（建议留一个最小复现样本）。

## 需要你补充的信息（用于把问题从“评估”推进到“确定修复”）

- 导出后的 PDF 用哪个阅读器打不开？（Acrobat / Chrome / Edge / macOS Preview / pdf.js）
- 具体报错信息是什么？
- 源 PDF 是否加密？（打开时是否需要密码）
- 能否提供一个最小复现 PDF（或至少提供 PDF 属性截图：是否加密、PDF 版本、是否线性化等）
