import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  degrees,
} from "@legir/pdfium/authoring";
import { exportPDF, loadPDF } from "@/services/pdfService";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { pagePointToView } from "@/components/workspace/lib/pageViewRotation";
import {
  normalizeRotationDeg,
  rotateOuterRectKeepingCenter,
} from "@/lib/controlRotation";
import { FieldType, type Annotation, type FormField } from "@/types";

const worker = {
  loadDocument: async () => true,
  resolveDest: async () => null,
  getOutline: async () => [],
  getPermissions: async () => null,
  renderPageImage: async () => undefined,
} as unknown as PDFWorkerService;
const read = (bytes: Uint8Array) => loadPDF(bytes, { workerService: worker });
const rect = { x: 80, y: 90, width: 180, height: 60 };
type Point = { x: number; y: number };
const corners = (r: typeof rect) => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
];
const pointsKey = (points: Point[]) =>
  points.map(({ x, y }) => [Number(x.toFixed(4)), Number(y.toFixed(4))]).sort();
const displayedPoints = (a: Annotation) => {
  if (a.type === "ink") return a.strokes!.flat();
  if (a.type === "highlight") return (a.rects ?? [a.rect!]).flatMap(corners);
  const r = a.rect!;
  const points = a.shapePoints
    ? a.shapePoints.map((p) => ({
        x: r.x + p.x * r.width,
        y: r.y + p.y * r.height,
      }))
    : corners(r);
  const theta = ((a.rotationDeg ?? 0) * Math.PI) / 180;
  const cx = r.x + r.width / 2,
    cy = r.y + r.height / 2;
  return points.map(({ x, y }) => ({
    x: cx + (x - cx) * Math.cos(theta) - (y - cy) * Math.sin(theta),
    y: cy + (x - cx) * Math.sin(theta) + (y - cy) * Math.cos(theta),
  }));
};
async function raster(bytes: Uint8Array) {
  const engine = await getPDFium();
  const doc = new engine.PDFDocument(bytes);
  try {
    const page = doc.loadPage(0);
    try {
      const bitmap = page.toPixmap([1, 0, 0, 1, 0, 0], undefined, true);
      try {
        return {
          width: bitmap.width,
          height: bitmap.height,
          rgba: bitmap.getPixels().slice(),
        };
      } finally {
        bitmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}
async function pixels(bytes: Uint8Array) {
  const { width, height, rgba } = await raster(bytes);
  return {
    width,
    height,
    hash: createHash("sha256").update(rgba).digest("hex"),
  };
}
async function blank(rotation: number) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  page.setCropBox(10, 20, 360, 460);
  page.setRotation(degrees(rotation));
  return doc;
}
const annotations: Annotation[] = [
  {
    id: "text",
    pageIndex: 0,
    type: "freetext",
    rect,
    text: "ROTATE 123",
    size: 16,
    fontFamily: "Helvetica",
    color: "#113355",
    borderWidth: 1,
    borderColor: "#008800",
    backgroundColor: "#eeeeee",
  },
  ...(
    [
      "square",
      "circle",
      "cloud",
      "line",
      "arrow",
      "polyline",
      "polygon",
      "cloud_polygon",
    ] as const
  ).map(
    (shapeType): Annotation => ({
      id: shapeType,
      pageIndex: 0,
      type: "shape",
      shapeType,
      rect,
      shapePoints: ["line", "arrow"].includes(shapeType)
        ? [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ]
        : ["polyline", "polygon", "cloud_polygon"].includes(shapeType)
          ? [
              { x: 0, y: 0 },
              { x: 1, y: 0.3 },
              { x: 0.4, y: 1 },
            ]
          : undefined,
      shapeEndArrow: shapeType === "arrow",
      shapeEndArrowStyle: shapeType === "arrow" ? "closed_arrow" : undefined,
      color: "#225588",
      backgroundColor: "#ffffaa",
      thickness: 2,
    }),
  ),
  {
    id: "ink",
    pageIndex: 0,
    type: "ink",
    strokes: [
      [
        { x: 80, y: 90 },
        { x: 260, y: 110 },
        { x: 130, y: 150 },
      ],
    ],
    color: "#225588",
    thickness: 2,
  },
  {
    id: "highlight",
    pageIndex: 0,
    type: "highlight",
    rect,
    rects: [
      { ...rect, height: 15 },
      { ...rect, y: 125, width: 120, height: 15 },
    ],
    color: "#ffff00",
    opacity: 0.4,
  },
  {
    id: "note",
    pageIndex: 0,
    type: "comment",
    rect,
    text: "Comment body",
    color: "#ffff00",
  },
  {
    id: "link",
    pageIndex: 0,
    type: "link",
    rect,
    linkUrl: "https://example.com/rotation",
  },
];

describe.each(annotations)("$id page rotation round trip", (original) => {
  it.each([
    [0, 90, 0],
    [0, 180, 30],
    [0, 270, 0],
    [90, 90, 30],
    [0, 90, 45],
    [270, 180, 90],
  ])(
    "preserves displayed geometry and regenerated appearance (page=%s, turn=%s, control=%s)",
    async (sourceRotation, turn, ownRotation) => {
      const doc = await blank(sourceRotation);
      const rotationDeg = ["shape", "freetext"].includes(original.type)
        ? ownRotation
        : 0;
      const bytes = await exportPDF(await doc.save(), [], undefined, [
        { ...original, rotationDeg },
      ]);
      const loaded = await read(bytes);
      try {
        expect(loaded.annotations).toHaveLength(1);
        expect
          .soft(
            pointsKey(displayedPoints(loaded.annotations[0])),
            "initial editable geometry",
          )
          .toEqual(pointsKey(displayedPoints({ ...original, rotationDeg })));
        const page = { ...loaded.pages[0], rotationDelta: turn };
        const saved = await exportPDF(
          bytes,
          [],
          undefined,
          loaded.annotations,
          undefined,
          { pageStructure: { pages: [page], sources: {} } },
        );
        const reference = await PDFDocument.load(bytes);
        reference
          .getPage(0)
          .setRotation(degrees((sourceRotation + turn) % 360));
        expect
          .soft(await pixels(saved), "rotation-only save")
          .toEqual(await pixels(await reference.save()));
        const reopened = await read(saved);
        try {
          expect(reopened.annotations).toHaveLength(1);
          const restored = reopened.annotations[0];
          expect
            .soft(pointsKey(displayedPoints(restored)), "editable geometry")
            .toEqual(
              pointsKey(
                displayedPoints(loaded.annotations[0]).map((p) =>
                  pagePointToView(p, page, 0),
                ),
              ),
            );
          expect.soft(restored.text).toBe(loaded.annotations[0].text);
          expect.soft(restored.linkUrl).toBe(loaded.annotations[0].linkUrl);
          if (original.type === "freetext")
            expect
              .soft(restored.rotationDeg)
              .toBe(
                normalizeRotationDeg(
                  (loaded.annotations[0].rotationDeg ?? 0) + turn,
                ),
              );
          const edited = await exportPDF(saved, [], undefined, [
            { ...restored, isEdited: true },
          ]);
          expect
            .soft(await pixels(edited), "regenerated appearance")
            .toEqual(await pixels(saved));
        } finally {
          reopened.dispose();
        }
      } finally {
        loaded.dispose();
      }
    },
  );
});

describe.each([
  FieldType.TEXT,
  FieldType.CHECKBOX,
  FieldType.RADIO,
  FieldType.DROPDOWN,
  FieldType.SIGNATURE,
])("%s widget on rotated pages", (type) => {
  it.each([90, 180, 270])(
    "keeps orientation without an explicit MK/R (%s)",
    async (turn) => {
      const doc = await blank(0);
      const field: FormField = {
        id: "field",
        type,
        name: "field",
        pageIndex: 0,
        rect,
        value: "Choice A",
        options: ["Choice A", "Choice B"],
        isChecked: true,
        exportValue: "On",
        radioValue: "On",
        style: {
          fontFamily: "Helvetica",
          fontSize: 14,
          borderWidth: 1,
          borderColor: "#113355",
        },
      };
      const seed = await PDFDocument.load(
        await exportPDF(await doc.save(), [field]),
      );
      const widget = seed.getPage(0).node.Annots()!.lookup(0) as PDFDict;
      widget.delete(PDFName.of("Rotate"));
      (widget.lookup(PDFName.of("MK")) as PDFDict | undefined)?.delete(
        PDFName.of("R"),
      );
      if (type === FieldType.SIGNATURE) {
        // External signature widgets stay editable without changing their FT.
        seed
          .getForm()
          .getFields()[0]
          .acroField.dict.set(PDFName.of("FT"), PDFName.of("Sig"));
      }
      const bytes = await seed.save({ updateFieldAppearances: false });
      const loaded = await read(bytes);
      try {
        const page = { ...loaded.pages[0], rotationDelta: turn };
        const saved = await exportPDF(
          bytes,
          loaded.fields,
          undefined,
          [],
          undefined,
          {
            pageStructure: { pages: [page], sources: {} },
            syncFormFields: true,
          },
        );
        const reopened = await read(saved);
        try {
          const restored = reopened.fields[0];
          expect.soft(restored.rotationDeg ?? 0, "widget angle").toBe(turn);
          expect
            .soft(pointsKey(corners(restored.rect)))
            .toEqual(
              pointsKey(
                corners(loaded.fields[0].rect).map((p) =>
                  pagePointToView(p, page, 0),
                ),
              ),
            );
          expect.soft(restored.type).toBe(type);
          expect.soft(restored.value).toBe(loaded.fields[0].value);
          expect.soft(restored.isChecked).toBe(loaded.fields[0].isChecked);
          const edited = await exportPDF(
            saved,
            reopened.fields,
            undefined,
            [],
            undefined,
            { syncFormFields: true },
          );
          expect
            .soft(await pixels(edited), "widget appearance on second save")
            .toEqual(await pixels(saved));
          if (type !== FieldType.SIGNATURE) {
            const change =
              type === FieldType.TEXT || type === FieldType.DROPDOWN
                ? { value: "Choice B" }
                : { isChecked: false };
            const changed = await exportPDF(saved, [
              { ...restored, ...change },
            ]);
            const reference = await PDFDocument.load(
              await exportPDF(bytes, [{ ...loaded.fields[0], ...change }]),
            );
            reference.getPage(0).setRotation(degrees(turn));
            expect
              .soft(await pixels(changed), "value edit after reopening")
              .toEqual(
                await pixels(
                  await reference.save({ updateFieldAppearances: false }),
                ),
              );
          }
        } finally {
          reopened.dispose();
        }
      } finally {
        loaded.dispose();
      }
    },
  );
});

it.each([
  FieldType.TEXT,
  FieldType.CHECKBOX,
  FieldType.RADIO,
  FieldType.DROPDOWN,
])(
  "clears a prior nonzero widget rotation when %s is returned to zero",
  async (type) => {
    const doc = await blank(0);
    const field: FormField = {
      id: "field",
      name: "field",
      type,
      pageIndex: 0,
      rect,
      rotationDeg: 90,
      value: "Value",
      options: ["Value"],
      isChecked: true,
      radioValue: "On",
    };
    const bytes = await exportPDF(await doc.save(), [field]);
    const loaded = await read(bytes);
    try {
      const restored = loaded.fields[0];
      expect(restored.rotationDeg).toBe(90);
      const saved = await exportPDF(bytes, [
        {
          ...restored,
          rotationDeg: 0,
          rect: rotateOuterRectKeepingCenter(restored.rect, 90, 0),
        },
      ]);
      const reopened = await read(saved);
      try {
        expect(reopened.fields[0].rotationDeg ?? 0).toBe(0);
      } finally {
        reopened.dispose();
      }
    } finally {
      loaded.dispose();
    }
  },
);

const signature =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAGUlEQVR4nD3BMQEAAAjAILR/5/kJJIi28Q5Y5gT/nBWRrgAAAABJRU5ErkJggg==";
describe.each(["contain", "fill"] as const)(
  "%s image signature",
  (imageScaleMode) => {
    it.each(
      [0, 90, 180, 270].flatMap((page) =>
        [0, 90].map((control) => [page, control]),
      ),
    )(
      "matches displayed content on a rotated page (page=%s, control=%s)",
      async (pageRotation, rotationDeg) => {
        const doc = await blank(pageRotation);
        const output = await exportPDF(await doc.save(), [
          {
            id: "signature",
            name: "signature",
            type: FieldType.SIGNATURE,
            pageIndex: 0,
            rect,
            rotationDeg,
            signatureData: signature,
            imageScaleMode,
          },
        ]);
        const bitmap = await raster(output);
        const localWidth = rotationDeg === 90 ? rect.height : rect.width;
        const localHeight = rotationDeg === 90 ? rect.width : rect.height;
        const scale = Math.min(localWidth / 4, localHeight / 2);
        const w = imageScaleMode === "fill" ? localWidth : 4 * scale;
        const h = imageScaleMode === "fill" ? localHeight : 2 * scale;
        const theta = (rotationDeg * Math.PI) / 180;
        for (const [x, y, rgb] of [
          [-0.375, -0.25, [0, 255, 0]],
          [0.25, 0, [0, 0, 255]],
        ] as const) {
          const px = Math.floor(
            rect.x +
              rect.width / 2 +
              x * w * Math.cos(theta) -
              y * h * Math.sin(theta),
          );
          const py = Math.floor(
            rect.y +
              rect.height / 2 +
              x * w * Math.sin(theta) +
              y * h * Math.cos(theta),
          );
          const offset = (py * bitmap.width + px) * 4;
          expect
            .soft(
              [...bitmap.rgba.slice(offset, offset + 3)],
              `signature at ${px},${py}`,
            )
            .toEqual(rgb);
        }
      },
    );
  },
);

it.each(["Underline", "StrikeOut", "Squiggly", "Caret", "Redact", "Widget"])(
  "preserves the native appearance of unsupported %s annotations on rotation",
  async (subtype) => {
    const doc = await blank(90);
    const page = doc.getPage(0);
    const ap = doc.context.register(
      doc.context.flateStream("0 0 1 rg 0 0 m 180 0 l 0 60 l h f", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 180, 60],
        Resources: {},
      }),
    );
    const annot = doc.context.obj({
      Type: "Annot",
      Subtype: subtype,
      Rect: [80, 90, 260, 150],
      QuadPoints: [80, 150, 260, 150, 80, 90, 260, 90],
      F: 4,
      P: page.ref,
      AP: { N: ap },
      ...(subtype === "Widget" ? { FT: "Btn", Ff: 1 << 16 } : {}),
    });
    page.node.addAnnot(doc.context.register(annot));
    const bytes = await doc.save({ updateFieldAppearances: false });
    const loaded = await read(bytes);
    try {
      const saved = await exportPDF(
        bytes,
        loaded.fields,
        undefined,
        loaded.annotations,
        undefined,
        {
          pageStructure: {
            pages: [{ ...loaded.pages[0], rotationDelta: 90 }],
            sources: {},
          },
          preservedSourceAnnotations: loaded.preservedSourceAnnotations,
        },
      );
      doc.getPage(0).setRotation(degrees(180));
      expect(await pixels(saved)).toEqual(
        await pixels(await doc.save({ updateFieldAppearances: false })),
      );
      const output = await PDFDocument.load(saved);
      expect(output.getPage(0).node.Annots()!.size()).toBe(1);
      expect(
        (output.getPage(0).node.Annots()!.lookup(0) as PDFDict).lookup(
          PDFName.of("Subtype"),
        ),
      ).toBe(PDFName.of(subtype));
    } finally {
      loaded.dispose();
    }
  },
);

