# PDFium 真实文件导入与合并导出优化

后续更新：两条活跃分支的嵌套回复导出缺失已修复，见[修复与新基线](pdf-export-replies.md)。下文保留当时的版本、结果及问题记录。

日期：2026-10-12。基于 `engine/pdfium` 的 `e4f3095` 修改，保存的原方案 `5c207b2` 和 MuPDF 分支未改动。

## 原方案源码说明了什么

原方案并非每个导出阶段都更快：上一轮 PDFium 单文档保存已明显更快，主要问题在整套导入和合并导出。

1. `5c207b2:src/workers/pdf-render.worker.ts` 的 `loadDocument` 只等待 PDF.js 的 `getDocument().promise`。注册 donor 时打开独立阅读文档，不把 donor 对象立刻合并进主文档。因此单看导入时间，原方案承担的工作较少；必须同时比较后续合并保存。
2. `5c207b2:src/services/pdfService/index.ts` 的 `loadPDFInternal` 并行启动 PDF.js 与 pdf-lib。页尺寸来自 pdf-lib 页面字典，读取尺寸不解析绘图指令。`exportPDF` 则重新载入编辑文档，在 `assemblePages` 中按复制组使用 `PDFObjectCopier`，通过映射保留共享引用，移除页面 Parent，保留压缩流内容，并修复表单、链接与页面关系。
3. 原方案 `assemblePages` 也逐页删除、插入页树。pdf-lib 的 `PDFPageTree.removeLeafNode/insertLeafNode` 每次都会扫描 Kids；其 JS 内存中的数组访问较便宜。PDFium 适配层照用这个循环，每次取值、解引用、判断类型都经过 WASM，并产生临时句柄与分配。这使原来的算法成本显著放大。不能据此推断 C++ 写文件比 JS 慢。
4. pdf-lib 的 `PDFWriter.serializeToBuffer` 先调用 `computeBufferSize`，再一次分配输出数组。PDFium 的原桥接虽然估算了流长度，却把初始预留截断在 64 MiB，数百 MB 的文件仍须扩容并复制已写出的数据。

对照的是仓库固定版本源码及安装的 `@cantoo/pdf-lib 2.5.3`，不是不同 PDF 引擎的一般性能排名。单实例架构仍须在导入时将 donor 对象复制到 owner；本次没有改回多个长期 PDF 实例。

## 已实现的修改与诊断证据

- [页面检查](../../src/services/pdfService/engine/documentSession.ts) 使用 `findPage` 读取页面字典，通过共享的几何计算保留 CropBox、MediaBox、UserUnit 和旋转，避免仅为尺寸调用 `FPDF_LoadPage`。
- [C++ 对象复制](../../packages/pdfium/native/bridge.cpp) 为间接引用预先分配目标编号，通过待处理队列完成复制，保留循环引用、共享流、别名和数值精度。100 层限制仅约束直接嵌套的容器；长书签/回复引用链不再消耗递归栈。直接嵌套超限仍拒绝并支持事务回滚，没有简单扩大限制。
- [页面组装](../../src/services/pdfService/lib/assemblePages.ts) 通过新的库 API `setPages` 一次更新页树。[适配层](../../src/services/pdfService/engine/nativeEditingContext.ts) 同步刷新已固定版本的布局辅助库页面缓存。原有表单重建、控件引用映射、链接修复和事务回滚继续执行。
- 写出缓冲按已有压缩流的实际长度预分配。PDFium 的 `CPDF_FlateEncoder` 会保留本组文件中主导体积的已有 Filter 图像/内容流编码；无 Filter 的流可能大幅压缩，因此其预留贡献仍限制为 64 MiB，总预留限制为 512 MiB，超出后正常增长。保存格式、压缩和加密策略未改变。
- 重新编译并校验 WASM 产物及 provenance；库依然独立，主 worker 长期仅保有一个 PDF 实例。

千页图集 + 288 页书籍的独立插桩运行中，合并保存的关键调用次数如下。插桩耗时包含明显开销，且诊断阶段有其他检查并行，因此只用调用数解释原因，不用作性能成绩。

| 调用                         |    修改前 | 修改后 |
| ---------------------------- | --------: | -----: |
| 数组取值 `LPDF_GetIndex`     | 1,338,887 |  8,559 |
| 类型查询 `LPDF_Type`         | 5,408,871 | 48,375 |
| 解引用 `LPDF_Resolve`        | 1,337,689 |  5,073 |
| 临时分配 `malloc`            | 1,347,988 | 11,796 |
| 页树批量更新 `LPDF_SetPages` |         1 |      2 |

最后一行修改前仅有“临时移除导入源页”的批量更新，真正的最终页面组装仍是逐页操作；修改后额外一次批量更新替代这些遍历。修改前千页打开诊断有 1000 次 `LPDF_LoadPage`，累计约 22 秒；修改后打开阶段此调用为零。上述调用数来自加入输出缓冲改进前的阶段一诊断，保留在 profile JSON 中。

