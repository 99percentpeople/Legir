# Retired benchmark tools

The following tools were removed from `engine/pdfium` after native authoring
replaced the helper PDF libraries. Their last complete snapshot is commit
`b65cf9c4c42af2884aad89e60dcc32842f374da7`. Historical script hashes refer to the
recorded revision, not to today's harness.

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

## Historical reports

Performance reports and raw measurements have been removed from the working tree.
A complete snapshot remains at `66225d98750a1ee1d10e77905c10128372ea8ddf`.
This preserves the original evidence, including failed/interfered runs and their
provenance, in Git history. Inspect it without restoring reports to the checkout:

```sh
git ls-tree -r --name-only 66225d98750a1ee1d10e77905c10128372ea8ddf -- docs/performance
git show 66225d98750a1ee1d10e77905c10128372ea8ddf:docs/performance/pdf-engine-real-corpus/manifest.json
git show 66225d98750a1ee1d10e77905c10128372ea8ddf:docs/performance/pdfium-native-authoring-20261014/ui.json
```

Use each report's recorded source revision for reproducing its measurements;
the archive snapshot is not a claim that every report measured that revision.
Keep new reports, measurements, PDFs, screenshots and logs under `/tmp` or the
ignored `.tmp/` directory. The legacy `docs/performance/` location is also ignored;
benchmark results are not committed.
