/* global process, console, URL, setTimeout, setInterval, clearInterval */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
import { PDFDocument } from "@legir/pdfium/authoring";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [root, fixtureDir, output, rounds = "3"] = process.argv.slice(2);
if (!root || !fixtureDir || !output)
  throw new Error("Usage: node run.mjs BUILT_DIR FIXTURES OUTPUT [ROUNDS]");
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const fixture = url.pathname.startsWith("/fixtures/");
    const filename = join(
      fixture ? fixtureDir : root,
      fixture ? url.pathname.slice(10) : url.pathname,
    );
    const bytes = await readFile(filename);
    const mime =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".pdf": "application/pdf",
        ".json": "application/json",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
      }[extname(filename)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/benchmark.html`;
const results = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  for (const fixture of ["forms", "large-images", "large-import"])
    for (let round = 0; round < Number(rounds); round++) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
        args: ["--no-sandbox", "--js-flags=--expose-gc"],
      });
      try {
        const context = await browser.newContext({
          acceptDownloads: true,
          viewport: { width: 1440, height: 1000 },
          serviceWorkers: "block",
        });
        const page = await context.newPage(),
          cdp = await browser.newBrowserCDPSession(),
          main = await context.newCDPSession(page);
        const errors = [],
          warnings = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error") warnings.push(message.text());
        });
        await main.send("Performance.enable");
        await page.goto(url);
        await page.waitForFunction(
          () => !!globalThis.pdfBenchmark,
          {},
          { timeout: 60000 },
        );
        await page.evaluate(
          (name) =>
            globalThis.pdfBenchmark.prepare(
              `/fixtures/${name === "large-import" ? "forms" : name}.pdf`,
              name === "large-import"
                ? "/fixtures/large-images.pdf"
                : "/fixtures/donor.pdf",
            ),
          fixture,
        );
        const memory = async () => {
          const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
          let pssKiB = 0,
            rssKiB = 0;
          for (const item of processInfo) {
            try {
              const info = await readFile(
                `/proc/${item.id}/smaps_rollup`,
                "utf8",
              );
              pssKiB += Number(/^Pss:\s+(\d+)/m.exec(info)?.[1] ?? 0);
              rssKiB += Number(/^Rss:\s+(\d+)/m.exec(info)?.[1] ?? 0);
            } catch {
              /* Process exited between samples. */
            }
          }
          return { pssMiB: pssKiB / 1024, rssMiB: rssKiB / 1024 };
        };
        const settle = async () => {
          await page.evaluate(() => globalThis.gc?.());
          for (const worker of page.workers())
            await worker.evaluate(() => globalThis.gc?.()).catch(() => {});
          await delay(150);
          return memory();
        };
        const record = {
          fixture,
          round,
          environment: {
            browser: browser.version(),
            platform: process.platform,
            arch: process.arch,
          },
          baseline: await settle(),
          phases: {},
          errors,
          warnings,
        };
        const phase = async (name, run) => {
          let peak = await memory(),
            sampling = false;
          const timer = setInterval(async () => {
            if (sampling) return;
            sampling = true;
            try {
              const sample = await memory();
              peak = {
                pssMiB: Math.max(peak.pssMiB, sample.pssMiB),
                rssMiB: Math.max(peak.rssMiB, sample.rssMiB),
              };
            } finally {
              sampling = false;
            }
          }, 50);
          try {
            const value = await run();
            if (process.env.PDF_BENCH_PROFILE) {
              value.profile = await Promise.all(
                page.workers().map((worker) =>
                  worker
                    .evaluate(() => {
                      const profile = globalThis.__pdfProfile;
                      globalThis.__pdfProfile = {};
                      return profile;
                    })
                    .catch(() => null),
                ),
              );
            }
            const beforeGC = await memory();
            peak = {
              pssMiB: Math.max(peak.pssMiB, beforeGC.pssMiB),
              rssMiB: Math.max(peak.rssMiB, beforeGC.rssMiB),
            };
            return (record.phases[name] = {
              ...value,
              peak,
              retained: await settle(),
            });
          } finally {
            clearInterval(timer);
            while (sampling) await delay(5);
          }
        };
        await phase("open", () =>
          page.evaluate(() => globalThis.pdfBenchmark.open()),
        );
        await phase("firstRender", () =>
          page.evaluate(() => globalThis.pdfBenchmark.render()),
        );
        await phase("hydrate", () =>
          page.evaluate(() => globalThis.pdfBenchmark.hydrate()),
        );
        await phase("warmRender", () =>
          page.evaluate(() => globalThis.pdfBenchmark.render()),
        );
        await phase("lastRender", () =>
          page.evaluate(
            (index) => globalThis.pdfBenchmark.render(index),
            fixture === "large-images" ? 59 : 11,
          ),
        );
        await phase("export", () =>
          page.evaluate(() => globalThis.pdfBenchmark.save()),
        );
        const save = async (name) => {
          const pending = page.waitForEvent("download");
          await page.evaluate(() => globalThis.pdfBenchmark.download());
          const download = await pending;
          const file = join(output, `${fixture}-${round}-${name}.pdf`);
          await download.saveAs(file);
          const pdf = await PDFDocument.load(await readFile(file));
          try {
            return {
              pages: pdf.getPageCount(),
              fields: pdf
                .getForm()
                .getFields()
                .map((field) => ({
                  name: field.getName(),
                  value:
                    typeof field.getText === "function"
                      ? field.getText()
                      : undefined,
                })),
            };
          } finally {
            pdf.destroy();
          }
        };
        record.exportValidation = await save("export");
        if (
          record.exportValidation.fields.some(
            (field) => field.value !== "BENCHMARK EDIT",
          )
        )
          throw new Error("Edited field value was not saved");
        await phase("import", () =>
          page.evaluate(() => globalThis.pdfBenchmark.importSource()),
        );
        await phase("mergedExport", () =>
          page.evaluate(() => globalThis.pdfBenchmark.save(true)),
        );
        record.mergeValidation = await save("merged");
        record.nativeStats = await page.evaluate(() =>
          globalThis.pdfBenchmark.stats(),
        );
        if (
          record.exportValidation.pages !==
          (fixture === "large-images" ? 60 : 12)
        )
          throw new Error("Export page count differs");
        if (
          record.mergeValidation.pages !==
          record.exportValidation.pages + (fixture === "large-import" ? 60 : 4)
        )
          throw new Error("Imported page count differs");
        if (
          record.mergeValidation.fields.length !==
          record.exportValidation.fields.length +
            (fixture === "large-import" ? 20 : 2)
        )
          throw new Error("Imported fields were lost");
        if (errors.length) throw new Error(errors.join("\n"));
        await page.evaluate(() => globalThis.pdfBenchmark.close());
        // Wait for the harness's download Blob URLs to be revoked before
        // attributing retained memory to the PDF engine.
        await delay(1200);
        record.afterClose = await settle();
        results.push(record);
        await writeFile(
          join(output, "results.json"),
          JSON.stringify(results, null, 2),
        );
        console.log(
          JSON.stringify({
            fixture,
            round,
            timings: Object.fromEntries(
              Object.entries(record.phases).map(([name, value]) => [
                name,
                Math.round(value.ms),
              ]),
            ),
            baseline: record.baseline,
            afterOpen: record.phases.hydrate.retained,
            afterClose: record.afterClose,
            nativeStats: record.nativeStats,
            warnings,
          }),
        );
      } finally {
        await browser.close();
      }
    }
} finally {
  server.close();
}
