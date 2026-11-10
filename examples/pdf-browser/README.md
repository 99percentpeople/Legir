# Standalone browser consumer

A small Vite application using the published package APIs, with no React,
Legir source aliases, application stores or Tauri. It renders the first page
of a user-selected PDF in a module Worker.

After the MIT/API-cleanup release is published:

```sh
cd examples/pdf-browser
bun install
bun run dev
# Production: bun run build
```

Select a PDF in the page. Password-protected documents are outside this minimal
example; the worker client's load options support a password when required.

- `main.ts` owns the client, UI and cleanup.
- `pdf.worker.ts` configures assets before importing the worker entry.
- `prepare-assets.mjs` copies the installed SDK's WASM directory AND notices.
- `vite.config.ts` selects ES-format workers so lazy imports can be bundled.

`bun run test:consumer` installs local tarballs outside the repository and builds
this same example. Set `LEGIR_BROWSER_BIN=chromium` (or a Chrome executable path)
to additionally exercise file selection, worker loading, WASM and raster output
in a real headless browser. This optional smoke test is not a cross-browser or
Tauri certification.

Use matching library versions. Applications using other bundlers should supply
their own Worker factory and asset-copy step, not import Legir's app adapters.
