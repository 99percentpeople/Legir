# 扫描页 Canvas 渲染、分级缓存与内存验证

2026-10-13，应用版本 `2cdb6d5`，分支 `engine/pdfium`。原方案为 `main` / `engine/pdfjs` 的 `5e1efc4`；优化前 PDFium 为 `ccf4bc0`。原生 PDFium WASM 未变更。当前主分支没有合入这条实验引擎分支。

## 实现范围

扫描正文现在由现有 PDFium 文档提取 JPEG 和页面变换，在同一个 Worker 的 OffscreenCanvas 中绘制。`ScanCanvasRenderer` 只借用已有 `PDFPage`，不构造第二个 PDF 文档。正文已有的批注、表单叠加层继续工作；要求绘制原生批注的任务整页回退。

快速路径只接受单张、不透明、无颜色配置文件的 DeviceRGB/gray JPEG，以及轴对齐、镜像或四分之一圈旋转的变换。文本、矢量、Form、透明组、蒙版、复杂裁剪、ICC/CMYK、解码失败及预算不足均保留完整原生路径。旋转后的最近邻放大也回退：实测浏览器在不同分块裁剪原点下可能选中相邻源像素，无法通过接缝检查。

- 参照本地 PDF.js 的分级缩小与平滑边界，逐轴减半，复用合适分辨率；先计算全页整数坐标，再减去分块偏移。
- 编码 JPEG、解码 ImageBitmap、缩放级别和输出块共享 LRU；保留预算 256 MiB，临时工作预算 384 MiB。原生超大图缓存按 Canvas 已用空间减少，避免两个缓存各保留 256 MiB。
- 缩放级别和输出块通过 `transferToImageBitmap()` 固化，随后将临时画布清零，避免小画布的绘制记录暗中持有整张大图。单个输出块不超过 8 MiB 才保留。
- 较大缩放时优先保留完整解码图，减少从整页转向分块时的再次解码。后台预览只复用已有资源，使用临时缩放级别，不驱逐前台缓存；工作空间不足时走原生。
- 取消或抢占不会发布半帧。页面内容、页面树或源文档变化后清理缓存；关闭时释放位图，迟到的异步解码结果也会关闭。纯元数据保存保留渲染缓存。

开发中排除了直接缓存 VideoFrame 的方案：在本机浏览器中，小分块仍可能触发全图格式转换，性能和内存均较差。最终使用一次解码、重复绘制的 ImageBitmap。另外把缓存回调工厂移出 PDF 加载函数，消除了闭包对整份传入 PDF 字节的保留；405 MB 文件的单轮渲染后 PSS 从约 2000 MiB 降到 1621 MiB。

## 画质检查

先执行独立像素验证，再执行性能测试，避免计时期间读回 Canvas 改变绘制后端。共 97 个场景：53 个 Canvas 快速路径、44 个原生回退。测试覆盖真实扫描的第 2、22、43 页、书籍和矢量图集，以及合成的细字、细线、色块、裁剪、镜像、旋转、插值、批注和蒙版。

真实扫描与 PDF.js 同尺寸输出比较：任一通道差超过 16 的像素比例最大 **0.000508%**，平均通道绝对误差最大 **0.1163 / 255**，低于设定的 0.1% 和 0.5 上限。回退场景与优化前 PDFium 的像素/PNG 哈希完全相等。19 组相邻分块重叠检查的最大通道误差为 14、最大平均误差为 0.00883，低于 16 和 0.05 上限；没有宣称接缝逐字节一致。

饱和色合成 JPEG 与 PDF.js 的色度重建存在差异，因此另设 RGB 边缘容差，并要求源分辨率输出与原生 PDFium 完全一致、亮度 RMSE 小于 1、没有亮度差超过 16 的像素。实际合成扫描最大严重 RGB 差异比例为 1.1993%，最大平均通道误差为 0.5126，最大亮度 RMSE 为 0.6628。真实扫描仍使用更严格的默认阈值，没有套用放宽的合成色度容差。

画质证据分两阶段保存：`b5eeee7` 的完整参考验证通过后，最终缓存策略版本 `b198b95` 的 97 个输出与已验收输出逐像素/哈希完全相同；`2cdb6d5` 仅调整 Worker 中回调的作用域，SDK 渲染代码与 `b198b95` 相同。每个捕获点均记录 `nativeDocuments = peakNativeDocuments = 1`，且缓存保留量、工作峰值通过预算断言。这是所列样本的验证，不是所有 PDF 页面或浏览器的完备证明。

