/* global process, console, URL, document, Worker, performance, setTimeout, clearTimeout, Buffer */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpus, arch, totalmem } from "node:os";
const { chromium } = createRequire(import.meta.url)("playwright");
const [packagePath, manifestPath, output, roundArg = "3"] =
  process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: canvas-offscreen.mjs PDFIUM_PACKAGE MANIFEST OUTPUT_JSON [ROUNDS]",
  );
const root = resolve(packagePath),
  rounds = Number(roundArg);
if (!Number.isInteger(rounds) || rounds < 1)
  throw Error("ROUNDS must be a positive integer");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(dirname(output), { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<!doctype html><title>Canvas worker benchmark</title><canvas style="width:800px;height:600px"></canvas>',
      );
      return;
    }
    const fixture = pathname.match(/^\/fixture\/(\d+)$/);
    const file =
      pathname === "/worker.mjs"
        ? fileURLToPath(
            new URL("./canvas-offscreen.worker.mjs", import.meta.url),
          )
        : fixture
          ? manifest.fixtures[Number(fixture[1])].path
          : resolve(root, "." + pathname.replace(/^\/sdk/, ""));
    if (!fixture && pathname !== "/worker.mjs" && !file.startsWith(root + "/"))
      throw Error("Invalid path");
    res.writeHead(200, {
      "Content-Length": (await stat(file)).size,
      "Content-Type":
        {
          ".mjs": "text/javascript",
          ".js": "text/javascript",
          ".wasm": "application/wasm",
        }[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const args = ["--no-sandbox", "--disable-gpu"];
const tasks = [
  { name: "page1600", longEdge: 1600 },
  { name: "page3200", longEdge: 3200 },
  { name: "tile1024at6400", longEdge: 6400, tile: true },
];
const result = {
  date: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  environment: {
    cpu: cpus()[0]?.model,
    arch: arch(),
    totalMemory: totalmem(),
    args,
  },
  rounds,
  tasks,
  measurements: [],
  realPages: [],
  validation: [],
};
async function session(use) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args,
  });
  try {
    result.environment.browser = browser.version();
    if (!result.environment.gpu)
      result.environment.gpu = (
        await (await browser.newBrowserCDPSession()).send("SystemInfo.getInfo")
      ).gpu;
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => {
      const worker = new Worker("/worker.mjs", { type: "module" });
      let id = 0;
      const pending = new Map();
      worker.onmessage = ({ data }) => {
        const waiter = pending.get(data.id);
        if (!waiter) return;
        pending.delete(data.id);
        clearTimeout(waiter.timer);
        if (data.error) waiter.reject(Error(data.error));
        else waiter.resolve(data.result);
      };
      worker.onerror = (event) => {
        for (const waiter of pending.values())
          waiter.reject(Error(event.message));
      };
      globalThis.canvasBench = {
        worker,
        rpc: (message, transfers = []) =>
          new Promise((resolve, reject) => {
            const key = ++id;
            pending.set(key, {
              resolve,
              reject,
              timer: setTimeout(() => reject(Error("Worker timeout")), 180000),
            });
            worker.postMessage({ ...message, id: key }, transfers);
          }),
      };
    });
    const init = await page.evaluate(() => {
      const canvas = document
        .querySelector("canvas")
        .transferControlToOffscreen();
      return globalThis.canvasBench.rpc({ type: "init", canvas }, [canvas]);
    });
    const rpc = (message) =>
      page.evaluate(async (message) => {
        const started = performance.now(),
          value = await globalThis.canvasBench.rpc(message);
        return { ...value, rpcMs: performance.now() - started };
      }, message);
    return await use(rpc, init);
  } finally {
    await browser.close();
  }
}
const save = () => writeFile(output, JSON.stringify(result, null, 2));
const realIds = (process.env.CANVAS_BENCH_REAL || "")
  .split(",")
  .filter(Boolean);
const selectedPages = (process.env.CANVAS_BENCH_PAGES || "")
  .split(",")
  .filter(Boolean)
  .map(Number);
const modes = (
  process.env.CANVAS_BENCH_MODES || "native,commands,cached"
).split(",");
if (
  modes.some(
    (mode) => !["native", "commands", "cached", "cached-high"].includes(mode),
  )
)
  throw Error("Unknown benchmark mode");
