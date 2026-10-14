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
visible broken images and, for PDFium, verifies one live worker followed by zero
after closing the document. Pass `pdfjs` as the optional final argument to test
the baseline: it records that engine's initial/active/closed worker URLs without
imposing PDFium's single-owner lifecycle. Retained PDF.js workers and failed
resource requests must be reported separately from functional UI checks.
Its fixture and selectors assume the English UI.

The historical `render.mjs` compares two already-built MuPDF variants, optionally alongside the
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

## Real book and engineering drawing corpus

Use `corpus-entry.ts` for arbitrary real PDFs. The active matrix is
`engine/pdfjs` (PDF.js + pdf-lib) and `engine/pdfium`. Build the **same entry** against
both revisions, including the shared export fixes. MuPDF builds and recorded
three-engine results are historical references. No application source
is patched; this entry invokes each revision's normal services and worker RPCs.

```sh
node scripts/pdf-benchmark/build.mjs /tmp/original /tmp/build-original corpus-entry.ts
node scripts/pdf-benchmark/build.mjs /path/to/Legir /tmp/build-pdfium corpus-entry.ts
node scripts/pdf-benchmark/corpus.mjs /tmp/manifest.json /tmp/corpus-results 3
node scripts/pdf-benchmark/corpus-validate.mjs /tmp/manifest.json /tmp/corpus-results/results.json /tmp/corpus-validation
node scripts/pdf-benchmark/corpus-summary.mjs /tmp/corpus-results/results.json /tmp/corpus-summary.json
```

The manifest has `variants: [{id, build, revision}]` and
`fixtures: [{id, path, donor, samplePages, importPages?}]`. Paths are absolute; `donor` names
another fixture, and `samplePages` contains three zero-based page indexes. Select
pages containing real content, including an interior page and the last page.
See the recorded manifest in `docs/performance/pdf-engine-real-corpus/` for a
complete example, sample hashes, sources, and exact versions. Source PDFs remain
outside the repository.

Optional `importPages` selects zero-based donor pages in the requested order;
omitting it imports the entire donor. The common entry detects whether the
revision supports native import previews: newer PDFium revisions keep the donor
in the owner's worker and hydrate/graft only those pages; earlier builds use
their separate preview worker and normal source registration. The source SDK
alias always resolves inside the selected checkout, including when dependencies
are shared through a symlink. Do not compare builds made from different entries.

Each sample uses a fresh browser with local fixture bytes loaded before the
memory baseline. Three rounds rotate engine order. The tasks are: readable open;
first actual transferred canvas at 1600-pixel long edge; complete model hydration;
first and repeated renders of three selected pages at 1600 pixels; full-page
zoom at 3200 pixels; four 1024-square tiles and a rotated tile with the page's
long edge at 6400 pixels; PNG export at 1600 pixels; metadata-edit save; importing
the selected donor pages (preview hydration plus owner registration); and merged save.
Merged saves append donor controls, preserved annotations and link targets with
the same page offsets as the app's page import flow. Canvas timings retain the
production animation-frame acknowledgment and exclude PNG encoding/readback.
Canvas requests explicitly use rotation 0, with 90 for the rotated tile, even
when the source page has a different intrinsic rotation. Tile coordinates are
fixed by the manifest page dimensions and recorded in each result. The PNG
operation retains source rotation. This measures identical transforms/clips
across engines, not the application's initial page-orientation UI behavior.

PSS, RSS and process swap are sampled every 50 ms across Chromium processes.
Retained snapshots follow GC. Baseline includes both input byte arrays and any
idle workers the revision starts. Record absolute totals as well as increments.
WASM capacity is reported separately from resident memory. The entry uses the
normal `exportPDFBlob` API when available and the byte API on older revisions;
the new API's native chunking and Blob assembly are included in export time.
Download URL construction and download consumption are a separate memory phase,
excluded from export time. Byte output is wrapped directly in a Blob without
an extra full-file slice for any revision. The `exportPeakPssMiB` summary metric
is the larger peak of the two save phases, distinct from the whole-workflow peak.
Recent-file previews are excluded from these download-only tasks. Host
temperature/load/swap counters and Chromium GPU feature flags accompany every
record; CPU-only headless measurements do not predict GPU/Tauri performance.
No validation subprocesses or builds run during the measured comparison.