## 测量方法

Linux ARM64、4 核 Cortex-A76、约 8 GiB RAM、Chromium 148，`--disable-gpu`；浏览器报告 Canvas 和光栅化走软件路径。各版本每轮独立浏览器进程，三轮轮换顺序，没有并行构建、测试或其他性能测试。

三份固定 PDF：288 页 Raspberry Pi 书籍（32,268,253 字节）、1000 页公开 INDOT 工程图集（245,660,530 字节）、43 页扫描工程图纸（405,260,653 字节）。文件哈希、抽样页、版本和环境记录在证据目录。私人图纸及其 PNG 不进入仓库。

服务层测试使用完全相同的 `corpus-entry.ts` 和生产 Worker：打开、1600 px 首帧、完整模型解析、三页冷/热绘制、3200 px 整页缩放、6400 px 页面下四个 1024² 分块、旋转分块和原生批注 PNG。这里的冷页指当前会话尚未绘制该页，不代表操作系统磁盘缓存为空；热页仍受 LRU 策略影响。计时包括 Worker RPC 和动画帧确认，不等于物理屏幕扫描输出时间。

本轮使用 `PDF_BENCH_RENDER_ONLY=1`，关闭前不执行整份大文件合并、下载或 PDF 保存，因此峰值仅代表这个渲染流程。输入文件和 donor 字节仍按共同测试规则预载；不能把本轮峰值与历史完整导入/导出流程的峰值直接比较。实际 UI 和离线 PWA 的导入/保存功能另测。

内存是每 50 ms 采样 Chromium 进程树的 PSS，保留值在主线程和 Worker 显式 GC 后测量；峰值可能漏掉更短的尖峰。256 MiB 是托管缓存预算，384 MiB 是托管工作预算，均不是浏览器进程总内存上限。解码器内部、目标画布、浏览器、PDF 字节和 WASM 空间仍占用额外内存。

## 三轮服务层结果

27 / 27 个会话完成，无失败。下列为三轮中位数，单位 ms；页冷/热值先在每轮的三个抽样页中取中位数，原始范围保存在 [summary.json](pdfium-scan-canvas/summary.json)。

405 MB 扫描工程图纸：

| 任务           | PDF.js + pdf-lib | 优化前 PDFium | Canvas 扫描版 |
| -------------- | ---------------: | ------------: | ------------: |
| 打开＋首帧     |           2023.9 |        1954.4 |        1547.8 |
| 1600 px 冷整页 |            874.7 |        1124.9 |         638.8 |
| 1600 px 热整页 |            137.1 |         260.9 |          11.2 |
| 3200 px 冷缩放 |            455.7 |        1385.4 |         696.1 |
| 3200 px 热缩放 |            168.7 |         457.3 |         178.8 |
| 四个分块合计   |             40.8 |         102.3 |          56.0 |
| 原生批注 PNG   |            801.4 |         409.4 |        1228.4 |

扫描页的打开、冷/热整页和分块相对优化前 PDFium 都改善，但尚未全面超过 PDF.js：冷缩放和四块合计仍较慢，热缩放接近。PNG 包含原生批注，继续用原生栅格器；它无法直接复用浏览器解码缓存，触发额外解码，本次从 409.4 ms 增至 1228.4 ms。该回退保证批注外观，性能回退仍存在，不能把正文的热缓存收益推广到 PNG 导出。PDF 文件保存是另一个流程，没有在此表计时。

书籍与矢量图集仍走原生路径。三轮样本中的小幅差异不能证明稳定提速；书籍热页、分块仍明显慢于 PDF.js：

| 文件          | 版本             | 打开＋首帧 | 冷整页 | 热整页 | 四块合计 |
| ------------- | ---------------- | ---------: | -----: | -----: | -------: |
| 288 页书籍    | PDF.js + pdf-lib |     1725.1 |   84.5 |   21.0 |     41.8 |
| 288 页书籍    | 优化前 PDFium    |     1067.2 |   79.3 |   55.5 |    175.5 |
| 288 页书籍    | Canvas 扫描版    |     1074.5 |   88.6 |   55.3 |    175.4 |
| 1000 页 INDOT | PDF.js + pdf-lib |     1805.5 |  124.7 |   23.2 |     35.8 |
| 1000 页 INDOT | 优化前 PDFium    |     1130.8 |   64.1 |   40.2 |     39.5 |
| 1000 页 INDOT | Canvas 扫描版    |     1091.4 |   60.2 |   40.0 |     43.9 |

