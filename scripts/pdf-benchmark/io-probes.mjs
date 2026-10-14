/* global process, console, URL */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PDFDocument } = require("@cantoo/pdf-lib");
const [build, fixture, output, mode = "cancel"] = process.argv.slice(2);
if (!build || !fixture || !output)
  throw new Error("Usage: io-probes.mjs BUILD FIXTURE OUTPUT [cancel|preview]");
await mkdir(output, { recursive: true });
const root = resolve(build);
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const file = path === "/fixture.pdf" ? fixture : resolve(root, `.${path}`);
    if (file !== fixture && !file.startsWith(root + sep))
      throw new Error("Invalid path");
    const info = await stat(file);
    response.writeHead(200, {
      "Content-Length": info.size,
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".wasm": "application/wasm",
          ".pdf": "application/pdf",
        }[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file)
      .on("error", () => response.destroy())
      .pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const result = { mode, fixture, browser: browser.version(), errors: [] };
try {
  const context = await browser.newContext({
    acceptDownloads: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => result.errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/benchmark.html`);
  await page.waitForFunction(() => !!globalThis.pdfCorpus);
  await page.evaluate(() =>
    globalThis.pdfCorpus.prepare("/fixture.pdf", "/fixture.pdf"),
  );
  result.open = await page.evaluate(() => globalThis.pdfCorpus.open());
  await page.evaluate(() => globalThis.pdfCorpus.hydrate());
  if (mode === "preview") {
    result.preview = await page.evaluate(() =>
      globalThis.pdfCorpus.previewProbe(),
    );
    if (!result.preview.matchesReopened || !result.preview.differsFromOriginal)
      throw new Error("Saved preview does not match the edited revision");
  } else {
    result.before = await page.evaluate(() => globalThis.pdfCorpus.png(0));
    result.cancellations = [];
    for (const [abortAfterMs, mode] of [
      [20, "full"],
      [250, "full"],
      [500, "full"],
      [0, "incremental"],
      [0, "prefix"],
    ]) {
      const cancelled = await page.evaluate(
        ([delay, mode]) => globalThis.pdfCorpus.cancelExport(delay, mode),
        [abortAfterMs, mode],
      );
      if (!cancelled.aborted || cancelled.stats.nativeDocuments !== 1)
        throw new Error("Export did not cancel with one surviving owner");
      if (mode === "prefix" && !cancelled.prefixReached)
        throw new Error("Incremental prefix cancellation was not exercised");
      result.cancellations.push(cancelled);
    }
    result.after = await page.evaluate(() => globalThis.pdfCorpus.png(0));
    if (result.before.hash !== result.after.hash)
      throw new Error("Cancel changed page pixels");
    result.retry = await page.evaluate(() => globalThis.pdfCorpus.save());
  }
  const downloaded = page.waitForEvent("download");
  await page.evaluate(() => globalThis.pdfCorpus.download());
  const file = resolve(output, "saved.pdf");
  await (await downloaded).saveAs(file);
  result.file = file;
  await page.evaluate(() => globalThis.pdfCorpus.close());
  for (let attempt = 0; attempt < 40 && page.workers().length; attempt++)
    await page.waitForTimeout(50);
  result.workersAfterClose = page.workers().length;
  if (result.workersAfterClose)
    throw new Error("Worker survived document close");
  await browser.close();
  const reopened = await PDFDocument.load(await readFile(file));
  result.savedPages = reopened.getPageCount();
  if (result.savedPages !== result.open.pages)
    throw new Error("Saved page count changed");
  result.fields = reopened
    .getForm()
    .getFields()
    .map((field) => ({
      name: field.getName(),
      value: typeof field.getText === "function" ? field.getText() : null,
    }));
  if (
    mode === "preview" &&
    !result.fields.some((field) => field.value === "Saved preview revision")
  )
    throw new Error("Edited form value missing from saved revision");
  if (result.errors.length) throw new Error("Browser errors");
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      mode,
      ok: result.ok,
      savedPages: result.savedPages,
      cancellations: result.cancellations?.map(({ stats, ...timing }) => ({
        ...timing,
        nativeDocuments: stats.nativeDocuments,
      })),
      preview: result.preview,
      workersAfterClose: result.workersAfterClose,
      error: result.error,
    }),
  );
}
