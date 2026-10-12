# 两分支的嵌套批注回复导出修复

日期：2026-10-12。当前维护与性能对照采用 `engine/pdfjs`（PDF.js + pdf-lib）和 `engine/pdfium`，MuPDF 保留历史快照，不参与本次修改和复测。

## 问题与修复

INDOT 千页工程图集的第 217 页有三个 Text 批注及各自的 Popup，审核状态依次为 Accepted、Completed、Corrected。后两个对象通过 `/IRT` 形成两层回复。之前两版只将第一层回复纳入编辑模型，导出清理 `/Annots` 时删掉第二层回复的列表项。其对象仍可能被 Popup 引用，因此不能仅靠搜索文件中的文字判断是否保存完整。

- 导入按完整引用链寻找所属批注，支持子回复排在父回复前面的文件，使用迭代遍历与缓存处理长链和循环。无法编辑的孤立回复、分组及异常链保留源对象。
- 编辑模型用 `inReplyToReplyId` 保存直接父回复；侧栏仍使用已有的平面回复列表。
- 导出先分配或复用全部回复对象，再连接 `/IRT`。修改回复时保留其源字典中的审核状态、标志和弹窗；主批注重新生成时同步维护相关引用。
- 复制、导入页面和拖动复制控件时，一并映射整组回复 ID。删除一个回复时将其子回复接到上一层，并移除对应弹窗；撤销恢复原关系。
- 两版使用相同的回归用例。PDFium 的修改继续作用于 worker 内的同一原生文档，没有为批注修复增加另一份解析文档。

## 分支记录

| 分支            | 本次代码提交                                                               |
| --------------- | -------------------------------------------------------------------------- |
| `engine/pdfjs`  | `b55cad5`，共享的嵌套回复修复                                              |
| `engine/pdfium` | `f687033`，保存上一轮导入/页树/输出缓冲优化；`9b71345`，共享的嵌套回复修复 |

PDF.js 工作树位于 `/tmp/legir-pdf-comparison/original`，PDFium 工作树位于 `/home/zach/Legir`。提交仅保存在本地。

## 验证方法

两版均执行完整应用测试：PDF.js 91 个文件、749 项；PDFium 97 个文件、778 项。PDFium 独立库 18 项测试也通过。新增 10 项用例覆盖乱序嵌套回复、反复保存重开、编辑中间回复和父批注、删除与撤销、页面复制、导入、拖动复制、循环/孤立/分组关系及无正文的根批注。两版类型检查、源码 ESLint 与生产构建通过。原版工作树已有未跟踪的 `bench-dist/` 构建产物，ESLint 源码检查排除了该目录及既有生成图标目录；未修改或删除这些文件。

真实文件仍是 288 页书籍、INDOT 1000 页图集、405 MB 的 43 页 A0 扫描图。两版均执行三轮完整打开、渲染、导出、整本 donor 导入及合并保存。INDOT 抽样页加入第 217 页，其他抽样条件保持相同；因此本轮渲染中位数不直接与此前不同抽样页的结果比较。

校验在计时结束后独立运行。除了每页几何、批注数量、链接、表单和抽样文字/像素，还检查回复的直接父对象、父对象是否在同页、审核状态、标志和 Popup 的父引用。旧原版的两份 INDOT 输出作为反例，两份均在第 217 页触发批注数量和回复关系检查失败，校验器保持非零退出码。

## 导出验证结果

**36/36 份导出通过严格校验，198/198 组抽样文字及 Poppler 像素完全一致。** INDOT 第 217 页及书籍在前合并时的第 505 页均保留三个 Text、三个 Popup，以及 Accepted → Completed → Corrected 的原始直接回复链，状态与标志保持一致。修复前同类对照为 18/36，失败项集中在该嵌套回复；增强后的校验没有放宽条件。

所有 9 次 PDFium 运行在导入/保存后均保有一个原生文档；导入临时 donor 的瞬时峰值为两个，关闭后 worker 数为零。没有把临时 donor 峰值与持久实例数量混为一谈。

## 修复后的性能基线

下表均为三轮中位数，单位秒。两版导出相同的完整批注结构；“导入 + 合并保存”先逐次相加再取中位数。完整指标和范围保存在 [summary.json](pdf-export-replies/summary.json)。

| 场景                 | 方案             | 单文档保存 | 导入 | 合并保存 | 导入 + 合并保存 |
| -------------------- | ---------------- | ---------: | ---: | -------: | --------------: |
| 书籍 + 千页图集      | PDF.js + pdf-lib |       0.66 | 2.03 |     5.19 |            7.23 |
| 书籍 + 千页图集      | PDFium           |       0.28 | 2.82 |     1.55 |            4.40 |
| 千页图集 + 书籍      | PDF.js + pdf-lib |       4.21 | 0.84 |     4.77 |            5.62 |
| 千页图集 + 书籍      | PDFium           |       1.23 | 0.95 |     1.04 |            1.99 |
| 405 MB 扫描图 + 书籍 | PDF.js + pdf-lib |       1.40 | 1.10 |     1.84 |            2.94 |
| 405 MB 扫描图 + 书籍 | PDFium           |       1.00 | 1.05 |     0.99 |            1.98 |