it.each([90, 180, 270])(
  "preserves selected list options after rotating %s degrees",
  async (turn) => {
    const doc = await blank(90);
    const bytes = await exportPDF(await doc.save(), [
      {
        id: "list",
        name: "list",
        type: FieldType.DROPDOWN,
        isMultiSelect: true,
        options: ["First", "Second", "Third"],
        value: "First\nThird",
        pageIndex: 0,
        rect,
        rotationDeg: 0,
        style: { fontFamily: "Helvetica", fontSize: 12 },
      },
    ]);
    const loaded = await read(bytes);
    try {
      const saved = await exportPDF(
        bytes,
        loaded.fields,
        undefined,
        [],
        undefined,
        {
          pageStructure: {
            pages: [{ ...loaded.pages[0], rotationDelta: turn }],
            sources: {},
          },
        },
      );
      const reopened = await read(saved);
      try {
        expect(reopened.fields[0]).toMatchObject({
          type: FieldType.DROPDOWN,
          isMultiSelect: true,
          value: "First\nThird",
          rotationDeg: turn,
        });
        const edited = await exportPDF(saved, reopened.fields);
        expect(await pixels(edited)).toEqual(await pixels(saved));
      } finally {
        reopened.dispose();
      }
    } finally {
      loaded.dispose();
    }
  },
);
