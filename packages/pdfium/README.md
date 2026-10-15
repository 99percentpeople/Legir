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
  cached pages and obtain fresh views after mutations or a rollback of mutations.
  `operationHasChanges()` reports journaled writes/new objects in the active
  transaction, so hosts can retain render pages after a read-only operation.
  A true result is conservative; it does not identify individual dirty pages.
  `operationAffectsRendering()` additionally excludes standard text/date writes
  to an existing Info dictionary. New objects and other writes still invalidate
  rendering conservatively, including shared resources and failed edits.
- `addPage`, `insertPage`, `deletePage` and `newGraftMap` provide page/object
  primitives. Form field trees, outline remapping and unique imported names
  remain responsibilities of a higher-level editor, as implemented by Legir.
  Use `insertPages`/`deletePages` to update the page tree once for a batch, or
  `setPages` to replace its entire order while retaining inherited attributes.
  Grafts within one engine run in C++, preserving shared references, cycles,
  encoded streams and numeric spelling. An explicit worklist follows indirect
  references, so long outline/reply chains do not consume the C++ call stack;
  inline container nesting still has a depth guard. Separate engines use a
  portable JS fallback. `getReferences(source)` returns the source-to-target reference map.
  The `copyWithinDocument` option clones an independent copy group inside the
  same document; `copyPages` materializes inherited attributes and omits page
  parents, avoiding traversal into unselected pages. Dispose each graft map
  after its group; never reuse it after rolling back a transaction. On a failed
  graft, discard the map and roll back the transaction.
  Parsed, immutable stream readers retain a view of the document's owned input
  allocation. Same-document grafts share these readers; cross-document grafts
  copy selected encoded streams so closing a donor cannot pin its entire input.
  Authored/decrypted vectors are copied. Subsequent writes replace a stream's
  backing storage, preserving copy independence.
- `extractText` returns text, glyph geometry, fonts and colors; `redactText`
  removes glyphs intersecting PDF-coordinate quads while retaining surrounding
  operators, original encodings, subsequent glyph positions and shared Forms.
  Ambiguous operators or edits within `/ActualText` fail without publishing a
  modified page. This is not a document-wide sanitization API.
- `saveToBuffer` writes reachable document objects. Options support unencrypted
  output or AES-256 with user/owner passwords and permission bits. Saving
  without encryption options produces unencrypted output; hosts must explicitly
  forward their intended security policy.
  New documents default to PDF 1.7; rewrites preserve the source version and
  honor a higher catalog `/Version`. Full saves derive trailer `/Size` from the
  objects actually written, including encryption dictionaries. Incremental
  saves also retain the original cross-reference range.
  The writer estimates encoded stream sizes to reserve its output buffer and
  avoid repeatedly reallocating/copying large PDFs. The initial reservation
  includes filtered stream sizes, limits the contribution from unfiltered
  streams to 64 MiB, and is capped at 512 MiB in total. It grows normally if
  required; these bounds do not limit the size of a saved PDF.
- `startSave(options)` creates a cooperative save task. Call `next()` to
  obtain an owned JS byte chunk and `done`, then yield to the event loop and
  await the destination before continuing. For Blob destinations, `nextBlob()`
  copies the current native span directly into an immutable Blob, without an
  intermediate JS byte array. Both methods consume the chunk and reuse the native
  working buffer. Always `destroy()` the task on failure or cancellation. The
  document owns outstanding tasks and closes them on destroy. Do not mutate/render
  the document during a save. Slices aim for 4 MiB or 8 ms at indirect-object
  boundaries; one large stream, graph discovery, encryption setup or the final
  cross-reference table can exceed that limit. `saveToBuffer()` remains
  synchronous and always writes a complete PDF.
- `startSave({ incremental: true })` requests a PDF revision **suffix**. Check
  `task.incremental` before writing: when true, prepend the exact immutable
  bytes originally opened by this document; when false, the chunks already form
  a complete rewritten PDF. Never prepend the previous save's output unless
  it was reopened as a new document. The suffix uses absolute byte offsets,
  a classic xref table and `/Prev`, including for xref-stream inputs. It includes
  changed indirect objects, owners of changed inline children and reachable new
  objects; unchanged referenced streams are reused from the original revision.
  New, encrypted, repaired or nonzero-generation inputs and encryption requests
  fall back to a full rewrite. Native text redaction also forces rewriting;
  rollback restores the previous save eligibility and dirty set. Other edits
  can retain old revisions, including deleted annotations, form values and
  metadata. Request a full save to discard that history. Page selection,
  flattening and any stronger sanitization policy are the host's responsibility.
  The engine does not append to a filesystem path or change its original input.

