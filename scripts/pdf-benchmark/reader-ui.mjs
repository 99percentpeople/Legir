/* global process, console, window, performance, DataTransfer, File, URL, fetch,
   document, DragEvent, setTimeout, clearTimeout, devicePixelRatio,
   OffscreenCanvasRenderingContext2D */
// Actual production UI open + same-page redraw probes with normal thumbnails.
// Timing includes RPC queuing and acknowledgement, not final display scanout.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [before, after, drawing, book, output, rounds = "3", original] =
  process.argv.slice(2);
if (!before || !after || !drawing || !book || !output)
  throw Error(
    "Usage: reader-ui.mjs BEFORE_BUILD AFTER_BUILD DRAWING_PDF BOOK_PDF OUTPUT_JSON [ROUNDS] [PDFJS_BUILD]",
  );
const variants = [
  ["before", before],
  ["after", after],
  ...(original ? [["pdfjs", original]] : []),
];
const fixtures = [
  ["drawing", drawing],
  ["book", book],
];
const results = [];
async function hostSnapshot() {
  return {
    loadavg: (await readFile("/proc/loadavg", "utf8")).trim(),
    swap: (await readFile("/proc/vmstat", "utf8"))
      .split("\n")
      .filter((line) => /^pswp(in|out) /.test(line)),
  };
}
for (let round = 0; round < Number(rounds); round++)
  for (const [fixture, path] of fixtures)
    for (const [variant, root] of round % 2
      ? [...variants].reverse()
      : variants) {
      const server = createServer(async (req, res) => {
        try {
          const name = new URL(req.url, "http://localhost").pathname;
          let file =
            name === "/__audit_fixture.pdf" ? path : resolve(root, "." + name);
          if (name !== "/__audit_fixture.pdf" && !file.startsWith(root + "/"))
            file = root + "/index.html";
          try {
            if (!(await stat(file)).isFile()) file = root + "/index.html";
          } catch {
            file = root + "/index.html";
          }
          const mime = {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".wasm": "application/wasm",
            ".json": "application/json",
            ".webmanifest": "application/manifest+json",
            ".svg": "image/svg+xml",
            ".pdf": "application/pdf",
            ".woff2": "font/woff2",
          };
          res.setHeader(
            "Content-Type",
            mime[extname(file)] || "application/octet-stream",
          );
          res.setHeader("Content-Length", (await stat(file)).size);
          createReadStream(file).pipe(res);
        } catch (error) {
          res.statusCode = 500;
          res.end(String(error));
        }
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const base = `http://127.0.0.1:${server.address().port}`;
      const browser = await chromium.launch({
        headless: true,
        executablePath: "/usr/bin/chromium",
        args: ["--no-sandbox", "--disable-gpu"],
      });
      const record = {
        fixture,
        variant,
        round,
        started: new Date().toISOString(),
        errors: [],
        hostBefore: await hostSnapshot(),
      };
      console.log("start", fixture, variant);
      try {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          deviceScaleFactor: 1,
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        page.on("pageerror", (e) => record.errors.push(String(e)));
        await page.addInitScript(() => {
          const trace = (window.__trace = {
            records: [],
            workers: [],
            start: 0,
            sequence: 0,
          });
          const NativeWorker = window.Worker;
          window.Worker = class extends NativeWorker {
            constructor(url, options) {
              super(url, options);
              const wi = trace.workers.length;
              trace.workers.push(this);
              const pending = new Map();
              this.addEventListener("message", (e) => {
                const d = e.data;
                if (typeof d?.success !== "boolean") return;
                const r = pending.get(d.id);
                if (!r) return;
                r.done = performance.now();
                r.ms = r.done - r.sent;
                r.success = d.success;
                if (!d.success) r.error = d.error;
                if (r.type === "render") r.rendered = d.payload;
                if (r.type === "documentStats") r.stats = d.payload;
                pending.delete(d.id);
              });
              const send = this.postMessage.bind(this);
              this.postMessage = (d, ...rest) => {
                if (d?.id && d.type) {
                  const r = {
                    worker: wi,
                    id: d.id,
                    type: d.type,
                    pageIndex: d.pageIndex,
                    scale: d.scale,
                    rotation: d.rotation,
                    canvasId: d.canvasId,
                    tile: d.tile,
                    targetWidth: d.targetWidth,
                    priority: d.priority,
                    docId: d.docId,
                    sent: performance.now(),
                  };
                  trace.records.push(r);
                  pending.set(d.id, r);
                }
                return send(d, ...rest);
              };
            }
          };
          window.__probe = async (type) => {
            const first = trace.records.find(
              (r) => r.type === "render" && r.rendered === true,
            );
            if (!first) throw Error("No completed canvas render");
            const id = `audit-${trace.sequence++}`;
            const w = trace.workers[first.worker];
            const data =
              type === "render"
                ? {
                    type,
                    id,
                    pageIndex: first.pageIndex,
                    scale: first.scale,
                    rotation: first.rotation,
                    canvasId: first.canvasId,
                    docId: first.docId,
                    priority: -1,
                  }
                : { type, id };
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(Error("Probe timed out")),
                60000,
              );
              const receive = (e) => {
                if (e.data?.id !== id || typeof e.data.success !== "boolean")
                  return;
                clearTimeout(timeout);
                w.removeEventListener("message", receive);
                if (e.data.success) resolve();
                else reject(Error(e.data.error));
              };
              w.addEventListener("message", receive);
              w.postMessage(data);
            });
          };
        });
        await page.goto(base);
        await page
          .getByRole("button", { name: "Open PDF", exact: true })
          .waitFor();
        await page.evaluate(async () => {
          window.__fixture = await (await fetch("/__audit_fixture.pdf")).blob();
        });
        await page.evaluate(() => {
          const dt = new DataTransfer();
          dt.items.add(
            new File([window.__fixture], "audit.pdf", {
              type: "application/pdf",
            }),
          );
          delete window.__fixture;
          window.__trace.start = performance.now();
          document.elementFromPoint(700, 400).dispatchEvent(
            new DragEvent("drop", {
              dataTransfer: dt,
              bubbles: true,
              cancelable: true,
              clientX: 700,
              clientY: 400,
            }),
          );
        });
        await page.waitForFunction(
          () =>
            window.__trace.records.some(
              (r) => r.type === "render" && r.rendered === true,
            ),
          null,
          { timeout: 120000 },
        );
        await page.waitForFunction(
          () => performance.getEntriesByName("pdf:hydrated", "mark").length > 0,
          null,
          { timeout: 120000 },
        );
        const owner = page
          .workers()
          .find((worker) => worker.url().includes("pdf-render"));
        await owner.evaluate(() => {
          globalThis.pixelWrites = [];
          const proto = OffscreenCanvasRenderingContext2D.prototype;
          const original = proto.putImageData;
          proto.putImageData = function (...args) {
            const start = performance.now();
            try {
              return original.apply(this, args);
            } finally {
              globalThis.pixelWrites.push({
                width: args[0].width,
                height: args[0].height,
                ms: performance.now() - start,
              });
            }
          };
        });
        if (variant !== "pdfjs")
          await page.evaluate(() => window.__probe("documentStats"));
        for (let i = 0; i < 3; i++) {
          await page.waitForTimeout(1200);
          await page.evaluate(() => window.__probe("render"));
          if (variant !== "pdfjs")
            await page.evaluate(() => window.__probe("documentStats"));
        }
        if (fixture === "drawing") {
          record.zoomStart = await page.evaluate(() => performance.now());
          await page
            .getByTitle("Zoom In (Ctrl + +)", { exact: true })
            .filter({ visible: true })
            .click();
          await page.waitForFunction(
            (start) =>
              window.__trace.records.some(
                (r) =>
                  r.type === "render" &&
                  r.tile &&
                  r.rendered === true &&
                  r.sent > start,
              ),
            record.zoomStart,
            { timeout: 120000 },
          );
          await page.waitForTimeout(2000);
        }
        const cdp = await browser.newBrowserCDPSession();
        const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
        let pssKiB = 0;
        for (const entry of processInfo) {
          try {
            pssKiB += Number(
              (await readFile(`/proc/${entry.id}/smaps_rollup`, "utf8")).match(
                /^Pss:\s+(\d+)/m,
              )?.[1] ?? 0,
            );
          } catch {
            /* Process may have exited. */
          }
        }
        record.browserPssMiB = pssKiB / 1024;
        record.pixelWrites = await owner.evaluate(() => globalThis.pixelWrites);
        await cdp.detach();
        Object.assign(
          record,
          await page.evaluate(() => ({
            start: window.__trace.start,
            trace: window.__trace.records,
            marks: performance
              .getEntriesByType("mark")
              .map(({ name, startTime }) => ({ name, startTime })),
            measures: performance
              .getEntriesByType("measure")
              .map(({ name, startTime, duration }) => ({
                name,
                startTime,
                duration,
              })),
            canvasSizes: [...document.querySelectorAll("canvas")].map((c) => [
              c.width,
              c.height,
            ]),
            dpr: devicePixelRatio,
          })),
        );
        record.status = "ok";
      } catch (error) {
        record.status = "failed";
        record.error = String(error);
      } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
      }
      record.finished = new Date().toISOString();
      record.hostAfter = await hostSnapshot();
      results.push(record);
      await writeFile(output, JSON.stringify(results, null, 2));
      console.log(
        "done",
        fixture,
        variant,
        record.status,
        JSON.stringify(record.measures),
      );
    }
