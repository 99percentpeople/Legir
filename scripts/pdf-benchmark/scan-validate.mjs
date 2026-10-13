/* global process, console, URL, document, requestAnimationFrame */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright"),
  { PNG } = require("pngjs");
const [manifestPath, output] = process.argv.slice(2);
if (!output) throw Error("Usage: scan-validate.mjs MANIFEST OUTPUT_DIRECTORY");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(output, { recursive: true });
let root;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = path.startsWith("/fixtures/")
      ? manifest.fixtures.find((f) => f.id === path.slice(10)).path
      : resolve(root, "." + path);
    if (!path.startsWith("/fixtures/") && !file.startsWith(root + "/"))
      throw Error("Invalid path");
    res.writeHead(200, {
      "Content-Length": (await stat(file)).size,
      "Content-Type":
        {
          ".js": "text/javascript",
          ".wasm": "application/wasm",
          ".html": "text/html",
        }[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const compareOnly = process.env.SCAN_VALIDATE_COMPARE_ONLY === "1";
const selectedVariants = process.env.SCAN_VALIDATE_VARIANTS?.split(",");
const results = compareOnly
  ? JSON.parse(await readFile(join(output, "renders.json"), "utf8"))
  : selectedVariants
    ? JSON.parse(await readFile(join(output, "renders.json"), "utf8")).filter(
        (r) => !selectedVariants.includes(r.variant),
      )
    : [];
try {
  for (const fixture of compareOnly ? [] : manifest.fixtures)
    for (const variant of manifest.variants.filter(
      (v) => !selectedVariants || selectedVariants.includes(v.id),
    )) {
      root = variant.build;
      const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
        headless: true,
        args: ["--no-sandbox", "--disable-gpu"],
      });
      try {
        const page = await browser.newPage({
          viewport: { width: 1280, height: 900 },
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(
          `http://127.0.0.1:${server.address().port}/benchmark.html`,
        );
        await page.waitForFunction(() => !!globalThis.pdfCorpus);
        await page.evaluate(
          (id) =>
            globalThis.pdfCorpus.prepare(`/fixtures/${id}`, `/fixtures/${id}`),
          fixture.id,
        );
        await page.evaluate(() => globalThis.pdfCorpus.open());
        const record = {
          fixture: fixture.id,
          variant: variant.id,
          cases: [],
          errors,
        };
        for (const pageIndex of fixture.samplePages)
          for (const task of fixture.tasks ?? [
            { name: "page1600", longEdge: 1600 },
            { name: "page3200", longEdge: 3200 },
            { name: "tile", longEdge: 6400, tilePosition: [0.4, 0.4] },
            {
              name: "tile-neighbor",
              longEdge: 6400,
              tilePosition: [0.45, 0.4],
            },
            { name: "rotated", longEdge: 1600, rotation: 90 },
          ]) {
            const prior = record.cases.at(-1)?.stats?.scanCanvas;
            if (task.png) {
              const rendering = await page.evaluate(
                (index) => globalThis.pdfCorpus.png(index, true),
                pageIndex,
              );
              const name = `${fixture.id}-${pageIndex}-${task.name}-${variant.id}.png`;
              const captured = !!rendering.url;
              if (rendering.url) {
                await writeFile(
                  join(output, name),
                  Buffer.from(rendering.url.split(",")[1], "base64"),
                );
                delete rendering.url;
              }
              const stats = await page.evaluate(() =>
                globalThis.pdfCorpus.stats(),
              );
              record.cases.push({
                pageIndex,
                task: task.name,
                png: true,
                file: captured ? name : undefined,
                rendering,
                stats,
                scanUsed: stats?.scanCanvas
                  ? stats.scanCanvas.renders > (prior?.renders ?? 0)
                  : undefined,
              });
              continue;
            }
            const rendering = await page.evaluate(
              (options) => globalThis.pdfCorpus.render(options),
              { pageIndex, ...task },
            );
            const capture = await page.evaluate(async () => {
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
              const source = document.querySelector("canvas");
              const target = document.createElement("canvas");
              target.width = source.width;
              target.height = source.height;
              target.getContext("2d").drawImage(source, 0, 0);
              return {
                width: target.width,
                height: target.height,
                url: target.toDataURL("image/png"),
              };
            });
            const name = `${fixture.id}-${pageIndex}-${task.name}-${variant.id}.png`;
            await writeFile(
              join(output, name),
              Buffer.from(capture.url.split(",")[1], "base64"),
            );
            const stats = await page.evaluate(() =>
              globalThis.pdfCorpus.stats(),
            );
            record.cases.push({
              pageIndex,
              task: task.name,
              file: name,
              width: capture.width,
              height: capture.height,
              rendering,
              stats,
              scanUsed: stats?.scanCanvas
                ? stats.scanCanvas.renders > (prior?.renders ?? 0)
                : undefined,
            });
          }
        await page.evaluate(() => globalThis.pdfCorpus.close());
        if (errors.length) throw Error(errors.join("\n"));
        results.push(record);
        await writeFile(
          join(output, "renders.json"),
          JSON.stringify(results, null, 2),
        );
        console.log(
          JSON.stringify({
            fixture: fixture.id,
            variant: variant.id,
            cases: record.cases.length,
          }),
        );
      } finally {
        await browser.close();
      }
    }
  const comparisons = [];
  for (const fixture of manifest.fixtures) {
    const reference = results.find(
      (r) =>
        r.fixture === fixture.id &&
        r.variant === (fixture.reference ?? manifest.variants[0].id),
    );
    for (const variant of results.filter(
      (r) =>
        r.fixture === fixture.id &&
        r !== reference &&
        (!manifest.variants.some((v) => v.validate) ||
          manifest.variants.find((v) => v.id === r.variant).validate),
    )) {
      for (const actual of variant.cases) {
        const expected = reference.cases.find(
          (c) => c.pageIndex === actual.pageIndex && c.task === actual.task,
        );
        if (actual.png && (!actual.file || !expected.file)) {
          const changed = actual.rendering.hash !== expected.rendering.hash;
          comparisons.push({
            fixture: fixture.id,
            variant: variant.variant,
            pageIndex: actual.pageIndex,
            task: actual.task,
            changedFraction: Number(changed),
            severeFraction: Number(changed),
            meanAbsoluteChannelError: Number(changed) * 255,
            stats: actual.stats,
            scanUsed: actual.scanUsed,
          });
          continue;
        }
        const a = PNG.sync.read(await readFile(join(output, expected.file))),
          b = PNG.sync.read(await readFile(join(output, actual.file)));
        if (a.width !== b.width || a.height !== b.height) {
          if (manifest.variants.find((v) => v.id === variant.variant).validate)
            throw Error(
              `Mismatched dimensions: ${fixture.id}/${variant.variant}/${actual.pageIndex}/${actual.task}`,
            );
          comparisons.push({
            fixture: fixture.id,
            variant: variant.variant,
            pageIndex: actual.pageIndex,
            task: actual.task,
            dimensionMismatch: true,
          });
          continue;
        }
        let severe = 0,
          absolute = 0,
          changed = 0,
          luminanceSquaredError = 0,
          severeLuminance = 0,
          inkExpected = 0,
          inkActual = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          let largest = 0;
          for (let c = 0; c < 4; c++) {
            const delta = Math.abs(a.data[i + c] - b.data[i + c]);
            largest = Math.max(largest, delta);
            absolute += delta;
          }
          if (largest) changed++;
          if (largest > 16) severe++;
          const luminanceDelta =
            (a.data[i] - b.data[i]) * 0.2126 +
            (a.data[i + 1] - b.data[i + 1]) * 0.7152 +
            (a.data[i + 2] - b.data[i + 2]) * 0.0722;
          luminanceSquaredError += luminanceDelta * luminanceDelta;
          if (Math.abs(luminanceDelta) > 16) severeLuminance++;
          if (Math.min(a.data[i], a.data[i + 1], a.data[i + 2]) < 180)
            inkExpected++;
          if (Math.min(b.data[i], b.data[i + 1], b.data[i + 2]) < 180)
            inkActual++;
        }
        comparisons.push({
          fixture: fixture.id,
          variant: variant.variant,
          pageIndex: actual.pageIndex,
          task: actual.task,
          changedFraction: changed / (a.width * a.height),
          severeFraction: severe / (a.width * a.height),
          meanAbsoluteChannelError: absolute / a.data.length,
          luminanceRMSE: Math.sqrt(
            luminanceSquaredError / (a.width * a.height),
          ),
          severeLuminanceFraction: severeLuminance / (a.width * a.height),
          inkExpected,
          inkActual,
          stats: actual.stats,
          scanUsed: actual.scanUsed,
        });
      }
    }
  }
  await writeFile(
    join(output, "comparisons.json"),
    JSON.stringify(comparisons, null, 2),
  );
  console.log(JSON.stringify({ comparisons: comparisons.length }));
  // Fail only variants explicitly marked for validation; native and PDF.js
  // reference differences remain recorded without redefining the quality gate.
  for (const comparison of comparisons) {
    const fixture = manifest.fixtures.find((f) => f.id === comparison.fixture);
    const gate = {
      ...fixture,
      ...fixture.tasks?.find((t) => t.name === comparison.task),
    };
    if (!manifest.variants.find((v) => v.id === comparison.variant).validate)
      continue;
    if (
      comparison.severeFraction > (gate.maxSevereFraction ?? 0.001) ||
      comparison.meanAbsoluteChannelError > (gate.maxMeanError ?? 0.5) ||
      (gate.maxLuminanceRMSE != null &&
        comparison.luminanceRMSE > gate.maxLuminanceRMSE) ||
      (gate.maxSevereLuminanceFraction != null &&
        comparison.severeLuminanceFraction > gate.maxSevereLuminanceFraction) ||
      (gate.exact && comparison.changedFraction !== 0)
    )
      throw Error(
        `Quality gate failed: ${comparison.fixture}/${comparison.pageIndex}/${comparison.task}`,
      );
    if (
      (fixture.tasks?.find((task) => task.name === comparison.task)
        ?.expectScan ?? fixture.expectScan) !== undefined &&
      comparison.scanUsed !==
        (fixture.tasks?.find((task) => task.name === comparison.task)
          ?.expectScan ?? fixture.expectScan)
    )
      throw Error(
        `Wrong renderer: ${comparison.fixture}/${comparison.pageIndex}/${comparison.task}`,
      );
    const stats = comparison.stats;
    if (
      stats?.nativeDocuments !== 1 ||
      stats?.peakNativeDocuments !== 1 ||
      stats.scanCanvas.bytes > stats.scanCanvas.limit ||
      stats.scanCanvas.reservedBytes !== 0 ||
      stats.scanCanvas.peakBytes > stats.scanCanvas.workLimit
    )
      throw Error("Document ownership or scan budget violation");
  }
  // Compare the annotation's influence independently of the different body
  // resamplers. For Normal and Multiply, changing the backdrop changes each
  // composed channel by at most the backdrop difference (plus integer rounding).
  // Missing, displaced or incorrectly blended annotations exceed this envelope.
  const annotationChecks = [];
  for (const fixture of manifest.fixtures.filter(
    (f) => f.annotationReference,
  )) {
    const reference = results.find(
      (r) =>
        r.fixture === fixture.id && r.variant === fixture.annotationReference,
    );
    for (const variant of results.filter(
      (r) =>
        r.fixture === fixture.id &&
        manifest.variants.find((v) => v.id === r.variant)?.validate,
    )) {
      for (const actual of variant.cases.filter((c) => c.png)) {
        const native = reference.cases.find(
          (c) =>
            c.png && c.pageIndex === actual.pageIndex && c.task === actual.task,
        );
        const body = variant.cases.find(
          (c) => !c.png && c.pageIndex === actual.pageIndex,
        );
        const nativeBody = reference.cases.find(
          (c) => !c.png && c.pageIndex === actual.pageIndex,
        );
        const images = await Promise.all(
          [actual, native, body, nativeBody].map(async (c) =>
            PNG.sync.read(await readFile(join(output, c.file))),
          ),
        );
        if (
          images.some(
            (img) =>
              img.width !== images[0].width || img.height !== images[0].height,
          )
        )
          throw Error("Annotation capture dimensions differ");
        const [a, n, b, nb] = images.map((img) => img.data);
        let maxExcess = 0,
          excessivePixels = 0,
          nativeAffectedPixels = 0,
          actualAffectedPixels = 0;
        for (let i = 0; i < a.length; i += 4) {
          let excess = 0,
            nativeAffected = false,
            actualAffected = false;
          for (let c = 0; c < 3; c++) {
            const j = i + c,
              nativeEffect = n[j] - nb[j],
              actualEffect = a[j] - b[j];
            nativeAffected ||= nativeEffect !== 0;
            actualAffected ||= actualEffect !== 0;
            excess = Math.max(
              excess,
              Math.abs(actualEffect - nativeEffect) - Math.abs(b[j] - nb[j]),
            );
          }
          maxExcess = Math.max(maxExcess, excess);
          excessivePixels += +(excess > 2);
          nativeAffectedPixels += +nativeAffected;
          actualAffectedPixels += +actualAffected;
        }
        annotationChecks.push({
          fixture: fixture.id,
          variant: variant.variant,
          pageIndex: actual.pageIndex,
          task: actual.task,
          maxExcess,
          excessivePixels,
          nativeAffectedPixels,
          actualAffectedPixels,
          requireAnnotations: fixture.requireAnnotations === true,
        });
      }
    }
  }
  await writeFile(
    join(output, "annotations.json"),
    JSON.stringify(annotationChecks, null, 2),
  );
  if (
    annotationChecks.some(
      (r) =>
        r.excessivePixels ||
        (r.requireAnnotations &&
          (!r.nativeAffectedPixels || !r.actualAffectedPixels)),
    )
  )
    throw Error("Native annotation influence differs");
  const seams = [];
  for (const record of results) {
    for (const actual of record.cases.filter(
      (c) => c.task === "tile-neighbor",
    )) {
      const prior = record.cases.find(
        (c) => c.pageIndex === actual.pageIndex && c.task === "tile",
      );
      const a = PNG.sync.read(await readFile(join(output, prior.file))),
        b = PNG.sync.read(await readFile(join(output, actual.file)));
      const [ax, ay, aw, ah] = prior.rendering.tile,
        [bx, by, bw, bh] = actual.rendering.tile;
      let mismatches = 0,
        count = 0,
        maxChannelError = 0,
        absoluteError = 0;
      for (let y = Math.max(ay, by); y < Math.min(ay + ah, by + bh); y++)
        for (let x = Math.max(ax, bx); x < Math.min(ax + aw, bx + bw); x++) {
          const i = ((y - ay) * aw + x - ax) * 4,
            j = ((y - by) * bw + x - bx) * 4;
          count++;
          for (let c = 0; c < 4; c++) {
            const delta = Math.abs(a.data[i + c] - b.data[j + c]);
            maxChannelError = Math.max(maxChannelError, delta);
            absoluteError += delta;
          }
          if (
            a.data[i] !== b.data[j] ||
            a.data[i + 1] !== b.data[j + 1] ||
            a.data[i + 2] !== b.data[j + 2] ||
            a.data[i + 3] !== b.data[j + 3]
          )
            mismatches++;
        }
      seams.push({
        fixture: record.fixture,
        variant: record.variant,
        pageIndex: actual.pageIndex,
        count,
        mismatches,
        maxChannelError,
        meanAbsoluteChannelError: absoluteError / (count * 4),
      });
    }
  }
  await writeFile(join(output, "seams.json"), JSON.stringify(seams, null, 2));
  if (
    seams.some(
      (r) =>
        manifest.variants.find((v) => v.id === r.variant).validate &&
        (!r.count ||
          r.maxChannelError > 16 ||
          r.meanAbsoluteChannelError > 0.05),
    )
  )
    throw Error("Overlapping tiles differ");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
