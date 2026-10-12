# PDFium 正文缓存与后台预览调度

2026-10-12。基于 `58381a1` 优化 PDFium 分支，保持每个打开文档一个 Worker、一个长期原生 PDF 实例。本轮改善重复绘制和缩放后的瓦片响应，首次打开扫描图没有改善。原版 PDF.js 分支未修改。

## 改动

- 原生大图缓存增加 `imageCache: "reuse"`：缩略图可以使用已经解码的正文图片，未命中时按原解码器绘制，不填入或淘汰正文缓存。默认 256 MiB 预算、分辨率和渲染选项不变。
- 页面分为最多 12 个正文页面和 2 个后台页面；缩略图及文本扫描不会挤掉正文页面，转为正文时复用同一个页面对象。
- 事务增加实际写入检查。只读解析不再清空首屏缓存；发生写入的解析仍保守清空所有页面，导出后仍清空。没有尝试忽略共享资源修改。
- 正文整页/瓦片任务优先于预览任务；取得文档锁后才选择任务，避免已排队的预览绕过新到的正文请求。
- 耗时超过 50 ms 的预览，在后续不可见页面任务前留出 600–2000 ms 空闲；新出现的可见缩略图跳过这段等待。保留最终生成全部缩略图的行为，代价是后台完成时间变长。

## 实际界面对照

三轮共 18 次运行，比较优化前、优化后和原版 PDF.js + pdf-lib。使用普通生产构建，1440×1000、DPR 1、Linux ARM64 无头 Chromium 软件渲染。相同 PDF 预先读取为 Blob，再通过正常拖入流程打开；正常生成缩略图，没有在测试中屏蔽后台任务。第二轮反转版本顺序。

扫描图为 405 MB、43 页图纸，首屏 Canvas 为 4493×3194；书籍为 288 页 Raspberry Pi Beginners Guide。正文重绘使用实际页面、缩放和所属 Worker，每轮发送三次请求，间隔 1200 ms，先取轮内中位数再取三轮中位数。瓦片通过工具栏真实的 Zoom In 操作触发，测到首个瓦片成功响应，不代表全部视口完成或最终屏幕呈现。

下表单位毫秒：

| 任务                             | PDFium 优化前 | PDFium 优化后 | 原版 PDF.js |
| -------------------------------- | ------------: | ------------: | ----------: |
| 扫描图首次打开至首个 Canvas 响应 |          3753 |          4110 |        3180 |
| 扫描图同页重绘                   |          2132 |          1046 |        1082 |
| 扫描图缩放至首个瓦片响应         |          2040 |           511 |         516 |
| 书籍首次打开至首个 Canvas 响应   |          2604 |          2608 |        3459 |
| 书籍同页重绘                     |           345 |            90 |        1444 |

扫描图重绘改善约 51%，首个瓦片响应改善约 75%；书籍重绘改善约 74%。不能据此宣称所有文件/设备上 PDFium 更快。首次打开扫描图本轮约慢 10%，书籍基本持平；主机有交换活动，原始记录包含每轮 `/proc/vmstat` 与负载。没有剔除不利样本，也没有把差异全部归因于外部负载。

优化前三轮解析后的大图缓存均为 0 字节；三次重绘后各有 11 次缓存填充、9 次淘汰。优化后三轮解析后均保留首页的 186,953,728 字节，重绘后仍为 1 次填充、0 次淘汰。`decodes` 仅表示大图缓存填充次数，并非所有解码调用次数。

优化后扫描图的单次重绘仍有约 1.3–1.4 秒的请求：已经开始的同步缩略图渲染会阻塞新请求；未遇到这段阻塞的重绘约 463–470 ms。队列优先级无法中断已经执行中的原生调用，这是剩余的延迟来源。

操作后整个浏览器 PSS 快照中位数：扫描图 2499→2460 MiB，书籍 845→771 MiB；原版分别为 3332、1123 MiB。这不是峰值内存，也没有要求后台完成相同数量的缩略图，因此不能作为独立引擎内存排名。WASM 容量仍可能保持高水位。

原始数据：[界面请求记录](pdfium-foreground-cache/ui-results.json)、[汇总](pdfium-foreground-cache/summary.json)、[环境与源码摘要](pdfium-foreground-cache/provenance.json)。

## 能否由 PDFium 解析、Canvas 绘制

技术上可以扩展 PDFium 内部的 `RenderDeviceDriverIface`，把绘图操作传给 Canvas。但当前公开渲染入口输出位图，不能只改一个输出参数就得到与 PDF.js 相当的 Canvas 后端。需要实现路径/裁剪、字体及字形、图片和颜色空间，以及透明组、软遮罩、混合等行为；部分操作依赖像素回读或离屏合成，仍可能需要原生光栅回退。逐个跨 WASM/JS 边界调用也可能增加开销，不能预先保证更快。

当前桥接已经直接生成 RGBA，并在同步作用域内把 WASM 像素交给 `ImageData`/`putImageData`，没有额外的 JS 整帧 `.slice()` 或 BGRA→RGBA 循环。本次 4493×3194 整页 `putImageData` 同步调用中位数约 11 ms，范围约 10–15 ms；这不包含所有后续合成成本，但说明删掉这一调用不会解决目前数百毫秒到一秒以上的等待。

本轮未切换 Canvas 绘图后端。若继续做，适合以独立后端实现并保留完整的原生回退，先验证普通路径/图片，再覆盖复杂 PDF 特性。单实例仍可保留。另一个直接方向是接入 PDFium 的渐进渲染，使长任务能让出 Worker；现有 [官方渐进接口](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_progressive.h) 仍是位图渲染接口，并不等于 Canvas 指令输出。

## 验证与复现

- 782 项应用测试、23 项独立库测试通过；完整 ESLint、应用/官网类型检查及生产构建通过。
- 书籍、1000 页 INDOT 工程图集和扫描图的 42 组原生 RGBA 哈希与前版完全一致，覆盖重复绘制、缩放、裁剪、旋转和淘汰后重访。[像素结果](pdfium-foreground-cache/native-pixels.json)
- 扫描图另外 14 组 `imageCache: "reuse"` 回退路径哈希也完全一致，全部渲染不填充大图缓存。[预览路径结果](pdfium-foreground-cache/preview-pixels.json)
- 正常生产 PWA 离线完成表单编辑、插页、撤销重做、导入及保存重开，导出为 8 页、3 个字段，值正确。活动 Worker 为 1，关闭后为 0；无页面 JS 异常或检查时可见的坏图。记录中仍有一次被撤销 Blob 图片的 `ERR_FILE_NOT_FOUND`，没有声称所有资源请求都成功。[记录](pdfium-foreground-cache/ui-smoke.json)、[截图](pdfium-foreground-cache/ui.png)
- 未测试 Windows/Tauri 或用户实际设备；没有测量持续滚动帧率。

```sh
NODE_PATH=/path/to/playwright/node_modules node scripts/pdf-benchmark/reader-ui.mjs \
  /path/to/before-dist /path/to/after-dist /path/to/drawing.pdf /path/to/book.pdf \
  /tmp/reader-results.json 3 /path/to/pdfjs-dist

node scripts/pdf-benchmark/native-render.mjs packages/pdfium/wasm \
  docs/performance/pdfium-image-cache/manifest.json /tmp/native-pixels.json \
  docs/performance/pdfium-image-cache/native-after.json
```

调整 manifest 中的本机文件路径后再运行。测试 PDF 和导出 PDF 没有加入仓库。界面测试脚本中缩放菜单定位失败的两次试运行不计入 18 次结果；有效三轮完整结果全部保留。