同一完整合并任务，PDFium 耗时分别减少 **39.1%、64.7%、32.5%**。这说明部分真实任务已经优于修复后的原实现，但不能推导出所有阶段都更快。书籍和千页图集的单独导入阶段仍较慢；扫描图重复整页渲染约 1.02 秒，对照约 0.141 秒，瓦片约 0.472 秒，对照约 0.009 秒。后续应分别分析导入重复工作、输出/下载数据复制及扫描图渲染缓存。

| 场景                 | 方案             | 阅读 PSS（MiB） | 全流程 PSS 峰值（MiB） | 浏览器 SwapPSS 峰值（MiB） |
| -------------------- | ---------------- | --------------: | ---------------------: | -------------------------: |
| 书籍 + 千页图集      | PDF.js + pdf-lib |             857 |                  2,544 |                          0 |
| 书籍 + 千页图集      | PDFium           |             773 |                  3,083 |                          0 |
| 千页图集 + 书籍      | PDF.js + pdf-lib |           1,323 |                  2,454 |                          0 |
| 千页图集 + 书籍      | PDFium           |             957 |                  2,816 |                          0 |
| 405 MB 扫描图 + 书籍 | PDF.js + pdf-lib |           2,238 |                  3,936 |                        769 |
| 405 MB 扫描图 + 书籍 | PDFium           |           1,283 |                  3,779 |                        333 |

阅读 PSS 三组均下降；书籍和图集的合并/下载峰值仍高于原版。扫描图有明显交换活动，PSS 不包含已经换出的内存，PSS 与 SwapPSS 的峰值也未必同时发生。这些是本机端到端结果，不是纯 CPU 或完全无交换时的性能排名。

## 浏览器与适用范围

两版生产 PWA 均在离线模式完成表单编辑、插页、撤销/重做、导入、保存，独立重开得到 8 页、3 个字段和正确编辑值。没有页面 JS 异常或检查时可见的坏图。

PDFium 活动 worker 为 1，关闭文档后为 0。原版初始/活动/关闭后的 worker 数为 2/4/4，保留完整 URL 记录；原版这一项是观测记录，没有套用 PDFium 的单 worker 断言。原版日志有一个离线 AI 模块请求失败及一个撤销后的 Blob 图片请求失败，PDFium 有一个撤销后的 Blob 图片请求失败。因此这次结果不代表所有资源请求或原版的 worker 回收检查均通过。

性能环境为 Raspberry Pi 5、8 GiB、Linux ARM64、无头 Chromium 软件渲染。构建、单测、UI 和校验不与正式计时并行。内存采用 Chromium 进程 PSS，50 ms 采样，下载 Blob 计入全流程峰值，SwapPSS 单列；WASM 容量不是活跃内存。未测试 Windows/Tauri 或实际交互滚动帧率；抽样视觉检查也不代表所有页面和全部 PDF 特性的无损证明。

## 数据与复现

[原始运行](pdf-export-replies/results.json)、[严格校验](pdf-export-replies/validation.json)、[源文件结构与哈希](pdf-export-replies/fixtures.json)、[旧输出反例](pdf-export-replies/negative-validation.json)、[版本与构建哈希](pdf-export-replies/provenance.json)及[生产 UI 记录](pdf-export-replies/ui.json)均保留。截图为 [PDF.js](pdf-export-replies/ui-pdfjs.png) 和 [PDFium](pdf-export-replies/ui-pdfium.png)。完整导出文件留在本机 `/tmp/legir-export-replies/`，源 PDF 的位置见 [manifest](pdf-export-replies/manifest.json)；这些 PDF 均未提交到仓库。

```sh
node scripts/pdf-benchmark/build.mjs /tmp/legir-pdf-comparison/original /tmp/legir-export-replies/build-pdfjs corpus-entry.ts
node scripts/pdf-benchmark/build.mjs /home/zach/Legir /tmp/legir-export-replies/build-pdfium corpus-entry.ts
# 按本机文件位置调整 manifest；每次改动后使用新的结果目录：
NODE_PATH=/tmp/legir-pdfium-browser-tools/node_modules node scripts/pdf-benchmark/corpus.mjs /tmp/legir-export-replies/manifest.json /tmp/replies-results 3
node scripts/pdf-benchmark/corpus-summary.mjs /tmp/replies-results/results.json /tmp/replies-summary.json
node scripts/pdf-benchmark/corpus-validate.mjs /tmp/legir-export-replies/manifest.json /tmp/replies-results/results.json /tmp/replies-validation
```
