# @legir/pdfium

An independent PDFium WebAssembly engine with TypeScript bindings. It has no
React, Tauri, Legir application, MuPDF, or pdf-lib dependency. The application
owns worker scheduling; the library owns native PDF documents and resources.

Native source revisions and the Emscripten toolchain are pinned in
`native/versions.json`. The bridge extends PDFium with document object access
and reversible transactions so editing and rendering can share a document.
These extensions use internal PDFium APIs and must be checked when upgrading.

## Use from a worker or Node

```ts
import { createPDFium } from "@legir/pdfium";

const engine = await createPDFium();
const document = new engine.PDFDocument(pdfBytes);
try {
  if (document.needsPassword() && !document.authenticatePassword(password))
    throw new Error("Incorrect PDF password");
  const page = document.loadPage(0);
  try {
    const text = page.extractText(); // Glyph quads use original PDF coordinates.
    const bitmap = page.toPixmap(engine.Matrix.scale(1.5, 1.5));
    try {
      const png = bitmap.asPNG(); // Owned Uint8Array; safe to transfer.
      // Send text/png to the caller or draw bitmap.getPixels() synchronously.
    } finally {
      bitmap.destroy();
    }
  } finally {
    page.destroy();
  }
  const output = document.saveToBuffer();
  try {
    const savedBytes = output.asUint8Array().slice();
    // Transfer or persist savedBytes before releasing the native output buffer.
  } finally {
    output.destroy();
  }
} finally {
  document.destroy();
}
```

Node resolves the bundled loader relative to the installed package. For browser
bundlers, copy `wasm/` to a served asset directory and pass
`createPDFium({ moduleUrl: "/pdfium/pdfium.js" })`; keep `pdfium.wasm` beside the
loader, or supply `locateFile`. `wasmBinary` also accepts caller-provided bytes.
This package performs no worker scheduling or network requests beyond loading
its own assets. A host should serialize document jobs in one worker.

## Editing API

- `getTrailer`, `findPage`, `PDFObject.get/put/delete/push`, `readStream` and
  `writeStream` expose the native object graph without a second PDF parser.
  Plain strings in object literals are PDF **names**; use `newString` for text
  strings or `newByteString` for exact bytes.
- `beginOperation`, `endOperation` and `abandonOperation` implement one active
  transaction per document. Rollback covers edited dictionaries, arrays,
  streams, new objects and native annotation appearance generation. Release
  cached pages and obtain fresh views after mutations or rollback.
- `addPage`, `insertPage`, `deletePage` and `newGraftMap` provide page/object
  primitives. Form field trees, outline remapping and unique imported names
  remain responsibilities of a higher-level editor, as implemented by Legir.
- `extractText` returns text, glyph geometry, fonts and colors; `redactText`
  removes glyphs intersecting PDF-coordinate quads while retaining surrounding
  operators, original encodings, subsequent glyph positions and shared Forms.
  Ambiguous operators or edits within `/ActualText` fail without publishing a
  modified page. This is not a document-wide sanitization API.
- `saveToBuffer` writes reachable document objects. Options support unencrypted
  output or AES-256 with user/owner passwords and permission bits. Saving
  without encryption options produces unencrypted output; hosts must explicitly
  forward their intended security policy.

Rendering, native annotation appearances, widget dictionaries, outlines,
destinations and password verification are included. This is an engine API,
not a ready-made paragraph editor. OCR inference, OCR layer creation, UI undo,
font selection/layout, signature validation and PDF JavaScript execution are
not implemented by the library. Legir supplies its existing editing UI and
appearance helpers; OCR models can consume its `renderOcrImage` result.

## Build

```sh
bun install
bun run --cwd packages/pdfium build:native
bun run --cwd packages/pdfium build
bun run --cwd packages/pdfium test
```

The native build requires Python 3, Git, Ninja, a C/C++ host toolchain, internet
access and several GB of disk space. It downloads pinned sources and Emscripten
into an ignored cache. `python3 scripts/build.py --help` lists overrides for
existing source/toolchain checkouts. Builds use a single-threaded WASM module;
the PDF document's JavaScript actions and XFA are disabled.

The build script currently targets Linux x64/ARM64 hosts. Native dependencies
are built from pinned PDFium sources with a small reviewed patch set, then linked
with `native/bridge.cpp` and `native/text_edit.cpp`. No prebuilt third-party JS
wrapper is used. `wasm/provenance.json` records pins and SHA-256 hashes; the normal
TypeScript build rejects assets that no longer match native sources or scripts.
Changing those files requires rebuilding WASM before running the app.

`wasm/` contains the compiled module, ESM loader, provenance and third-party
license notices. Release assets must always be distributed together.

## Ownership

Keep one engine instance in a worker. Open each document once and explicitly
destroy pages, objects, buffers and the document when finished. Opening transfers
one input allocation to PDFium; it retains that allocation until document
closure without making another full-file copy. Cross-document
imports temporarily open a donor and copy its native objects into the owner.
Transactions record changes to the owner's objects; they do not parse another
copy of the PDF. WASM memory capacity may remain at its high-water mark until
the worker is terminated.

`PDFPixmap.getPixels()` and `PDFBuffer.asUint8Array()` borrow WASM memory. Copy
them before retaining/transferring, awaiting work, or making native allocations
that may grow memory. `PDFPixmap.asPNG()` returns an owned copy. Destroying a
document also closes its tracked pages/object handles; independent output
buffers and pixmaps must still be destroyed by the caller. `engine.memory()`
reports arena capacity, not resident memory or live allocation size.

The package is BSD-3-Clause; the surrounding Legir application keeps its own
license. See `LICENSE` and `wasm/licenses/`.
