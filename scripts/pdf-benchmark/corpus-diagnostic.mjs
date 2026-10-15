/* global process, console, URL, setTimeout, clearTimeout */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [manifestPath, output] = process.argv.slice(2);
if (!manifestPath || !output)
  throw new Error("Usage: node corpus-diagnostic.mjs MANIFEST OUTPUT_JSON");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(dirname(output), { recursive: true });
let root;
const server = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, "http://localhost").pathname;
    const file = p.startsWith("/fixtures/")
      ? manifest.fixtures.find((f) => f.id === p.slice(10)).path
      : join(root, p);
    const s = await stat(file);
    res.writeHead(200, {
      "Content-Length": s.size,
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
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const results = [];
const fixture = manifest.fixtures.find(
  (f) => f.id === (process.env.PDF_BENCH_CASES || manifest.fixtures[0].id),
);
if (!fixture) throw new Error("Unknown fixture");
const selectedVariants = process.env.PDF_BENCH_VARIANTS?.split(",");
const variants = selectedVariants
  ? manifest.variants.filter((variant) => selectedVariants.includes(variant.id))
  : manifest.variants;
if (!variants.length) throw new Error("No selected variants");
const timeoutMs = Number(process.env.PDF_BENCH_TIMEOUT_MS || 60000);
for (const variant of variants) {
  root = variant.build;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--js-flags=--expose-gc"],
  });
  const page = await browser.newPage();
  const record = { variant: variant.id, events: [] };
  results.push(record);
  const start = Date.now();
  page.on("console", (m) => {
    if (m.text().startsWith("CORPUS_STAGE"))
      record.events.push({ ms: Date.now() - start, message: m.text() });
  });
  // Sparse protocol logging only, scoped to this separate diagnostic run.
  await page.route("**/assets/pdf-render.worker*.js", async (route) => {
    const response = await route.fetch();
    const code = await response.text();
    const hook = `self.addEventListener('message',({data})=>{if(data.type==='load'||data.type==='documentCommand')console.info('CORPUS_STAGE '+JSON.stringify({type:data.type,docId:data.docId,command:data.command,id:data.id}));});\n`;
    await route.fulfill({ response, body: hook + code });
  });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/benchmark.html`);
    await page.waitForFunction(() => !!globalThis.pdfCorpus);
    await page.evaluate(
      (f) =>
        globalThis.pdfCorpus.prepare(
          `/fixtures/${f.id}`,
          `/fixtures/${f.donor}`,
        ),
      fixture,
    );
    const profile = async () =>
      Promise.all(
        page.workers().map((worker) =>
          worker.evaluate(() => {
            const result = globalThis.__pdfProfile;
            globalThis.__pdfProfile = {};
            return result;
          }),
        ),
      );
    record.open = await page.evaluate(() => globalThis.pdfCorpus.open());
    delete record.open.sizes;
    if (process.env.PDF_BENCH_PROFILE) record.openProfile = await profile();
    await page.evaluate(() =>
      globalThis.pdfCorpus.render({ pageIndex: 0, longEdge: 1600 }),
    );
    record.hydrate = await page.evaluate(() => globalThis.pdfCorpus.hydrate());
    const gc = async () => {
      await page.evaluate(() => globalThis.gc?.());
      for (const w of page.workers()) await w.evaluate(() => globalThis.gc?.());
    };
    await gc();
    for (const pageIndex of fixture.samplePages) {
      await page.evaluate((o) => globalThis.pdfCorpus.render(o), {
        pageIndex,
        longEdge: 1600,
        freshCanvas: true,
      });
      await page.evaluate((o) => globalThis.pdfCorpus.render(o), {
        pageIndex,
        longEdge: 1600,
      });
    }
    for (const freshCanvas of [true, false])
      await page.evaluate((o) => globalThis.pdfCorpus.render(o), {
        pageIndex: fixture.samplePages[1],
        longEdge: 3200,
        freshCanvas,
      });
    for (const [i, tilePosition] of [
      [0.4, 0.4],
      [0.55, 0.4],
      [0.55, 0.55],
      [0.4, 0.55],
    ].entries())
      await page.evaluate((o) => globalThis.pdfCorpus.render(o), {
        pageIndex: fixture.samplePages[1],
        longEdge: 6400,
        tilePosition,
        freshCanvas: i === 0,
      });
    await page.evaluate((o) => globalThis.pdfCorpus.render(o), {
      pageIndex: fixture.samplePages[1],
      longEdge: 6400,
      tilePosition: [0.5, 0.5],
      rotation: 90,
      freshCanvas: true,
    });
    await page.evaluate(
      (index) => globalThis.pdfCorpus.png(index),
      fixture.samplePages[1],
    );
    await gc();
    record.save = await page.evaluate(() => globalThis.pdfCorpus.save());
    await gc();
    const pending = page.waitForEvent("download");
    await page.evaluate(() => globalThis.pdfCorpus.download());
    const download = await pending;
    await download.path();
    await download.delete();
    await page.evaluate(() => globalThis.pdfCorpus.releaseDownload());
    if (process.env.PDF_BENCH_PROFILE)
      record.beforeImportProfile = await profile();
    const importStart = Date.now();
    record.events.push({ ms: importStart - start, message: "IMPORT_BEGIN" });
    let timer;
    try {
      record.import = await Promise.race([
        page.evaluate(() => globalThis.pdfCorpus.importSource()),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`diagnostic stopped after ${timeoutMs} ms`)),
            timeoutMs,
          );
        }),
      ]);
      if (process.env.PDF_BENCH_PROFILE) {
        record.importProfile = await profile();
        record.merged = await page.evaluate(() =>
          globalThis.pdfCorpus.save(true),
        );
        record.mergedProfile = await profile();
      }
    } catch (error) {
      record.error = String(error);
      record.importElapsed = Date.now() - importStart;
      record.workers = page.workers().map((w) => w.url());
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await browser.close();
  }
  await writeFile(output, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(record));
}
server.close();
