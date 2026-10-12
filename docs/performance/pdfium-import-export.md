# PDFium import/export optimization

On the 60-page image import, median end-to-end import fell from **1777.9 to
1049.2 ms (41.0%)**, and merged export fell from **567.4 to 190.0 ms (66.5%)**.
Exporting the 60-page image document directly improved from **298.2 to 255.2 ms
(14.4%)**. Small form exports remain essentially unchanged. These are results
for the fixtures and host below, not a general guarantee that one C++ engine
will outperform another.

The baseline is PDFium commit `cda31118acc0a7fca3ff88d7042d8cc596b6b8cc` on
`engine/pdfium`. The optimized implementation and rebuilt WASM remain on that
branch; `engine/mupdf` is unchanged. This is a fresh PDFium before/after
comparison. The historical [MuPDF comparison](pdfium-migration.md) was not rerun
and is not a concurrent timing reference.

## What changed

An instrumented baseline run located the large import's owner-worker cost in
60 whole-page-tree rewrites (about 1026 ms inclusive) and JS object grafting
(about 517 ms inclusive). These diagnostic timings include instrumentation
overhead and overlap; the comparison below uses ordinary production builds.

- The standalone library now grafts object graphs in C++, remapping shared
  references and cycles without moving encoded stream bodies through JS.
  Portable copying between separate WASM instances remains supported.
- Page insertion/removal is batched. Inherited attributes and parent links are
  updated in one native operation instead of rewriting the tree per page.
- Legir's export copy groups use native grafting inside the existing document.
  The layout layer still rebuilds AcroForm/widget relationships, resource names,
  annotations and page destinations. Imports copy reachable source objects and
  obtain their reference map directly from the graft.
- Native type queries and dictionary name keys avoid repeated temporary
  string buffers and resolve/drop calls in the editing facade.
- The native writer reserves space based on reachable encoded streams, bounded
  at 64 MiB initially, avoiding repeated full-output reallocations. It still
  writes a complete PDF with the same reachable-object and encryption policy.

The owner worker still retains one native PDF document. Donors open temporarily
during import and close immediately; the import preview has its own worker
until it closes. No extra persistent parser or PDF instance was introduced.

## Method and timings

Raspberry Pi 5 Model B Rev 1.1, 8 GiB RAM, Linux ARM64, headless Chromium
148.0.7778.167, Node 24.18.0, Bun 1.4.2. Three fresh-browser samples per fixture
and version, alternating order before/after, after/before, before/after. Builds
and automated tests finished before timing. Native pins, exact source/bundle
hashes and validation results are in [provenance](pdfium-import-export/provenance.json).

The same hashed fixtures from the migration run were reused: 12-page forms,
60-page distinct noise images (47,260,228 bytes), and a four-page donor. Import
includes preview startup/parsing followed by registering the donor in the owner
worker. Rendering includes PNG encoding and worker RPC at 1.5 scale. Values are
medians in milliseconds; all samples and ranges are retained.

| Fixture                | Version |  Open | First PNG | Hydrate | Warm PNG | Export | Import | Merged export |
| ---------------------- | ------- | ----: | --------: | ------: | -------: | -----: | -----: | ------------: |
| Forms + 4-page donor   | Before  | 413.2 |      78.6 |    47.5 |     24.8 |  126.7 |  631.4 |          80.5 |
| Forms + 4-page donor   | After   | 417.7 |      73.2 |    41.0 |     26.9 |  122.5 |  488.2 |          81.3 |
| Images + 4-page donor  | Before  | 535.5 |      92.3 |   136.8 |     59.5 |  298.2 |  675.8 |         290.7 |
| Images + 4-page donor  | After   | 541.5 |      92.3 |    95.7 |     59.7 |  255.2 |  592.5 |         217.5 |
| Forms + 60-page images | Before  | 437.5 |      76.0 |    48.4 |     26.3 |  123.3 | 1777.9 |         567.4 |
| Forms + 60-page images | After   | 422.2 |      74.7 |    43.0 |     24.8 |  116.4 | 1049.2 |         190.0 |

