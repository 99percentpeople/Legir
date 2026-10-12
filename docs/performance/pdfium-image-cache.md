# PDFium 大型扫描图解码缓存

日期：2026-10-12。`engine/pdfium` 增加有总量上限的大图解码缓存，解决同一幅扫描图在整页、缩放和瓦片渲染时反复解码的问题。405 MB 图纸三轮阅读测试中，重复整页渲染从 1064 ms 降至 256 ms，瓦片从 485 ms 降至 25 ms。首次渲染和内存有代价；PDF.js 的重复渲染仍然更快，书籍场景也没有证明性能改善。

## 实现与边界

固定版本 PDFium 的 `CPDF_DIB::kHugeImageSize` 为 60,000,000 字节。`CPDF_PageImageCache` 对超过阈值的图片保留按行解码器，没有完整保存解码后的像素；后续渲染向前请求 JPEG 行时会重新解码。本次扫描图每幅约 9362 × 6656 RGB，完整像素约 179 MiB，反复解码占据大部分瓦片耗时。

在这个大图分支加入 `LargeImage` 包装，按首次访问保存原始解码像素。每个 WASM 模块共享一个 LRU，默认上限 256 MiB，所有页面及临时 donor 共同使用该预算。渲染期间固定正在使用的缓存，保证合成器借用的扫描行在本次渲染返回前仍有效；剩余空间不足时继续使用原来的按行解码器。同一张图片在一次渲染内只尝试填充一次，避免多图超过预算时反复解码和淘汰。

缓存随页面关闭释放；修改流、回滚和页面重建也有回归覆盖。独立库新增 `largeImageCache()` 统计和 `setLargeImageCacheLimit(bytes)`，支持 0–512 MiB，设为 0 可立即释放并禁用这部分缓存。统计中的 `decodes` 指成功填充缓存的次数，不是全部解码器调用次数。没有改变采样分辨率、平滑、颜色或裁剪条件。

这个预算只限制新增的大图像素缓存，不限制文件字节、PDFium 原有缓存、输出缓冲或 Canvas。释放缓存不保证 WASM 线性内存立即缩小。本次仍是一个 worker 持有一个长期存活的原生文档；导入时短暂打开 donor，峰值为两个，导入完成后恢复一个。

实现位于 [image_cache.cpp](../../packages/pdfium/native/image_cache.cpp)、[源码补丁](../../packages/pdfium/scripts/patch_source.py)和[原生桥接](../../packages/pdfium/native/bridge.cpp)，API 与行为见[库文档](../../packages/pdfium/README.md)。

## 版本与测量方法

| 对象             | 提交      | 用途                                                 |
| ---------------- | --------- | ---------------------------------------------------- |
| PDF.js + pdf-lib | `b55cad5` | 已修复嵌套回复导出的原版                             |
| PDFium 优化前    | `9b71345` | 相同导出修复后的原生基线                             |
| 缓存候选版       | `e6e64d5` | 三轮完整导入、导出对照                               |
| PDFium 最终版    | `902e0a5` | 增加渲染期间的扫描行保护，最终三轮阅读测试与导出复验 |

`6527c87` 为测试驱动增加仅阅读模式。PDFium 固定在 `59ea54cce0179db3269c4c58874249597ca3b118`，Emscripten 5.0.3；最终 WASM SHA-256 以 `93ee728b6b9f` 开头。完整版本和构建摘要见 [provenance.json](pdfium-image-cache/provenance.json)。原版分支未在本轮修改，MuPDF 不参与。

环境是 Raspberry Pi 5、8 GiB、Linux ARM64、Chromium 148 无头软件渲染。三份文件分别为 288 页书籍、1000 页 INDOT 工程图集、405,260,653 字节的 43 页 A0 扫描图，页码与哈希见 [fixtures.json](pdfium-image-cache/fixtures.json)。私人扫描图没有提交到仓库。

每次运行启动新浏览器，预先加载相同的主文件及 donor 字节，三轮轮换三个版本的顺序。整页长边 1600 像素，缩放 3200 像素；瓦片为 1024 × 1024，页面长边 6400 像素，另测 90° 旋转。Canvas 计时保留生产 worker 的绘制确认，像素校验在计时之外进行。整页和瓦片先取每次运行内部的中位数，再取三轮中位数；每轮、每页原值均保留。

