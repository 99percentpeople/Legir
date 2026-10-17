# Test ownership

Run these from the repository root:

```sh
bun run test         # Application integration, state, UI and platform tests
bun run test:pdfium  # Standalone SDK tests under packages/pdfium/tests
bun run lint
```

The application command verifies the pinned WASM artifacts and builds the SDK
before Vitest starts. CI runs both suites; changes under `packages/pdfium/**`
trigger the same validation as application changes. The SDK uses Node while
the application defaults to jsdom, with per-file environment overrides.

| Area                                               | Responsibility                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/pdf/`                                       | App import/export policies, forms, annotation replies, page assembly, owner routing, cancellation, incremental/full saves and cache invalidation.                                     |
| `packages/pdfium/tests/`                           | Native resource lifetime, journal/graft/save semantics, rendering and the independent authoring API. Similar operations at these two layers protect different contracts.              |
| `tests/workspace/`, `tests/editor*`, `tests/page*` | View state, interactions, page identity, undo/redo and UI rendering requests.                                                                                                         |
| `tests/platform/`, `tests/desktop*`                | Persistence, file handling and desktop packaging rules.                                                                                                                               |
| `tests/ai/`, `tests/www/`                          | AI service behavior and the separate marketing/demo surface.                                                                                                                          |
| `scripts/pdf-benchmark/`                           | Manual production-browser timing, cancellation/ownership probes, canvas quality and independent qpdf/Poppler export validation. See its [README](../scripts/pdf-benchmark/README.md). |

`pdf/authoringLifecycle.ts` releases standalone native documents created by test
fixtures after each application test. It does not own app sessions. App owners,
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
