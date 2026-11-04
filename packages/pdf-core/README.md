# @legir/pdf-core

PDF import/export policies and transactional document sessions, extracted from
Legir. Depends on `@legir/pdfium`, `@legir/pdf-model` and `pdf-fontkit`, not on
React, Zustand, Tauri, the application event bus or Vite.

## Headless Node example

Build the workspace packages first. After installing these packages in another
project, the same imports work without Legir's source aliases or build config.

```js
import { readFile, writeFile } from "node:fs/promises";
import { createPDFium } from "@legir/pdfium";
import { DocumentSession } from "@legir/pdf-core";

const engine = await createPDFium();
const bytes = new Uint8Array(await readFile("template.pdf"));
const session = new DocumentSession(engine, bytes);
try {
  const model = await session.parse({}, async () => undefined);
  const fields = model.fields.map((field) =>
    field.name === "project_name" ? { ...field, value: "Project 833" } : field,
  );
  const result = await session.export({
    fields,
    annotations: model.annotations,
    metadata: model.metadata,
    options: {
      preservedSourceAnnotations: model.preservedSourceAnnotations,
      flattenFormFields: true,
    },
  });
  await writeFile("completed.pdf", result);
} finally {
  session.dispose();
}
```

The example assumes a normal AcroForm text field and supported embedded/standard
fonts. It is not a general PDF sanitization or digital-signature service.
Unknown image-stamp fallback parsing can require a browser image/canvas host;
the callback above intentionally supplies no raster stamp fallback.

## Ownership and concurrency

A `DocumentSession` owns one native document. Parsing and exporting borrow an
authoring view and roll back temporary mutations to the source. Page imports may
briefly own a donor document. Dispose sessions, views, pixmaps and standalone
buffers explicitly. Serialize operations on a session: this class does not
make concurrent edits safe. Use isolated workers for parallel server jobs.

The browser renderer already provides a serial task queue. No second PDF parser
or separate editable object graph was added by the extraction.

## Host capabilities

`configurePdfHost` supplies optional integration capabilities once per JavaScript
realm: PDFium module URL, asset URL or font-asset reader, system-font provider,
font catalog, progress/password events, existing-document lookup and a content
worker factory. Do not put per-request tokens, tenant data or credentials in the
realm-scoped host configuration.

For Node, the SDK resolves its bundled WASM by default. CJK or other custom fonts
must be supplied using `customFont` on an export request or a configured
`readFontAsset` / font provider. The package does not bundle Legir's public fonts.
For browser builds, serve the SDK's WASM assets and inject their URL; do not
hard-code a Vite `BASE_URL` inside this package. A password prompt without a host
handler rejects instead of waiting indefinitely.

`PdfHydrationServices` describes only the parser's required capabilities. The
core does not depend on `PDFWorkerService` or any particular transport.

## Internal organization

- `pipeline/types.ts`: load/export-facing contracts.
- `pipeline/load.ts`: model hydration and import orchestration.
- `pipeline/loadSession.ts`: shared progress, cancellation and password session.
- `pipeline/annotations.ts`: extraction of existing PDF annotation dictionaries.
- `pipeline/export.ts`: write policy, appearance regeneration and serialization.
- `engine/`: native document sessions, editing views and content operations.
- `parsers/`, `exporters/`, `lib/`: field/annotation implementations and PDF helpers.

The root exports `DocumentSession`, host contracts and pipeline entry points.
`loadPDFInternal` is the lower-level hydration entry; normal headless callers
should use a session to avoid constructing transport-shaped adapters themselves.
The browser image/canvas-dependent helpers remain optional capabilities, not a
promise that every image-transform path runs in Node without an adapter.

License: AGPL-3.0-or-later, retained from the extracted application code.
