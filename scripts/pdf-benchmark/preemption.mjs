/* global process, console, URL, document, Worker, fetch, performance, setTimeout */
// Production worker: preview preemption and active cancellation, no test hooks.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [before, after, drawing, output, rounds = "3"] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: preemption.mjs BEFORE_APP AFTER_APP DRAWING OUTPUT [ROUNDS]",
  );
const results = [];
for (let round = 0; round < Number(rounds); round++) {
  const variants = [
    ["before", before],
    ["after", after],
  ];
  for (const [variant, root] of round % 2 ? variants.reverse() : variants) {
    const workerFile = (await readdir(resolve(root, "assets"))).find((name) =>
      /^pdf-render\.worker-.*\.js$/.test(name),
    );
    const server = createServer(async (req, res) => {
      try {
        const name = new URL(req.url, "http://localhost").pathname;
        if (name === "/") {
          res.setHeader("Content-Type", "text/html");
          res.end("<!doctype html><title>Worker scheduling audit</title>");
          return;
        }
        const file =
          name === "/fixture.pdf" ? drawing : resolve(root, "." + name);
        if (name !== "/fixture.pdf" && !file.startsWith(root + "/"))
          throw Error("Invalid path");
        res.setHeader(
          "Content-Type",
          extname(file) === ".js"
            ? "text/javascript"
            : extname(file) === ".wasm"
              ? "application/wasm"
              : "application/octet-stream",
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
      const result = await page.evaluate(async (workerFile) => {
        const worker = new Worker(`/assets/${workerFile}`);
        const replies = [],
          pending = new Map();
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
            payload:
              typeof data.payload === "boolean" ? data.payload : undefined,
          });
          const p = pending.get(data.id);
          if (p) {
            pending.delete(data.id);
            if (data.success) p.resolve(data.payload);
            else p.reject(Error(data.error));
          }
        };
        const send = (type, data = {}, transfer = []) => {
          const id = `audit-${++sequence}`;
          const done = new Promise((resolve, reject) =>
            pending.set(id, { resolve, reject }),
          );
          worker.postMessage({ type, id, ...data }, transfer);
          return { id, done };
        };
        const render = (pageIndex, scale, tile) => {
          const element = document.createElement("canvas");
          element.width = element.height = 1;
          document.body.append(element);
          const canvas = element.transferControlToOffscreen();
          return send(
            "render",
            {
              pageIndex,
              scale,
              rotation: 0,
              canvasId: `canvas-${sequence}`,
              canvas,
              tile,
              renderAnnotations: false,
            },
            [canvas],
          );
        };
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        try {
          const bytes = new Uint8Array(
            await (await fetch("/fixture.pdf")).arrayBuffer(),
          );
          await send("load", { data: bytes }, [bytes.buffer]).done;
          const { pages } = await send("inspectDocument").done;
          const scale = 3200 / Math.max(pages[1].width, pages[1].height);
          await render(1, scale).done;
          const preview = send("renderImage", {
            pageIndex: 21,
            targetWidth: 180,
            mimeType: "image/jpeg",
            priority: 100,
          });
          await delay(40);
          const foregroundStart = performance.now();
          const foreground = render(1, scale * 2, [512, 512, 1024, 1024]);
          const foregroundRendered = await foreground.done;
          const foregroundMs = performance.now() - foregroundStart;
          await preview.done;
          const previewReply = replies.find((r) => r.id === preview.id),
            foregroundReply = replies.find((r) => r.id === foreground.id);
          const cancelled = render(42, scale);
          await delay(40);
          const cancelStart = performance.now();
          worker.postMessage({ type: "cancel", id: cancelled.id });
          const cancelledResult = await cancelled.done;
          const cancelMs = performance.now() - cancelStart;
          const stats = await send("documentStats").done;
          const restarted = await render(42, scale, [0, 0, 512, 512]).done;
          const parsed = await send("parseDocument").done;
          const beforeSave = await send("documentStats").done;
          const exported = await send("exportDocument", {
            fields: parsed.fields,
            annotations: parsed.annotations,
            metadata: { ...parsed.metadata, title: "Metadata cache audit" },
            options: {
              preservedSourceAnnotations: parsed.preservedSourceAnnotations,
              syncFormFields: false,
            },
          }).done;
          const afterSave = await send("documentStats").done;
          const redrawStart = performance.now();
          await render(42, scale, [0, 0, 512, 512]).done;
          const postSaveRedrawMs = performance.now() - redrawStart;
          await send("releaseCanvas", {
            canvasIds: Array.from(
              { length: sequence },
              (_, i) => `canvas-${i}`,
            ),
          }).done;
          await send("unload").done;
          const closed = await send("documentStats").done.catch((error) =>
            String(error),
          );
          if (!String(closed).includes("PDF Document not loaded"))
            throw Error("Document remained loaded");
          await delay(50);
          return {
            foregroundMs,
            foregroundRendered,
            foregroundBeforePreview: foregroundReply.at < previewReply.at,
            cancelMs,
            cancelledResult,
            cancelledReplies: replies.filter((r) => r.id === cancelled.id)
              .length,
            restarted,
            beforeSave,
            afterSave,
            exportedBytes: exported.byteLength,
            postSaveRedrawMs,
            stats,
            closed,
            replies,
          };
        } finally {
          worker.terminate();
        }
      }, workerFile);
      if (
        variant === "after" &&
        (!result.foregroundBeforePreview ||
          result.cancelledResult !== false ||
          result.cancelledReplies !== 1 ||
          !result.restarted)
      )
        throw Error(
          "Cooperative scheduling validation failed: " + JSON.stringify(result),
        );
      results.push({ variant, round, ...result });
      console.log(
        variant,
        round,
        result.foregroundMs,
        result.cancelMs,
        result.foregroundBeforePreview,
      );
      await writeFile(output, JSON.stringify(results, null, 2));
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  }
}
