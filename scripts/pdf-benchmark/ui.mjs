/* global console, process, window, Window, location, document, navigator, DataTransfer, File, DragEvent */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
import { PDFDocument, StandardFonts, rgb } from "@legir/pdfium/authoring";
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 3; i++) {
  const p = pdf.addPage([400, 500]);
  p.drawText("Native PDF page " + (i + 1), { x: 40, y: 400, size: 22, font });
  p.drawRectangle({
    x: 40,
    y: 320,
    width: 250,
    height: 40,
    color: rgb(0.15, 0.4, 0.8),
  });
}
const field = pdf.getForm().createTextField("name");
field.setText("Alice");
field.addToPage(pdf.getPage(0), { x: 40, y: 200, width: 180, height: 30 });
const bytes = Array.from(await pdf.save());
pdf.destroy();
const baseUrl = process.argv[2];
const donorFile = process.argv[3];
const output = process.argv[4];
const engine = process.argv[5] ?? "pdfium";
if (!baseUrl || !donorFile || !output)
  throw new Error(
    "Usage: node ui.mjs PRODUCTION_URL DONOR_PDF OUTPUT [pdfium|pdfjs]",
  );
if (!["pdfium", "pdfjs"].includes(engine)) throw new Error("Unknown engine");
await (await import("node:fs/promises")).mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  const resourceFailures = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (request) =>
    resourceFailures.push({
      url: request.url(),
      type: request.resourceType(),
      error: request.failure()?.errorText,
    }),
  );
  page.on("console", (m) => {
    if (m.type() === "error") console.log("console", m.text());
  });
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
    delete Window.prototype.showSaveFilePicker;
  });
  await page.goto(baseUrl);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  const initialWorkerUrls = page.workers().map((worker) => worker.url());
  await page.getByRole("button", { name: "Open PDF", exact: true }).waitFor();
  await page.waitForTimeout(250);
  await page.evaluate((bytes) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([new Uint8Array(bytes)], "native-migration.pdf", {
        type: "application/pdf",
      }),
    );
    document.elementFromPoint(700, 400).dispatchEvent(
      new DragEvent("drop", {
        dataTransfer,
        bubbles: true,
        cancelable: true,
        clientX: 700,
        clientY: 400,
      }),
    );
  }, bytes);
  await page.waitForURL("**/editor/**", { timeout: 30000 }).catch(async (e) => {
    console.log(await page.locator("body").innerText(), errors);
    throw e;
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector(".textLayer")
        ?.textContent?.includes("Native PDF page 1"),
    { timeout: 30000 },
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("canvas")].some(
      (c) => c.width > 100 && c.height > 100,
    ),
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("img")].filter(
        (i) => i.src.startsWith("blob:") && i.complete && i.naturalWidth > 50,
      ).length >= 2,
    { timeout: 30000 },
  );
  await page
    .getByText("Parsing PDF...", { exact: true })
    .waitFor({ state: "hidden", timeout: 30000 });
  const firstThumb = page.locator('img[src^="blob:"]').first();
  const beforeThumb = await firstThumb.getAttribute("src");
  const fieldInput = page.locator('input[type="text"]').first();
  await fieldInput.fill("Bob");
  await fieldInput.press("Tab");
  await page.waitForFunction((before) => {
    const i = [...document.querySelectorAll("img")].find((i) =>
      i.src.startsWith("blob:"),
    );
    return i && i.src !== before && i.complete && i.naturalWidth > 0;
  }, beforeThumb);
  const plainSaves = [];
  for (let revision = 0; revision < 2; revision++) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const file = `${output}/ui-plain-${revision}.pdf`;
    await (await pending).saveAs(file);
    const savedBytes = await (await import("node:fs/promises")).readFile(file);
    const saved = await PDFDocument.load(savedBytes);
    const prefix = bytes.every((value, index) => savedBytes[index] === value);
    if (
      saved.getPageCount() !== 3 ||
      saved.getForm().getTextField("name").getText() !== "Bob"
    )
      throw new Error("Plain UI save lost the edited form or pages");
    saved.destroy();
    if (engine === "pdfium" && !prefix)
      throw new Error("Plain PDFium UI save did not use incremental output");
    plainSaves.push({
      bytes: savedBytes.length,
      originalPrefixRetained: prefix,
    });
  }
  if (engine === "pdfium" && plainSaves[0].bytes !== plainSaves[1].bytes)
    throw new Error(
      "Repeated UI save accumulated a revision instead of reusing the original base",
    );
  await page.getByRole("button", { name: "Select Mode", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "Page mode", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-page-card]").length === 3,
  );
  await page.getByRole("button", { name: "Blank pages", exact: true }).click();
  await page
    .getByRole("button", { name: "Add blank pages", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-page-card]").length === 4,
  );
  await page
    .getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-page-card]").length === 3,
  );
  await page.getByRole("button", { name: /Redo/ }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-page-card]").length === 4,
  );
  await page
    .locator('[aria-label="Page mode"] input[type="file"]')
    .setInputFiles(donorFile);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Import PDF", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-page-card]").length === 8,
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".textLayer")].some((e) =>
      /Native PDF|donor PAGE/.test(e.textContent),
    ),
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const download = await downloadPromise.catch(async (e) => {
    console.log(await page.locator("body").innerText(), errors);
    throw e;
  });
  await download.saveAs(`${output}/ui-saved.pdf`);
  const check = await PDFDocument.load(
    await (await import("node:fs/promises")).readFile(`${output}/ui-saved.pdf`),
  );
  if (
    check.getForm().getTextField("name").getText() !== "Bob" ||
    check.getPageCount() !== 8 ||
    check.getForm().getFields().length !== 3
  )
    throw new Error(
      "UI save did not preserve edited/imported fields and blank page",
    );
  const savedPages = check.getPageCount();
  const savedFields = check
    .getForm()
    .getFields()
    .map((f) => f.getName());
  check.destroy();
  await page.screenshot({ path: `${output}/ui.png` });
  const result = await page.evaluate(() => ({
    url: location.pathname,
    text: [...document.querySelectorAll(".textLayer")]
      .map((e) => e.textContent)
      .slice(0, 3),
    forms: [...document.querySelectorAll("input")].map((e) => ({
      type: e.type,
      value: e.value,
    })),
    canvases: [...document.querySelectorAll("canvas")]
      .map((c) => [c.width, c.height])
      .filter((s) => s[0] > 100 && s[1] > 100),
  }));
  if (
    errors.length ||
    !result.text.some((s) => /Native PDF|donor PAGE/.test(s))
  )
    throw new Error(JSON.stringify({ result, errors }));
  await page.waitForTimeout(1500);
  const activeWorkers = page.workers().length;
  const activeWorkerUrls = page.workers().map((worker) => worker.url());
  const brokenImages = await page.evaluate(() =>
    [...document.images]
      .filter(
        (i) =>
          i.getBoundingClientRect().width > 0 && i.complete && !i.naturalWidth,
      )
      .map((i) => i.src),
  );
  if ((engine === "pdfium" && activeWorkers !== 1) || brokenImages.length)
    throw new Error(JSON.stringify({ activeWorkers, brokenImages }));
  await page.locator('[data-editor-tab-id] button[aria-label="Close"]').click();
  const discard = page.getByRole("button", {
    name: "Close without saving",
    exact: true,
  });
  await discard
    .waitFor({ state: "visible", timeout: 1500 })
    .then(() => discard.click())
    .catch(() => {});
  await page
    .waitForFunction(() => !document.querySelector("[data-editor-tab-id]"))
    .catch(async (e) => {
      console.log(await page.locator("body").innerText());
      throw e;
    });
  await page.waitForTimeout(500);
  const workersAfterClose = page.workers().length;
  const workerUrlsAfterClose = page.workers().map((worker) => worker.url());
  // The original engine has an eager global render service and PDF.js workers.
  // Record its lifecycle separately; single-owner assertions apply to PDFium.
  if (engine === "pdfium" && workersAfterClose !== 0)
    throw new Error(`Workers remain after close: ${workersAfterClose}`);
  if (errors.length) throw new Error(errors.join("\n"));
  // Exit-animation clones can disappear before the broken-image DOM check.
  // Keep intentional request cancellation separate from failed Blob previews.
  const failedBlobImages = resourceFailures.filter(
    ({ url, type, error }) =>
      url.startsWith("blob:") &&
      type === "image" &&
      error !== "net::ERR_ABORTED",
  );
  if (engine === "pdfium" && failedBlobImages.length)
    throw new Error(
      `Blob preview requests failed: ${JSON.stringify(failedBlobImages)}`,
    );
  console.log(
    JSON.stringify({
      engine,
      plainSaves,
      result,
      errors,
      resourceFailures,
      savedPages,
      savedFields,
      activeWorkers,
      initialWorkerUrls,
      activeWorkerUrls,
      workersAfterClose,
      workerUrlsAfterClose,
      brokenImages,
    }),
  );
} finally {
  await browser.close();
}
