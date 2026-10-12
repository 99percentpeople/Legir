# PDF engine comparison

Run from an installed Legir checkout with Node, Playwright and Chromium available.
The reference run used `/usr/bin/chromium`; override with `CHROMIUM_PATH`.
The browser automation dependency is used only by this manual benchmark.

```sh
node scripts/pdf-benchmark/fixtures.mjs /tmp/pdf-fixtures
node scripts/pdf-benchmark/build.mjs /absolute/checkout /tmp/pdf-build
node scripts/pdf-benchmark/run.mjs /tmp/pdf-build /tmp/pdf-fixtures /tmp/pdf-results 3
node scripts/pdf-benchmark/visual.mjs /tmp/pdf-build /tmp/pdf-fixtures /tmp/pdf-images
node scripts/pdf-benchmark/compare.mjs /tmp/before-build /tmp/after-build /tmp/pdf-fixtures /tmp/comparison 3
# Separately serve the normal production app build (with its PWA service worker):
node scripts/pdf-benchmark/ui.mjs http://127.0.0.1:5189 /tmp/pdf-fixtures/donor.pdf /tmp/pdf-ui
```

`build.mjs` builds the common harness against the selected checkout's own source
and Vite/worker configuration, without editing that checkout. The normal
production app build is tested separately. Run variants sequentially, without
concurrent builds/tests. Each sample starts a fresh browser context/process,
preloads identical fixture bytes, and opens one document. First render precedes
model hydration, matching the app's readable-first pipeline.

Times cover worker initialization/loading, PNG rendering at 1.5 scale, hydration,
export, and importing/parsing a four-page donor. Import timing includes parsing
the source preview and registering the source with the owning worker. The
`large-import` case imports the 60-page image file into the small form file;
the other cases import the four-page donor. Merged export retains all original and imported fields. An independent pdf-lib reader
checks page counts, field counts and edited values; exported files are retained
with the raw JSON. The fixture seed and date fields are fixed; record the actual
fixture hashes because serializers may add identifiers.

Memory uses `/proc/<pid>/smaps_rollup` for the processes listed by Chromium's
`SystemInfo.getProcessInfo`. PSS avoids counting shared pages fully in every
process. RSS is also retained in JSON. This includes native/WASM memory, unlike
JS heap size. Samples are collected at 50 ms intervals; peaks can miss shorter
spikes. Retained samples follow explicit GC in the main thread and workers.
Closing samples wait for download Blob URLs to be revoked. Browser/module/cache
memory can remain after document closure; absolute totals and baseline deltas
are both useful. The harness baseline already includes fixture bytes. Native
`wasmCapacityBytes` reports reserved arena capacity, not live allocation or PSS.

The image fixture intentionally contains 60 distinct Flate-compressed noise
images (about 45 MiB). It stresses byte/object ownership without depending on
private files; it does not represent every real drawing, font, scan or PDF.
`visual.mjs` captures rendering in a separate run so image transfer/inspection
does not change the timed or memory-measured runs. The harness does not measure
UI scrolling, zoom transitions, OS file pickers or Tauri WebView performance.

`compare.mjs` runs both builds sequentially, alternating their order each round.
It retains raw timing/memory samples and exported PDFs, checks original render
pixel hashes and compares independently reopened page/field values. Use the
same pinned fixtures and idle machine for both builds.

For diagnostic builds, set `PDF_BENCH_PROFILE=1` on both `build.mjs` and `run.mjs`.
The worker-only build plugin adds native call counts/timings and inclusive
graft/page-tree/export stage timings to each phase's `profile`. This instrumentation
adds overhead and stage times overlap; never use those timings as the final
performance comparison. Ordinary builds include no profiling hooks.

`ui.mjs` installs the production PWA, switches offline, edits a text field,
inserts a blank page, undoes/redoes it, imports the four-page donor and saves.
It independently reopens the download (eight pages, three fields), checks for
visible broken images and verifies one live worker followed by zero after
closing the document. Its fixture and selectors assume the English UI.

`render.mjs` compares two already-built MuPDF variants, optionally alongside the
original PDF.js build. Preserve the previous build before changing the worker:

```sh
node scripts/pdf-benchmark/render.mjs /tmp/before-build /tmp/after-build /tmp/pdf-fixtures /tmp/render-results 3 /tmp/pdfjs-build
```

It alternates variant order across three rounds, starts fresh browsers for each
fixture/variant, warms each case twice and measures eight further renders. Cases
cover PNG output, a transferred HTML canvas at 1.5 and 3 times page size, and a
rotated tile. Pixel hashes are checked only after timing to avoid canvas readback
affecting its rendering backend during measurements. Before/after MuPDF pixels
must match, and the optimized path must allocate no intermediate RGBA copies.
The optional PDF.js build is a timing reference, not a pixel equality reference.

Scoped browser-only instrumentation measures native draw, pixel copy, Canvas
write and PNG encoding. `beforePresentation` measures the interval between worker
receipt and its request for an animation frame; the total also includes frame
scheduling and RPC. These are elapsed times, not CPU samples or display latency.
Stage medians need not add up to the median total. The renderer's rendering
quality, animation-frame acknowledgment and production code are not overridden.