完整流程先阅读，再修改标题保存、下载、导入整本 donor、合并保存和下载。新增的仅阅读模式在 PNG 后关闭，避免此前合并和下载阶段的分配及交换压力影响下一组阅读测试；它仍预载 donor。两种模式分开记录，不能将阅读峰值当成完整任务峰值。

本机同时承担其他开发工作。本任务自己的构建、测试及校验均与计时分开，但没有独占整台机器。较早的阅读诊断遇到另一个工作区的 Vitest，保留为 [interfered-reader-results.json](pdfium-image-cache/interfered-reader-results.json)，不用于以下表格。最终阅读期间仍有外部 Vite 服务，原版书籍某轮首次 Canvas 达到 11,086.5 ms；没有删除该样本。后半程的 [进程监测](pdfium-image-cache/competition.json)未发现所筛选的测试或编译进程，但监测不包含 Vite，也没有覆盖整轮。这些条件限制了小幅变化和书籍性能的归因。

## 最终版阅读结果

以下为最终版与两份固定基线的三轮中位数，单位 ms；27/27 次完成。完整范围在 [reader-summary.json](pdfium-image-cache/reader-summary.json)，原始数据在 [reader-results.json](pdfium-image-cache/reader-results.json)。

| 405 MB 扫描图任务      | PDF.js + pdf-lib | PDFium 优化前 | PDFium 最终版 |
| ---------------------- | ---------------: | ------------: | ------------: |
| 打开至首个 Canvas 完成 |           2279.1 |        2223.8 |        2573.1 |
| 首次 Canvas 渲染本身   |           1178.8 |        1398.3 |        1483.5 |
| 抽样页首次渲染         |            906.6 |        1048.2 |        1108.1 |
| 抽样页重复渲染         |            141.8 |        1064.0 |         255.9 |
| 重复缩放渲染           |            190.6 |        1250.1 |         438.6 |
| 瓦片                   |             10.2 |         485.0 |          25.4 |
| 旋转瓦片               |             18.8 |         525.9 |          56.1 |
| PNG                    |           1177.7 |        1179.1 |         387.9 |

相对优化前，重复整页约快 4.16 倍、重复缩放 2.85 倍、瓦片 19.1 倍、旋转瓦片 9.37 倍。三轮的重复整页范围为优化前 1030.4–1211.6 ms、最终版 253.9–323.5 ms；瓦片为 474.4–720.4 ms 和 23.8–37.8 ms，改善在三轮均出现。首次 Canvas 中位数增加约 6.1%，首次完整解码仍有成本。原版的重复整页与瓦片仍快于最终 PDFium，不能据此声称已经全面超过原实现。

| 其他文件      | 方案             | 打开至首个 Canvas | 首次 Canvas | 重复整页 | 重复缩放 | 瓦片 |
| ------------- | ---------------- | ----------------: | ----------: | -------: | -------: | ---: |
| 288 页书籍    | PDF.js + pdf-lib |            1849.4 |      1141.8 |     21.2 |     35.5 |  9.1 |
| 288 页书籍    | PDFium 优化前    |            1141.0 |       583.8 |     68.5 |    101.0 | 43.3 |
| 288 页书籍    | PDFium 最终版    |            2293.2 |       923.6 |    104.6 |    166.0 | 80.3 |
| 1000 页 INDOT | PDF.js + pdf-lib |            1738.6 |       225.3 |     25.7 |     58.6 |  8.5 |
| 1000 页 INDOT | PDFium 优化前    |            1212.3 |       107.4 |     39.8 |     63.2 |  9.2 |
| 1000 页 INDOT | PDFium 最终版    |            1170.7 |       114.9 |     39.4 |     60.4 |  8.8 |

INDOT 与优化前接近。书籍本轮中位数变慢，不能宣称无性能回退；书籍和 INDOT 的大图缓存填充数均为 0。书籍第一轮两版首个 Canvas 为 579.7/612.1 ms，后续轮次波动扩大，原版也出现上述异常长耗时。另用两个独立 WASM 模块在一个 Node 进程中交替渲染书籍四页六轮，24/24 对像素相同，但耗时有快有慢，期间又出现外部类型检查和浏览器测试。因此 [该诊断](pdfium-image-cache/paired-book.json)仅补充一致性证据，不能排除性能回归或证明外部负载是唯一原因；需在空闲主机继续定位。

## 内存与生命周期

内存为浏览器进程 PSS，50 ms 采样；下表均为三轮中位数，单位 MiB。峰值增量按每次运行减去自己的基线，再取中位数。阅读模式没有导入或下载，JSON 中通用的 `includingDownloadPeakPssMiB` 字段在此仅代表阅读峰值。