内存单位为 **MiB**。下面的“保留 / 峰值”分别是渲染流程结束并 GC 后的 PSS，以及流程中采样的 PSS 峰值；三轮分别取中位数。

| 文件            | PDF.js + pdf-lib |   优化前 PDFium |   Canvas 扫描版 |
| --------------- | ---------------: | --------------: | --------------: |
| 288 页书籍      |   969.4 / 1036.4 |   855.9 / 896.5 |   855.0 / 898.8 |
| 1000 页 INDOT   |  1453.1 / 1579.3 |  989.5 / 1424.2 |  988.8 / 1425.3 |
| 405 MB 扫描图纸 |  2909.5 / 3021.4 | 1584.3 / 2167.3 | 1611.5 / 2433.7 |

扫描页保留内存比 PDF.js 低约 44.6%，但比纯 PDFium 高约 1.7%，峰值高约 12.3%。这体现了浏览器 RGBA 解码图和临时缩放空间的成本；缓存上限并不意味着全部进程内存下降。首帧后的扫描 PSS 为 2230.5 / 1450.5 / 1332.1 MiB（顺序同表）。关闭后候选版本 Worker 数量归零，PSS 中位数 436.1 MiB；浏览器本身及其分配器仍可保留空间。

全部样本的浏览器进程 swap 为 0，但整个测试期间宿主机有 8075 页换入和 21363 页换出，其他进程及宿主调度仍可能造成波动。原始记录保留温度、负载、swap、基线内存、每阶段峰值及三轮范围；这些是描述性结果，没有做统计显著性检验。

## 正常界面与功能回归

正常生产 UI 共 18 / 18 个会话完成（三版本 × 两文件 × 三轮），无页面脚本异常。保留正常缩略图任务，在 1440 × 1000、DPR 1 的窗口打开文件，再发送三次同页重绘，扫描图纸另外点击一次放大。以下是三轮中位数，单位 ms。首帧取 drop 到第一个成功 Canvas RPC 完成的时间，不依赖部分旧版本缺失的性能标记。重绘值包括后台任务竞争和 RPC 排队，不能当作隔离栅格器的绘制时间。

| 文件        | 版本             | 界面首帧 | 同页重绘 | 点击放大至首块完成 |
| ----------- | ---------------- | -------: | -------: | -----------------: |
| 405 MB 扫描 | PDF.js + pdf-lib |   2929.9 |   1756.9 |              443.2 |
| 405 MB 扫描 | 优化前 PDFium    |   3110.7 |    499.5 |              434.2 |
| 405 MB 扫描 | Canvas 扫描版    |   2475.7 |    252.1 |              422.0 |
| 288 页书籍  | PDF.js + pdf-lib |   3420.8 |   1656.5 |                  — |
| 288 页书籍  | 优化前 PDFium    |   2549.4 |     95.1 |                  — |
| 288 页书籍  | Canvas 扫描版    |   2673.6 |     82.7 |                  — |

实际扫描界面首次正文画布为 4493 × 3194，放大后使用最大 2048² 的分块，与服务层 1600 px / 1024² 的测试不同。这些较大输出超过 8 MiB，不保留输出位图；它们仍复用解码源图，避免缓存输出块挤掉整张源图后反复解码。因此不能用服务层 11.2 ms 的小整页热绘制数字描述实际界面的所有缩放。

UI 的扫描页进程 PSS 中位数分别为 3415.1 / 2395.5 / 2302.1 MiB（PDF.js / 优化前 PDFium / Canvas）；此处在缩放后读取，没有强制 GC，也没有采样峰值，与上一节的渲染流程内存是不同指标。原方案的重绘延迟包含其后台缩略图队列，本次未单独归因这些时间。

生产 Worker 的三轮抢占/取消检查全部通过：前台分块先于后台预览完成，取消请求恰好返回一次 `false`，随后可以重新渲染；卸载后不能再取得文档。前台响应中位数从 44.5 ms 降至 20.9 ms。纯元数据保存前后 Canvas 缓存统计完全一致，保存后重绘从 24.0 ms 降至 4.7 ms。

