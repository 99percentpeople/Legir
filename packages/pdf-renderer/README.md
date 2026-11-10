# @legir/pdf-renderer

Reusable browser PDF worker transport and rendering runtime. The package has no
React, Zustand, Tauri or Vite imports and creates no default client or worker on
import. The host supplies the worker constructor and optional system-font reader.

Install with `bun add @legir/pdf-renderer` or `npm install @legir/pdf-renderer`.

```ts
import { PDFWorkerService } from "@legir/pdf-renderer";

const client = new PDFWorkerService({
  lazy: true,
  createWorker: () =>
    new Worker(new URL("./pdf.worker.ts", import.meta.url), {
      type: "module",
    }),
});
try {
  await client.loadDocument(pdfBytes);
  const image = await client.renderPageImage({
    pageIndex: 0,
    scale: 1,
    renderAnnotations: true,
    mimeType: "image/png",
    quality: 1,
  });
  // image.bytes contains the generated page image.
} finally {
  client.destroy();
}
```

The host worker entry imports an asset configuration module before the runtime:

```ts
// pdf.worker.ts
import "./pdf-assets";
import "@legir/pdf-renderer/worker";
```

```ts
// pdf-assets.ts
import { configurePdfHost } from "@legir/pdf-core/host";
configurePdfHost({
  moduleUrl: () => "/pdfium/pdfium.js",
  resolveAssetUrl: (path) => "/" + path,
});
```

Serve `pdfium.js`, `pdfium.wasm` and their license notices from the SDK's `wasm`
directory. The host chooses module versus classic workers and bundling policy.
Legir retains its existing Vite `?worker` adapter and inline worker chunks for
WebView compatibility. `@legir/pdf-renderer/content-worker` is the separate
short-lived content-operation entry; its request carries the SDK module URL.
Do not import either worker entry into a main thread or a Node server.

`getPdfWorkerForBytes` exposes the WeakMap owner lookup. It does not retain a
closed document; `destroy()` releases ownership and pending requests. The core
receives lookup through `configurePdfHost`, not a reverse package dependency.
The mutable owner map and thumbnail cache are private. `protocol` exposes the
typed Worker message contract; it belongs here, not in `pdf-core`.

See [the standalone Vite example](../../examples/pdf-browser/README.md) for a
complete client, asset-copy step and worker entry. It is typechecked and built
from installed tarballs by `bun run test:consumer`; set `LEGIR_BROWSER_BIN` to
add the real headless Chromium Worker/WASM smoke test.

This is a rendering/transport library, not a React viewer component. Viewport
components, interaction controls and application stores remain in Legir.

## Tests

After `bun run build:packages` at the repository root, run
`bun run --cwd packages/pdf-renderer test` (or `bun run test` inside this package).
`tests/` checks worker lifetime, canvas previews, thumbnail caching and entry-point
side effects using injected worker/canvas doubles, without application aliases.
The root `bun run test` also includes this Vitest project. These unit tests do
not replace the real browser Worker/WASM consumer check above.

License: [MIT](LICENSE). Closed-source commercial use is permitted, provided
that the copyright and license notice are retained. Dependencies retain their
own licenses, including the engine notices in `@legir/pdfium/wasm/licenses/`.
The Legir application remains AGPL-3.0-or-later.
