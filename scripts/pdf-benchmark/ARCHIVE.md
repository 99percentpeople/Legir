# Retired benchmark tools

The following tools were removed from `engine/pdfium` after native authoring
replaced the helper PDF libraries. Their last complete snapshot is commit
`b65cf9c4c42af2884aad89e60dcc32842f374da7`. Historical reports and raw measurements
remain in `docs/performance`; their script hashes refer to the recorded revision,
not to today's harness.

| Retired file                  | Reason / maintained replacement                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry.ts`                    | Its byte-buffer export and separate donor worker no longer represent the app. Use `corpus-entry.ts`, which follows Blob export and owner-based import.           |
| `run.mjs`                     | Duplicate timing/memory runner for the retired entry. Use `corpus.mjs` with a synthetic or real-file manifest.                                                   |
| `compare.mjs`                 | Separate two-build loop and native-only roundtrip checks. Use corpus variants, `corpus-summary.mjs` and the independent `corpus-validate.mjs`.                   |
| `visual.mjs`                  | First-page synthetic captures. Use corpus capture for diagnostics, `scan-validate.mjs` for canvas quality, and `authoring-audit.mjs` for forms/appearances.      |
| `render.mjs`                  | Hard-coded MuPDF loader and instrumentation, outside the active engine matrix. Use corpus rendering, `native-render.mjs` and `reader-ui.mjs`.                    |
| `canvas-offscreen.mjs`        | Completed feasibility experiment with a benchmark-only renderer. Production scan rendering is checked by `scan-validate.mjs` and measured by the corpus runner.  |
| `canvas-offscreen.worker.mjs` | Cached Path2D/ImageBitmap prototype used only by the retired feasibility runner. SDK Canvas-plan coverage remains in `canvasPlan.test.ts` and `canvas-plan.mjs`. |

To inspect an old script without restoring it to the working tree:

```sh
git show b65cf9c4c42af2884aad89e60dcc32842f374da7:scripts/pdf-benchmark/render.mjs
```

For a historical reproduction, use a separate worktree and the fixture, engine
and tool versions recorded in that report:

```sh
git worktree add --detach /tmp/legir-benchmark-archive b65cf9c4c42af2884aad89e60dcc32842f374da7
```

Keep new PDFs, screenshots, build logs and intermediate runs under `/tmp` or the
ignored `.tmp/` directory. Commit only deliberate reports and their necessary
evidence. Existing measurements, including failed/interfered runs and their
provenance, are retained so the historical conclusions remain auditable.
