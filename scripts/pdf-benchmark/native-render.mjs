/* global process, console */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { createPDFium } from "../../packages/pdfium/dist/index.js";

// Separate from end-to-end browser measurements. Compare exact pixels from
// archived/current WASM, including different clips, zooms and cache eviction.
const [wasmDir, manifestPath, output, referencePath] = process.argv.slice(2);
if (!output)
  throw new Error(
    "Usage: node native-render.mjs WASM_DIR MANIFEST OUTPUT_JSON [REFERENCE_JSON]",
  );
const engine = await createPDFium({
  moduleUrl: pathToFileURL(resolve(wasmDir, "pdfium.js")).href,
});
if (process.env.PDF_IMAGE_CACHE_BYTES)
  engine.setLargeImageCacheLimit(Number(process.env.PDF_IMAGE_CACHE_BYTES));
const cache = () => {
  try {
    return engine.largeImageCache();
  } catch {
    return undefined; // Archived builds predate this diagnostic API.
  }
};
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const references = referencePath
  ? JSON.parse(await readFile(referencePath, "utf8"))
  : undefined;
const results = [];
for (const fixture of manifest.fixtures) {
  if (process.env.PDF_BENCH_CASES && fixture.id !== process.env.PDF_BENCH_CASES)
    continue;
  const doc = new engine.PDFDocument(
    new Uint8Array(await readFile(fixture.path)),
  );
  const pages = new Map();
  const record = { fixture: fixture.id, renders: [] };
  try {
    const render = (pageIndex, longEdge, rotation = 0, position) => {
      let page = pages.get(pageIndex);
      if (!page) pages.set(pageIndex, (page = doc.loadPage(pageIndex)));
      const {
        box: [x0, y0, x1, y1],
      } = page.geometry();
      const scale = longEdge / Math.max(x1 - x0, y1 - y0);
      const w = (rotation ? y1 - y0 : x1 - x0) * scale;
      const h = (rotation ? x1 - x0 : y1 - y0) * scale;
      const matrix = rotation
        ? [0, scale, scale, 0, -y0 * scale, -x0 * scale]
        : [scale, 0, 0, -scale, -x0 * scale, y1 * scale];
      const x = position ? Math.floor((w - 1024) * position[0]) : 0;
      const y = position ? Math.floor((h - 1024) * position[1]) : 0;
      const bounds = [
        x,
        y,
        x + (position ? 1024 : Math.floor(w)),
        y + (position ? 1024 : Math.floor(h)),
      ];
      const start = performance.now();
      const pixmap = page.render(matrix, bounds, { annotations: true });
      const ms = performance.now() - start;
      try {
        record.renders.push({
          pageIndex,
          longEdge,
          rotation,
          bounds,
          ms,
          hash: createHash("sha256").update(pixmap.getPixels()).digest("hex"),
          cache: cache(),
        });
      } finally {
        pixmap.destroy();
      }
    };
    for (const pageIndex of fixture.samplePages) {
      render(pageIndex, 1600);
      render(pageIndex, 1600);
    }
    const middle = fixture.samplePages[1];
    render(middle, 3200);
    render(middle, 3200);
    for (const position of [
      [0.4, 0.4],
      [0.55, 0.4],
      [0.55, 0.55],
      [0.4, 0.55],
    ])
      render(middle, 6400, 0, position);
    render(middle, 6400, 90, [0.5, 0.5]);
    render(fixture.samplePages[0], 1600);
  } finally {
    doc.destroy();
  }
  record.afterClose = { cache: cache(), documents: engine.liveDocuments() };
  assert.equal(record.afterClose.documents, 0);
  if (record.afterClose.cache) {
    assert.equal(record.afterClose.cache.bytes, 0);
    assert.equal(record.afterClose.cache.entries, 0);
    for (const render of record.renders)
      assert.ok(render.cache.bytes <= render.cache.limit);
  }
  if (references) {
    const reference = references.find((item) => item.fixture === fixture.id);
    const signature = ({ pageIndex, longEdge, rotation, bounds, hash }) => ({
      pageIndex,
      longEdge,
      rotation,
      bounds,
      hash,
    });
    assert.ok(reference, `Missing reference for ${fixture.id}`);
    assert.deepEqual(
      record.renders.map(signature),
      reference.renders.map(signature),
    );
    record.matchesReference = true;
  }
  results.push(record);
  await writeFile(output, JSON.stringify(results, null, 2));
  console.log(
    fixture.id,
    record.renders.map(({ ms }) => Math.round(ms)),
  );
}
