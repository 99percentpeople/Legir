import { describe, expect, it, vi } from "vitest";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  degrees,
} from "@legir/pdfium/authoring";
import { createHash } from "node:crypto";
import { exportPDF, loadPDF } from "@/services/pdfService";
import { decodePdfStreamToText } from "@/services/pdfService/lib/pdf-import-utils";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { Annotation, StampImageAppearance } from "@/types";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import { pagePointToView } from "@/components/workspace/lib/pageViewRotation";
import { normalizeRotationDeg } from "@/lib/controlRotation";
import { StampParser } from "@/services/pdfService/parsers/AnnotationParsers";
import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";

// A 4 x 2 JPEG needs no browser canvas to round-trip its native image resource.
const jpeg =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAACAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCWgA4pK//Z";
const svg =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2" viewBox="0 0 4 2"><rect width="4" height="2" fill="red"/><rect x="2" width="2" height="2" fill="blue"/><rect width="1" height="1" fill="lime"/></svg>',
  );
const worker = () => ({
  loadDocument: vi.fn(async () => true),
  resolveDest: vi.fn(async () => null),
  getOutline: vi.fn(async () => []),
  getPermissions: vi.fn(async () => null),
  renderPageImage: vi.fn(async () => undefined),
});

const stamp = (
  dataUrl: string,
  scaleMode?: StampImageAppearance["scaleMode"],
): Annotation => ({
  id: "image",
  type: "stamp",
  pageIndex: 0,
  rect: { x: 20, y: 30, width: 120, height: 120 },
  stamp: {
    kind: "image",
    image: { dataUrl, intrinsicSize: { width: 4, height: 2 } },
    appearance: { frame: "plain", scaleMode },
  },
});

