/* global process, console */
import { readFile, writeFile } from "node:fs/promises";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Usage: node corpus-summary.mjs RESULTS_JSON OUTPUT_JSON");
const records = JSON.parse(await readFile(input, "utf8"));
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2
    : null;
};
const spread = (values) => {
  const valid = values.filter(Number.isFinite);
  return {
    n: valid.length,
    median: median(valid),
    min: valid.length ? Math.min(...valid) : null,
    max: valid.length ? Math.max(...valid) : null,
  };
};
function metrics(record) {
  const phases = record.phases;
  const tiles = Object.values(phases).filter((phase) => phase.kind === "tile");
  const byKind = (kind) =>
    median(
      Object.values(phases)
        .filter((phase) => phase.kind === kind)
        .map((phase) => phase.ms),
    );
  const memory = record.memory;
  const peak = (download) =>
    Math.max(
      ...Object.values(phases)
        .filter((p) => download || p.kind !== "downloadExcludedFromTiming")
        .map((p) => p.peak.pssMiB),
    );
  return {
    openMs: phases.open?.ms,
    firstCanvasMs: phases.firstCanvas?.ms,
    openPlusFirstCanvasMs: phases.open?.ms + phases.firstCanvas?.ms,
    hydrationMs: phases.hydrate?.ms,
    pageColdMs: byKind("pageCold"),
    pageWarmMs: byKind("pageWarm"),
    zoomColdMs: phases.zoomCold?.ms,
    zoomWarmMs: phases.zoomWarm?.ms,
    tileMs: byKind("tile"),
    tilesTotalMs:
      tiles.length === 4
        ? tiles.reduce((total, phase) => total + phase.ms, 0)
        : undefined,
    rotatedTileMs: phases.rotatedTile?.ms,
    pngMs: phases.png?.ms,
    exportMs: phases.export?.ms,
    importMs: phases.import?.ms,
    importReadableMs: phases.import?.readableMs,
    importPreviewMs: phases.import?.parseMs,
    importRegisterMs: phases.import?.registerMs,
    mergedExportMs: phases.mergedExport?.ms,
    importAndMergedExportMs: phases.import?.ms + phases.mergedExport?.ms,
    exportBytes: phases.export?.bytes,
    mergedExportBytes: phases.mergedExport?.bytes,
    baselinePssMiB: memory.baseline?.pssMiB,
    readablePssMiB: memory.readable?.pssMiB,
    readableDeltaMiB: memory.readable?.pssMiB - memory.baseline?.pssMiB,
    renderedPssMiB: memory.rendered?.pssMiB,
    importedPssMiB: memory.imported?.pssMiB,
    processingPeakPssMiB: peak(false),
    exportPeakPssMiB: Math.max(
      ...[phases.export, phases.mergedExport]
        .filter(Boolean)
        .map((phase) => phase.peak.pssMiB),
    ),
    includingDownloadPeakPssMiB: peak(true),
    includingDownloadPeakDeltaMiB: peak(true) - memory.baseline?.pssMiB,
    processingPeakDeltaMiB: peak(false) - memory.baseline?.pssMiB,
    closedPssMiB: memory.closed?.pssMiB,
    closedMinusBaselineMiB: memory.closed?.pssMiB - memory.baseline?.pssMiB,
    wasmCapacityMiB: memory.merged?.native
      ? memory.merged.native.wasmCapacityBytes / 1048576
      : undefined,
    browserSwapPeakMiB: Math.max(
      ...Object.values(phases).map((p) => p.peak.swapMiB),
    ),
    hostSwapInPages:
      record.hostAfter.swapInPages - record.hostBefore.swapInPages,
    hostSwapOutPages:
      record.hostAfter.swapOutPages - record.hostBefore.swapOutPages,
  };
}
const groups = new Map();
for (const record of records) {
  const key = `${record.fixture}/${record.variant}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(record);
}
const summaries = [];
for (const [key, group] of groups) {
  const values = group.map(metrics);
  const summary = {
    key,
    fixture: group[0].fixture,
    variant: group[0].variant,
    samples: group.length,
    completed: group.filter((r) => r.status === "ok").length,
    failures: group
      .filter((r) => r.status !== "ok")
      .map((r) => ({ round: r.round, phase: r.failedPhase, error: r.error })),
    metrics: Object.fromEntries(
      Object.keys(values[0]).map((name) => [
        name,
        spread(values.map((v) => v[name])),
      ]),
    ),
  };
  summaries.push(summary);
  console.log(
    JSON.stringify({
      key,
      completed: summary.completed,
      ...Object.fromEntries(
        Object.entries(summary.metrics).map(([key, value]) => [
          key,
          value.median === null ? null : Math.round(value.median * 10) / 10,
        ]),
      ),
    }),
  );
}
await writeFile(output, JSON.stringify(summaries, null, 2));
