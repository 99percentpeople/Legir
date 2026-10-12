/* global process, console, URL, Buffer */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [root, fixtures, output] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost"),
      fixture = url.pathname.startsWith("/fixtures/");
    const file = join(
      fixture ? fixtures : root,
      fixture ? url.pathname.slice(10) : url.pathname,
    );
    const bytes = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".wasm": "application/wasm",
          ".pdf": "application/pdf",
        }[extname(file)] || "application/octet-stream",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const name of ["forms", "large-images"]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const OriginalWorker = globalThis.Worker;
      globalThis.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", ({ data }) => {
            if (data.payload?.imageBytes)
              globalThis.capturedPng = Array.from(
                new Uint8Array(data.payload.imageBytes),
              );
          });
        }
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/benchmark.html`);
    await page.waitForFunction(() => !!globalThis.pdfBenchmark);
    await page.evaluate(
      (name) =>
        globalThis.pdfBenchmark.prepare(
          `/fixtures/${name}.pdf`,
          "/fixtures/donor.pdf",
        ),
      name,
    );
    await page.evaluate(() => globalThis.pdfBenchmark.open());
    await page.evaluate(() => globalThis.pdfBenchmark.hydrate());
    const image = await page.evaluate(() => globalThis.pdfBenchmark.render());
    await writeFile(
      join(output, `${name}.png`),
      Buffer.from(await page.evaluate(() => globalThis.capturedPng)),
    );
    console.log(JSON.stringify({ name, ...image }));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