Import's two stages show why the total does not fall as far as grafting alone:

| Fixture                | Preview before → after | Owner registration before → after |
| ---------------------- | ---------------------: | --------------------------------: |
| Forms + donor          |          517.1 → 471.6 |                      119.3 → 14.1 |
| Images + donor         |          581.6 → 582.6 |                        95.6 → 9.9 |
| Forms + 60-page images |          869.8 → 764.0 |                     902.1 → 285.2 |

Owner registration includes message transfer and donor loading, not just the
native copy. Stage medians need not sum to the median total. Preview startup and
parsing now dominate import; small-file saving and rendering remain within the
variation seen in these three samples. No claim about scrolling, OS file
pickers, other document families or Tauri WebView timings is made.

## Memory

PSS is summed over Chromium's processes and sampled every 50 ms. The baseline
already contains fixture bytes. Peak deltas are the maximum sampled increase
over each run's baseline; reserved WASM capacity is not live allocations or PSS.
Absolute totals and per-phase retained samples are available in the raw data.

| Fixture                | Peak PSS delta before → after, MiB | WASM capacity before close, MiB | After-close PSS delta, MiB |
| ---------------------- | ---------------------------------: | ------------------------------: | -------------------------: |
| Forms + donor          |                      297.1 → 285.5 |                     16.0 → 16.0 |                55.4 → 54.3 |
| Images + donor         |                      639.8 → 569.5 |                   224.5 → 143.5 |                13.1 → 13.7 |
| Forms + 60-page images |                      573.6 → 541.2 |                   236.9 → 187.8 |                18.9 → 13.3 |

The image case's sampled peak PSS delta falls 11.0%; its WASM capacity falls
36.1%. Browser/module caches can remain after closure, so after-close deltas
are not a leak measurement. Shorter spikes can escape the sampling interval.

## Correctness and builds

- All 18 browser samples passed. Original first/warm/last rendered pixel hashes
  match exactly between versions. An independent pdf-lib reader reopened every
  export and verified page counts, field counts and values, including edits.
  Forms merge from 12 to 16 pages / 4 to 6 fields; images from 60 to 64 pages /
  20 to 22 fields; the large import from 12 to 72 pages / 4 to 24 fields.
- Application: 96 test files / 767 tests pass. Standalone library: 16 tests pass.
  Coverage includes native/portable grafts, cycles and reference aliases,
  shared encoded streams, numeric/name-byte preservation, inherited page
  attributes, copy isolation, failed-graft rollback, encrypted imports,
  repeated saves and preservation of forms, annotations and destinations.
- ESLint, application/website typechecks, Web production build and Tauri
  frontend build pass. Native Tauri runtime was not exercised.
- Production PWA offline smoke passes: Alice → Bob, insert blank page,
  undo/redo, import donor, save and reopen 8 pages / 3 fields. One live worker
  remains while editing and zero after closure. No page exceptions or visible
  broken images. The transient revoked thumbnail Blob URL failure also present
  in the migration baseline remains; see [UI evidence](pdfium-import-export/ui.json)
  and [screenshot](pdfium-import-export/ui.png).

## Reproduce

Preserve an ordinary baseline harness build before editing the checkout, then
build and compare the optimized source using the same fixture directory:

```sh
node scripts/pdf-benchmark/build.mjs /path/to/checkout /tmp/after-build
NODE_PATH=/path/to/playwright/node_modules node scripts/pdf-benchmark/compare.mjs \
  /tmp/before-build /tmp/after-build /tmp/pdf-fixtures /tmp/comparison 3
```

See the [benchmark README](../../scripts/pdf-benchmark/README.md) for fixtures,
browser dependencies, offline UI testing and opt-in profiling. Raw results:
[before](pdfium-import-export/before.json),
[after](pdfium-import-export/after.json),
[summary and ranges](pdfium-import-export/summary.json),
[comparison assertions](pdfium-import-export/comparison.json),
[fixture hashes](pdfium-import-export/fixtures.json),
[diagnostic baseline profile](pdfium-import-export/profile-before.json).