Rendering, native annotation appearances, widget dictionaries, outlines,
destinations and password verification are included. This is an engine API,
not a ready-made paragraph editor. OCR inference, OCR layer creation, UI undo,
font selection policy, signature validation and PDF JavaScript execution are
not implemented by the library. Legir supplies its existing editing UI and
appearance helpers; OCR models can consume its `renderOcrImage` result.

## Authoring views

`@legir/pdfium/authoring` is the package's own higher-level editing layer. It
provides the object/field vocabulary used by Legir, Standard-14 and caller-supplied
fontkit fonts, PNG/JPEG, vector SVG shapes/text/images, page drawing and metadata.
It is not a drop-in implementation of every API from other PDF libraries.

```ts
import { NativeEditingContext, StandardFonts } from "@legir/pdfium/authoring";
const view = new NativeEditingContext(engine, document); // Borrow the existing owner.
try {
  const font = view.document.embedStandardFont(StandardFonts.Helvetica);
  view.document.getPage(0).drawText("Edited", { font, size: 12, x: 20, y: 30 });
  await view.flush(); // Makes pending fonts/appearances visible to native render/save.
} finally {
  view.dispose(); // Releases the view, not the borrowed PDF document.
}
```

Standalone `PDFDocument.create()` / `load(bytes, {password})` own a native document;
call `destroy()` after use. `save()` is a convenience full-buffer writer; live
applications should use the owner's cooperative `startSave()` for bounded output
and cancellation. `PDFContext` only constructs values; it cannot parse or save
files independently. Native object graph copying is used whenever views share
an engine. The application retains its page-assembly policies for forms, links,
annotations/replies and source identity.

SVG vector authoring supports paths (including arcs), shapes, transforms,
text/font mapping, clipping, embedded PNG/JPEG images and transparency. Filters,
masks and gradient paints are rejected so callers can supply a raster appearance;
this is not a general browser SVG renderer. Custom fonts require a supplied
font shaper/subsetter; the package does not fetch fonts or embed a second PDF
engine. `fast-png` and `@xmldom/xmldom` are image/XML codecs only.

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

Huge images that PDFium normally leaves as lazy scanline decoders can retain
their exact decoded pixels in a module-wide LRU cache. Its default budget is
256 MiB across all open pages and documents, so repeated tiles and zooms do not
restart a large JPEG decode. Images larger than the budget use the original
lazy path. Eviction and page destruction release these pixels; changing page
contents still requires closing cached pages before obtaining fresh views.
Images used during one render remain pinned until it completes or is cancelled; additional images
use lazy decoding when the pinned images fill the budget.
Pass `imageCache: "reuse"` to `page.render` for previews: resident pixels are
reused, but cache misses use the original decoder without filling or evicting
this cache. This protects reader images without increasing the memory budget.
`engine.setLargeImageCacheLimit(bytes)` sets a 0–512 MiB budget. Lowering it
evicts unpinned images immediately; active render pins are released on completion
or cancellation, so live bytes can temporarily exceed a newly reduced budget.
Zero disables new entries. `engine.largeImageCache()` reports its decoded
pixel bytes, limit, entries, cumulative decodes and evictions. This budget does
not include PDFium's existing small-image caches, compressed inputs, render
targets or WASM arena capacity. Decoding resolution and rendering options are
unchanged.

## Cooperative and experimental Canvas rendering

`page.startRender(matrix, bounds, options)` returns a `PDFRenderTask`. Call
`task.continue(8)` until it returns `true`, yielding to the worker event loop
between calls; then `task.finish()` returns the usual owned `PDFPixmap`.
Always call `task.destroy()` in `finally`. Destroying a task cancels it without
publishing a partial image; destroying its page/document also closes it. Budget
values are cooperative checkpoints, not a hard latency limit: parsing and some
individual PDFium operations remain synchronous. A page allows one active task.
Serialize document edits; never mutate a document while one of its jobs is paused.
Large-image cache entries fill incrementally and remain pinned across yields.