`io-probes.mjs BUILD FIXTURE OUTPUT [cancel|preview]` separately tests save
cancellation or saved-revision preview reuse. Cancellation repeats three times,
measures both caller rejection and worker readiness after rollback, requires one
surviving native document, compares page pixels, and retries a complete save.
Preview mode needs the synthetic donor with an editable text field. It compares
the cached preview with the independently reopened edited PDF, requires it to
differ from the original preview, then reopens the downloaded file with pdf-lib.
The verification worker is confined to the probe. These are correctness and
response-latency diagnostics, not part of the timed performance comparison.

`native-render.mjs WASM_DIR MANIFEST OUTPUT_JSON` separately records exact RGBA
hashes for three sampled pages, repeated renders, zoom, four tiles, a rotated
tile and a revisit after cache eviction. Run it against archived and current
WASM; pass the earlier output as an optional fourth argument to assert every
hash and transform matches (nonzero exit on mismatch). Cache limits and cleanup
after document closure are also asserted. Set
`PDF_IMAGE_CACHE_BYTES=0` to diagnose the native large-image cache fallback;
its byte/count/decode/eviction statistics are recorded after each render and
document closure. This direct Node run excludes canvas/RPC/presentation costs;
use `corpus.mjs` for browser performance and memory claims.

Set `PDF_RENDER_PROGRESSIVE=1` on `native-render.mjs` to exercise the resumable
native API against the same hashes. Per-render slice durations are diagnostic
measurements; the requested 8 ms budget is cooperative, not a hard maximum.

`preemption.mjs BEFORE_APP AFTER_APP DRAWING OUTPUT_JSON [ROUNDS]` runs the actual
production workers against the 43-page drawing fixture. It first warms page 1,
starts a page-21 thumbnail, then requests a foreground tile after 40 ms. It checks
that the candidate completes the foreground request before resuming the preview.
It separately cancels an active page-42 render, requires exactly one false reply,
restarts that page, releases canvases and unloads the document. Run this separately
from builds, other benchmarks and validation. It measures message response latency,
not screen scanout; tiny native slices can still contain long synchronous work.
The final stage hydrates the document, saves an edited title with all source
annotations retained, and records cache residency and redraw time after saving.

`canvas-plan.mjs PDFIUM_PACKAGE OUTPUT_JSON [PDF_FILES...]` tests the opt-in SDK
Canvas display list with paths and an unprofiled JPEG, including a tile, rotation,
cancellation, mask rejection and document cleanup. Optional real PDFs are sampled
at first/middle/last pages; unsupported pages report `supported: false` and should
use native rendering. It is a feasibility/correctness diagnostic, not a statistically
controlled speed comparison. Its 5% gross-placement-error guard is intentionally
loose; inspect the recorded pixel differences before considering a default switch.
The normal native renderer must still pass the strict hash check above.

`canvas-offscreen.mjs PDFIUM_PACKAGE MANIFEST OUTPUT_JSON [ROUNDS]` compares
cooperative native RGBA rendering, the current Canvas-plan SDK, and a diagnostic
replay with cached Path2D/ImageBitmap objects and conservative viewport culling.
All three draw in a worker into the same kind of transferred HTML canvas. The
cached replay exists only in the benchmark worker; it is not a production backend.