async function pixels(bytes: Uint8Array) {
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
          hash: createHash("sha256").update(bitmap.getPixels()).digest("hex"),
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

const read = (bytes: Uint8Array) =>
  loadPDF(bytes, {
    workerService: worker() as unknown as PDFWorkerService,
  });

it("does not rotate a rendered-page stamp crop a second time", () => {
  const [parsed] = new StampParser().parse({
    pageIndex: 0,
    viewport: createViewportFromPageInfo({
      viewBox: [0, 0, 400, 600],
      rotation: 90,
    }),
    pageAnnotations: [
      {
        subtype: "Stamp",
        rect: [10, 20, 70, 200],
        rotation: 30,
        appearanceRotation: 30,
        stamp: {
          image: stamp(jpeg).stamp!.image,
          appearance: { frame: "plain", source: "baked" },
        },
      },
    ],
  });
  expect(parsed.rotationDeg).toBe(0);
  expect(parsed.rect).toEqual({ x: 20, y: 10, width: 180, height: 60 });
});

describe.each([
  ["JPEG", () => stamp(jpeg, "fill")],
  ["SVG", () => stamp(svg, "fill")],
  ["extracted SVG", () => stamp(svg, "fill")],
  [
    "preset",
    (): Annotation => ({
      ...stamp(svg),
      stamp: { kind: "preset", presetId: "approved" },
    }),
  ],
] as const)("%s stamp on a rotated page", (_format, makeStamp) => {
  it.each([
    [0, 90, 0],
    [0, 180, 0],
    [0, 270, 0],
    [90, 90, 0],
    [270, 180, 0],
    [180, 270, 0],
    [90, 270, 30],
    [270, 90, -90],
  ])(
    "keeps appearance and editable geometry across save/reopen (page=%s, turn=%s, stamp=%s)",
    async (pageRotation, turn, stampRotation) => {
      const source = await PDFDocument.create();
      const page = source.addPage([400, 600]);
      page.setCropBox(20, 30, 360, 540);
      page.node.set(PDFName.of("UserUnit"), source.context.obj(2));
      page.setRotation(degrees(pageRotation));
      const original: Annotation = {
        ...makeStamp(),
        rect: { x: 100, y: 120, width: 180, height: 60 },
        rotationDeg: stampRotation,
      };
      let bytes = await exportPDF(await source.save(), [], undefined, [
        original,
      ]);
      if (_format === "extracted SVG") {
        const external = await PDFDocument.load(bytes);
        const annotation = external
          .getPage(0)
          .node.Annots()!
          .lookup(0) as PDFDict;
        annotation.delete(PDFName.of("FFStampSourceSvgData"));
        bytes = await external.save();
      }
      const loaded = await read(bytes);
      try {
        const rotatedPage = { ...loaded.pages[0], rotationDelta: turn };
        const saved = await exportPDF(
          bytes,
          [],
          undefined,
          loaded.annotations,
          undefined,
          {
            pageStructure: {
              pages: [rotatedPage],
              sources: {},
            },
          },
        );
        const reference = await PDFDocument.load(bytes);
        reference.getPage(0).setRotation(degrees((pageRotation + turn) % 360));
        expect(await pixels(saved)).toEqual(
          await pixels(await reference.save()),
        );
        const reopened = await read(saved);
        try {
          const restored = reopened.annotations[0];
          const center = pagePointToView({ x: 190, y: 150 }, rotatedPage, 0);
          expect(restored.rotationDeg).toBeCloseTo(
            normalizeRotationDeg(stampRotation + turn),
          );
          expect(restored.rect!.width).toBeCloseTo(180);
          expect(restored.rect!.height).toBeCloseTo(60);
          expect(restored.rect!.x + 90).toBeCloseTo(center.x);
          expect(restored.rect!.y + 30).toBeCloseTo(center.y);
          // An actual edit must regenerate the AP rather than just preserve it.
          const edited = await exportPDF(saved, [], undefined, [
            { ...restored, isEdited: true },
          ]);
          expect(await pixels(edited)).toEqual(await pixels(saved));
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
  ["JPEG", jpeg],
  ["SVG", svg],
])("%s stamp display mode", (format, dataUrl) => {
  it.each([undefined, "contain", "fill"] as const)(
    "exports mode %s and preserves the full editable bounds after reopening",
    async (mode) => {
      const doc = await PDFDocument.create();
      doc.addPage([600, 800]);
      const original = stamp(dataUrl, mode);
      const bytes = await exportPDF(await doc.save(), [], undefined, [
        original,
      ]);
      const saved = await PDFDocument.load(bytes);
      const annotation = saved.getPage(0).node.Annots()!.lookup(0) as PDFDict;
      const ap = annotation
        .lookup(PDFName.of("AP"), PDFDict)
        .lookup(PDFName.of("N")) as PDFStream;
      const contents = await decodePdfStreamToText(ap);
      // JPEG draws a unit square; SVG scales its native 4 x 2 viewport.
      expect(contents).toContain(
        format === "JPEG"
          ? mode === "fill"
            ? "120 0 0 120 0 0 cm"
            : "120 0 0 60 0 0 cm"
          : mode === "fill"
            ? "30 0 0 60 20 770 cm"
            : "30 0 0 30 20 740 cm",
      );
      const service = worker();
      const reopened = await loadPDF(bytes, {
        workerService: service as unknown as PDFWorkerService,
      });
      try {
        expect(reopened.annotations).toHaveLength(1);
        const restored = reopened.annotations[0];
        expect(restored.rect).toEqual(original.rect);
        expect(restored.stamp?.appearance).toMatchObject({
          scaleMode: mode ?? "contain",
          source: "native",
        });
        expect(restored.stamp?.appearance?.box).toBeUndefined();
        expect(restored.stamp?.image).toEqual(original.stamp?.image);
        expect(service.renderPageImage).not.toHaveBeenCalled();
        // The imported stamp remains editable: change mode, export, and reopen again.
        const nextMode = mode === "fill" ? "contain" : "fill";
        const changed = {
          ...restored,
          isEdited: true,
          stamp: {
            ...restored.stamp!,
            appearance: {
              ...restored.stamp?.appearance,
              scaleMode: nextMode as "contain" | "fill",
            },
          },
        };
        const changedBytes = await exportPDF(bytes, [], undefined, [changed]);
        const next = await loadPDF(changedBytes, {
          workerService: worker() as unknown as PDFWorkerService,
        });
        try {
          expect(next.annotations).toHaveLength(1);
          expect(next.annotations[0].rect).toEqual(original.rect);
          expect(next.annotations[0].stamp?.appearance?.scaleMode).toBe(
            nextMode,
          );
        } finally {
          next.dispose();
        }
      } finally {
        reopened.dispose();
      }
    },
  );
});
