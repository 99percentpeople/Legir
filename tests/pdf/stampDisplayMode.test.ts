import { describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFStream } from "@cantoo/pdf-lib";
import { exportPDF, loadPDF } from "@/services/pdfService";
import { decodePdfStreamToText } from "@/services/pdfService/lib/pdf-import-utils";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { Annotation, StampImageAppearance } from "@/types";

// A 4 x 2 JPEG needs no browser canvas to round-trip its native image resource.
const jpeg =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAACAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCWgA4pK//Z";
const svg =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2" viewBox="0 0 4 2"><rect width="4" height="2" fill="red"/></svg>',
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