`task.setBackground(opaqueRGBA)` may seed the bitmap before its first continuation.
Dimensions must match and every alpha value must be 255. Rendering with
`contents: false` then composites native annotations against that backdrop,
including Multiply and transparency groups, without rasterizing the body again.

The opt-in `createCanvasPlan(page, options)` / `drawCanvasPlan(plan, context,
matrix, bounds, { signal })` experiment exports parsed PDFium objects for browser
Canvas 2D drawing. It supports opaque RGB/gray paths and unprofiled DeviceRGB/gray
JPEGs, without first rasterizing the page in WASM. The plan owns its arrays and
can outlive the document. Commands are bounded to 16 MiB, encoded JPEGs to 64 MiB
and total image pixels to 64 Mi pixels. Decoded ImageBitmaps and staging canvases
are released after use; cancelled or failed draws preserve the destination.

`createCanvasPlan` returns `null` for unsupported pages. Callers must use the
native renderer for those pages and for failed browser decodes. Text, Forms,
shading, clipping, graphics-state resources, masks, transparency groups,
profiled/oriented JPEGs and requested annotations are deliberately excluded.
Canvas antialiasing/downsampling differ from PDFium. The general path replay
remains a feasibility API, not a replacement for PDFium's complete semantics.

`ScanCanvasRenderer` is the narrower browser scan renderer used by Legir. It
accepts only one axis-aligned (including quarter-turns/reflections), opaque,
unprofiled JPEG and requires `annotations: false` plus browser `createImageBitmap`
support. A `false` result means the
caller must render the entire page natively. Requested annotations, masks,
complex contents, budget exhaustion and browser decode failures all fall back.
Cancellation/preemption from `signal`, `checkpoint` or `yieldTask` propagates
before publishing a new frame. An abort returns promptly even when a browser
bitmap decode cannot stop; its late result is closed and never cached. Calls must be serialized with the document owner.

The renderer borrows the existing `PDFPage` to extract the image and geometry;
it never opens or owns a PDF. Give `render` a stable page `key` and call `clear`
after content/page-tree mutations or document closure. Downsampling halves each
axis until the source is at most twice the output dimension, reuses those
levels, and rounds image placement in global pixel coordinates before applying
the tile offset. Small outputs (up to 8 MiB) are cached by transform and bounds.
Larger outputs and `cacheOutput: false` draw synchronously to the destination
after asynchronous preparation/checkpoints, avoiding an output-sized copy.
`populate: false` lets previews reuse existing levels without decoding a new
page; callbacks still allow foreground work to preempt them. Rotated nearest-
neighbor magnification stays native because browser clipping can otherwise
select different source pixels for overlapping tiles.

Scale levels and tiles are materialized as ImageBitmaps before caching so Canvas
recordings cannot retain a larger input image behind a small reported surface.
Full sources stay pinned through temporary downsampling. The cache favors decoded
sources and the level needed at reading zoom over overview levels and encoded
bytes. Removing an encoded Blob leaves the decoded images usable. Retained
storage is trimmed after rendering, so a temporary level does not prematurely
evict a source needed by the next zoom or tile. Previews use temporary levels,
keep foreground images pinned and fall back if working headroom is insufficient;
they do not evict the foreground cache.

Encoded JPEG blobs, decoded bitmaps, pyramid surfaces and small output tiles
share a tiered LRU budget (default 512 MiB). This fits two approximately 62 MP
RGBA sources, subject to other cached resources. A separate working limit
(default 640 MiB) permits a source and destination to coexist during a resize.
Both limits are configurable. Bitmaps and decode reservations are charged at
four bytes per pixel; pending reservations remain charged until the promise
settles, including after an abort or `clear`. JPEGs decode directly into reusable
ImageBitmaps. `stats()` reports logical storage and cumulative counters, not
process memory. Browser decoder/GPU allocations, destination canvases, PDF bytes
and WASM capacity are outside this accounting.

`onMemoryChange` lets the host subtract managed usage from PDFium's native image
cache. Legir retains its native 256 MiB cap, reduces it as scan storage grows,
and measures browser PSS separately; the combined retained cap is 512 MiB.
`clear` closes owned bitmaps and invalidates late asynchronous results. The host
must ignore memory notifications from an owner that has been replaced.

The package is BSD-3-Clause; the surrounding Legir application keeps its own
license. See `LICENSE` and `wasm/licenses/`.