## 测试方法

继续使用 [三引擎真实文件基准](pdf-engine-real-corpus.md) 的同一入口、字节相同的样本和实际生产服务调用：288 页书籍（32.27 MB）、INDOT 1000 页图集（245.66 MB）、43 页 A0 扫描图纸（405.26 MB）。主文档是书籍时导入完整 INDOT；另外两种主文档导入完整书籍。无图片重压缩。

环境仍为 Raspberry Pi 5、8 GiB、Linux ARM64、Chromium 148 无头软件渲染。构建、单元测试和诊断已在正式计时前结束。每次新建 Chromium，每组各三轮；同组轮换版本顺序。最终版本与原方案共 18 次新浏览器运行。前一阶段另有 24 次三轮对照，保留修改前 PDFium 及尚未优化输出预留的中间版本，用于核对原因及变化范围；不将中间版本的时间混入最终中位数。未重跑上一轮已有三次超时的修改前书籍导入。MuPDF 本次未复测。

PSS 汇总 Chromium 进程，50 ms 采样，包含 native/WASM；基线已经持有主文档及 donor 字节。下载 Blob 复制独立计时；全流程峰值包含下载。WASM arena 容量不等于常驻内存。这里没有 Windows/Tauri、真实滚动帧率或长期泄漏结论。

## 最终实测结果

每格均为三轮中位数，单位秒。总计先对每轮导入与合并保存相加，再取中位数；不是两列中位数相加。最终 18/18 次完成，原始数据和范围见 [results.json](pdfium-real-corpus-optimization/results.json) 与 [summary.json](pdfium-real-corpus-optimization/summary.json)。

| 场景                 | 方案          | 打开 | 单文档保存 | 导入 | 合并保存 | 导入 + 合并保存 |
| -------------------- | ------------- | ---: | ---------: | ---: | -------: | --------------: |
| 书籍 + 千页图集      | 原方案        | 0.62 |       0.65 | 2.13 |     5.12 |            7.24 |
| 书籍 + 千页图集      | 优化后 PDFium | 0.57 |       0.28 | 2.99 |     1.53 |            4.44 |
| 千页图集 + 书籍      | 原方案        | 1.56 |       4.16 | 0.82 |     4.74 |            5.55 |
| 千页图集 + 书籍      | 优化后 PDFium | 1.15 |       1.19 | 0.98 |     1.05 |            2.03 |
| 405 MB 扫描图 + 书籍 | 原方案        | 0.94 |       1.31 | 0.98 |     1.82 |            2.81 |
| 405 MB 扫描图 + 书籍 | 优化后 PDFium | 0.80 |       0.89 | 1.08 |     0.93 |            2.05 |

相对原方案，同一个完整合并任务的耗时分别下降 **38.7%、63.5%、27.0%**。单看导入，PDFium 仍稍慢：预览解析之后还需把 donor 复制进主实例；更大的收益来自合并保存。

与本轮前一阶段的 `e4f3095` 对照，千页图集打开 **24.56 → 1.15 秒**，该场景合并保存 **7.09 → 1.05 秒**；书籍导入整套图集此前三次超过 180 秒，本轮最终三次均完成。修改前书籍超时来自上一轮记录，未混入当前成功耗时。图集单文档保存则从阶段一修改前的 **1.06 → 1.19 秒**，有回落；不再预解析全部内容后，部分读取工作留到后续，尚未单独分摊这约 0.13 秒差异，不能称每个阶段都加速。

## 内存与剩余成本

以下为 MiB。PSS 是实际驻留内存；SwapPSS 单独列出，各峰值可能发生在不同时刻，不能把两列相加作为某一时刻的内存峰值。

| 场景                 | 方案          | 阅读 PSS | 阅读增量 | 全流程 PSS 峰值 | 浏览器 SwapPSS 峰值 |
| -------------------- | ------------- | -------: | -------: | --------------: | ------------------: |
| 书籍 + 千页图集      | 原方案        |      851 |      175 |           2,515 |                   0 |
| 书籍 + 千页图集      | 优化后 PDFium |      776 |      156 |           3,100 |                   0 |
| 千页图集 + 书籍      | 原方案        |    1,319 |      647 |           2,469 |                   0 |
| 千页图集 + 书籍      | 优化后 PDFium |      956 |      344 |           2,817 |                   0 |
| 405 MB 扫描图 + 书籍 | 原方案        |    2,237 |    1,407 |           4,224 |                 625 |
| 405 MB 扫描图 + 书籍 | 优化后 PDFium |    1,284 |      510 |           3,965 |                  33 |

