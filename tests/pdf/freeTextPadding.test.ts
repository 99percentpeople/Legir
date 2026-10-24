import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  degrees,
} from "@legir/pdfium/authoring";
import { exportPDF, loadPDF } from "@/services/pdfService";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import {
  freeTextPaddingFromPdf,
  getFreeTextContentBox,
  wrapFreeText,
} from "@/services/pdfService/lib/freeTextLayout";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { Annotation } from "@/types";

const worker = {
  loadDocument: async () => true,
  resolveDest: async () => null,
  getOutline: async () => [],
  getPermissions: async () => null,
} as unknown as PDFWorkerService;
const read = (bytes: Uint8Array) => loadPDF(bytes, { workerService: worker });
const annotation: Annotation = {
  id: "text",
  type: "freetext",
  pageIndex: 0,
  rect: { x: 40, y: 60, width: 200, height: 100 },
  text: "Hg Text\nSecond line",
  fontFamily: "Helvetica",
  size: 24,
  color: "#000000",
  borderColor: "#ff0000",
  borderWidth: 2,
};
const fixture = async (rotation = 0) => {
  const doc = await PDFDocument.create();
  try {
    doc.addPage([400, 500]).setRotation(degrees(rotation));
    return await doc.save();
  } finally {
    doc.destroy();
  }
};
const rd = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  try {
    const a = doc.getPage(0).node.Annots()!.lookup(0) as PDFDict;
    const values = a.lookup(PDFName.of("RD")) as PDFArray;
    return Array.from({ length: values.size() }, (_, i) =>
      (values.lookup(i) as PDFNumber).asNumber(),
    );
  } finally {
    doc.destroy();
  }
};
const ink = async (bytes: Uint8Array) => {
  const engine = await getPDFium();
  const doc = new engine.PDFDocument(bytes);
  try {
    const page = doc.loadPage(0);
    try {
      const bitmap = page.toPixmap([2, 0, 0, 2, 0, 0], undefined, true);
      try {
        const pixels = bitmap.getPixels();
        let left = Infinity,
          right = -Infinity,
          top = Infinity,
          bottom = -Infinity;
        for (let y = 0; y < bitmap.height; y++)
          for (let x = 0; x < bitmap.width; x++) {
            const i = (y * bitmap.width + x) * 4;
            if (
              pixels[i + 3] > 128 &&
              pixels[i] < 100 &&
              pixels[i + 1] < 100 &&
              pixels[i + 2] < 100
            ) {
              left = Math.min(left, x / 2);
              right = Math.max(right, x / 2);
              top = Math.min(top, y / 2);
              bottom = Math.max(bottom, y / 2);
            }
          }
        return { left, right, top, bottom };
      } finally {
        bitmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
};

describe("FreeText content layout", () => {
  it("keeps legacy border insets, accepts zero and collapses over-padded content", () => {
    expect(getFreeTextContentBox({ borderWidth: 2 }, 100, 40)).toMatchObject({
      x: 2,
      y: 2,
      width: 96,
      height: 36,
    });
    expect(
      getFreeTextContentBox({ borderWidth: 2, textPadding: 0 }, 100, 40),
    ).toMatchObject({ x: 0, y: 0, width: 100, height: 40 });
    expect(getFreeTextContentBox({ textPadding: 80 }, 100, 40)).toMatchObject({
      width: 0,
      height: 0,
    });
    expect(freeTextPaddingFromPdf([1, -2, 3, 4])).toBeUndefined();
  });

  it("wraps explicit blank lines and Unicode code points without losing content", () => {
    expect(wrapFreeText("A\n\nB", 20, (s) => s.length)).toEqual(["A", "", "B"]);
    expect(wrapFreeText("甲😀乙", 1, (s) => Array.from(s).length)).toEqual([
      "甲",
      "😀",
      "乙",
    ]);
    expect(wrapFreeText("anything", 0, () => 0)).toEqual([]);
  });

  it.each([0, 90, 180, 270])(
    "retains asymmetric imported RD through edits and both page/text rotations (%s)",
    async (rotation) => {
      const padding = { left: 20, bottom: 9, right: 13, top: 16 };
      const source = await exportPDF(await fixture(rotation), [], undefined, [
        { ...annotation, rotationDeg: 90, textPadding: padding },
      ]);
      expect(await rd(source)).toEqual([20, 9, 13, 16]);
      const loaded = await read(source);
      try {
        expect(loaded.annotations[0].textPadding).toEqual(padding);
        const saved = await exportPDF(source, [], undefined, [
          { ...loaded.annotations[0], text: "Edited text", isEdited: true },
        ]);
        expect(await rd(saved)).toEqual([20, 9, 13, 16]);
        const reopened = await read(saved);
        try {
          expect(reopened.annotations[0].textPadding).toEqual(padding);
        } finally {
          reopened.dispose();
        }
      } finally {
        loaded.dispose();
      }
    },
  );

  it.each([false, true])(
    "centers the first baseline within the line instead of shifting it by the full leading (flatten=%s)",
    async (flatten) => {
      const source = await fixture();
      const output = async (lineHeight: number, textPadding: number) =>
        ink(
          await exportPDF(source, [], undefined, [
            { ...annotation, lineHeight, textPadding, flatten },
          ]),
        );
      const tight = await output(1, 2);
      const loose = await output(1.5, 2);
      const padded = await output(1.5, 12);
      expect(
        Math.abs(tight.top - (60 + 2 + (24 * (1 - 0.718)) / 2)),
      ).toBeLessThan(1);
      expect(loose.top - tight.top).toBe(6);
      expect(padded.top - loose.top).toBe(10);
      expect(padded.left - loose.left).toBe(10);
    },
  );

  it("converts font, border and padding between PDF UserUnit and editor points", async () => {
    const doc = await PDFDocument.create();
    let source: Uint8Array;
    try {
      const page = doc.addPage([400, 500]);
      page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
      source = await doc.save();
    } finally {
      doc.destroy();
    }
    const saved = await exportPDF(source, [], undefined, [
      {
        ...annotation,
        textPadding: { top: 16, right: 24, bottom: 12, left: 20 },
      },
    ]);
    expect(await rd(saved)).toEqual([10, 6, 12, 8]);
    const loaded = await read(saved);
    try {
      expect(loaded.annotations[0]).toMatchObject({
        size: 24,
        borderWidth: 2,
        rect: annotation.rect,
        textPadding: { top: 16, right: 24, bottom: 12, left: 20 },
      });
    } finally {
      loaded.dispose();
    }
  });

  it.each([0, 90])(
    "clips overflowing text to all four content edges in both outputs (rotation=%s)",
    async (rotationDeg) => {
      const source = await fixture();
      const value = {
        ...annotation,
        rotationDeg,
        text: "W".repeat(50),
        textPadding: { top: 20, right: 90, bottom: 52, left: 90 },
      };
      const normal = await ink(await exportPDF(source, [], undefined, [value]));
      const flattened = await ink(
        await exportPDF(source, [], undefined, [{ ...value, flatten: true }]),
      );
      expect(flattened).toEqual(normal);
      expect(normal.left).toBeGreaterThanOrEqual(rotationDeg ? 142 : 130);
      expect(normal.right).toBeLessThan(rotationDeg ? 170 : 150);
      expect(normal.top).toBeGreaterThanOrEqual(rotationDeg ? 100 : 80);
      expect(normal.bottom).toBeLessThan(rotationDeg ? 120 : 108);
    },
  );
});
