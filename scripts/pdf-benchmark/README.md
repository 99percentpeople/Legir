# PDF regression and performance tools

Run from an installed Legir checkout with Node, Playwright and Chromium available.
The reference run used `/usr/bin/chromium`; override with `CHROMIUM_PATH`.
Browser automation and independent PDF readers are manual-test dependencies only.
For automated application/SDK coverage, see [tests/README.md](../../tests/README.md).

## Maintained entry points

| Task                                                              | Tools                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| App workflow performance and PSS/RSS                              | `build.mjs`, `corpus-entry.ts`, `corpus.mjs`, `corpus-summary.mjs`       |
| Independent export structure, sampled text/pixels, content syntax | `corpus-validate.mjs`, `inspect_pdf.py`, `content-syntax.mjs`            |
| Native pixels and cache lifetime                                  | `native-render.mjs`                                                      |
| Production canvas quality and tile seams                          | `scan-fixtures.mjs`, `scan-validate.mjs`                                 |
| Reader responsiveness and foreground scheduling                   | `reader-ui.mjs`, `preemption.mjs`                                        |
| Sidebar thumbnail cache, pixels, cancellation and process memory  | `thumbnails.mjs`                                                         |
| Export cancellation and saved-preview reuse                       | `io-probes.mjs`                                                          |
| PWA, forms and authoring appearances                              | `fixtures.mjs`, `ui.mjs`, `authoring-audit.mjs`, `authoring-validate.py` |
| Opt-in diagnosis                                                  | `corpus-diagnostic.mjs`, `profile-plugin.mjs`, `canvas-plan.mjs`         |

`build.mjs` defaults to `corpus-entry.ts`. It builds the common harness against
the selected checkout's own source and Vite/worker configuration, without editing
that checkout. Use the same entry for every compared revision. Run variants
sequentially without concurrent builds/tests; validate outputs after timing.
The normal production app build is tested separately.

The retired synthetic runner, MuPDF instrumentation and benchmark-only Canvas
replay are listed in [ARCHIVE.md](ARCHIVE.md), with replacements and the Git
snapshot needed to reproduce historical reports. Formal measurements and their
provenance remain in `docs/performance`. Keep new temporary logs, PDFs, screenshots
and intermediate runs in `/tmp` or the ignored `.tmp/` directory.

## Synthetic fixtures and production PWA

```sh
bun run build:pdfium
node scripts/pdf-benchmark/fixtures.mjs /tmp/pdf-fixtures
# Separately serve the normal production app build (with its PWA service worker):
node scripts/pdf-benchmark/ui.mjs http://127.0.0.1:5189 /tmp/pdf-fixtures/donor.pdf /tmp/pdf-ui
```

