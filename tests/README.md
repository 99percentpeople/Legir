# Test ownership

Run these from the repository root:

```sh
bun run test         # Application + all four library Vitest projects
bun run --cwd packages/pdf-core test # One library after build:packages
bun run test:pdfium  # Standalone SDK tests under packages/pdfium/tests
bun run lint
```

The application command verifies the pinned WASM artifacts and builds the SDK
before Vitest starts. Each library has its own Vitest config and `test` command;
root `test` aggregates all of them with the application project. Libraries default
to Node, the application defaults to jsdom, and browser-specific cases use
explicit per-file environment overrides.

| Area                                                                                    | Responsibility                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/pdf/`                                                                            | App import/export policies, forms, annotation replies, page assembly, owner routing, cancellation, incremental/full saves and cache invalidation.                                     |
| `packages/pdf-model/tests/`, `packages/pdf-core/tests/`, `packages/pdf-renderer/tests/` | Portable model geometry, core document/form/font/stream/raster behavior, and renderer worker/cache behavior. No application source imports or aliases.                                |
| `packages/pdfium/tests/`                                                                | Native resource lifetime, journal/graft/save semantics, rendering and the independent authoring API. Similar operations at these two layers protect different contracts.              |
| `tests/workspace/`, `tests/editor*`, `tests/page*`                                      | View state, interactions, page identity, undo/redo and UI rendering requests.                                                                                                         |
| `tests/platform/`, `tests/desktop*`                                                     | Persistence, file handling and desktop packaging rules.                                                                                                                               |
| `tests/ai/`, `tests/www/`                                                               | AI service behavior and the separate marketing/demo surface.                                                                                                                          |
| `scripts/pdf-benchmark/`                                                                | Manual production-browser timing, cancellation/ownership probes, canvas quality and independent qpdf/Poppler export validation. See its [README](../scripts/pdf-benchmark/README.md). |

`packages/pdfium/tests/helpers/authoringLifecycle.ts` releases standalone native
documents created by fixtures after application/core tests. It does not own app sessions. App owners,
pages, pixmaps and tasks still need explicit cleanup in their own tests.
`pdf/nativeVerification.ts` provides native reopen/render checks; those checks
share the engine under test and do not replace the independent corpus validator.
The two small [PDF fixtures](fixtures/pdf/README.md) cover classic and object-stream
cross-reference formats and must both remain.

`pdfiumArtifacts.test.ts` checks a Git checkout with `core.autocrlf=true` and
ensures the provenance verifier still rejects modified source/loader/WASM bytes.
`pdfBenchmarkFixtures.test.ts` runs the documented fixture CLI, reopens all three
PDFs, checks their page/field counts and manifest hashes, and renders sampled
image pages. It generates the full 60-page image fixture in a temporary directory
and removes the outputs after the test.

Do not infer browser scheduling, display quality, process peak memory or Tauri
WebView behavior from jsdom/Node tests. Run the relevant manual browser tools when
those paths change, and keep performance measurement separate from validation.
Retired duplicate/experimental tools are listed in the [benchmark archive](../scripts/pdf-benchmark/ARCHIVE.md).

## Package boundaries and external consumers

`bun run test` builds all workspace libraries and checks dependency boundaries
before running all library and application regressions. `bun run test:consumer` separately
packs all four libraries, installs their tarballs outside this repository and
runs `scripts/pdf-consumer-smoke.mjs` under plain Node. It covers AcroForm import,
fill, save, flatten, raster parity, transactional rollback and explicit native
cleanup without Vite aliases, application source, React or Tauri. These checks
also run in the CI validation job. They do not replace browser or native desktop
validation when those paths change.

`pdfLibraryNpmPublish.test.ts` packs a temporary tagged repository and verifies
all tarball and manifest checksums with `sha256sum -c`. `pdfLibraryPublish.test.ts`
mocks npm and registry requests to cover preflight failures, dependency order,
`latest` downgrade protection, dry runs and partial-release retries. These tests
never publish real packages. Their synthetic fixture versions are independent of
the actual package manifests; do not update them when releasing.
`pdfLibraryLicense.test.ts` checks the actual
four package tarballs for MIT metadata and license text, preserved engine notices,
and the unchanged AGPL application boundary.

`pdfLibraryApi.test.ts` checks explicit export maps, development alias parity,
private-path rejection and DOM-free model imports. Tests of private algorithms
reference repository-local `packages/*/dist` files deliberately; those are not
published import paths. The external consumer also typechecks/builds
`examples/pdf-browser` without Legir aliases. Set `LEGIR_BROWSER_BIN=chromium`
to additionally run its actual Worker/WASM path in a headless browser.
