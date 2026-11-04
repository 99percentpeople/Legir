# @legir/pdf-renderer

Reusable browser PDF worker transport and rendering runtime. The package has no
React, Zustand, Tauri or Vite imports and creates no default client or worker on
import. The host supplies the worker constructor and optional system-font reader.

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

This is a rendering/transport library, not a React viewer component. Viewport
components, interaction controls and application stores remain in Legir.

License: AGPL-3.0-or-later, retained from the extracted application code.