| 文件   | 方案             | 基线 PSS | 渲染后 PSS | 阅读峰值 PSS | 峰值增量 | SwapPSS 峰值 |
| ------ | ---------------- | -------: | ---------: | -----------: | -------: | -----------: |
| 书籍   | PDF.js + pdf-lib |    566.6 |      870.0 |        932.1 |    363.3 |            0 |
| 书籍   | PDFium 优化前    |    513.3 |      773.2 |        836.6 |    309.4 |            0 |
| 书籍   | PDFium 最终版    |    612.7 |      769.6 |        820.9 |    301.7 |            0 |
| INDOT  | PDF.js + pdf-lib |    678.4 |     1464.5 |       1566.5 |    882.3 |            0 |
| INDOT  | PDFium 优化前    |    613.7 |     1091.4 |       1386.3 |    770.5 |            0 |
| INDOT  | PDFium 最终版    |    614.1 |     1093.4 |       1372.7 |    769.4 |            0 |
| 扫描图 | PDF.js + pdf-lib |    832.3 |     2692.8 |       2962.7 |   2130.5 |        187.3 |
| 扫描图 | PDFium 优化前    |    773.1 |     1510.4 |       1983.2 |   1213.0 |            0 |
| 扫描图 | PDFium 最终版    |    675.6 |     1689.4 |       1888.0 |   1212.4 |            0 |

扫描图实际缓存 187,290,784 字节，约 178.6 MiB，低于 256 MiB 上限。渲染后绝对 PSS 增加约 179 MiB；由于两版基线不同，逐次计算的渲染后增量中位数为 738.5 → 1023.5 MiB。阅读峰值增量几乎相同，不能把最终版较低的绝对峰值解释为缓存降低了内存需求。阅读阶段的 WASM 容量为 665.6 → 868.7 MiB；这是内存容量而非活跃分配量。

最终版 9 次阅读、3 次完整复验都保持一个活动 worker 和一个长期原生文档，关闭后 worker 为 0；完整复验 donor 的瞬时原生文档峰值为 2。直接原生测试关闭后文档数和大图缓存均为 0。保存关闭页面缓存后字节数也为 0，但扫描图完整流程的 WASM 容量仍保留到约 1496.9 MiB。可核查 [ownership.json](pdfium-image-cache/ownership.json)及每次运行的原始内存快照。

## 导入、导出与完整性

缓存候选版做了三轮完整流程，与最终版仅阅读结果分开。下表单位秒，保留全部样本；扫描图和书籍存在交换活动，不能将这一组当成无负载下的 CPU 排名。细节与范围见 [candidate-summary.json](pdfium-image-cache/candidate-summary.json)。本轮没有新增导入或保存算法优化。

| 文件及 donor  | 方案             | 单文档保存 |  导入 | 合并保存 | 导入及合并保存 |
| ------------- | ---------------- | ---------: | ----: | -------: | -------------: |
| 书籍 + INDOT  | PDF.js + pdf-lib |      0.757 | 2.299 |    5.270 |          7.569 |
| 书籍 + INDOT  | PDFium 优化前    |      0.448 | 8.152 |    2.592 |         11.383 |
| 书籍 + INDOT  | 缓存候选版       |      0.905 | 7.758 |    3.469 |         11.227 |
| INDOT + 书籍  | PDF.js + pdf-lib |      6.436 | 1.595 |    5.108 |          6.775 |
| INDOT + 书籍  | PDFium 优化前    |      1.153 | 0.930 |    1.062 |          1.992 |
| INDOT + 书籍  | 缓存候选版       |      1.140 | 0.944 |    1.064 |          2.008 |
| 扫描图 + 书籍 | PDF.js + pdf-lib |      1.370 | 1.193 |    1.785 |          2.958 |
| 扫描图 + 书籍 | PDFium 优化前    |      0.800 | 1.775 |    1.434 |          3.209 |
| 扫描图 + 书籍 | 缓存候选版       |      1.263 | 1.700 |    2.052 |          3.752 |

候选版的书籍全流程 PSS/SwapPSS 峰值中位数为 2860.9/270.4 MiB，扫描图为 3653.9/684.8 MiB。PSS 与交换峰值不一定同时发生，不能相加，也不能仅看 PSS 宣称总内存下降。之前[导出修复基线](pdf-export-replies.md)与本轮的绝对耗时存在明显差异，旧记录原样保留。

