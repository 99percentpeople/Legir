/* global process, console */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  PDFDocument,
  StandardFonts,
  PDFRawStream,
  rgb,
} from "@legir/pdfium/authoring";
const output = process.argv[2];
if (!output) throw new Error("Usage: node fixtures.mjs OUTPUT");
await mkdir(output, { recursive: true });
let seed = 81273819;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
};
const hashes = {};
for (const [name, count, image] of [
  ["forms", 12, false],
  ["large-images", 60, true],
  ["donor", 4, false],
]) {
  const pdf = await PDFDocument.create();
  let bytes;
  try {
    pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
    pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
    pdf.setTitle(name);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < count; i++) {
      const page = pdf.addPage([600, 800]);
      page.drawText(`${name} PAGE ${i + 1}`, { font, x: 35, y: 755, size: 20 });
      if (image) {
        const data = new Uint8Array(512 * 512 * 3);
        for (let p = 0; p < data.length; p++) data[p] = random() & 255;
        const stream = PDFRawStream.of(
          pdf.context.obj({
            Type: "XObject",
            Subtype: "Image",
            Width: 512,
            Height: 512,
            ColorSpace: "DeviceRGB",
            BitsPerComponent: 8,
            Filter: "FlateDecode",
          }),
          new Uint8Array(deflateSync(data)),
        );
        const ref = pdf.context.register(stream);
        const imageName = page.node.newXObject("Scan", ref);
        const content = pdf.context.flateStream(
          `q 512 0 0 512 44 170 cm ${imageName} Do Q`,
        );
        page.node.addContentStream(pdf.context.register(content));
      } else
        for (let j = 0; j < 40; j++) {
          page.drawText(
            `Row ${j + 1}: PDF text, vectors and form preservation`,
            {
              font,
              x: 35,
              y: 720 - j * 13,
              size: 9,
            },
          );
          if (j % 5 === 0)
            page.drawRectangle({
              x: 460,
              y: 716 - j * 13,
              width: 90,
              height: 8,
              color: rgb(0.15, 0.4, 0.8),
            });
        }
      if (i % 3 === 0) {
        const field = pdf.getForm().createTextField(`${name}-field-${i}`);
        field.setText(`VALUE ${i}`);
        field.addToPage(page, { x: 40, y: 90, width: 250, height: 28 });
      }
    }
    bytes = await pdf.save();
  } finally {
    pdf.destroy();
  }
  await writeFile(`${output}/${name}.pdf`, bytes);
  hashes[name] = {
    pages: count,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
await writeFile(`${output}/fixtures.json`, JSON.stringify(hashes, null, 2));
console.log(JSON.stringify(hashes));
