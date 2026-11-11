import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DocumentSession } from "@legir/pdf-core";
import { getPDFium } from "@legir/pdf-core/runtime";
import { FieldType, type FormField } from "@legir/pdf-model";
import { PDFDocument, PDFName, PDFStream } from "@legir/pdfium/authoring";
import { parseFieldStyle } from "../dist/lib/control-parsing.js";

const alignments = ["top", "middle", "bottom"] as const;
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function raster(bytes: Uint8Array) {
  const engine = await getPDFium();
  const doc = new engine.PDFDocument(bytes);
  try {
    const page = doc.loadPage(0);
    try {
      const pixmap = page.toPixmap([1, 0, 0, 1, 0, 0], undefined, false, true);
      try {
        return hash(pixmap.getPixels());
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

function textPositions(doc: PDFDocument, name = "text") {
  const appearance = doc
    .getForm()
    .getTextField(name)
    .acroField.getWidgets()[0]
    .getNormalAppearance() as PDFStream;
  const content = new TextDecoder().decode(appearance.getUnencodedContents());
  return [...content.matchAll(/1 0 0 1 ([\d.e+-]+) ([\d.e+-]+) Tm/g)].map(
    (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
  );
}

describe("text field vertical alignment", () => {
  it("keeps explicit left alignment and only falls back when the primary PDF code is absent or invalid", async () => {
    const doc = await PDFDocument.create();
    try {
      const field = doc.getForm().createTextField("text");
      const read = (textAlignment: number | undefined) =>
        parseFieldStyle(
          {
            subtype: "Widget",
            rect: [0, 0, 100, 40],
            fieldName: "text",
            textAlignment,
          },
          doc,
          new Map(),
          undefined,
        ).horizontalAlignment;
      field.setHorizontalAlignment("left");
      expect(read(2)).toBe("left");
      field.setHorizontalAlignment(undefined);
      expect(read(2)).toBe("right");
      expect(read(1)).toBe("center");
      expect(read(undefined)).toBe("left");
      expect(read(99)).toBe("left");
      field.acroField.dict.set(PDFName.of("Q"), doc.context.obj(99));
      expect(read(2)).toBe("right");
    } finally {
      doc.destroy();
    }
  });
  it("uses symmetric alignment APIs with horizontal center and vertical middle", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const source = await doc.save();
    const session = new DocumentSession(await getPDFium(), source);
    try {
      const bytes = await session.export({
        fields: [
          {
            id: "text",
            name: "text",
            type: FieldType.TEXT,
            pageIndex: 0,
            rect: { x: 20, y: 20, width: 180, height: 80 },
            value: "Text",
            horizontalAlignment: "center",
            verticalAlignment: "middle",
          },
        ],
        annotations: [],
      });
      const reopened = new DocumentSession(await getPDFium(), bytes);
      try {
        const field = (await reopened.parse({}, async () => undefined))
          .fields[0];
        expect(field.horizontalAlignment).toBe("center");
        expect(field.verticalAlignment).toBe("middle");
        expect(field).not.toHaveProperty("alignment");
      } finally {
        reopened.dispose();
      }
      const authoring = await PDFDocument.load(bytes);
      try {
        const field = authoring.getForm().getTextField("text");
        expect(field.getHorizontalAlignment()).toBe("center");
        expect(field.getVerticalAlignment()).toBe("middle");
        field.setHorizontalAlignment("right");
        expect(field.getHorizontalAlignment()).toBe("right");
        field.setVerticalAlignment("top");
        expect(field.getVerticalAlignment()).toBe("top");
        expect(() => field.setVerticalAlignment("center" as "middle")).toThrow(
          /alignment/,
        );
        field.setHorizontalAlignment(undefined);
        field.setVerticalAlignment(undefined);
        expect(field.getHorizontalAlignment()).toBeUndefined();
        expect(field.getVerticalAlignment()).toBeUndefined();
        expect(() => field.setHorizontalAlignment("bad" as "left")).toThrow(
          /alignment/,
        );
      } finally {
        authoring.destroy();
      }
    } finally {
      session.dispose();
      doc.destroy();
    }
  });
  it.each([false, true])(
    "persists all alignments and renders identical editable/flattened output, multiline=%s",
    async (multiline) => {
      const source = await PDFDocument.create();
      source.addPage([360, 300]);
      const bytes = await source.save();
      const originalHash = hash(bytes);
      const engine = await getPDFium();
      const before = engine.liveDocuments();
      const session = new DocumentSession(engine, bytes);
      try {
        for (const rotation of [0, 90, 180, 270]) {
          const positions: number[] = [];
          const pixels: string[] = [];
          for (const verticalAlignment of alignments) {
            const field: FormField = {
              id: "text",
              name: "text",
              type: FieldType.TEXT,
              pageIndex: 0,
              rect: { x: 40, y: 40, width: 200, height: 150 },
              value: multiline ? "First line\nSecond line" : "Text",
              style: {
                fontFamily: "Helvetica",
                fontSize: 14,
                borderWidth: 0,
                isTransparent: true,
              },
              horizontalAlignment: "right",
              verticalAlignment,
              multiline,
              rotationDeg: rotation,
            };
            const request = {
              fields: [field],
              annotations: [],
              options: { incremental: false },
            };
            const editable = await session.export(request);
            const doc = await PDFDocument.load(editable);
            const tf = doc.getForm().getTextField("text");
            expect(tf.getVerticalAlignment()).toBe(verticalAlignment);
            expect(tf.getHorizontalAlignment()).toBe("right");
            const lines = textPositions(doc);
            expect(lines).toHaveLength(multiline ? 2 : 1);
            if (multiline) expect(lines[0].y).toBeGreaterThan(lines[1].y);
            positions.push(lines[0].y);
            const restored = new DocumentSession(engine, editable);
            try {
              const parsed = await restored.parse({}, async () => undefined);
              expect(parsed.fields[0].verticalAlignment).toBe(
                verticalAlignment,
              );
              expect(parsed.fields[0].horizontalAlignment).toBe("right");
              const next = await restored.export({
                ...request,
                fields: [
                  {
                    ...parsed.fields[0],
                    horizontalAlignment: "left",
                    verticalAlignment: "middle",
                  },
                ],
              });
              const nextDoc = await PDFDocument.load(next);
              expect(
                nextDoc.getForm().getTextField("text").getHorizontalAlignment(),
              ).toBe("left");
              expect(
                nextDoc.getForm().getTextField("text").getVerticalAlignment(),
              ).toBe("middle");
              expect(textPositions(nextDoc)[0].x).toBeLessThan(lines[0].x);
              nextDoc.destroy();
            } finally {
              restored.dispose();
            }
            doc.destroy();
            const flat = await session.export({
              ...request,
              options: { ...request.options, flattenFormFields: true },
            });
            const flatDoc = await PDFDocument.load(flat);
            expect(flatDoc.getForm().getFields()).toHaveLength(0);
            flatDoc.destroy();
            const pixelHash = await raster(editable);
            expect(await raster(flat)).toBe(pixelHash);
            pixels.push(pixelHash);
          }
          expect(positions[0]).toBeGreaterThan(positions[1]);
          expect(positions[1]).toBeGreaterThan(positions[2]);
          expect(positions[1]).toBeCloseTo(
            (positions[0] + positions[2]) / 2,
            5,
          );
          expect(new Set(pixels).size).toBe(3);
        }
        expect(hash(bytes)).toBe(originalHash);
        expect(
          (await session.parse({}, async () => undefined)).fields,
        ).toHaveLength(0);
      } finally {
        session.dispose();
      }
      expect(engine.liveDocuments()).toBe(before);
    },
  );

  it("retains legacy defaults, clears an explicit alignment and ignores malformed imported values", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const field = doc.getForm().createTextField("text");
    field.setFontSize(14);
    field.setText("Text");
    field.addToPage(page, { x: 30, y: 30, width: 200, height: 120 });
    const original = textPositions(doc);
    expect(field.getVerticalAlignment()).toBeUndefined();
    field.setVerticalAlignment("bottom");
    const changed = await PDFDocument.load(await doc.save());
    expect(textPositions(changed)[0].y).toBeLessThan(original[0].y);
    field.setVerticalAlignment(undefined);
    const reset = await PDFDocument.load(await doc.save());
    expect(
      reset.getForm().getTextField("text").getVerticalAlignment(),
    ).toBeUndefined();
    expect(textPositions(reset)).toEqual(original);
    field.acroField.dict.set(PDFName.of("LegirVAlign"), PDFName.of("unknown"));
    expect(field.getVerticalAlignment()).toBeUndefined();
    expect(() => field.setVerticalAlignment("invalid" as "top")).toThrow(
      /alignment/,
    );
  });

  it("aligns wrapped custom-font text and preserves it after flattening", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 300]);
    const bytes = await source.save();
    const session = new DocumentSession(await getPDFium(), bytes);
    const fontBytes = new Uint8Array(
      await readFile(
        new URL(
          "../../../public/fonts/NotoSansSC-Regular.ttf",
          import.meta.url,
        ),
      ),
    );
    const positions: number[] = [];
    try {
      for (const verticalAlignment of alignments) {
        const field: FormField = {
          id: "text",
          name: "text",
          type: FieldType.TEXT,
          pageIndex: 0,
          rect: { x: 40, y: 40, width: 90, height: 200 },
          value: "中文自动换行测试，第二段内容",
          multiline: true,
          style: {
            fontFamily: "Custom",
            fontSize: 14,
            borderWidth: 2,
            isTransparent: true,
          },
          horizontalAlignment: "center",
          verticalAlignment,
        };
        const request = {
          fields: [field],
          annotations: [],
          customFont: { bytes: fontBytes, name: "TestFont" },
        };
        const editable = await session.export(request);
        const doc = await PDFDocument.load(editable);
        const lines = textPositions(doc);
        expect(lines.length).toBeGreaterThan(1);
        positions.push(lines[0].y);
        doc.destroy();
        const flat = await session.export({
          ...request,
          options: { flattenFormFields: true },
        });
        expect(await raster(flat)).toBe(await raster(editable));
      }
      expect(positions[0]).toBeGreaterThan(positions[1]);
      expect(positions[1]).toBeGreaterThan(positions[2]);
    } finally {
      session.dispose();
    }
  });
});
