import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  degrees,
} from "@legir/pdfium/authoring";
import { exportPDF, loadPDF } from "@/services/pdfService";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { Annotation } from "@/types";
import { getFreeTextAppearanceRotation } from "@/services/pdfService/lib/freeTextAppearance";
import { decodePdfStreamToText } from "@/services/pdfService/lib/pdf-import-utils";

const worker = {
  loadDocument: async () => true,
  resolveDest: async () => null,
  getOutline: async () => [],
  getPermissions: async () => null,
} as unknown as PDFWorkerService;
const read = (bytes: Uint8Array) => loadPDF(bytes, { workerService: worker });

async function pixels(bytes: Uint8Array) {
  const engine = await getPDFium();
  const document = new engine.PDFDocument(bytes);
  try {
    const page = document.loadPage(0);
    try {
      const bitmap = page.toPixmap([1, 0, 0, 1, 0, 0], undefined, true);
      try {
        return createHash("sha256").update(bitmap.getPixels()).digest("hex");
      } finally {
        bitmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    document.destroy();
  }
}

describe("imported FreeText appearance direction", () => {
  it.each(
    [0, 90, 180, 270].flatMap((pageRotation) =>
      [0, 90, 180, -90].map((textRotation) => [pageRotation, textRotation]),
    ),
  )(
    "uses painted text instead of conflicting Rotate/MK (page=%s, text=%s)",
    async (pageRotation, textRotation) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([400, 500]);
      page.setCropBox(10, 20, 360, 460);
      page.setRotation(degrees(pageRotation));
      const annotation: Annotation = {
        id: "text",
        type: "freetext",
        pageIndex: 0,
        rect: { x: 80, y: 100, width: 160, height: 50 },
        rotationDeg: textRotation,
        text: "START -> 123",
        fontFamily: "Helvetica",
        size: 16,
        color: "#113355",
        borderWidth: 1,
        borderColor: "#008800",
      };
      const reference = await exportPDF(await doc.save(), [], undefined, [
        annotation,
      ]);
      const external = await PDFDocument.load(reference);
      const annot = external.getPage(0).node.Annots()!.lookup(0) as PDFDict;
      // Some producers retain an editing angle that disagrees with their AP.
      // Native viewers paint the AP; changing this metadata must not flip the editor.
      const staleRotation = (pageRotation - textRotation + 180 + 360) % 360;
      annot.set(PDFName.of("Rotate"), PDFNumber.of(staleRotation));
      annot.set(PDFName.of("MK"), external.context.obj({ R: staleRotation }));
      const source = await external.save();
      const expectedPixels = await pixels(reference);
      expect(await pixels(source)).toBe(expectedPixels);
      const loaded = await read(source);
      try {
        expect(loaded.annotations).toHaveLength(1);
        expect.soft(loaded.annotations[0].rotationDeg).toBe(textRotation);
        const saved = await exportPDF(source, [], undefined, [
          { ...loaded.annotations[0], isEdited: true },
        ]);
        expect
          .soft(await pixels(saved), "regenerated text direction")
          .toBe(expectedPixels);
        const reopened = await read(saved);
        try {
          expect(reopened.annotations[0].rotationDeg).toBe(textRotation);
        } finally {
          reopened.dispose();
        }
      } finally {
        loaded.dispose();
      }
    },
  );

  it("reads a text matrix inside an identity AP matrix when Rotate is absent", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 500]);
    const font = doc.context.register(
      doc.context.obj({
        Type: "Font",
        Subtype: "Type1",
        BaseFont: "Helvetica",
      }),
    );
    const ap = doc.context.register(
      doc.context.flateStream(
        "q BT /F1 16 Tf 0 1 -1 0 30 5 Tm (START -> 123) Tj ET Q",
        {
          Type: "XObject",
          Subtype: "Form",
          BBox: [0, 0, 50, 160],
          Matrix: [1, 0, 0, 1, 0, 0],
          Resources: { Font: { F1: font } },
        },
      ),
    );
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "FreeText",
          Rect: [80, 100, 130, 260],
          Contents: PDFString.of("START -> 123"),
          DA: PDFString.of("/F1 16 Tf 0 g"),
          AP: { N: ap },
          F: 4,
        }),
      ),
    );
    const loaded = await read(await doc.save());
    try {
      expect(loaded.annotations[0].rotationDeg).toBe(-90);
      expect(loaded.annotations[0].rect?.width).toBeCloseTo(160);
      expect(loaded.annotations[0].rect?.height).toBeCloseTo(50);
    } finally {
      loaded.dispose();
    }
  });

  it.each([false, true])(
    "retains the metadata fallback with an unusable AP (%s)",
    async (withAppearance) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([400, 500]);
      const ap = doc.context.register(
        doc.context.flateStream("q 0 0 50 160 re S Q", {
          Type: "XObject",
          Subtype: "Form",
          BBox: [0, 0, 50, 160],
        }),
      );
      page.node.addAnnot(
        doc.context.register(
          doc.context.obj({
            Type: "Annot",
            Subtype: "FreeText",
            Rect: [80, 100, 130, 260],
            Rotate: 90,
            Contents: PDFString.of("Text"),
            AP: withAppearance ? { N: ap } : undefined,
          }),
        ),
      );
      const loaded = await read(await doc.save());
      try {
        expect(loaded.annotations[0].rotationDeg).toBe(-90);
      } finally {
        loaded.dispose();
      }
    },
  );
});

