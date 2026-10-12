import { beforeAll, expect, it } from "vitest";
import { createPDFium, createCanvasPlan, type PDFium } from "../src/index.js";

let engine: PDFium;
beforeAll(async () => {
  engine = await createPDFium();
});

it("exports owned paths and rejects unsupported content before any drawing", () => {
  const doc = new engine.PDFDocument();
  try {
    const font = doc.addObject({
      Type: "Font",
      Subtype: "Type1",
      BaseFont: "Helvetica",
    });
    const fixtures = [
      { contents: "q 1 0 0 rg 10 10 30 40 re f Q", supported: true },
      { contents: "0 0 m 50 100 100 50 150 150 c 2 w S", supported: true },
      { contents: "q 0 0 10 10 re W n 0 0 40 40 re f Q", supported: false },
      { contents: "BT /F1 12 Tf 10 10 Td (TEXT) Tj ET", supported: false },
      { contents: "q /GS gs 10 10 20 20 re f Q", supported: false },
    ];
    const plans = fixtures.map(({ contents, supported }) => {
      const object = doc.addPage(
        [0, 0, 200, 200],
        0,
        { Font: { F1: font }, ExtGState: { GS: { ca: 0.5 } } },
        contents,
      );
      doc.insertPage(-1, object);
      const page = doc.loadPage(doc.countPages() - 1);
      const plan = createCanvasPlan(page);
      expect(!!plan).toBe(supported);
      page.destroy();
      object.destroy();
      return plan;
    });
    doc.destroy();
    expect(plans[0]?.commands[0]).toBe(1);
    expect([...plans[0]!.commands].every(Number.isFinite)).toBe(true);
    expect(plans[0]?.box).toEqual([0, 0, 200, 200]);
  } finally {
    doc.destroy();
  }
});

it("does not drop annotations and rejects degenerate hairline strokes", () => {
  const doc = new engine.PDFDocument();
  try {
    const object = doc.addPage([0, 0, 100, 100], 0, {}, "0 0 50 50 re f");
    object.put("Annots", [
      doc.addObject({ Type: "Annot", Subtype: "Text", Rect: [0, 0, 20, 20] }),
    ]);
    doc.insertPage(-1, object);
    const page = doc.loadPage(0);
    expect(createCanvasPlan(page)).toBeNull();
    expect(createCanvasPlan(page, { annotations: false })).not.toBeNull();
    expect(createCanvasPlan(page, { contents: false })).toBeNull();
    page.destroy();
    const hairline = doc.addPage([0, 0, 100, 100], 0, {}, "0 w 0 0 50 50 re S");
    doc.insertPage(-1, hairline);
    expect(createCanvasPlan(doc.loadPage(1))).toBeNull();
  } finally {
    doc.destroy();
  }
});