const cases = realIds.length
  ? manifest.fixtures.flatMap((fixture, index) =>
      realIds.includes(fixture.id)
        ? fixture.samplePages
            .filter(
              (pageIndex) =>
                !selectedPages.length || selectedPages.includes(pageIndex),
            )
            .map((pageIndex) => ({
              kind: fixture.id,
              fixture: index,
              pageIndex,
            }))
        : [],
    )
  : [{ kind: "paths" }, { kind: "jpeg" }];
if (!cases.length) throw Error("No selected fixtures");
result.cases = cases;
result.modes = modes;
result.harnessHashes = {};
for (const name of ["canvas-offscreen.mjs", "canvas-offscreen.worker.mjs"])
  result.harnessHashes[name] = createHash("sha256")
    .update(await readFile(new URL(name, import.meta.url)))
    .digest("hex");
try {
  // Fresh browser/worker/document per mode; rotate mode order. No readback while timing.
  for (let round = 0; round < rounds; round++)
    for (const descriptor of cases) {
      const { kind, fixture, pageIndex } = descriptor;
      for (const mode of [
        ...modes.slice(round % modes.length),
        ...modes.slice(0, round % modes.length),
      ]) {
        const record = await session(async (rpc, init) => {
          const opened = await rpc({ type: "open", ...descriptor });
          const prepared =
            mode === "native" ? null : await rpc({ type: "prepare", mode });
          if (prepared && !prepared.supported)
            throw Error(
              "Selected fixture unsupported: " + JSON.stringify(descriptor),
            );
          const samples = [];
          for (const task of tasks)
            for (let iteration = 0; iteration < 6; iteration++) {
              samples.push({
                task: task.name,
                iteration,
                ...(await rpc({ type: "render", mode, task })),
              });
            }
          const closed = await rpc({ type: "close" });
          if (closed.liveDocuments !== 0 || closed.imageCache.bytes !== 0)
            throw Error("Native resources leaked");
          return {
            round,
            kind,
            fixture,
            pageIndex,
            mode,
            init,
            opened,
            prepared,
            samples,
            closed,
          };
        });
        result.measurements.push(record);
        await save();
        console.log(
          JSON.stringify({ round, kind, pageIndex, mode, done: true }),
        );
      }
    }
  // Real PDF coverage is evaluated with the same annotations:false as app rendering.
  for (
    let fixture = 0;
    !realIds.length && fixture < manifest.fixtures.length;
    fixture++
  ) {
    const descriptor = manifest.fixtures[fixture];
    for (const pageIndex of descriptor.samplePages) {
      result.realPages.push(
        await session(async (rpc, init) => {
          const opened = await rpc({ type: "open", fixture, pageIndex });
          const prepared = await rpc({ type: "prepare", mode: "commands" });
          const samples = [];
          for (let iteration = 0; iteration < 3; iteration++)
            samples.push({
              iteration,
              ...(await rpc({
                type: "render",
                mode: "native",
                task: tasks[0],
              })),
            });
          const closed = await rpc({ type: "close" });
          if (closed.liveDocuments !== 0 || closed.imageCache.bytes !== 0)
            throw Error("Native resources leaked");
          return {
            fixture: descriptor.id,
            pageIndex,
            init,
            opened,
            prepared,
            samples,
            closed,
          };
        }),
      );
      await save();
      console.log(
        JSON.stringify({ fixture: descriptor.id, pageIndex, done: true }),
      );
    }
  }
  // Separate post-timing validation; readback cannot change the timed canvas backend.
  for (const descriptor of cases)
    result.validation.push(
      await session(async (rpc) => {
        await rpc({ type: "open", ...descriptor });
        const validation = await rpc({
          type: "validate",
          tasks,
          highQuality: modes.includes("cached-high"),
          capture: !!process.env.CANVAS_BENCH_CAPTURE,
        });
        for (const capture of validation.captures ?? []) {
          const file = resolve(
            dirname(output),
            `${descriptor.kind}-${descriptor.pageIndex ?? 0}-${capture.mode}.png`,
          );
          await writeFile(file, Buffer.from(capture.png, "base64"));
        }
        delete validation.captures;
        const inspected = await rpc({ type: "inspect" });
        const closed = await rpc({ type: "close" });
        if (closed.liveDocuments !== 0 || closed.imageCache.bytes !== 0)
          throw Error("Validation resources leaked");
        return { ...descriptor, ...validation, inspected, closed };
      }),
    );
  await save();
} finally {
  await new Promise((resolve) => server.close(resolve));
}