describe("FreeText painted baseline transforms", () => {
  it.each([
    {
      name: "composed cm and Tm",
      content: "q 0 1 -1 0 0 0 cm BT 0 1 -1 0 0 0 Tm (text) Tj ET Q",
      matrix: [0, 1, -1, 0, 0, 0],
      expected: -90,
    },
    {
      name: "restored graphics state",
      content: "q 0 -1 1 0 0 0 cm Q BT (text) Tj ET",
      expected: 0,
    },
    {
      name: "replacement text matrix",
      content: "BT 0 1 -1 0 0 0 Tm 0 -1 1 0 0 0 Tm (text) Tj ET",
      expected: -90,
    },
    {
      name: "operators inside strings and comments",
      content:
        "% 0 -1 1 0 0 0 cm\r/Span << /ActualText (BT 0 -1 1 0 0 0 Tm (fake) Tj) >> BDC BT (literal \\( 0 -1 1 0 0 0 cm \\) (nested)) Tj ET EMC",
      expected: 0,
    },
    {
      name: "text array and following decoration",
      content: "BT 0 1 -1 0 0 0 Tm [(A) 20 <42>] TJ ET q 0 -1 1 0 0 0 cm Q",
      expected: 90,
    },
    {
      name: "invisible and empty text before visible text",
      content:
        "BT 0 1 -1 0 0 0 Tm () Tj 3 Tr (hidden) Tj 0 Tr 0 -1 1 0 0 0 Tm (visible) Tj ET",
      expected: -90,
    },
    {
      name: "zero-degree visible text",
      content: "BT /F1 16 Tf (text) Tj ET",
      expected: 0,
    },
    {
      name: "no painted text",
      content: "q 0 1 -1 0 0 0 cm 0 0 20 30 re S Q",
      expected: undefined,
    },
    {
      name: "inline image fallback",
      content: "BI /W 1 /H 1 ID BT (not text) Tj EI",
      expected: undefined,
    },
  ])("$name", async ({ content, matrix, expected }) => {
    const doc = await PDFDocument.create();
    const stream = doc.context.flateStream(content, { Matrix: matrix });
    expect(
      await getFreeTextAppearanceRotation(stream, decodePdfStreamToText),
    ).toBe(expected);
  });

  it("composes nested form matrices and inherits the text graphics state", async () => {
    const doc = await PDFDocument.create();
    const inner = doc.context.register(
      doc.context.flateStream("BT 0 1 -1 0 0 0 Tm (nested) Tj ET", {
        Subtype: "Form",
        Matrix: [0, 1, -1, 0, 0, 0],
      }),
    );
    const outer = doc.context.flateStream(
      "q 3 Tr /Fm#31 Do Q q 0 1 -1 0 0 0 cm /Fm#31 Do Q",
      {
        Resources: { XObject: { Fm1: inner } },
      },
    );
    expect(
      await getFreeTextAppearanceRotation(outer, decodePdfStreamToText),
    ).toBe(-90);
  });

  it("bounds cyclic form traversal", async () => {
    const doc = await PDFDocument.create();
    const stream = doc.context.flateStream("/Self Do", { Subtype: "Form" });
    const ref = doc.context.register(stream);
    stream.dict.set(
      PDFName.of("Resources"),
      doc.context.obj({ XObject: { Self: ref } }),
    );
    expect(
      await getFreeTextAppearanceRotation(stream, decodePdfStreamToText),
    ).toBeUndefined();
  });

  it("includes the AP-to-annotation fit when it scales the axes differently", async () => {
    const doc = await PDFDocument.create();
    const stream = doc.context.flateStream("BT 1 1 -1 1 0 0 Tm (text) Tj ET", {
      BBox: [0, 0, 100, 100],
    });
    expect(
      await getFreeTextAppearanceRotation(
        stream,
        decodePdfStreamToText,
        [0, 0, 200, 100],
      ),
    ).toBeCloseTo(26.565051177);
  });
});
