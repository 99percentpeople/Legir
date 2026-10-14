/* global process, console, URL */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const [manifestPath, resultsPath, output] = process.argv.slice(2);
if (!manifestPath || !resultsPath || !output)
  throw new Error(
    "Usage: node corpus-validate.mjs MANIFEST RESULTS_JSON OUTPUT",
  );
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const results = JSON.parse(await readFile(resultsPath, "utf8"));
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fileHash(file, length) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(
    file,
    length === undefined ? undefined : { start: 0, end: length - 1 },
  ))
    digest.update(chunk);
  return digest.digest("hex");
}
async function inspect(path) {
  const { stdout } = await exec(
    process.env.PDF_BENCH_PYTHON ?? "python3",
    [fileURLToPath(new URL("./inspect_pdf.py", import.meta.url)), path],
    { maxBuffer: 32 * 1024 * 1024, timeout: 180000 },
  );
  return JSON.parse(stdout);
}
const fixtureInfo = new Map();
for (const fixture of manifest.fixtures) {
  console.log(`Inspecting ${fixture.id}`);
  fixtureInfo.set(fixture.id, await inspect(fixture.path));
  fixture.sha256 = await fileHash(fixture.path);
  fixture.bytes = (await stat(fixture.path)).size;
  fixture.pages = fixtureInfo.get(fixture.id).pages.length;
}
await writeFile(
  join(output, "fixtures.json"),
  JSON.stringify(
    manifest.fixtures.map((f) => ({ ...f, structure: fixtureInfo.get(f.id) })),
    null,
    2,
  ),
);
const rasterCache = new Map();
async function raster(file, index) {
  const key = `${file}:${index}`;
  if (rasterCache.has(key)) return rasterCache.get(key);
  const { stdout } = await exec(
    "pdftoppm",
    [
      "-f",
      String(index + 1),
      "-l",
      String(index + 1),
      "-singlefile",
      "-scale-to",
      "1200",
      file,
    ],
    { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 180000 },
  );
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(
    stdout.subarray(0, 100).toString("ascii"),
  );
  if (!header) throw new Error("Unexpected Poppler PPM header");
  const pixels = stdout.subarray(header[0].length);
  const result = {
    width: Number(header[1]),
    height: Number(header[2]),
    pixels,
    hash: hash(pixels),
  };
  // Cache only source images. Export images can otherwise accumulate for GBs.
  if (manifest.fixtures.some((f) => f.path === file))
    rasterCache.set(key, result);
  return result;
}
async function textHash(file, index) {
  const { stdout } = await exec(
    "pdftotext",
    ["-f", String(index + 1), "-l", String(index + 1), "-layout", file, "-"],
    { maxBuffer: 16 * 1024 * 1024, timeout: 180000 },
  );
  const normalized = stdout.replace(/\s+/g, " ").trim();
  return { characters: normalized.length, hash: hash(normalized) };
}
function comparePixels(a, b) {
  if (a.width !== b.width || a.height !== b.height)
    return {
      dimensionsMatch: false,
      a: [a.width, a.height],
      b: [b.width, b.height],
    };
  let absolute = 0,
    changed = 0;
  for (let i = 0; i < a.pixels.length; i += 3) {
    let maximum = 0;
    for (let j = 0; j < 3; j++) {
      const delta = Math.abs(a.pixels[i + j] - b.pixels[i + j]);
      absolute += delta;
      maximum = Math.max(maximum, delta);
    }
    if (maximum > 16) changed++;
  }
  return {
    dimensionsMatch: true,
    exact: a.hash === b.hash,
    meanAbsoluteChannelError: absolute / a.pixels.length,
    changedPixelFraction: changed / (a.width * a.height),
    sourceHash: a.hash,
    outputHash: b.hash,
  };
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
const validations = [];
for (const record of results) {
  const fixture = manifest.fixtures.find((f) => f.id === record.fixture);
  const donor = manifest.fixtures.find((f) => f.id === record.donor);
  for (const mode of [
    "export",
    ...(record.phases.repeatExportDownload ? ["repeatExport"] : []),
    "merged",
  ]) {
    const file = record.phases[`${mode}Download`]?.file;
    if (!file) continue;
    console.log(
      `Checking ${record.variant}/${record.fixture}/${record.round}/${mode}`,
    );
    const validation = {
      variant: record.variant,
      fixture: record.fixture,
      round: record.round,
      mode,
      file,
    };
    try {
      validation.bytes = (await stat(file)).size;
      validation.originalPrefixRetained =
        validation.bytes >= fixture.bytes &&
        (await fileHash(file, fixture.bytes)) === fixture.sha256;
      validation.appendedBytes = validation.originalPrefixRetained
        ? validation.bytes - fixture.bytes
        : null;
      const actual = await inspect(file);
      validation.syntaxWarnings = actual.warnings;
      const source = fixtureInfo.get(fixture.id),
        imported = fixtureInfo.get(donor.id);
      const selectedPages =
        record.phases.import?.selectedPages ?? imported.pages.map((_, i) => i);
      const donorPages = selectedPages.map((index) => imported.pages[index]);
      const expected =
        mode === "merged" ? [...source.pages, ...donorPages] : source.pages;
      if (
        mode === "merged" &&
        selectedPages.length !== imported.pages.length &&
        imported.fields.length
      )
        throw new Error(
          "Partial-form selection needs a dedicated field/widget validator",
        );
      validation.pages = actual.pages.length;
      validation.expectedPages = expected.length;
      validation.titleEdited = actual.title === "Legir corpus benchmark";
      validation.geometryMismatches = [];
      validation.annotationMismatches = [];
      validation.replyMismatches = [];
      validation.linkMismatches = [];
      for (const [index, page] of expected.entries()) {
        const result = actual.pages[index];
        if (
          !result ||
          Math.abs(result.size.width - page.size.width) > 0.01 ||
          Math.abs(result.size.height - page.size.height) > 0.01 ||
          result.rotation !== page.rotation
        )
          validation.geometryMismatches.push(index);
        if (
          !result ||
          !same(
            Object.entries(result.annotations).sort(),
            Object.entries(page.annotations).sort(),
          )
        )
          validation.annotationMismatches.push({
            page: index,
            expected: page.annotations,
            actual: result?.annotations,
          });
        if (!result || !same(result.replies, page.replies))
          validation.replyMismatches.push({
            page: index,
            expected: page.replies,
            actual: result?.replies,
          });
        const expectedLinks = page.links.map((link) => ({
          ...link,
          ...(mode === "merged" &&
          index >= source.pages.length &&
          link.kind === "GoTo" &&
          link.targetPage !== null
            ? {
                targetPage: selectedPages.includes(link.targetPage)
                  ? selectedPages.indexOf(link.targetPage) + source.pages.length
                  : null,
              }
            : {}),
        }));
        const sortedLinks = (links) =>
          links.map((link) => JSON.stringify(link)).sort();
        if (
          !result ||
          !same(sortedLinks(result.links), sortedLinks(expectedLinks))
        )
          validation.linkMismatches.push(index);
      }
      // For these fixtures names do not collide; include values, not just counts.
      const fields =
        mode === "merged"
          ? [...source.fields, ...imported.fields].sort((a, b) =>
              a.name.localeCompare(b.name),
            )
          : source.fields;
      validation.fieldsMatch = same(actual.fields, fields);
      validation.fields = actual.fields;
      const checks = [...new Set([0, ...fixture.samplePages])].map((index) => ({
        source: fixture.path,
        sourcePage: index,
        outputPage: index,
      }));
      if (mode === "merged")
        for (const index of [
          ...new Set([
            0,
            Math.floor(selectedPages.length / 2),
            selectedPages.length - 1,
          ]),
        ])
          checks.push({
            source: donor.path,
            sourcePage: selectedPages[index],
            outputPage: source.pages.length + index,
          });
      validation.samples = [];
      for (const check of checks) {
        const before = await raster(check.source, check.sourcePage),
          after = await raster(file, check.outputPage);
        const sourceText = await textHash(check.source, check.sourcePage),
          outputText = await textHash(file, check.outputPage);
        validation.samples.push({
          ...check,
          pixels: comparePixels(before, after),
          textEqual: sourceText.hash === outputText.hash,
          sourceText,
          outputText,
        });
      }
      validation.ok =
        !validation.syntaxWarnings.length &&
        validation.pages === expected.length &&
        validation.titleEdited &&
        !validation.geometryMismatches.length &&
        !validation.annotationMismatches.length &&
        !validation.replyMismatches.length &&
        !validation.linkMismatches.length &&
        validation.fieldsMatch &&
        validation.samples.every(
          (s) =>
            s.textEqual &&
            s.pixels.dimensionsMatch &&
            s.pixels.changedPixelFraction < 0.001,
        );
    } catch (error) {
      validation.ok = false;
      validation.error = String(error);
    }
    validations.push(validation);
    await writeFile(
      join(output, "validation.json"),
      JSON.stringify(validations, null, 2),
    );
  }
}
console.log(
  JSON.stringify({
    exports: validations.length,
    passed: validations.filter((v) => v.ok).length,
  }),
);
if (validations.some((v) => !v.ok)) process.exitCode = 1;