加入扫描行保护后，最终版再跑一轮完整流程，三份源文件各导出单文档及合并文档。这组是功能复验，样本数为 1，不作为三轮性能排名：

| 最终版文件 | 单文档保存（秒） | 导入（秒） | 合并保存（秒） | 完整 PSS 峰值（MiB） | SwapPSS 峰值（MiB） |
| ---------- | ---------------: | ---------: | -------------: | -------------------: | ------------------: |
| 书籍       |            0.284 |      2.819 |          1.689 |               3032.6 |                   0 |
| INDOT      |            1.151 |      1.072 |          1.088 |               2824.2 |                   0 |
| 扫描图     |            1.818 |      2.791 |          1.289 |               3246.9 |               755.4 |

候选版 54/54 份输出通过独立校验，297/297 对抽样文字和 Poppler 像素完全一致；最终版 6/6 份输出通过，33/33 对文字和像素完全一致。检查包括所有页面几何、旋转、批注数量、链接、字段、标题，以及嵌套回复的直接父对象、状态、标志与 Popup 所属关系。没有放宽上一轮修复的校验条件。结果见 [candidate-validation.json](pdfium-image-cache/candidate-validation.json)与 [smoke-validation.json](pdfium-image-cache/smoke-validation.json)。

最终 WASM 与优化前在三个真实文件、不同页面、缩放、裁剪、旋转和缓存淘汰后重访上，42/42 组 RGBA 哈希完全一致，见 [native-before.json](pdfium-image-cache/native-before.json)及 [native-after.json](pdfium-image-cache/native-after.json)。这证明所测变换的像素相同，不代表已经逐页验证全部 PDF 特性。

## 自动化与生产 UI

最终代码通过 778 项应用测试、22 项独立库测试、完整源码 ESLint、应用和官网类型检查，以及生产构建。新增四项原生测试覆盖精确像素、跨文档预算与淘汰、禁用后回退、编辑及回滚、参数校验、多张大图交错渲染期间的像素生命周期。

正常生产 PWA 在离线模式完成表单编辑、插页、撤销/重做、donor 导入及保存，独立重开为 8 页、3 个字段，值正确。活动 worker 为 1，关闭后为 0，无页面 JS 异常或检查时可见的坏图。[UI 记录](pdfium-image-cache/ui.json)仍包含一次已经撤销的 Blob 图片请求 `ERR_FILE_NOT_FOUND`，因此没有将其表述为所有资源请求都成功。[截图](pdfium-image-cache/ui.png)已检查。这次未测试 Windows/Tauri，也没有测量实际滚动帧率。

## 复现与后续

使用 [manifest.json](pdfium-image-cache/manifest.json)中的三个固定构建与文件，按本机位置调整路径；不要覆盖旧结果目录。源文件和导出 PDF 保留在本机，没有加入仓库。

```sh
# 保存优化前 WASM；构建当前版本到新的不可变目录。
node scripts/pdf-benchmark/build.mjs /home/zach/Legir /tmp/new-pdfium-build corpus-entry.ts
PDF_BENCH_RENDER_ONLY=1 NODE_PATH=/tmp/legir-pdfium-browser-tools/node_modules node scripts/pdf-benchmark/corpus.mjs /tmp/manifest.json /tmp/new-reader-results 3
node scripts/pdf-benchmark/corpus-summary.mjs /tmp/new-reader-results/results.json /tmp/new-reader-summary.json

# 完整流程与校验顺序执行，不与上面的性能测试并行。
NODE_PATH=/tmp/legir-pdfium-browser-tools/node_modules node scripts/pdf-benchmark/corpus.mjs /tmp/manifest.json /tmp/new-complete-results 3
node scripts/pdf-benchmark/corpus-validate.mjs /tmp/manifest.json /tmp/new-complete-results/results.json /tmp/new-validation

# 相同变换的精确像素比较；这个 Node 诊断不代替浏览器性能测试。
node scripts/pdf-benchmark/native-render.mjs /tmp/before-wasm /tmp/manifest.json /tmp/native-before.json
node scripts/pdf-benchmark/native-render.mjs packages/pdfium/wasm /tmp/manifest.json /tmp/native-after.json /tmp/native-before.json
```

下一步应在空闲机器确认书籍差异，并分析缓存命中后仍存在的图像缩放、合成和 Canvas 提交开销。完整导入、下载的内存峰值及扫描图首屏仍值得单独优化；当前结果支持大图重复渲染显著提速，尚不支持所有任务都快于原方案。