```sh
node scripts/pdf-benchmark/canvas-offscreen.mjs packages/pdfium /tmp/manifest.json /tmp/canvas-results.json 3
# Explicitly benchmark supported real pages from the manifest:
CANVAS_BENCH_REAL=drawing405 node scripts/pdf-benchmark/canvas-offscreen.mjs packages/pdfium /tmp/manifest.json /tmp/canvas-real-results.json 3
# Separately test high-quality minification, using a zero-based page index:
CANVAS_BENCH_REAL=drawing405 CANVAS_BENCH_PAGES=21 CANVAS_BENCH_MODES=native,cached-high node scripts/pdf-benchmark/canvas-offscreen.mjs packages/pdfium /tmp/manifest.json /tmp/canvas-quality-results.json 3
```

The default run measures deterministic 10,000-curve and 12-megapixel JPEG
fixtures, then checks the manifest's real pages with `annotations: false`, matching
the application's body rendering. Including annotations can reject a page whose
body is otherwise supported. `CANVAS_BENCH_REAL` selects comma-separated fixture
IDs and measures each listed sample page; it fails if a selected page is unsupported.
`cached-high` enables smoothing during minification and uses the browser's high
quality setting. It does not implement PDF.js's multistage downsampling. Setting
`CANVAS_BENCH_CAPTURE=1` saves private validation PNGs beside the JSON, after all
timed runs; do not commit source-document screenshots without authorization.
Each mode/page/round opens a fresh browser, worker and single PDF document, with
mode order rotated across rounds. WASM initialization, document/page loading,
command extraction and Path2D/image preparation are recorded separately. Six
draws per size include two warmups and four measured repetitions. Report the
median within each round, then the median of those three round medians; also
report the first render including preparation rather than presenting cached-only
figures as first-open performance. File fetching and synthetic fixture construction
are outside rendering time.

The software-only Chromium configuration is deliberate and recorded with GPU
feature status. `drawMs` includes the drawing calls and cooperative yields;
`responseMs` also includes a worker animation-frame acknowledgment. Neither is
physical display scanout. Pixel readback runs in separate post-timing sessions,
with channel-difference statistics against native PDFium and exact comparison
between the SDK replay and cached replay. Different browser resampling/antialiasing
may invalidate an otherwise fast candidate; these statistics are diagnostic, not
an automatic quality pass. `bitmapBytes` is logical decoded RGBA size and
`wasmCapacity` is arena capacity, not measured process memory. Every session closes
native documents and decoded bitmaps. Do not run builds/tests concurrently.

`scan-fixtures.mjs PDFIUM_PACKAGE OUTPUT_PDF` generates eleven deterministic scan
cases (fine text/lines/colors, crop origins, reflections, quarter-turns,
interpolation, annotations including a Multiply transparency group, non-scan
content and a soft mask). Set `SCAN_FIXTURE_LARGE=1` to use an 8190×5460 image,
retaining the same page geometry and fine detail pattern. Fixture bytes are
returned as base64 to avoid expanding large binary files into JSON number arrays.
`scan-validate.mjs MANIFEST OUTPUT_DIRECTORY` separately captures actual worker
canvases from the common corpus entry; it needs the manual `pngjs` dependency
alongside Playwright. A fixture can specify `reference`, `expectScan`, `exact`
and custom `tasks`; set `validate: true` only on the candidate variant. Tasks can
override `expectScan`, and a warm render followed by a `png: true` task checks
cache-backed PNG composition. With the current common entry, validation saves
actual PNG bytes and compares pixels; older entries without capture support
retain the exact decoded-pixel-hash check. The
default gate allows fewer than 0.1% pixels with any channel difference over 16
and mean absolute channel error at most 0.5 against PDF.js. Native fallback
fixtures use `exact: true` against the previous PDFium build. Overlapping tiles
must have maximum channel error at most 16 and mean channel error at most 0.05;
browser interpolation can differ by a few levels at different clip origins.
Rotated nearest-neighbor magnification, which exceeds this bound, falls back
to native rendering. Ownership and managed cache limits are asserted as well.
Inspect text/line crops before treating a numeric pass as a quality result.
For the saturated-color synthetic JPEG, PDF.js's JPEG decoder has different
chroma reconstruction from the browser/PDFium decoder. That fixture additionally
requires exact native-resolution pixels against PDFium, luminance RMSE below 1
and zero pixels with luminance error over 16 against PDF.js. Its documented RGB
edge tolerance is 2% severe pixels and mean channel error at most 0.75; the real
scan gate keeps the stricter default. This separates decoded color differences
from lost text/line detail instead of treating every RGB difference as blur.
PNGs stay outside the repository; record only JSON diagnostics for private PDFs.
Warm PNG fixtures can set `annotationReference` to the native variant and
`requireAnnotations: true` for known annotation cases. The validator separately
checks annotation influence against native body/full-page captures: for Normal
and Multiply, the change caused by switching the backdrop cannot exceed the
body-channel difference plus two levels of integer rounding. Missing/displaced
annotations fail this check. Task-specific gates allow the pure-body luminance
checks to remain strict while native annotation antialiasing is checked against
its own renderer; whole-PNG RGB gates still apply. Record `annotations.json`
alongside the body comparisons and seams. This blend envelope is specific to the
fixture's Normal/Multiply modes, not a proof for every possible PDF blend mode.
Run this quality gate before the performance comparison, in a separate process.

