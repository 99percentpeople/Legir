/* global process, console, URL, performance, Worker, OffscreenCanvas,
   OffscreenCanvasRenderingContext2D, Blob, location, document, crypto, createImageBitmap */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const [before, after, fixtures, output, rounds = "3", original] =
  process.argv.slice(2);
if (!before || !after || !fixtures || !output)
  throw new Error(
    "Usage: node render.mjs BEFORE_BUILD AFTER_BUILD FIXTURES OUTPUT [ROUNDS] [PDFJS_BUILD]",
  );
await mkdir(output, { recursive: true });
const variants = { before, after, ...(original ? { original } : {}) };
let root;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = path.startsWith("/fixtures/")
      ? join(fixtures, path.slice(10))
      : join(root, path);
    const bytes = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".wasm": "application/wasm",
          ".pdf": "application/pdf",
        }[extname(file)] ?? "application/octet-stream",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const results = [];
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
};
try {
  for (let round = 0; round < Number(rounds); round++) {
    const order = Object.keys(variants);
    if (round % 2) order.reverse();
    for (const variant of order)
      for (const fixture of ["forms", "large-images"]) {
        root = variants[variant];
        const browser = await chromium.launch({
          headless: true,
          executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
          args: ["--no-sandbox"],
        });
        try {
          const context = await browser.newContext({
            serviceWorkers: "block",
            viewport: { width: 1440, height: 1000 },
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(String(error)));
          await page.addInitScript(() => {
            const Original = Worker;
            globalThis.diagnosticWorkers = [];
            globalThis.Worker = class extends Original {
              constructor(...args) {
                super(...args);
                globalThis.diagnosticWorkers.push(this);
              }
            };
          });
          await page.goto(
            `http://127.0.0.1:${server.address().port}/benchmark.html`,
          );
          await page.waitForFunction(() => !!globalThis.pdfBenchmark);
          await page.evaluate(
            (name) =>
              globalThis.pdfBenchmark.prepare(
                `/fixtures/${name}.pdf`,
                "/fixtures/donor.pdf",
              ),
            fixture,
          );
          await page.evaluate(() => globalThis.pdfBenchmark.open());
          await page.evaluate(() => globalThis.pdfBenchmark.hydrate());
          const worker = page
            .workers()
            .filter((w) => w.url().includes("pdf-render"))
            .at(-1);
          await worker.evaluate(async (native) => {
            globalThis.diagnosticTimings = [];
            const record = (label, start, extra = {}) =>
              globalThis.diagnosticTimings.push({
                label,
                ms: performance.now() - start,
                ...extra,
              });
            const wrap = (proto, name, label, isAsync = false) => {
              const method = proto[name];
              proto[name] = isAsync
                ? async function (...args) {
                    const start = performance.now();
                    try {
                      return await method.apply(this, args);
                    } finally {
                      record(label, start);
                    }
                  }
                : function (...args) {
                    const start = performance.now();
                    try {
                      return method.apply(this, args);
                    } finally {
                      record(label, start);
                    }
                  };
            };
            let renderStart;
            globalThis.addEventListener("message", ({ data }) => {
              if (data.type === "render") {
                renderStart = performance.now();
                if (data.canvas) globalThis.diagnosticCanvas = data.canvas;
              }
            });
            const raf = globalThis.requestAnimationFrame;
            globalThis.requestAnimationFrame = function (callback) {
              if (renderStart !== undefined)
                record("beforePresentation", renderStart);
              return raf.call(this, callback);
            };
            wrap(OffscreenCanvas.prototype, "convertToBlob", "pngEncode", true);
            wrap(
              OffscreenCanvasRenderingContext2D.prototype,
              "putImageData",
              "putImageData",
            );
            wrap(Blob.prototype, "arrayBuffer", "blobBytes", true);
            if (native) {
              const m = await import(
                new URL("/mupdf/1.28.1/mupdf.js", location.href).href
              );
              wrap(m.DisplayList.prototype, "run", "nativeRaster");
              wrap(m.Page.prototype, "toDisplayList", "buildDisplayList");
              wrap(m.Pixmap.prototype, "clear", "clearPixels");
              const ArrayType = globalThis.Uint8ClampedArray;
              globalThis.Uint8ClampedArray = new Proxy(ArrayType, {
                construct(target, args, newTarget) {
                  const start = performance.now();
                  const value = Reflect.construct(target, args, newTarget);
                  if (args[0] instanceof ArrayType)
                    record("copyPixels", start, { bytes: value.byteLength });
                  return value;
                },
              });
            }
          }, variant !== "original");
          for (const mode of [
            { name: "png", scale: 1.5 },
            { name: "canvas", scale: 1.5 },
            { name: "canvas-3x", scale: 3 },
            {
              name: "rotated-tile",
              scale: 3,
              rotation: 90,
              tile: [120, 160, 640, 480],
            },
          ]) {
            const samples = [];
            for (let iteration = 0; iteration < 10; iteration++) {
              await worker.evaluate(() => {
                globalThis.diagnosticTimings = [];
              });
              const value = await page.evaluate(
                async ({ mode, iteration }) => {
                  const worker = globalThis.diagnosticWorkers.at(-1);
                  const id = `diagnostic-${mode.name}-${iteration}`;
                  const request = {
                    type: mode.name === "png" ? "renderImage" : "render",
                    id,
                    pageIndex: 0,
                    scale: mode.scale,
                    rotation: mode.rotation,
                    tile: mode.tile,
                    mimeType: "image/png",
                    renderAnnotations: true,
                    canvasId: mode.name,
                  };
                  const transfers = [];
                  if (mode.name !== "png" && iteration === 0) {
                    document.querySelector("canvas")?.remove();
                    const canvas = document.createElement("canvas");
                    canvas.style.width = "450px";
                    canvas.style.height = "600px";
                    document.body.append(canvas);
                    request.canvas = canvas.transferControlToOffscreen();
                    transfers.push(request.canvas);
                  }
                  const start = performance.now();
                  const payload = await new Promise((resolve, reject) => {
                    const listener = ({ data }) => {
                      if (data.id !== id) return;
                      worker.removeEventListener("message", listener);
                      if (!data.success || data.payload === false)
                        reject(new Error(data.error ?? "Render cancelled"));
                      else resolve(data.payload);
                    };
                    worker.addEventListener("message", listener);
                    worker.postMessage(request, transfers);
                  });
                  const ms = performance.now() - start;
                  if (payload.imageBytes)
                    globalThis.diagnosticPng = payload.imageBytes;
                  return { ms, bytes: payload.imageBytes?.byteLength };
                },
                { mode, iteration },
              );
              const timings = await worker.evaluate(
                () => globalThis.diagnosticTimings,
              );
              samples.push({ iteration, ...value, timings });
            }
            // Read/hash only after all timed iterations, to avoid canvas
            // readback changing the browser's rendering backend mid-sample.
            const pixels =
              mode.name === "png"
                ? await page.evaluate(async () => {
                    const bitmap = await createImageBitmap(
                      new Blob([globalThis.diagnosticPng]),
                    );
                    const canvas = new OffscreenCanvas(
                      bitmap.width,
                      bitmap.height,
                    );
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(bitmap, 0, 0);
                    bitmap.close();
                    const pixels = ctx.getImageData(
                      0,
                      0,
                      canvas.width,
                      canvas.height,
                    );
                    return {
                      width: canvas.width,
                      height: canvas.height,
                      hash: Array.from(
                        new Uint8Array(
                          await crypto.subtle.digest("SHA-256", pixels.data),
                        ),
                      )
                        .map((x) => x.toString(16).padStart(2, "0"))
                        .join(""),
                    };
                  })
                : await worker.evaluate(async () => {
                    const canvas = globalThis.diagnosticCanvas;
                    const pixels = canvas
                      .getContext("2d")
                      .getImageData(0, 0, canvas.width, canvas.height);
                    return {
                      width: canvas.width,
                      height: canvas.height,
                      hash: Array.from(
                        new Uint8Array(
                          await crypto.subtle.digest("SHA-256", pixels.data),
                        ),
                      )
                        .map((x) => x.toString(16).padStart(2, "0"))
                        .join(""),
                    };
                  });
            const measured = samples.slice(2);
            const labels = [
              ...new Set(
                measured.flatMap((s) => s.timings.map((t) => t.label)),
              ),
            ];
            const summary = {
              ms: median(measured.map((s) => s.ms)),
              stages: Object.fromEntries(
                labels.map((label) => [
                  label,
                  median(
                    measured.map((s) =>
                      s.timings
                        .filter((t) => t.label === label)
                        .reduce((sum, t) => sum + t.ms, 0),
                    ),
                  ),
                ]),
              ),
              copiedBytes: median(
                measured.map((s) =>
                  s.timings
                    .filter((t) => t.label === "copyPixels")
                    .reduce((sum, t) => sum + t.bytes, 0),
                ),
              ),
            };
            results.push({
              variant,
              fixture,
              round,
              mode,
              environment: {
                browser: browser.version(),
                platform: process.platform,
                arch: process.arch,
              },
              samples,
              pixels,
              summary,
            });
            console.log(
              JSON.stringify({
                variant,
                fixture,
                round,
                mode: mode.name,
                ...summary,
              }),
            );
          }
          if (errors.length) throw new Error(errors.join("\n"));
          await page.evaluate(() => globalThis.pdfBenchmark.close());
        } finally {
          await browser.close();
        }
      }
  }
  for (const row of results.filter((r) => r.variant === "after")) {
    const reference = results.find(
      (r) =>
        r.variant === "before" &&
        r.fixture === row.fixture &&
        r.round === row.round &&
        r.mode.name === row.mode.name,
    );
    if (reference.pixels.hash !== row.pixels.hash)
      throw new Error(
        `Pixels changed: ${row.fixture}/${row.mode.name}/${row.round}`,
      );
    if (row.summary.copiedBytes !== 0)
      throw new Error(
        `Page pixels still copied: ${row.fixture}/${row.mode.name}`,
      );
  }
  await writeFile(
    join(output, "render.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
} finally {
  server.close();
}
