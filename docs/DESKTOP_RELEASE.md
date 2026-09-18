# Desktop builds and website downloads

## Build locally

Use Bun (CI currently pins 1.3.3) and Rust through rustup. `rust-toolchain.toml` pins Rust 1.94.0, so rustup selects the same compiler locally and in CI. Nightly is no longer required. Keep `~/.cargo/bin` on PATH on Linux/macOS; restart the terminal after installing rustup on Windows.

Install the platform prerequisites from [Tauri's prerequisites guide](https://v2.tauri.app/start/prerequisites/): Windows requires the C++ build tools and WebView2, macOS requires Xcode Command Line Tools, and Linux requires WebKitGTK 4.1 and the native development libraries.

For the Ubuntu 22.04 CI image:

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf xdg-utils libssl-dev libxdo-dev file
```

From the repository root:

```bash
bun install --frozen-lockfile
bun run check:desktop
bun run dev:app
# Or create release installers for the current machine:
bun run build:app --ci -- --locked
```

For a specific installer format on its corresponding OS:

```bash
# Windows x64 (run on Windows)
bun run build:app --target x86_64-pc-windows-msvc --bundles nsis --ci -- --locked

# macOS Apple Silicon (run on macOS with this Rust target installed)
bun run build:app --target aarch64-apple-darwin --bundles app,dmg --ci -- --locked

# macOS Intel (run on macOS with this Rust target installed)
bun run build:app --target x86_64-apple-darwin --bundles app,dmg --ci -- --locked

# Linux (native architecture)
bun run build:app --bundles deb --ci -- --locked
```

`--target` selects a Rust target; it does not install another OS's SDK. The CI matrix builds on the corresponding operating systems. Add Rust targets with `rustup target add <target>` before using them locally.

Without `--target`, bundles are written to `src-tauri/target/release/bundle/`. With it, the path is `src-tauri/target/<target>/release/bundle/`.

The platform-specific `tauri.windows.conf.json`, `tauri.linux.conf.json` and `tauri.macos.conf.json` set these same bundle targets for local builds without `--bundles`. Windows defaults to NSIS only; Linux defaults to DEB only. MSI, RPM and AppImage are not built.

### Package the no-install editions

Linux's no-install edition is the original `release/Legir` native ELF executable, copied without an archive or runtime wrapper. Stage it, or create Windows/macOS archives, with:

```bash
# Run on Windows, after the Windows build above:
bun scripts/desktop-portable.ts x86_64-pc-windows-msvc src-tauri/target/x86_64-pc-windows-msvc/release desktop-dist

# Run on Apple Silicon macOS, after the macOS build above:
bun scripts/desktop-portable.ts aarch64-apple-darwin src-tauri/target/aarch64-apple-darwin/release desktop-dist

# Run on Linux after a native build without --target (choose the matching target):
bun scripts/desktop-portable.ts x86_64-unknown-linux-gnu src-tauri/target/release desktop-dist
# For ARM64 use aarch64-unknown-linux-gnu instead.

# For Intel macOS, replace aarch64-apple-darwin with x86_64-apple-darwin.
# For builds without --target, pass src-tauri/target/release as the release directory.
```

The Windows ZIP contains `Legir.exe`, adjacent runtime DLLs when present, the configured PDF icon resource, a license and usage notes. The macOS TAR.GZ contains the **complete signed `Legir.app` bundle**, its resources, executable permissions and symbolic links, plus a license and usage notes. It is not a bare Mach-O executable. Both scripts read the checked project version rather than using a hardcoded release number.

`scripts/desktop-linux.ts` copies exactly `release/Legir` into an extensionless `Legir_<version>_linux_<x64|arm64>_portable` file. It checks the ELF64 header and machine architecture, rejects renamed AppImages, and fails if Linux configuration introduces external resources or sidecars that a single file would omit. It does not bundle GTK/WebKit or make the executable statically linked.

To collect the built native bundles alongside the no-install files for inspection:

```bash
bun scripts/desktop-release.ts stage src-tauri/target/<target>/release/bundle desktop-dist
```

Staging excludes old MSI/RPM/AppImage files even when they remain in the build directory. The CI workflow performs both steps automatically.

The build chain is:

```text
bun run build:app
  -> Tauri beforeBuildCommand
  -> bun run build:web:tauri
  -> TypeScript + Vite --mode tauri
  -> Cargo release build
  -> native bundler
```

There is no need to build the web application separately first. The desktop frontend deliberately excludes the browser PWA/service worker and the large `public/fonts` library; it uses the existing desktop font integration. PDF.js CMaps, standard fonts and WASM resources remain bundled.

### Linuxbrew linker conflicts

On a Linux machine with Homebrew's `ld` ahead of the system linker, the final link can mix system GTK/WebKit with incompatible Homebrew libraries. This was observed on the current development machine. Keep the current Node/Bun/Rust executables, but put the system tool directories before Homebrew for this build only:

```bash
NODE_BIN_DIR="$(dirname "$(command -v node)")"
PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$NODE_BIN_DIR:/usr/bin:/bin:$PATH" \
  bun run build:app --bundles deb --ci -- --locked
```

This does not change the project's compiler flags or global shell configuration. After building, stage the native executable with the command above; no second build or AppImage tooling is needed.

## Build and release workflows

`tauri-bundles.yml` is the shared build workflow. It validates versions, runs lint/type checks and tests once, then builds five native targets:

| System  | Architecture        | Installer         | No-install edition                                    |
| ------- | ------------------- | ----------------- | ----------------------------------------------------- |
| Windows | x64                 | NSIS `-setup.exe` | `_windows_x64_portable.zip`                           |
| macOS   | Intel x64           | `.dmg`            | `_macos_x64_portable.tar.gz` containing `Legir.app`   |
| macOS   | Apple Silicon ARM64 | `.dmg`            | `_macos_arm64_portable.tar.gz` containing `Legir.app` |
| Linux   | x64                 | `.deb`            | `_linux_x64_portable` (native ELF, no extension)      |
| Linux   | ARM64               | `.deb`            | `_linux_arm64_portable` (native ELF, no extension)    |

Only one installer and one no-install edition per architecture are published. MSI, RPM and AppImage are not built, staged, accepted by the publication gate or shown on the website. The historical v0.1.0 release retains its original files; v0.1.1 switches Linux no-install downloads to native ELF without rewriting previously published assets.

The Linux ARM64 job uses GitHub's public-repository ARM runner. Private repositories need an available runner with the same architecture.

`tauri-build.yml` calls that workflow for relevant branch/PR changes and manual builds. A version tag runs only the release workflow, avoiding a second full native build. Marketing-only source changes do not normally trigger native builds. CI installers are retained for 14 days; Actions artifacts are for validation, not permanent public download links.

`tauri-release.yml` runs on a pushed `v*` tag or a manual dispatch with an **existing version tag**. It checks that the tag matches all three version fields:

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `[package].version`

The native Linux distribution change uses `0.1.1`. After reviewing, committing and pushing the release changes:

```bash
bun run check:desktop v0.1.1
git tag -a v0.1.1 -m "Legir v0.1.1"
git push origin v0.1.1
```

For later releases, update all three version fields and run `bun install --lockfile-only` plus `cargo check --manifest-path src-tauri/Cargo.toml` to refresh lockfiles as needed. Commit the version and lockfile changes before tagging.

The release pipeline builds every target first. Only after all jobs succeed does it collect the five installers and five no-install packages, validate their names/versions/architecture coverage, generate `SHA256SUMS.txt`, upload everything to a draft, and publish it as the latest stable release. An incomplete build never becomes a new public release. The publication step revalidates the actual Linux ELF headers and restores execute permissions after Actions artifact download; HTTP/browser downloads still require the user to run `chmod +x` locally.

The release job checks out the requested tag in every stage, including manually dispatched builds. It refuses to overwrite a release that is already public. Failed uploads can be retried while the release is still a draft. The current website/release contract intentionally supports stable `vX.Y.Z` releases only, not beta/RC channels.

The workflow uses the built-in `GITHUB_TOKEN` with write permission only in the publish job; no personal access token is needed. It does not read or embed AI credentials.

## Website download links

The website has a `#downloads` section, linked from the header, hero and footer. The browser app remains the primary hero action.

When a supported desktop OS is detected, its card is larger and centered on wide screens, with an accent-colored installer button. It is first in the DOM and appears above the other systems on narrow screens. Other systems remain available, and every no-install download is a secondary text link rather than an equal-weight button. Phones, tablets reporting a mobile OS, ChromeOS and unrecognized clients get a neutral layout without a misleading current-system badge. OS detection never chooses a processor architecture or hides a published package.

Relevant files:

- `www/src/components/DownloadSection.tsx`, `DownloadCard.tsx` and `downloads.css`: responsive download UI.
- `www/src/content/downloads.ts`: all seven supported languages.
- `www/src/lib/downloads.ts`: release parsing, platform detection and repository URLs.
- `scripts/desktop-release.ts`: version validation, flat native-bundle staging and checksum generation. It uses the same asset parser as the website to validate the publication contract.
- `scripts/desktop-portable.ts`: shared no-install entry point, Windows ZIP and complete macOS `.app` archives.
- `scripts/desktop-linux.ts`: native Linux executable staging, architecture and file-format verification.

The website queries the public GitHub API:

```text
https://api.github.com/repos/99percentpeople/Legir/releases/latest
```

Only verified metadata for this repository's published stable releases is displayed. Actual `browser_download_url` values become download links; the website never invents versioned asset URLs. It displays version, architecture, installer/no-install labels, format and file size. Only explicitly named Linux native executables are accepted. Generic ZIPs, updater archives, arbitrary executables, MSI/RPM/AppImage and mismatched-version asset names are not shown as downloads. Linux ELF links include an accessible note about GTK/WebKit dependencies and execute permission. macOS always offers the actual available Intel and Apple Silicon builds instead of guessing the processor from the browser user agent.

With no release, the website explicitly shows that the first desktop release is being prepared. On timeout, network errors or rate limiting it shows an error with retry and a permanent GitHub Releases link. Missing platform assets are not represented by broken buttons. No GitHub token, additional backend, hardcoded release version or website redeployment is required for a new published version to be picked up on a subsequent page load (subject to GitHub/browser HTTP caching).

GitHub's anonymous API rate limits still apply. A same-origin cached release endpoint can be added later if website traffic warrants it; retain the existing failure fallback. Update the API URL and repository URL together when moving or forking the repository.

## Size, build speed and distribution constraints

The Rust release profile retains `opt-level = "s"`, LTO, one codegen unit, abort-on-panic and symbol stripping. Removing nightly-only `profile-rustflags`, `-Zthreads` and `trim-paths` makes normal rustup installations usable without sacrificing those existing size optimizations. CI remaps the checkout path using the stable `--remap-path-prefix` compiler flag. Stable-vs-nightly build time and size must be measured on equivalent builds; do not assume that changing compiler channel alone improves either.

Tauri builds the frontend directly, not through Turbo, so `TAURI_ENV_*` settings cannot accidentally reuse a web/debug frontend from a mismatched Turbo cache. Native dependencies are cached per target. Installers are already compressed, so Actions uploads skip redundant ZIP compression.

### No-install does not mean dependency-free or a portable user profile

- **Windows ZIP:** extract the whole folder and run `Legir.exe`. Microsoft Edge WebView2 Runtime must already be installed; use the EXE installer when it is missing. The ZIP does not run an installer or register shortcuts/PDF associations. Keeping the ZIP small intentionally avoids bundling a fixed WebView2 runtime.
- **Linux ELF:** download the matching native executable, grant execute permission and run it directly (commands below). There is no archive to extract, runtime wrapper or FUSE requirement. WebKitGTK 4.1, GTK 3 and a compatible glibc must already exist on the target system. CI builds on Ubuntu 22.04, but this does not promise compatibility with every Linux distribution. Use DEB through your package manager to resolve dependencies on a supported Debian-based system.
- **macOS TAR.GZ:** extract and open the complete `Legir.app`, without a package installer. Do not separate the executable from the bundle's resources, metadata or signature files. Signing/notarization restrictions apply just as for the DMG.

All no-install editions still use the application's normal per-user data locations. Settings, configured API credentials and recent-file history do **not** travel with the extracted folder. This change does not introduce a separate portable-profile mode.

For the native Linux x64 file downloaded into the current directory:

```bash
chmod +x ./Legir_0.1.1_linux_x64_portable
./Legir_0.1.1_linux_x64_portable
```

For ARM64 use `Legir_0.1.1_linux_arm64_portable` in both commands. Run as your normal user, not with `sudo`. `ldd ./Legir_0.1.1_linux_x64_portable` can inspect missing libraries on a trusted, checksum-verified download. Refer to `SHA256SUMS.txt` in the same release for file verification.

References: [WebView2 requirements](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options), [Tauri Linux dependencies and baseline](https://v2.tauri.app/distribute/debian/), [macOS application bundles](https://v2.tauri.app/distribute/macos-application-bundle/).

### Signing

The current pipeline is an **early-build distribution pipeline**, not a fully trusted/signed public distribution setup:

- macOS uses an ad-hoc `"-"` signing identity, following Tauri's guidance for Apple Silicon builds. This is not Developer ID signing or Apple notarization. Gatekeeper warnings can still occur.
- Windows signing is not configured. SmartScreen warnings can occur.
- SHA-256 checksums detect file changes; they do not substitute for publisher authentication or OS code signing.

Before a broad public launch, configure Developer ID signing/notarization and Windows code signing, smoke-test installation/opening/saving PDFs on each OS, and review Tauri capabilities/CSP. Do not disable system security globally as an installation workaround.

In-app automatic updates are not configured; this change provides website downloads only. A later updater needs its own signing key, public verification key, permissions and update metadata. Those signing secrets must remain in CI secrets, never in the website or repository.

References: [Tauri GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/), [app-size guidance](https://v2.tauri.app/concept/size/), [macOS signing](https://v2.tauri.app/distribute/sign/macos/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/).
