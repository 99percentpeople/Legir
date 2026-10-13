/* global process, console, URL, OffscreenCanvas, Blob */
// Synthetic scan geometry/quality cases; no source-document images are embedded.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
const { chromium } = createRequire(import.meta.url)("playwright");
const [packagePath, output] = process.argv.slice(2);
if (!output) throw Error("Usage: scan-fixtures.mjs PDFIUM_PACKAGE OUTPUT_PDF");
const root = resolve(packagePath);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Scan fixtures</title>");
      return;
    }
    const file = resolve(root, "." + path);
    if (!file.startsWith(root + "/")) throw Error("Invalid path");
    res.setHeader("Content-Length", (await stat(file)).size);
    res.setHeader(
      "Content-Type",
      extname(file) === ".js" ? "text/javascript" : "application/wasm",
    );
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
  const result = await page.evaluate(async () => {
    const { createPDFium } = await import("/dist/index.js");
    const engine = await createPDFium({ moduleUrl: "/wasm/pdfium.js" });
    const doc = new engine.PDFDocument();
    const canvas = new OffscreenCanvas(3072, 2048),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < 2048; y += 64) {
      ctx.fillStyle = y % 128 ? "#204080" : "#202020";
      ctx.font = `${12 + (y % 29)}px sans-serif`;
      ctx.fillText(
        `Scan row ${y}: ABC xyz 0123456789 — thin lines`,
        24,
        y + 28,
      );
      for (let x = 800; x < 2400; x += 10) ctx.fillRect(x, y, 1 + (x % 3), 45);
      ctx.fillStyle = `hsl(${y / 7} 85% 50%)`;
      ctx.fillRect(2500, y, 480, 50);
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 0.8 + (y % 3);
      ctx.beginPath();
      ctx.moveTo(10, y + 40);
      ctx.lineTo(2450, y + 58);
      ctx.stroke();
    }
    const encoded = new Uint8Array(
      await (
        await canvas.convertToBlob({ type: "image/jpeg", quality: 0.96 })
      ).arrayBuffer(),
    );
    const parts = [encoded.slice(0, 2)];
    for (let offset = 2; offset < encoded.length; ) {
      const marker = encoded[offset + 1];
      if (marker === 0xda) {
        parts.push(encoded.slice(offset));
        break;
      }
      const end = offset + 2 + encoded[offset + 2] * 256 + encoded[offset + 3];
      if (![0xe1, 0xe2, 0xee].includes(marker))
        parts.push(encoded.slice(offset, end));
      offset = end;
    }
    const jpeg = new Uint8Array(await new Blob(parts).arrayBuffer());
    const makeImage = (extra = {}) => {
      const image = doc.addObject({
        Type: "XObject",
        Subtype: "Image",
        Width: 3072,
        Height: 2048,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "DCTDecode",
        ...extra,
      });
      image.writeRawStream(jpeg);
      return image;
    };
    const image = makeImage(),
      interpolated = makeImage({ Interpolate: true });
    const add = (
      matrix,
      {
        rotation = 0,
        crop,
        source = image,
        suffix = "",
        annotations = false,
      } = {},
    ) => {
      const object = doc.addPage(
        [0, 0, 1200, 800],
        rotation,
        { XObject: { Im: source } },
        `q ${matrix.join(" ")} cm /Im Do Q ${suffix}`,
      );
      if (crop) object.put("CropBox", crop);
      if (annotations)
        object.put("Annots", [
          {
            Type: "Annot",
            Subtype: "Square",
            Rect: [200, 200, 500, 450],
            C: [1, 0, 0],
            BS: { W: 8 },
            F: 4,
          },
        ]);
      doc.insertPage(-1, object);
      object.destroy();
    };
    add([1200, 0, 0, 800, 0, 0]);
    add([1200, 0, 0, 800, 0, 0], { rotation: 90 });
    add([1300.25, 0, 0, 900.5, -50.125, -60.25], {
      crop: [31.25, 21.5, 1167.75, 763.25],
    });
    add([-1200, 0, 0, 800, 1200, 0]);
    add([1200, 0, 0, -800, 0, 800]);
    add([0, 800, -1200, 0, 1200, 0]);
    add([1200, 0, 0, 800, 0, 0], { source: interpolated });
    // Body-only rendering supports this page; annotation requests must fall back.
    add([1200, 0, 0, 800, 0, 0], { annotations: true });
    // Non-scan content and soft masks must use native rendering as a whole page.
    add([1200, 0, 0, 800, 0, 0], { suffix: "1 0 0 rg 100 100 200 200 re f" });
    const mask = doc.addObject({
      Type: "XObject",
      Subtype: "Image",
      Width: 1,
      Height: 1,
      ColorSpace: "DeviceGray",
      BitsPerComponent: 8,
    });
    mask.writeRawStream(new Uint8Array([160]));
    const masked = makeImage({ SMask: mask });
    add([1200, 0, 0, 800, 0, 0], { source: masked });
    const bytes = doc.saveToBuffer();
    const result = Array.from(bytes.asUint8Array());
    bytes.destroy();
    masked.destroy();
    mask.destroy();
    interpolated.destroy();
    image.destroy();
    doc.destroy();
    return result;
  });
  await writeFile(output, Buffer.from(result));
  console.log(JSON.stringify({ output, bytes: result.length, pages: 10 }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
