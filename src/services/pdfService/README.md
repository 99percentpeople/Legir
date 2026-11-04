# Application PDF adapters

Portable implementation lives in `packages/pdf-core`, `packages/pdf-renderer`
and `packages/pdf-model`. Do not add reusable PDF algorithms here.

- `host.ts`: bridges application events, fonts and content-worker ownership.
- `assets.ts`: injects the versioned WASM and public font asset URLs.
- `pdfWorkerService.ts`: supplies the Vite render-worker factory and lazy client.
- `documentPipeline.ts`: compatibility facade with application host setup.
- `index.ts`: application open/export orchestration and UI font lifetimes.
- `pdfRenderer.ts` / `thumbnailRenderer.ts`: application presentation adapters.
- `pageClipboard.ts`: captures editor state before invoking PDF export.

The app imports packages; packages must never import these files. See
`packages/README.md` at the repository root for package development and tests.
