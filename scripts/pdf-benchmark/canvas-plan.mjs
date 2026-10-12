/* global process, console, URL, performance, fetch, OffscreenCanvas, AbortController, Blob */
// Opt-in SDK experiment, not an application renderer or a final performance claim.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [packageRoot, output, ...fixtures] = process.argv.slice(2);
if (!output)
  throw Error("Usage: canvas-plan.mjs PDFIUM_PACKAGE OUTPUT [PDF_FILES...]");
const root = resolve(packageRoot);
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, "http://localhost").pathname;
    if (name === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Canvas plan experiment</title>");
      return;
    }
    const fixture = name.match(/^\/fixture\/(\d+)$/);
    const file = fixture
      ? fixtures[Number(fixture[1])]
      : resolve(root, "." + name);
    if (!fixture && !file.startsWith(root + "/")) throw Error("Invalid path");
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
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async (fixtureCount) => {
    const { createPDFium, createCanvasPlan, drawCanvasPlan } =
      await import("/dist/index.js");
    const engine = await createPDFium({ moduleUrl: "/wasm/pdfium.js" });
    const records = [];
    async function compare(doc, pageIndex, label) {
      const page = doc.loadPage(pageIndex);
      try {
        const started = performance.now(),
          plan = createCanvasPlan(page);
        const record = {
          label,
          pageIndex,
          planMs: performance.now() - started,
          supported: !!plan,
          cases: [],
        };
        records.push(record);
        if (!plan) return;
        const bounds = page.getBounds();
        const scale = 800 / Math.max(bounds[2], bounds[3]);
        const base = engine.Matrix.concat(
          page.getTransform(),
          engine.Matrix.scale(scale, scale),
        );
        const width = Math.ceil(bounds[2] * scale),
          height = Math.ceil(bounds[3] * scale);
        for (const [name, matrix, clip] of [
          ["page", base, [0, 0, width, height]],
          ["tile", base, [101, 51, 351, 301]],
          [
            "rotated",
            engine.Matrix.concat(base, [0, 1, -1, 0, height, 0]),
            [0, 0, height, width],
          ],
        ]) {
          const canvas = new OffscreenCanvas(1, 1),
            ctx = canvas.getContext("2d");
          const nativeStart = performance.now();
          const pixmap = page.render(matrix, clip);
          const nativeMs = performance.now() - nativeStart;
          const pixels = pixmap.getPixels().slice();
          pixmap.destroy();
          const canvasStart = performance.now();
          await drawCanvasPlan(plan, ctx, matrix, clip);
          const canvasMs = performance.now() - canvasStart;
          const actual = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          let changed = 0,
            severe = 0,
            absolute = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            let largest = 0;
            for (let c = 0; c < 4; c++) {
              const d = Math.abs(pixels[i + c] - actual[i + c]);
              largest = Math.max(largest, d);
              absolute += d;
            }
            if (largest) changed++;
            if (largest > 16) severe++;
          }
          record.cases.push({
            name,
            nativeMs,
            canvasMs,
            width: canvas.width,
            height: canvas.height,
            changedFraction: changed / (pixels.length / 4),
            severeFraction: severe / (pixels.length / 4),
            meanAbsoluteChannelError: absolute / pixels.length,
          });
          // Large orientation/placement errors must fail this audit.
          if (severe / (pixels.length / 4) > 0.05)
            throw Error(
              "Canvas fidelity regression: " + JSON.stringify(record),
            );
          canvas.width = canvas.height = 0;
        }
        const canvas = new OffscreenCanvas(31, 29),
          ctx = canvas.getContext("2d");
        ctx.fillStyle = "red";
        ctx.fillRect(0, 0, 31, 29);
        const controller = new AbortController();
        controller.abort();
        let aborted = false;
        try {
          await drawCanvasPlan(plan, ctx, base, [0, 0, width, height], {
            signal: controller.signal,
          });
        } catch (error) {
          aborted = error.name === "AbortError";
        }
        if (
          !aborted ||
          canvas.width !== 31 ||
          ctx.getImageData(0, 0, 1, 1).data[0] !== 255
        )
          throw Error("Cancelled plan changed destination");
      } finally {
        page.destroy();
      }
    }
    const doc = new engine.PDFDocument();
    try {
      doc.insertPage(
        -1,
        doc.addPage(
          [0, 0, 400, 400],
          0,
          {},
          "1 0 0 rg 30 40 70 80 re f 0 0 1 RG 3 w 130 80 m 170 300 220 40 300 320 c S 0 1 0 rg 180 180 70 70 re f",
        ),
      );
      await compare(doc, 0, "paths");
      const source = new OffscreenCanvas(96, 64),
        ctx = source.getContext("2d");
      for (const [color, x, y] of [
        ["red", 0, 0],
        ["lime", 48, 0],
        ["blue", 0, 32],
        ["yellow", 48, 32],
      ]) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 48, 32);
      }
      const encoded = new Uint8Array(
        await (
          await source.convertToBlob({ type: "image/jpeg", quality: 0.95 })
        ).arrayBuffer(),
      );
      // Chromium embeds an sRGB ICC profile; use an explicitly unprofiled
      // fixture to exercise the supported DeviceRGB JPEG subset. Profiled
      // inputs are deliberately rejected by this prototype.
      const parts = [encoded.slice(0, 2)];
      for (let offset = 2; offset < encoded.length; ) {
        if (encoded[offset] !== 255) throw Error("Unexpected JPEG marker");
        const marker = encoded[offset + 1];
        if (marker === 0xda) {
          parts.push(encoded.slice(offset));
          break;
        }
        const end =
          offset + 2 + encoded[offset + 2] * 256 + encoded[offset + 3];
        if (![0xe1, 0xe2, 0xee].includes(marker))
          parts.push(encoded.slice(offset, end));
        offset = end;
      }
      const jpeg = new Uint8Array(await new Blob(parts).arrayBuffer());
      const image = doc.addObject({
        Type: "XObject",
        Subtype: "Image",
        Width: 96,
        Height: 64,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "DCTDecode",
        Interpolate: true,
      });
      image.writeRawStream(jpeg);
      doc.insertPage(
        -1,
        doc.addPage(
          [0, 0, 400, 400],
          0,
          { XObject: { Im: image } },
          "q 300 0 0 200 40 60 cm /Im Do Q",
        ),
      );
      await compare(doc, 1, "jpeg");
      if (!records.at(-1).supported)
        throw Error("Plain DeviceRGB JPEG was rejected");
      image.put("SMask", image);
      {
        const page = doc.loadPage(1);
        try {
          if (createCanvasPlan(page)) throw Error("Soft mask must fall back");
        } finally {
          page.destroy();
        }
      }
    } finally {
      doc.destroy();
    }
    for (let i = 0; i < fixtureCount; i++) {
      const doc = new engine.PDFDocument(
        new Uint8Array(await (await fetch(`/fixture/${i}`)).arrayBuffer()),
      );
      try {
        for (const index of [
          0,
          Math.floor(doc.countPages() / 2),
          doc.countPages() - 1,
        ])
          await compare(doc, index, `fixture-${i}`);
      } finally {
        doc.destroy();
      }
    }
    if (engine.liveDocuments() !== 0) throw Error("Leaked document");
    return {
      records,
      liveDocuments: engine.liveDocuments(),
      imageCache: engine.largeImageCache(),
      wasmCapacity: engine.memory(),
    };
  }, fixtures.length);
  await writeFile(output, JSON.stringify({ fixtures, ...result }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
