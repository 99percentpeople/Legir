# PDFium migration and MuPDF comparison

> 本文记录历史版本。旧合成跑分入口已合并到 corpus 工具；复现本文请使用
> [归档脚本及对应版本](../../scripts/pdf-benchmark/ARCHIVE.md)。

Measured on 2026-10-12. The MuPDF implementation is preserved on `engine/mupdf`
at `b6790f0a43280fd1e40ebc974e79c5fbef141e88`. `engine/pdfium` uses the independent
[`@legir/pdfium` package](../../packages/pdfium/README.md), built locally from
pinned PDFium sources with Emscripten 5.0.3. Both versions retain the existing
worker queue and editor models.

PDFium's first PNG render is faster on these fixtures, and its WASM is smaller
(4.68 MiB versus 9.93 MiB). This implementation currently has slower import and
export, and higher peak browser memory. It is not a universal performance upgrade.

## Functional verification

- 765 application tests across 96 files, and 11 independent library tests pass.
  Coverage includes native object identity/rollback, page assembly, imported
  AcroForm fields, annotations, text replacement, shared Forms, CJK, encrypted
  input/output, PDF 2.0 and source geometry. A forced WASM growth test checks
  borrowed byte views; native opening transfers one input allocation into the
  document without an additional full-file copy.
- ESLint/type checks, the Web build and the Tauri frontend build pass. The
  native desktop application was not built or exercised in a platform WebView.
- The package was packed, extracted outside the repository, and used from Node
  without Legir dependencies to open a four-page PDF, extract text, render PNG,
  save and close. The native live-document count returned to zero.
- Chromium production PWA tests pass offline: open, edit `Alice` to `Bob`, insert
  a blank page, undo/redo, import four pages and save. An independent reader finds
  eight pages and three fields, including the edited value. One worker is live
  during editing, and zero after closing. [PDFium UI evidence](pdfium-migration/pdfium-ui.json)
  and [screenshot](pdfium-migration/pdfium-ui.png).
- Every performance run independently reopens original and merged exports:
  forms: 12 → 16 pages / 4 → 6 fields; images: 60 → 64 pages / 20 → 22 fields;
  large import: 12 → 72 pages / 4 → 24 fields. Edited values survive all runs.
- Visual inspection confirms matching page geometry, text, vectors, image
  placement and widget appearances. Font rasterization/stroke darkness differs;
  pixels are not expected to be identical. Compare the
  [MuPDF page](pdfium-migration/mupdf-forms.png) and
  [PDFium page](pdfium-migration/pdfium-forms.png). Both render at 900 × 1200.

Both production UI versions log one transient `ERR_FILE_NOT_FOUND` for a revoked
thumbnail Blob URL during the workflow; neither has visible broken images or
uncaught page errors at completion. The benchmark harness also logs a missing
favicon in both versions. These observations are retained in the raw records.

## Timing

Raspberry Pi 5, 8 GiB RAM, Linux ARM64, Chromium 148.0.7778.167, headless. Three
fresh-browser rounds per fixture, run sequentially without concurrent builds or
tests. MuPDF was measured first, then PDFium; order was not randomized. Values
are medians in milliseconds. Rendering uses the worker PNG API at 1.5 scale and
includes PNG encoding/RPC; it does not measure scrolling, display latency or
steady-state Canvas rendering. First render follows loading and precedes model
hydration. Import includes opening/parsing the preview plus grafting into the
owner; merged export includes the imported pages.

