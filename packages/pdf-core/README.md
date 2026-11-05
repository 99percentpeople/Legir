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

## Text alignment

Text fields accept `alignment: "left" | "center" | "right"` and
`verticalAlignment: "top" | "middle" | "bottom"`. The latter places the entire
text block inside the control, including wrapped lines, explicit line breaks,
font metrics, border padding and quarter-turn rotations. Explicit vertical
alignment uses the same appearance for editable and flattened exports.

Omit `verticalAlignment` to preserve the legacy layout: single-line text is
centered vertically and multiline text starts at the top. The optional value
round-trips through `/LegirVAlign`, a Legir extension; the saved `/AP` appearance
is ordinary PDF. Other readers display it, but editing the field in a reader
that regenerates appearances without understanding this extension can reset its
vertical placement. Flatten for a fixed final layout.

```ts
const fields = model.fields.map((field) =>
  field.type === FieldType.TEXT
    ? {
        ...field,
        alignment: "center" as const,
        verticalAlignment: "middle" as const,
      }
    : field,
);
```

## List boxes and dropdowns

Choice controls share `FieldType.DROPDOWN`, but `isListBox` preserves the PDF
`/Combo` distinction independently of `isMultiSelect`. Import, export, field-type
conversion and font selection support both single- and multi-select lists.
Reordering options retains the selected values and rewrites their `/I` indexes;
clearing a list removes its selection rather than restoring an old `/V`.

## Button images and real signature fields

`FieldType.BUTTON` represents a standard AcroForm pushbutton, not a page image
or a signature. Its `buttonCaption`, `buttonLayout` (standard `/MK /TP` values
0–6) and `buttonImageFit` configure caption/icon presentation. Set `buttonImage`
to a PNG/JPEG data URL to replace the icon, `null` to clear it, or leave it
`undefined` to retain the original native icon. File data is validated before
pixel decoding (20 MiB and 32 megapixels); no external image URLs are fetched.
The shared validators live in `@legir/pdf-model/buttonImage`.

Imported `buttonIconPreview` and `sourceAppearance` are bounded native-rendered
previews, not replacement assets. A no-op save or move retains the original
appearance and icon (including vectors) and action dictionaries. The library
never executes embedded button JavaScript. Copying a control into another
source-independent document promotes the icon preview to portable PNG data;
page imports retain the native objects through the existing graft mechanism.
Button images and captions are painted into the page when fields are flattened,
rather than being deleted as unsupported buttons.

`FieldType.SIGNATURE` now creates and edits a real unsigned `/FT /Sig` field.
It has no image-upload value and does not synthesize `/V`. Custom unsigned
signature appearances survive no-op saves and moves; editing one widget does
not regenerate other widgets belonging to the same field. Import-only
`signature` metadata reports a dictionary's **presence**, not cryptographic
validity. Existing populated signature widgets/appearances are not regenerated,
and converting them to another field type is rejected. The editor also locks
such fields against direct alteration/deletion. Other document edits can still
affect signature validity; flattening removes the signature field and retains
only its appearance. Certificate signing, validation and timestamp services are
outside this library's scope.

The former `signatureData`/`imageScaleMode` image-signature model is no longer a
signature feature. Legir converts legacy image-signature clipboard payloads to
image buttons. Existing PDFs whose old image signatures were already flattened
remain ordinary page content; they cannot be recovered as cryptographic signatures.

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
