/* global process, console, URL, setTimeout, clearTimeout, setInterval, clearInterval */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { cpus, totalmem, loadavg } from "node:os";

const { chromium } = createRequire(import.meta.url)("playwright");
const [manifestPath, output, rounds = "3"] = process.argv.slice(2);
if (!manifestPath || !output)
  throw new Error("Usage: node corpus.mjs MANIFEST OUTPUT [ROUNDS]");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(output, { recursive: true });
const resultsFile = join(output, "results.json");
const results = await readFile(resultsFile, "utf8")
  .then(JSON.parse)
  .catch(() => []);
let root;
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    let file;
    if (path.startsWith("/fixtures/")) {
      const fixture = manifest.fixtures.find(
        (item) => item.id === path.slice(10),
      );
      if (!fixture) throw new Error("Unknown fixture");
      file = fixture.path;
    } else {
      file = resolve(root, `.${path}`);
      if (!file.startsWith(resolve(root) + sep))
        throw new Error("Invalid path");
    }
    const info = await stat(file);
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".wasm": "application/wasm",
          ".pdf": "application/pdf",
          ".json": "application/json",
          ".ttf": "font/ttf",
        }[extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-store",
    });
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/benchmark.html`;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const timeoutMs = Number(process.env.PDF_BENCH_TIMEOUT_MS ?? 180000);
const renderOnly = process.env.PDF_BENCH_RENDER_ONLY === "1";
async function deadline(promise, name) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} exceeded ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function hostState() {
  const vmstat = await readFile("/proc/vmstat", "utf8");
  return {
    load: loadavg(),
    temperatureC: await readFile(
      "/sys/class/thermal/thermal_zone0/temp",
      "utf8",
    )
      .then((s) => Number(s) / 1000)
      .catch(() => null),
    swapInPages: Number(/^pswpin (\d+)/m.exec(vmstat)?.[1]),
    swapOutPages: Number(/^pswpout (\d+)/m.exec(vmstat)?.[1]),
  };
}
const selected = (items, env) =>
  env ? items.filter((item) => env.split(",").includes(item.id)) : items;
const variants = selected(manifest.variants, process.env.PDF_BENCH_VARIANTS);
const fixtures = selected(manifest.fixtures, process.env.PDF_BENCH_CASES);
if (!variants.length || !fixtures.length) throw new Error("No selected cases");
try {
  for (let round = 0; round < Number(rounds); round++) {
    // Latin-square rotation gives every engine each position over three rounds.
    const order = [
      ...variants.slice(round % variants.length),
      ...variants.slice(0, round % variants.length),
    ];
    for (const fixture of fixtures)
      for (const variant of order) {
        if (
          results.some(
            (r) =>
              r.round === round &&
              r.fixture === fixture.id &&
              r.variant === variant.id,
          )
        )
          continue;
        root = variant.build;
        const record = {
          variant: variant.id,
          fixture: fixture.id,
          donor: fixture.donor,
          round,
          started: new Date().toISOString(),
          status: "running",
          mode: renderOnly ? "render-only" : "complete",
          environment: {
            platform: process.platform,
            arch: process.arch,
            cpu: cpus()[0].model,
            cpuCount: cpus().length,
            totalMemory: totalmem(),
          },
          hostBefore: await hostState(),
          phases: {},
          memory: {},
          errors: [],
          warnings: [],
        };
        console.log(
          JSON.stringify({
            event: "sample",
            variant: variant.id,
            fixture: fixture.id,
            round,
          }),
        );
        const browser = await chromium.launch({
          headless: true,
          executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
          args: ["--no-sandbox", "--js-flags=--expose-gc"],
        });
        let phaseName = "prepare";
        try {
          record.environment.browser = browser.version();
          const context = await browser.newContext({
            acceptDownloads: true,
            serviceWorkers: "block",
            viewport: { width: 1440, height: 1000 },
          });
          const page = await context.newPage();
          const cdp = await browser.newBrowserCDPSession();
          const gpu = await cdp.send("SystemInfo.getInfo");
          record.environment.gpu = gpu.gpu.devices;
          record.environment.gpuFeatures = gpu.gpu.featureStatus;
          page.on("pageerror", (e) => record.errors.push(String(e)));
          page.on("console", (message) => {
            if (["error", "warning"].includes(message.type()))
              record.warnings.push(message.text());
          });
          page.on("crash", () =>
            record.errors.push("Renderer process crashed"),
          );
          await page.goto(url);
          await page.waitForFunction(() => !!globalThis.pdfCorpus);
          record.input = await deadline(
            page.evaluate(
              ({ id, donor }) =>
                globalThis.pdfCorpus.prepare(
                  `/fixtures/${id}`,
                  `/fixtures/${donor}`,
                ),
              fixture,
            ),
            "prepare",
          );
          const memory = async () => {
            const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
            let pssKiB = 0,
              rssKiB = 0,
              swapKiB = 0;
            for (const item of processInfo) {
              try {
                const data = await readFile(
                  `/proc/${item.id}/smaps_rollup`,
                  "utf8",
                );
                pssKiB += Number(/^Pss:\s+(\d+)/m.exec(data)?.[1] ?? 0);
                rssKiB += Number(/^Rss:\s+(\d+)/m.exec(data)?.[1] ?? 0);
                swapKiB += Number(/^SwapPss:\s+(\d+)/m.exec(data)?.[1] ?? 0);
              } catch {
                /* Process exited between discovery and sampling. */
              }
            }
            return {
              pssMiB: pssKiB / 1024,
              rssMiB: rssKiB / 1024,
              swapMiB: swapKiB / 1024,
            };
          };
          const settle = async () => {
            await deadline(
              page.evaluate(() => globalThis.gc?.()),
              "main GC",
            );
            for (const worker of page.workers())
              await deadline(
                worker.evaluate(() => globalThis.gc?.()).catch(() => {}),
                "worker GC",
              );
            await delay(200);
            return memory();
          };
          const snapshot = async (name) => {
            record.memory[name] = await settle();
            record.memory[name].workers = page.workers().length;
            record.memory[name].native = await deadline(
              page.evaluate(() => globalThis.pdfCorpus.stats()),
              "stats",
            );
          };
          record.memory.baseline = await settle();
          const phase = async (name, run, info = {}) => {
            phaseName = name;
            console.log(
              JSON.stringify({
                event: "phase",
                variant: variant.id,
                fixture: fixture.id,
                round,
                name,
              }),
            );
            let peak = await memory(),
              sampling = false,
              samples = 0;
            const merge = (value) => {
              for (const key of Object.keys(peak))
                peak[key] = Math.max(peak[key], value[key]);
              samples++;
            };
            const timer = setInterval(async () => {
              if (sampling) return;
              sampling = true;
              try {
                merge(await memory());
              } catch {
                /* Errors are also recorded by the operation. */
              } finally {
                sampling = false;
              }
            }, 50);
            try {
              const value = await deadline(run(), name);
              merge(await memory());
              record.phases[name] = { ...info, ...value, peak, samples };
              console.log(
                JSON.stringify({
                  event: "done",
                  name,
                  ms: value.ms,
                  peak: peak.pssMiB,
                }),
              );
              return value;
            } catch (error) {
              record.phases[name] = {
                ...info,
                error: String(error),
                peak,
                samples,
              };
              throw error;
            } finally {
              clearInterval(timer);
              while (sampling) await delay(5);
            }
          };
          const render = (name, options, kind) =>
            phase(
              name,
              () =>
                page.evaluate(
                  (options) => globalThis.pdfCorpus.render(options),
                  options,
                ),
              { kind },
            );
          await phase("open", () =>
            page.evaluate(() => globalThis.pdfCorpus.open()),
          );
          await render(
            "firstCanvas",
            { pageIndex: 0, longEdge: 1600 },
            "first",
          );
          await phase("hydrate", () =>
            page.evaluate(() => globalThis.pdfCorpus.hydrate()),
          );
          await snapshot("readable");
          for (const pageIndex of fixture.samplePages) {
            await render(
              `page-${pageIndex}-cold`,
              { pageIndex, longEdge: 1600, freshCanvas: true },
              "pageCold",
            );
            await render(
              `page-${pageIndex}-warm`,
              { pageIndex, longEdge: 1600 },
              "pageWarm",
            );
            if (process.env.PDF_BENCH_CAPTURE)
              await page.screenshot({
                path: join(
                  output,
                  `${variant.id}-${fixture.id}-${pageIndex}.png`,
                ),
              });
          }
          const pageIndex = fixture.samplePages[1];
          await render(
            "zoomCold",
            { pageIndex, longEdge: 3200, freshCanvas: true },
            "zoom",
          );
          await render("zoomWarm", { pageIndex, longEdge: 3200 }, "zoom");
          for (const [index, tilePosition] of [
            [0.4, 0.4],
            [0.55, 0.4],
            [0.55, 0.55],
            [0.4, 0.55],
          ].entries())
            await render(
              `tile-${index}`,
              {
                pageIndex,
                longEdge: 6400,
                tilePosition,
                freshCanvas: index === 0,
              },
              "tile",
            );
          await render(
            "rotatedTile",
            {
              pageIndex,
              longEdge: 6400,
              tilePosition: [0.5, 0.5],
              rotation: 90,
              freshCanvas: true,
            },
            "rotatedTile",
          );
          await phase("png", () =>
            page.evaluate(
              (index) => globalThis.pdfCorpus.png(index),
              pageIndex,
            ),
          );
          await snapshot("rendered");
          const saveDownload = async (name) => {
            await phase(
              `${name}Download`,
              async () => {
                const pending = page.waitForEvent("download", {
                  timeout: timeoutMs,
                });
                await page.evaluate(() => globalThis.pdfCorpus.download());
                const download = await pending;
                const path = join(
                  output,
                  `${variant.id}-${fixture.id}-${round}-${name}.pdf`,
                );
                await download.saveAs(path);
                await download.delete();
                await page.evaluate(() =>
                  globalThis.pdfCorpus.releaseDownload(),
                );
                return { file: path };
              },
              { kind: "downloadExcludedFromTiming" },
            );
          };
          if (!renderOnly) {
            await phase("export", () =>
              page.evaluate(() => globalThis.pdfCorpus.save()),
            );
            await snapshot("exported");
            await saveDownload("export");
            if (process.env.PDF_BENCH_REPEAT_SAVE) {
              await phase("repeatExport", () =>
                page.evaluate(() => globalThis.pdfCorpus.save()),
              );
              await snapshot("repeatExported");
              await saveDownload("repeatExport");
            }
            await phase("import", () =>
              page.evaluate(
                (indexes) => globalThis.pdfCorpus.importSource(indexes),
                fixture.importPages,
              ),
            );
            await snapshot("imported");
            await phase("mergedExport", () =>
              page.evaluate(() => globalThis.pdfCorpus.save(true)),
            );
            await snapshot("merged");
            await saveDownload("merged");
          }
          await deadline(
            page.evaluate(() => globalThis.pdfCorpus.close()),
            "close",
          );
          await delay(500);
          record.memory.closed = await settle();
          record.memory.closed.workers = page.workers().length;
          if (record.errors.length) throw new Error(record.errors.join("\n"));
          record.status = "ok";
        } catch (error) {
          record.status = "failed";
          record.failedPhase = phaseName;
          record.error = String(error);
          console.log(
            JSON.stringify({
              event: "failure",
              variant: variant.id,
              fixture: fixture.id,
              phaseName,
              error: String(error),
            }),
          );
        } finally {
          await browser.close();
          record.hostAfter = await hostState();
          record.finished = new Date().toISOString();
          results.push(record);
          await writeFile(resultsFile, JSON.stringify(results, null, 2));
        }
      }
  }
} finally {
  server.close();
}
