# Legir

Legir is a local-first PDF workspace for reading, navigating, annotating, and editing PDF forms.

It is built for practical document work rather than generic file preview. You can open local PDFs, mark them up, fill or create form controls, and export the result back to PDF. Optional AI-assisted features can help with document understanding, but the core experience remains a fast client-side PDF editor.

## What You Can Do

- Read and navigate PDFs in a focused workspace
- Add annotations such as highlight, ink, comment, free text, and shapes
- Create and edit form controls such as text, checkbox, radio, dropdown, and signature
- Reopen recent files and restore the last editor UI state
- Run in the browser or as a Tauri desktop app
- Keep the main workflow local-first

## Available As

- Browser app for local PDF work
- Tauri desktop app for a native local workflow
- Separate `www` landing site for marketing / public entry

## Typical Use Cases

- Review a PDF and leave visual markup
- Fill or design interactive PDF forms
- Reopen in-progress document work quickly
- Use a desktop-style local workflow without sending files to a server

## Quick Start

```bash
bun install
bun run dev
```

Desktop: `bun run dev:app`  
Landing site: `bun run dev:www`

To build native installers, run `bun run build:app --ci -- --locked` after installing the platform prerequisites. Rust is pinned in `rust-toolchain.toml` and does not require nightly. See [Desktop builds and releases](docs/DESKTOP_RELEASE.md) for OS-specific commands, signing requirements, and the tag-driven release pipeline.

## PDF Engine

This branch uses the independent [@legir/pdfium package](packages/pdfium/README.md)
for rendering, parsing and editing. The saved MuPDF implementation is on
`engine/mupdf` as a historical snapshot. Active development and comparisons use
`engine/pdfium` (PDFium) and `engine/pdfjs` (PDF.js + pdf-lib). Shared document
correctness fixes must be applied to both active branches before comparing
performance; MuPDF is not part of the current benchmark matrix.

The compiled WASM, loader and license notices are included. Normal `dev`, `build`
and `test` commands validate the assets and build the package's TypeScript API.
Use `bun run build:native:pdfium` to rebuild the pinned native sources, and
`bun run test:pdfium` for the standalone library tests.

Ongoing performance work compares the two active branches with the
[real-file benchmark](scripts/pdf-benchmark/README.md). Historical reports can be
retrieved using the [archive instructions](scripts/pdf-benchmark/ARCHIVE.md#historical-reports);
new measurement outputs stay outside version control. See the
[current architecture review](docs/PDFIUM_REVIEW.md) and [test map](tests/README.md)
for ownership boundaries, remaining maintenance work and validation commands.

## Deployment

Deploy the repository root as the app project at `https://legir.app`, and deploy `www/` as a separate Vercel project at `https://www.legir.app` with `Root Directory = www`. Bind each domain to its project's production deployment without a redirect between the two domains.

The landing project shares source files and assets with the repository root, so enable **Include source files outside of the Root Directory in the Build Step** in its Vercel settings.

Keep the landing project's Build Command as `bun run build` and Output Directory as `dist`. Its build first verifies the bundled PDFium assets and generates the SDK's JavaScript and type declarations, which the shared source requires during typechecking. This works on a fresh checkout without a previous application build or cached `packages/pdfium/dist` directory; rebuilding the native WASM is not required.

The landing site's app links default to `https://legir.app`, including on preview deployments. Local development uses `http://localhost:5173`. To explicitly configure the destination, set `VITE_APP_URL` in the landing project's environment:

```bash
VITE_APP_URL=https://legir.app
```

This optional override takes precedence over both defaults and is applied at build time; redeploy the landing site after changing it.

The landing page's download section reads the latest stable GitHub Release and links directly to its actual installers. Before the first release, it shows an explicit preparation notice instead of broken download links.

## For Contributors

For the internal architecture and module layout, see:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## License

This project is licensed under the GNU Affero General Public License v3.0 or later.
See [LICENSE](LICENSE).