| Fixture                | Engine |  Open | First PNG | Warm PNG | Export | Import | Merged export |
| ---------------------- | ------ | ----: | --------: | -------: | -----: | -----: | ------------: |
| 12-page forms          | MuPDF  | 441.3 |     120.4 |     37.4 |   67.2 |  417.9 |          47.9 |
| 12-page forms          | PDFium | 402.9 |      69.5 |     24.6 |  123.7 |  576.0 |          83.0 |
| 60-page images         | MuPDF  | 508.0 |     138.6 |     58.6 |  171.2 |  384.8 |         139.8 |
| 60-page images         | PDFium | 519.0 |      90.8 |     57.4 |  295.9 |  662.4 |         313.6 |
| Forms + 60-page import | MuPDF  | 418.1 |     110.2 |     32.5 |   71.4 |  649.0 |         323.3 |
| Forms + 60-page import | PDFium | 417.1 |      68.2 |     24.3 |  125.5 | 1756.8 |         564.9 |

The 60-page fixture contains roughly 45 MiB of distinct compressed noise images.
It stresses byte ownership, not all real scans, fonts or engineering drawings.
The form fixture imports a four-page donor, as does the image fixture.

## Memory

PSS includes Chromium processes and native/WASM memory; it is not JS heap size.
The fixture bytes are already present at baseline. Values below are medians of
each run's baseline and deltas, in MiB. Hydrated means after first render and model
hydration. Peak is the largest 50 ms sample across all measured phases; short
spikes can be missed. Closing waits for download URL revocation and requests GC.

| Fixture      | Engine | Baseline PSS | Hydrated delta | Peak delta | After-close delta | WASM capacity before close |
| ------------ | ------ | -----------: | -------------: | ---------: | ----------------: | -------------------------: |
| Forms        | MuPDF  |        345.1 |          129.6 |      159.0 |              46.2 |                       22.0 |
| Forms        | PDFium |        342.5 |           64.0 |      289.9 |              55.8 |                       16.0 |
| Images       | MuPDF  |        391.1 |          128.9 |      403.4 |               4.0 |                      128.4 |
| Images       | PDFium |        388.5 |          157.7 |      637.5 |              13.6 |                      224.5 |
| Large import | MuPDF  |        391.5 |          108.6 |      385.5 |               3.0 |                      223.5 |
| Large import | PDFium |        389.2 |           64.7 |      574.1 |              66.5 |                      236.9 |

All native session measurements report one persistent document, temporarily two
while grafting a donor. The preview worker is separate and closes after import.
WASM capacity is an allocator high-water mark, not live allocations. Closing
terminates the owner worker; browser code/module caches and other retained state
can keep total process PSS above baseline. These samples do not establish a
long-running leak rate. Import/export copying and native writer cost remain
optimization targets; this comparison does not attribute CPU time to a specific
native function.

## Current scope

The engine supplies rendering, object/stream editing, transactions, form and
annotation integration, text geometry and export. The existing appearance/layout
helpers remain; their parser and writer are not used for live documents. OCR
models can use `renderOcrImage` and `pixelToPdf`; recognition and OCR layer
persistence are not implemented here.

V8 PDF actions and XFA are disabled. A partial glyph edit intersecting
`/ActualText` fails explicitly to avoid leaving stale logical text. The text API
is not a paragraph layout engine or a document-wide sanitization tool. Native
patches use internal PDFium APIs and require revalidation on upgrades. The
wrapper is BSD-3-Clause with bundled third-party notices; Legir remains AGPL.

## Reproduce and inspect

See the [benchmark instructions](../../scripts/pdf-benchmark/README.md).
Build each branch in a separate installed checkout, then run `run.mjs` for three
rounds and `visual.mjs` separately. Run `ui.mjs` against each normal production
PWA build. `bun run test:pdfium`, `bun run test`, `bun run lint`, `bun run build`
and `bun run build:web:tauri` cover the automated checks.

Raw records: [MuPDF](pdfium-migration/mupdf.json),
[PDFium](pdfium-migration/pdfium.json),
[median summary](pdfium-migration/summary.json),
[fixture hashes](pdfium-migration/fixtures.json), and
[source/build provenance](pdfium-migration/provenance.json).
Median deltas are computed per run before aggregation; do not subtract rounded
table values to reconstruct them.