**阅读占用下降，合并/下载峰值并非全面低于原方案。** 书籍与图集场景仍高于原方案；扫描图峰值下降，但交换活动明显。扫描图原方案各轮 SwapPSS 峰值约 401–911 MiB，最终 PDFium 约 11–606 MiB。其耗时和 PSS 受这台 8 GiB 主机的内存压力影响，不能解读为纯 CPU 或完全无交换时的排名。

增加输出预留后，相比阶段一未改输出缓冲的版本，三个场景的 WASM 容量中位数分别从 **1593 → 1096、1560 → 968、1931 → 1316 MiB**。这是 arena 高水位，不能当作活跃内存。最终九次 PDFium 流程均确认主 worker 保有 1 个原生文档、导入期间瞬时峰值 2，关闭后 worker 为 0。

后续优先减少导入预览与主 worker 的重复开档/流数据副本，并研究减少导出与下载的中间缓冲。当前扫描图重复整页渲染仍约 1.02 秒（原方案 0.138 秒），瓦片约 0.497 秒（原方案 0.010 秒），渲染仍需单独优化。

## 验证与范围

- 第一阶段完整应用测试通过：96 个文件、768 项；原生库 18 项通过，ESLint、应用/网站类型检查及生产构建通过。最终缓冲修改后重新运行原生库 18 项和 PDF 相关的 21 个文件、168 项测试，并重新构建生产应用。
- 最终生产 PWA 在 Chromium 中离线完成打开、表单编辑、插页、撤销/重做、导入、保存与关闭。独立重开得到 8 页和 3 个字段，编辑值正确；活动 worker 为 1、关闭后为 0。没有页面 JS 异常或检查时可见的坏图；日志保留了 1 次已经撤销的 Blob 图片请求失败，不能称为完全没有资源错误。记录和截图见 [ui.json](pdfium-real-corpus-optimization/ui.json) 与 [ui.png](pdfium-real-corpus-optimization/ui.png)。
- 第一阶段 48 份导出全部通过页数、全部页尺寸/旋转、标题、链接和字段检查；264 组抽样文字与 Poppler 像素完全一致。严格结构校验为 24/48，通过不了的 24 份均为原方案也存在的 INDOT 第 217 页嵌套回复丢失一个 Text 批注列表项（书籍在前合并时为第 505 页）。未放宽校验，校验程序仍以非零状态报告该问题。
- 最终版本对照的 36 份导出全部通过上述页数、几何、标题、链接和字段检查；198/198 组抽样文字与 Poppler 像素完全一致。严格检查为 18/36，通过不了的 18 份仍只有同一个嵌套回复缺失，无新增差异。详见 [validation.json](pdfium-real-corpus-optimization/validation.json)。修改前/阶段一/最终 PDFium 的三类样本 PNG 校验值一致。
- 本组真实样本没有可填写表单；表单与加密、对象别名/共享流、页面复制独立性和回滚的覆盖来自单元测试与生产浏览器回归。不是全页人工视觉审查、全部 PDF 特性的无损证明或 Windows/Tauri 实测。

## 复现与文件

最终 [manifest.json](pdfium-real-corpus-optimization/manifest.json) 和 [provenance.json](pdfium-real-corpus-optimization/provenance.json) 包含路径、版本、最终及阶段一源码/WASM/worker 哈希。源文件哈希沿用 [fixtures.json](pdf-engine-real-corpus/fixtures.json)。完整 PDF 保存在本机 `/tmp/legir-pdfium-io/` 下，未加入仓库。

```sh
node scripts/pdf-benchmark/build.mjs /home/zach/Legir /tmp/legir-pdfium-io/build-final corpus-entry.ts
# 按本机路径调整 manifest；使用全新结果目录，避免复用旧记录：
NODE_PATH=/tmp/legir-pdfium-browser-tools/node_modules node scripts/pdf-benchmark/corpus.mjs /tmp/legir-pdfium-io/manifest-final.json /tmp/new-final-results 3
node scripts/pdf-benchmark/corpus-summary.mjs /tmp/new-final-results/results.json /tmp/new-final-summary.json
node scripts/pdf-benchmark/corpus-validate.mjs /tmp/legir-pdfium-io/manifest-final.json /tmp/new-final-results/results.json /tmp/new-final-validation
```

独立调用诊断使用 `PDF_BENCH_PROFILE=1` 构建，再以相同变量调用 `corpus-diagnostic.mjs`，具体见 [脚本说明](../../scripts/pdf-benchmark/README.md)。保留的 [阶段一结果](pdfium-real-corpus-optimization/stage-one-results.json)、[阶段一汇总](pdfium-real-corpus-optimization/stage-one-summary.json)、[阶段一校验](pdfium-real-corpus-optimization/stage-one-validation.json) 与最终结果分开；不要混合计算中位数。
