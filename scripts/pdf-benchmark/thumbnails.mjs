/* global process, console, URL, Worker, document, Image, Blob, performance, fetch, setTimeout */
// Production worker thumbnail requests: unchanged pixels, bounded cache and scheduling.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [manifestPath, output, rounds = "3", mode = "measure"] =
  process.argv.slice(2);
if (!output || !["measure", "validate"].includes(mode))
  throw Error(
    "Usage: thumbnails.mjs MANIFEST OUTPUT [ROUNDS] [measure|validate]",
  );
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(output, { recursive: true });
let root;
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, "http://localhost").pathname;
    if (name === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Production thumbnail audit</title>");
      return;
    }
    const fixture = name.startsWith("/fixtures/");
    const file = fixture
      ? manifest.fixtures.find((f) => f.id === name.slice(10))?.path
      : resolve(root, "." + name);
    if (!file || (!fixture && !file.startsWith(root + "/")))
      throw Error("Invalid path");
    res.setHeader(
      "Content-Type",
      { ".js": "text/javascript", ".wasm": "application/wasm" }[
        extname(file)
      ] ?? "application/octet-stream",
    );
    res.setHeader("Content-Length", (await stat(file)).size);
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const results = [];
const host = async () => ({
  loadavg: (await readFile("/proc/loadavg", "utf8")).trim(),
  swap: (await readFile("/proc/vmstat", "utf8"))
    .split("\n")
    .filter((line) => /^pswp(in|out) /.test(line)),
});
try {
  for (let round = 0; round < Number(rounds); round++) {
    for (const fixture of manifest.fixtures) {
      const variants =
        round % 2 ? [...manifest.variants].reverse() : manifest.variants;
      for (const variant of variants) {
        root = variant.build;
        const workerFiles = (await readdir(resolve(root, "assets"))).filter(
          (name) => /^pdf-render\.worker-.*\.js$/.test(name),
        );
        if (workerFiles.length !== 1)
          throw Error(
            "Expected one production worker; rebuild with --emptyOutDir",
          );
        const [workerFile] = workerFiles;
        const workerSha256 = createHash("sha256")
          .update(await readFile(resolve(root, "assets", workerFile)))
          .digest("hex");
        const browser = await chromium.launch({
          executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
          headless: true,
          args: ["--no-sandbox", "--disable-gpu", "--js-flags=--expose-gc"],
        });
        let sampling = false,
          sampler;
        const errors = [];
        const hostBefore = await host();
        try {
          const page = await browser.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          const cdp = await browser.newBrowserCDPSession();
          const memory = async () => {
            const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
            let pss = 0,
              rss = 0,
              swap = 0;
            for (const item of processInfo) {
              try {
                const data = await readFile(
                  `/proc/${item.id}/smaps_rollup`,
                  "utf8",
                );
                pss += Number(/^Pss:\s+(\d+)/m.exec(data)?.[1] ?? 0);
                rss += Number(/^Rss:\s+(\d+)/m.exec(data)?.[1] ?? 0);
                swap += Number(/^SwapPss:\s+(\d+)/m.exec(data)?.[1] ?? 0);
              } catch {
                /* exited */
              }
            }
            return {
              pssMiB: pss / 1024,
              rssMiB: rss / 1024,
              swapMiB: swap / 1024,
            };
          };
          const settle = async () => {
            await page.evaluate(() => globalThis.gc?.());
            for (const worker of page.workers())
              await worker.evaluate(() => globalThis.gc?.());
            await page.waitForTimeout(200);
            return memory();
          };
          await page.goto(`http://127.0.0.1:${server.address().port}`);
          await page.evaluate(
            async ({ workerFile, fixture }) => {
              const worker = new Worker(`/assets/${workerFile}`);
              const pending = new Map(),
                replies = [];
              let sequence = 0;
              worker.onmessage = ({ data }) => {
                if (data.type === "fontRequest") {
                  worker.postMessage({ type: "fontResponse", id: data.id });
                  return;
                }
                if (typeof data.success !== "boolean") return;
                replies.push({
                  id: data.id,
                  at: performance.now(),
                  success: data.success,
                  value:
                    typeof data.payload === "boolean"
                      ? data.payload
                      : undefined,
                });
                const request = pending.get(data.id);
                if (!request) return;
                pending.delete(data.id);
                if (data.success) request.resolve(data.payload);
                else request.reject(Error(data.error));
              };
              const send = (type, data = {}, transfer = []) => {
                const id = `thumb-${++sequence}`;
                const done = new Promise((resolve, reject) =>
                  pending.set(id, { resolve, reject }),
                );
                worker.postMessage({ type, id, ...data }, transfer);
                return { id, done };
              };
              const bytes = new Uint8Array(
                await (await fetch(`/fixtures/${fixture.id}`)).arrayBuffer(),
              );
              await send("load", { data: bytes }, [bytes.buffer]).done;
              const { pages } = await send("inspectDocument").done;
              const parsed = await send("parseDocument").done;
              const content = (index) => ({
                width: pages[index].width,
                height: pages[index].height,
                fields: parsed.fields.filter((f) => f.pageIndex === index),
                annotations: parsed.annotations.filter(
                  (a) => a.pageIndex === index,
                ),
                preserved: parsed.preservedSourceAnnotations.filter(
                  (a) => a.pageIndex === index,
                ),
              });
              const thumb = (index, png = false, edited = false) => {
                const snapshot = content(index);
                if (edited)
                  snapshot.fields = snapshot.fields.map((field) =>
                    field.type === "Text"
                      ? { ...field, value: "UPDATED" }
                      : field,
                  );
                if (edited)
                  snapshot.annotations.push({
                    id: "preview-live-note",
                    pageIndex: index,
                    type: "comment",
                    rect: { x: 24, y: 24, width: 20, height: 20 },
                    color: "#ff0000",
                  });
                return send("renderImage", {
                  pageIndex: index,
                  targetWidth: 500,
                  mimeType: png ? "image/png" : "image/jpeg",
                  quality: 0.7,
                  priority: 20,
                  renderAnnotations: true,
                  thumbnailContent: snapshot,
                });
              };
              const render = (index, tile) => {
                const canvas = document.createElement("canvas");
                document.body.append(canvas);
                const offscreen = canvas.transferControlToOffscreen();
                return send(
                  "render",
                  {
                    pageIndex: index,
                    scale:
                      1600 / Math.max(pages[index].width, pages[index].height),
                    rotation: 0,
                    canvasId: `reader-${sequence}`,
                    canvas: offscreen,
                    renderAnnotations: false,
                    tile,
                  },
                  [offscreen],
                );
              };
              globalThis.thumbnailAudit = {
                worker,
                send,
                pages,
                replies,
                thumb,
                render,
              };
            },
            { workerFile, fixture },
          );
          const baseline = await settle();
          let peak = baseline;
          sampling = true;
          sampler = (async () => {
            while (sampling) {
              const sample = await memory();
              peak = Object.fromEntries(
                Object.keys(peak).map((key) => [
                  key,
                  Math.max(peak[key], sample[key]),
                ]),
              );
              await new Promise((done) => setTimeout(done, 50));
            }
          })();
          const record = await page.evaluate(
            async ({ fixture, validate }) => {
              const { send, thumb, render, worker, replies } =
                globalThis.thumbnailAudit;
              const timings = [],
                captures = [];
              for (const index of fixture.samplePages)
                for (const repeat of [false, true]) {
                  const start = performance.now();
                  const result = await thumb(
                    index,
                    validate,
                    !validate && repeat && fixture.editRepeat === true,
                  ).done;
                  const received = performance.now();
                  const blob = new Blob([result.imageBytes], {
                    type: result.mimeType,
                  });
                  const url = URL.createObjectURL(blob),
                    image = new Image();
                  image.src = url;
                  await image.decode();
                  timings.push({
                    index,
                    repeat,
                    edited: !validate && repeat && fixture.editRepeat === true,
                    rpcMs: received - start,
                    totalMs: performance.now() - start,
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  });
                  URL.revokeObjectURL(url);
                  if (validate)
                    captures.push({
                      index,
                      label: repeat ? "repeat" : "cold",
                      bytes: Array.from(new Uint8Array(result.imageBytes)),
                    });
                }
              const stats = await send("documentStats").done;
              const scheduling = [];
              if (validate) {
                const index = fixture.samplePages[0];
                for (const edited of [true, false]) {
                  const result = await thumb(index, true, edited).done;
                  captures.push({
                    index,
                    label: edited ? "edited" : "restored",
                    bytes: Array.from(new Uint8Array(result.imageBytes)),
                  });
                }
                const readerIndex = fixture.readerPage ?? index;
                await render(readerIndex).done;
                const readerBefore = (await send("documentStats").done)
                  .scanCanvas;
                if (fixture.requireReaderCache && !readerBefore.bytes)
                  throw Error("Reader cache was not populated");
                if (fixture.stressPages) {
                  for (const other of fixture.stressPages)
                    await thumb(other).done;
                }
                const afterStress = await send("documentStats").done;
                if (afterStress.scanCanvas.bytes !== readerBefore.bytes)
                  throw Error("Thumbnails changed the reader cache budget");
                if (
                  afterStress.thumbnailRaster?.bytes >
                  afterStress.thumbnailRaster?.limit
                )
                  throw Error("Unbounded thumbnail cache");
                if (fixture.preemptionPages) {
                  const delay = (ms) =>
                    new Promise((done) => setTimeout(done, ms));
                  for (const cancel of [false, true]) {
                    const preview = thumb(
                      fixture.preemptionPages[cancel ? 1 : 0],
                    );
                    await delay(40);
                    const start = performance.now();
                    const foreground = render(readerIndex, [0, 0, 512, 512]);
                    if (cancel)
                      worker.postMessage({ type: "cancel", id: preview.id });
                    await foreground.done;
                    const foregroundMs = performance.now() - start;
                    const value = await preview.done;
                    const responses = replies.filter(
                      (r) => r.id === preview.id,
                    );
                    if (responses.length !== 1 || (cancel && value !== false))
                      throw Error("Bad cancel/preemption reply");
                    if (
                      !cancel &&
                      responses[0].at <=
                        replies.find((r) => r.id === foreground.id).at
                    )
                      throw Error("Foreground did not preempt thumbnail");
                    scheduling.push({
                      cancel,
                      foregroundMs,
                      previewCompleted: value !== false,
                      replies: responses.length,
                    });
                  }
                  const preview = thumb(fixture.preemptionPages[2]);
                  await delay(40);
                  const start = performance.now();
                  worker.postMessage({ type: "cancel", id: preview.id });
                  if ((await preview.done) !== false)
                    throw Error("Cancellation published an image");
                  scheduling.push({
                    activeCancelMs: performance.now() - start,
                  });
                  if (
                    !(await thumb(fixture.preemptionPages[2]).done)?.imageBytes
                  )
                    throw Error("Cancelled preview could not retry");
                }
                const active = await send("documentStats").done;
                if (
                  active.nativeDocuments !== 1 ||
                  active.peakNativeDocuments !== 1
                )
                  throw Error("Single owner violated");
                return {
                  timings,
                  stats,
                  afterStress,
                  active,
                  scheduling,
                  captures,
                };
              }
              return { timings, stats, scheduling, captures };
            },
            { fixture, validate: mode === "validate" },
          );
          sampling = false;
          await sampler;
          const retained = await settle();
          await page.evaluate(async () => {
            const { worker, send } = globalThis.thumbnailAudit;
            await send("unload").done;
            const result = await send("documentStats").done.catch((e) =>
              String(e),
            );
            if (!String(result).includes("PDF Document not loaded"))
              throw Error("Document remained loaded");
            worker.terminate();
          });
          for (const capture of record.captures) {
            capture.file = `${fixture.id}-${capture.index}-${capture.label}-${variant.id}.png`;
            await writeFile(
              resolve(output, capture.file),
              Buffer.from(capture.bytes),
            );
            delete capture.bytes;
          }
          results.push({
            round,
            variant: variant.id,
            revision: variant.revision,
            workerFile,
            workerSha256,
            fixture: fixture.id,
            mode,
            browser: browser.version(),
            errors,
            hostBefore,
            hostAfter: await host(),
            baseline,
            peak,
            retained,
            ...record,
          });
          await writeFile(
            resolve(output, "results.json"),
            JSON.stringify(results, null, 2),
          );
          console.log(
            JSON.stringify({
              round,
              fixture: fixture.id,
              variant: variant.id,
              timings: record.timings,
              peak,
              retained,
              scheduling: record.scheduling,
            }),
          );
          if (errors.length) throw Error(errors.join("\n"));
        } finally {
          sampling = false;
          await sampler;
          await browser.close();
        }
      }
    }
  }
  if (mode === "validate") {
    const { PNG } = require("pngjs"),
      comparisons = [];
    for (const result of results) {
      const edited = result.captures.find((c) => c.label === "edited");
      const cold = result.captures.find(
        (c) => c.index === edited.index && c.label === "cold",
      );
      const restored = result.captures.find((c) => c.label === "restored");
      const pixels = async (capture) =>
        PNG.sync.read(await readFile(resolve(output, capture.file))).data;
      const original = await pixels(cold);
      if (
        !original.equals(await pixels(restored)) ||
        original.equals(await pixels(edited))
      )
        throw Error(
          "Cached body hid a live overlay update or failed to restore it",
        );
    }
    for (const fixture of manifest.fixtures) {
      const reference = results.find(
        (r) =>
          r.fixture === fixture.id && r.variant === manifest.variants[0].id,
      );
      for (const candidate of results.filter(
        (r) => r.fixture === fixture.id && r.variant !== reference.variant,
      )) {
        for (const actual of candidate.captures) {
          const expected = reference.captures.find(
            (c) => c.index === actual.index && c.label === actual.label,
          );
          const a = PNG.sync.read(
              await readFile(resolve(output, expected.file)),
            ),
            b = PNG.sync.read(await readFile(resolve(output, actual.file)));
          const exact =
            a.width === b.width &&
            a.height === b.height &&
            a.data.equals(b.data);
          comparisons.push({
            fixture: fixture.id,
            index: actual.index,
            label: actual.label,
            exact,
          });
        }
      }
    }
    await writeFile(
      resolve(output, "comparisons.json"),
      JSON.stringify(comparisons, null, 2),
    );
    if (comparisons.some((c) => !c.exact))
      throw Error("Thumbnail pixels changed; inspect comparisons.json");
  }
} finally {
  server.close();
}