Validation runs **after timing** with pdf-lib and Poppler: all page dimensions,
rotations, annotation subtype counts, nested reply parents, review states/flags,
popup ownership, internal link targets, external link URIs
and form values are checked, along with the
edited title. Source/output text and 1200-pixel rasters are compared on the
selected pages, plus first/middle/last imported pages. Subpixel antialiasing is
allowed by a documented threshold (under 0.1% of pixels with a channel difference
over 16); raw errors and exact hashes are retained. This is sampled visual
validation, not a proof that every page or interactive destination is identical.
The recorded real corpus has no fillable form fields; use the synthetic form
suite above for form-editing coverage. This corpus harness does not implement
the UI's renaming of colliding imported field names, so choose donors without
those collisions.

`PDF_BENCH_CASES=book,indot`, `PDF_BENCH_VARIANTS=pdfium`, and
`PDF_BENCH_TIMEOUT_MS=180000` can scope diagnostic runs. `PDF_BENCH_CAPTURE=1`
adds screenshots; use a separate output directory and exclude these runs from
the final comparison. Existing results in an output directory are resumed by
fixture/variant/round, including failures. Use a **new directory** after changing
the harness, builds or manifest. Errors/timeouts are preserved, never silently
dropped from the summary; check sample counts before comparing medians.

`PDF_BENCH_RENDER_ONLY=1` retains the same prepare/open/hydrate/render/PNG
sequence and memory sampling, then closes without export, import or download.
Use a separate output directory to investigate render regressions without the
large allocation/swap pressure of preceding merge/download tasks. Records carry
`mode: "render-only"`; do not mix them with complete runs or treat their smaller
peak as a full-workflow memory result. Input and donor bytes are still preloaded
to keep the opening conditions identical.

For a separate import diagnosis, `corpus-diagnostic.mjs MANIFEST OUTPUT_JSON`
replays the first fixture's render/save/import path with sparse logging of worker
load messages. It stops an import after 60 seconds by default and records whether
the donor reached its owning worker. Select one fixture/variants with the same
environment variables above. This run is for locating failures, not timing:
worker responses and exceptions can vary under instrumentation, so retain both
the original timeout records and any diagnostic error rather than substituting
one for the other.

With `PDF_BENCH_PROFILE=1` on both build and diagnostic commands, the diagnostic
also captures worker call counts after opening, before import, after owner
registration and after merged export. The counters are reset between these
stages. This adds a merged save to the diagnostic; these instrumented elapsed
times are not performance comparison results. Use the ordinary corpus runner
and uninstrumented builds for reported before/after timings.