**取消响应存在回退**：本次在浏览器 JPEG 解码进行中取消，要等 `createImageBitmap` 完成后才能在检查点返回；中位数 446.0 ms（范围 436.7–524.7），原生版本为 46.3 ms。迟到位图会关闭，不发布已取消帧，但这不是可中断的浏览器解码器，不能承诺 8 ms 内响应取消。

离线生产 PWA 完成表单编辑、插入空白页、撤销/重做、导入和保存；独立重开导出文件为 8 页、3 个字段，编辑值 `Bob` 正确。活动 Worker 为 1，关闭后为 0；无页面脚本异常或检查时可见的坏图。仍记录一次已撤销 Blob 缩略图的 `ERR_FILE_NOT_FOUND`，对优化前的同一生产构建复测也得到相同警告。本轮没有修复这个原有缩略图生命周期问题，也没有将其写成“所有资源请求成功”。

## 验证与复现

应用测试 99 个文件、787 项通过；SDK 测试 6 个文件、43 项通过。ESLint、应用与网站 TypeScript 检查、Web 生产构建和 Tauri 前端构建通过。Tauri 原生程序和 Windows/GPU 实机尚未验证，不能把此处 CPU 浏览器结果当作这些设备的性能承诺。

运行方式见 [benchmark README](../../scripts/pdf-benchmark/README.md)。核心命令：

```sh
# 每个版本使用同一入口单独构建；路径见 manifest。
node scripts/pdf-benchmark/build.mjs CHECKOUT BUILD corpus-entry.ts
node scripts/pdf-benchmark/scan-fixtures.mjs packages/pdfium SYNTHETIC.pdf
node scripts/pdf-benchmark/scan-validate.mjs QUALITY_MANIFEST QUALITY_OUTPUT

# 先完成画质验证，再在空闲机器上计时；始终使用新的输出目录。
PDF_BENCH_RENDER_ONLY=1 node scripts/pdf-benchmark/corpus.mjs MANIFEST OUTPUT 3
node scripts/pdf-benchmark/corpus-summary.mjs OUTPUT/results.json SUMMARY.json
node scripts/pdf-benchmark/reader-ui.mjs BEFORE_APP AFTER_APP SCAN.pdf BOOK.pdf UI.json 3 PDFJS_APP
node scripts/pdf-benchmark/preemption.mjs BEFORE_APP AFTER_APP SCAN.pdf PREEMPTION.json 3
node scripts/pdf-benchmark/ui.mjs APP_URL DONOR.pdf PWA_OUTPUT
```

这些手动脚本需要 Node、Playwright、Chromium；像素验证还需 pngjs。本次自动化依赖安装在仓库外，通过 `NODE_PATH` 指定。原始 JSON 中的本机临时路径用于记录来源，复现时需替换为自己的绝对路径。

- [固定版本、文件哈希和检查记录](pdfium-scan-canvas/provenance.json)、[性能 manifest](pdfium-scan-canvas/manifest.json)
- [27 个服务层会话原始数据](pdfium-scan-canvas/results.json)、[中位数与范围](pdfium-scan-canvas/summary.json)
- [97 场景参考画质 manifest](pdfium-scan-canvas/quality-reference-manifest.json)、[捕获记录](pdfium-scan-canvas/quality-reference-renders.json)、[像素比较](pdfium-scan-canvas/quality-reference-comparisons.json)、[接缝](pdfium-scan-canvas/quality-reference-seams.json)
- [最终缓存画质 manifest](pdfium-scan-canvas/quality-current-manifest.json)、[捕获记录](pdfium-scan-canvas/quality-current-renders.json)、[与验收输出完全相等的比较](pdfium-scan-canvas/quality-current-comparisons.json)、[接缝](pdfium-scan-canvas/quality-current-seams.json)
- [18 个正常 UI 会话](pdfium-scan-canvas/reader-ui.json)、[UI 中位数与范围](pdfium-scan-canvas/reader-ui-summary.json)
- [抢占、取消与元数据保存记录](pdfium-scan-canvas/preemption.json)、[响应时间汇总](pdfium-scan-canvas/preemption-summary.json)
- [离线 PWA 回归](pdfium-scan-canvas/pwa.json)、[优化前 PWA 对照](pdfium-scan-canvas/pwa-before.json)
- [修复输入字节保留前的诊断汇总](pdfium-scan-canvas/before-byte-release-summary.json)、[修复后的单轮内存诊断](pdfium-scan-canvas/byte-release-probe.json)，两者仅用于定位问题；正式三轮比较以 `results.json` 为准。
