// @vitest-environment node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PDFDocument } from "@legir/pdfium/authoring";
import { afterAll, beforeAll, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
let output: string;
let manifest: Record<string, { pages: number; bytes: number; sha256: string }>;

beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), "legir-pdf-fixtures-"));
  // Run the documented CLI, including the full image corpus and subsequent donor.
  await promisify(execFile)(
    process.execPath,
    [join(root, "scripts/pdf-benchmark/fixtures.mjs"), output],
    { cwd: root, timeout: 60_000 },
  );
  manifest = JSON.parse(await readFile(join(output, "fixtures.json"), "utf8"));
}, 60_000);

afterAll(async () => {
  if (output) await rm(output, { recursive: true, force: true });
});

it("publishes all three fixtures and a complete manifest", async () => {
  expect((await readdir(output)).sort()).toEqual([
    "donor.pdf",
    "fixtures.json",
    "forms.pdf",
    "large-images.pdf",
  ]);
  expect(Object.keys(manifest).sort()).toEqual([
    "donor",
    "forms",
    "large-images",
  ]);
});

it.each([
  ["forms", 12],
  ["large-images", 60],
  ["donor", 4],
] as const)(
  "reopens %s with its pages, fields and painted content",
  async (name, count) => {
    const bytes = await readFile(join(output, `${name}.pdf`));
    expect(manifest[name]).toEqual({
      pages: count,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const pdf = await PDFDocument.load(bytes);
    try {
      expect(pdf.getPageCount()).toBe(count);
      expect(pdf.getPages().map((page) => page.getSize())).toEqual(
        Array.from({ length: count }, () => ({ width: 600, height: 800 })),
      );
      const form = pdf.getForm();
      expect(form.getFields()).toHaveLength(Math.ceil(count / 3));
      for (let index = 0; index < count; index += 3)
        expect(form.getTextField(`${name}-field-${index}`).getText()).toBe(
          `VALUE ${index}`,
        );

      const imageHashes = new Set<string>();
      for (const index of [0, Math.floor((count - 1) / 2), count - 1]) {
        const page = pdf.nativeView!.native.loadPage(index);
        try {
          const text = page
            .extractText()
            .lines.map((line) =>
              line.glyphs.map((glyph) => glyph.text).join(""),
            )
            .join("\n");
          expect(text).toContain(`${name} PAGE ${index + 1}`);
          if (name !== "large-images") continue;
          // Crop exactly the scan rectangle: a dangling/mismatched Do name paints white.
          const raster = page.render(page.getTransform(), [44, 118, 556, 630], {
            annotations: false,
          });
          try {
            const pixels = raster.getPixels();
            let nonwhite = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250)
                nonwhite++;
            expect(nonwhite / (512 * 512)).toBeGreaterThan(0.99);
            imageHashes.add(createHash("sha256").update(pixels).digest("hex"));
          } finally {
            raster.destroy();
          }
        } finally {
          page.destroy();
        }
      }
      if (name === "large-images") {
        expect(bytes.length).toBeGreaterThan(40 * 1024 * 1024);
        expect(imageHashes.size).toBe(3);
      }
    } finally {
      pdf.destroy();
    }
  },
);
