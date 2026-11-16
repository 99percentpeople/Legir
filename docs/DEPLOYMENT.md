# 官网、Web App 与桌面发布

| 目标         | 触发方式                                       | 发布位置                                         |
| ------------ | ---------------------------------------------- | ------------------------------------------------ |
| 官网         | `main` 上官网或共享输入变化                    | `www.legir.app`，Vercel 项目 `www-legir`         |
| Web 最新版   | `main` 提交                                    | `dev.legir.app`，独立 Vercel 项目 `legir-dev`    |
| Web 正式版   | 推送 `vX.Y.Z` tag                              | `legir.app`，Vercel 项目 `legir`                 |
| Tauri 日常版 | `main` 或 PR 的应用/桌面相关变化，也可手动构建 | Actions 的 `desktop-dev-<target>-<sha>` 免安装包 |
| Tauri 正式版 | 推送 `vX.Y.Z` tag                              | GitHub Release，五个平台的安装器和免安装包       |

PDF 库继续使用独立的 `pdf-libs-v*` tag 和版本，不随应用版本一起调整。

## Vercel 项目配置

三个项目连接同一仓库，Production Branch 均为 `main`，Node.js 24。

1. **`www-legir`**：Root Directory 为 `www`，开启 Include source files outside
   of the Root Directory。绑定 `www.legir.app`，不设置到 App 的重定向。
   安装、构建和 Ignored Build Step 使用 `www/vercel.json` 的配置。
2. **`legir-dev`**：Root Directory 留空，Framework 选 Vite，绑定
   `dev.legir.app`。在 Production 和 Preview 环境设
   `LEGIR_WEB_CHANNEL=latest`。Git 提交由根 `vercel.json` 的忽略脚本检查，
   只构建 `main`。域名应绑定这个项目的 Production，而不是另一项目的别名。
3. **`legir`**：Root Directory 留空，Framework 选 Vite，保留 `legir.app`。
   设 `LEGIR_WEB_CHANNEL=stable`。自动 Git 构建全部跳过，由 tag 工作流
   调用 Vercel CLI 构建并上传生产产物。未设置 channel 时同样跳过自动构建。

保留 Vercel 的自动系统环境变量，使忽略脚本能取得 Git 分支和提交 SHA。
在域名面板按 Vercel 提示设置 DNS；“已添加域名”不代表 DNS 已生效。
现有 `legir.app` 部署保留到下一个正式 tag 成功发布，不自动回退到旧版本。

官网按钮仍默认进入 `https://legir.app`。如需改为最新版，在官网项目设置
`VITE_APP_URL=https://dev.legir.app` 并重新部署；本配置不改变默认入口。

## GitHub Actions 凭据

在仓库 Settings → Secrets and variables → Actions 设置：

- Secret `VERCEL_TOKEN`：有权限部署正式版 Vercel 项目的 token。
- Variable `VERCEL_ORG_ID`：项目所属 Team ID。
- Variable `VERCEL_PROJECT_ID`：正式版 `legir` 的 Project ID，不能填开发或官网项目。

`web-release.yml` 使用固定版本的 Vercel CLI，拉取正式项目的 Production 配置，
对 tag 执行一次 `vercel build --prod`，再 `deploy --prebuilt --prod`，
不会在 Vercel 服务器上再构建一次。版本/tag 验证失败时不会部署。
项目安装命令只安装应用依赖。不要将 AI 服务密钥放入构建环境。

## 官网跳过构建的边界

`scripts/check-www-changes.mjs` 不需要安装依赖。Vercel 在安装前比较上一次成功
部署的 `VERCEL_GIT_PREVIOUS_SHA` 与当前提交；Actions 的 `changes` job
比较本次 push/PR 的范围，只在需要时启动两个安装/构建验证任务。
浅克隆缺少旧提交时会先获取该提交；首次部署或历史无法获取时，保守地执行构建。
手动 Actions 构建总会运行。

`config/www-build-inputs.json` 是两处共用的范围：官网源代码、公共资源、模型库、
共享 UI/样式/翻译以及构建配置。应用业务逻辑、PDFium 和 Rust 改动不触发官网构建。
公共 lockfile/根 manifest 的变化仍保守触发，以避免共享依赖变化漏发。
`tests/www/buildBoundary.test.ts` 检查官网的实际 TypeScript 依赖，新增共享导入时
必须同步范围。官网发布新的桌面下载链接通过 GitHub Releases API 获取，不需重建。

## Tauri 日常版与正式版

日常版仍编译 Windows x64、Linux x64/ARM64、macOS Intel/Apple Silicon。
它是 release 模式二进制，使用 `opt-level=1`、关闭 LTO、16 个 codegen units；
Windows/Linux 跳过安装器，macOS 只制作可运行的 `.app` 后归档。产物保留 14 天，
名称包含提交 SHA，下载入口是对应 Actions run。不会覆盖 GitHub 最新正式 Release。

正式版保留体积优化参数、完整测试和五个平台安装器。两种模式分开 Rust 缓存，
Bun 缓存用于验证和构建。根测试已包含 PDFium，CI 不再重复执行一遍。
首次冷缓存和 GitHub runner 排队仍会影响耗时，具体提速需以实际 CI 为准。

## 发布正式版

更新应用的 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`
版本及对应 lockfile，提交后执行（用下一个实际版本替换示例）：

```sh
bun run check:desktop vX.Y.Z
git tag -a vX.Y.Z -m "Legir vX.Y.Z"
git push origin vX.Y.Z
```

`publish-web` 和 `publish-tauri` 各自检出该 tag、验证版本并构建发布。
两个工作流独立成功/失败，Web 不等待五个平台构建。失败可用原 tag 手动重跑；
已公开的桌面 Release 不允许覆盖，需要新版本。不要用应用 tag 发布 PDF 库。

参考：[Vercel GitHub Actions](https://vercel.com/docs/git/vercel-for-github)、
[Ignored Build Step](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand)、
[桌面包与签名说明](DESKTOP_RELEASE.md)。