The generator supplies a 12-page form file, a 60-page image file and a four-page
donor. Its fixed seed/date and distinct field names permit a synthetic corpus
manifest; still record actual file hashes because serializers can add IDs.
The image file has distinct Flate-compressed noise images (about 45 MiB); it
stresses ownership, not real-world scan quality. Use `scan-fixtures.mjs` for that.
The [form appearance regression](../../docs/PDFIUM_REVIEW.md#已修复未编辑表单的外观一致性)
demonstrates why field-value checks must also include pixels: unnecessarily setting
`NeedAppearances` made independent readers regenerate otherwise valid appearances.
The save policy now inspects retained widgets and tracks successful appearance
updates, while preserving missing/stale appearance and XFA fallbacks. Keep the
strict validator thresholds when using form fixtures.

`ui.mjs` installs the production PWA, switches offline, edits a text field and
saves it twice. PDFium must retain the exact original prefix without growing a
revision chain. It then inserts a blank page, undoes/redoes it, imports the
four-page donor and saves again.
It reopens the download with the native SDK (eight pages, three fields), checks for
visible broken images and, for PDFium, verifies one live worker followed by zero
after closing the document. Pass `pdfjs` as the optional final argument to test
the baseline: it records that engine's initial/active/closed worker URLs without
imposing PDFium's single-owner lifecycle. Retained PDF.js workers and failed
resource requests must be reported separately from functional UI checks.
Its fixture and selectors assume the English UI.

## Real book and engineering drawing corpus

Use `corpus-entry.ts` for synthetic fixtures and arbitrary real PDFs. The active matrix is
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
Every save supplies the full page structure and enables form synchronization,
matching the UI's export request. Previews and physical file writes remain
separate from this export timing. Earlier harness revisions omitted the page
structure on standalone saves; rebuild every variant with the same updated entry
before comparing these numbers.
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
`PDF_BENCH_REPEAT_SAVE=1` adds a second identical standalone save before import,
with a separate memory snapshot and retained download. This distinguishes initial
immutable-prefix Blob construction from reuse on incremental engines; all engines
run the same additional operation. Validation includes that repeated output and
records whether each file retains the exact source prefix and its appended size.
Download URL construction and download consumption are a separate memory phase,
excluded from export time. Byte output is wrapped directly in a Blob without
an extra full-file slice for any revision. The `exportPeakPssMiB` summary metric
is the largest peak of all save phases, distinct from the whole-workflow peak.
`standaloneExportPeakPssMiB` and `repeatExportPeakPssMiB` isolate the individual
saves; the standalone delta is relative to the post-render snapshot.
Recent-file previews are excluded from these download-only tasks. Host
temperature/load/swap counters and Chromium GPU feature flags accompany every
record; CPU-only headless measurements do not predict GPU/Tauri performance.
No validation subprocesses or builds run during the measured comparison.

`io-probes.mjs BUILD FIXTURE OUTPUT [cancel|cancel-merged|preview]` separately tests save
cancellation or saved-revision preview reuse. Cancellation covers full writes at
20/250/500 ms, an early incremental cancellation, and cancellation while building
the original-prefix Blob (use a large fixture). `cancel-merged` imports three selected pages, cancels merged saves at the same three delays, and retries the complete assembled output. The latter uses a diagnostic-only
wrapper to schedule an abort after the native delta RPC returns; production
services are unchanged. Each attempt
measures both caller rejection and worker readiness after rollback, requires one
surviving native document, compares page pixels, and retries a complete save.
Preview mode needs the synthetic donor with an editable text field. It compares
the cached preview with the independently reopened edited PDF, requires it to
differ from the original preview, then reopens the downloaded file with the native SDK.
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

Validation runs **after timing** with qpdf (pikepdf) and Poppler: all page dimensions,
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

The independent structure reader is `inspect_pdf.py`. Install the pinned
`scripts/pdf-benchmark/requirements.txt` in a separate Python venv and set
`PDF_BENCH_PYTHON=/absolute/venv/bin/python` when running `corpus-validate.mjs`.
Every indirect object is resolved and parser/xref warnings fail structural
validation. The corpus validator checks all page/annotation/form/link structures
plus sampled text/raster output. It does not parse every page's content operators;
use `content-syntax.mjs` for that separate qpdf check. This distinction matters
because the public INDOT source already has compressed-stream warnings.
Neither these tools nor Poppler are application dependencies. The small UI/fixture probes
use the native SDK for secondary checks; they do not replace this independent
corpus validation.

`content-syntax.mjs MANIFEST RESULTS_JSON OUTPUT` runs qpdf 12's native Job API
through the pinned pikepdf package on the sources and first-round candidate
standalone/merged outputs. Install `jbig2dec` on PATH for source JBIG2 streams.
Exact diagnostic logs are retained; normalized warning categories/counts are
compared with the source documents. This is not a zero-warning assertion or proof
that warnings refer to identical streams. `PDF_BENCH_VALIDATION_JOBS` (1–4) can
parallelize the separate structure/raster validator after timing has finished.

`authoring-audit.mjs OUTPUT [HISTORICAL_AUTHORING_MODULE]` creates a synthetic
editable/flattened document covering both bundled CJK fonts, standard fonts,
SVG/text/path/PNG appearances, all editable form kinds, wrapping/combing,
password presentation and rotated widgets. With no module override it uses the
current SDK. A historical module path allows a separate reference checkout to
supply fixtures without reintroducing an old package into this branch. Run `python authoring-validate.py CANDIDATE_DIR REFERENCE_DIR OUTPUT_JSON`
with the verification venv to check field values, Chinese text and exact editable
versus flattened Poppler pixels; a historical library's own flattening failure must be reported,
not treated as a valid visual reference.

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

All manifest variants run by default; `PDF_BENCH_VARIANTS` can select a subset.
With `PDF_BENCH_PROFILE=1` on both build and diagnostic commands, the diagnostic
also captures worker call counts after opening, before import, after owner
registration and after merged export. The counters are reset between these
stages. This adds a merged save to the diagnostic; these instrumented elapsed
times are not performance comparison results. Use the ordinary corpus runner
and uninstrumented builds for reported before/after timings.

`thumbnails.mjs MANIFEST OUTPUT [ROUNDS=3] [measure|validate]` uses unmodified
workers from normal production app builds. Its manifest contains
`variants: [{id, build, revision}]` and `fixtures: [{id, path, samplePages}]`.
All page indexes are zero-based. It hydrates the normal model, then sends the
sidebar's 500-pixel / JPEG quality 0.7 requests, including current controls and
preserved source annotations. Cold and repeated requests are separate; elapsed
time ends after the returned image decodes on the main thread. Three rounds
alternate variant order. Chromium PSS/RSS/SwapPss are sampled every 50 ms after
hydration, with GC snapshots before and after the thumbnail phase. These RPC
measurements exclude the sidebar's scheduling delay; use an actual UI run to
assess first visible thumbnails.
Set a fixture's `editRepeat: true` to measure an added note (and changed text
fields, if present) on the repeated request, exercising a live overlay over the
cached body. Keep this run separate from unchanged repeated previews.

Run `validate` separately, with one round. It uses lossless PNG, requires exact
RGBA equality against the first variant, and checks an added note followed by
restoring the original controls. Optional `stressPages` visits more pages after
warming the reader and checks its scan storage is unchanged. Optional
`readerPage` selects that foreground page; `requireReaderCache: true` fails if
the selected page did not populate the scan cache. Optional
`preemptionPages: [a,b,c]` should select three cold, expensive pages: it checks
reader priority, cancellation immediately after preemption, active cancellation
and retry. Native owner counts must remain one, the thumbnail cache must stay
within its budget, and unload must leave no loaded document. Include scan
rotation/crop/reflection/Normal/Multiply fixtures and live form pages. Raw files
and validation timings stay outside formal performance summaries. These checks
do not establish Tauri WebView behavior or make cold JPEG decoding faster.
