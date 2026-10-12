import { getThumbnailSourceAnnotations } from "@/services/pdfService/lib/thumbnailSourceAnnotations";
import { expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { FieldType, type Annotation } from "@/types";
import { createThumbnailOverlay } from "@/services/pdfService/lib/thumbnailOverlay";
import type { ThumbnailContent } from "@/services/pdfService/types";
import { field } from "../helpers/editorStore";

const shape = (
  id: string,
  objectNumber: number,
  isEdited = false,
): Annotation => ({
  id,
  pageIndex: 7,
  type: "shape",
  shapeType: "square",
  rect: { x: 20, y: 20, width: 50, height: 50 },
  sourcePdfRef: { objectNumber, generationNumber: 0 },
  isEdited,
});
const content = (): ThumbnailContent => ({
  width: 600,
  height: 800,
  fields: [],
  annotations: [],
  preserved: [],
});

it("preserves untouched/unsupported native appearances while replacing edited annotations and widgets", () => {
  const snapshot = content();
  snapshot.annotations = [shape("untouched", 1), shape("edited", 2, true)];
  snapshot.preserved = [
    { pageIndex: 7, sourcePdfRef: { objectNumber: 5, generationNumber: 3 } },
  ];
  expect([...getThumbnailSourceAnnotations(snapshot)].sort()).toEqual([1, 5]);
});

it("builds a single-page overlay from current text, checkbox and choice values without loading a source document", async () => {
  const snapshot = content();
  snapshot.fields = [
    field("text", {
      pageIndex: 7,
      value: "CURRENT",
      sourcePdfRef: { objectNumber: 21, generationNumber: 0 },
    }),
    field("check", {
      pageIndex: 7,
      type: FieldType.CHECKBOX,
      isChecked: true,
      rect: { x: 10, y: 60, width: 20, height: 20 },
    }),
    field("choice", {
      pageIndex: 7,
      type: FieldType.DROPDOWN,
      value: "B",
      options: ["A", "B"],
      rect: { x: 10, y: 100, width: 100, height: 20 },
    }),
  ];
  const bytes = await createThumbnailOverlay(snapshot);
  expect(bytes).not.toBeNull();
  const document = await PDFDocument.load(bytes!);
  expect(document.getPageCount()).toBe(1);
  expect(document.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
  expect(document.getForm().getTextField("text").getText()).toBe("CURRENT");
  expect(document.getForm().getCheckBox("check").isChecked()).toBe(true);
  expect(document.getForm().getDropdown("choice").getSelected()).toEqual(["B"]);
  expect(snapshot.fields[0].pageIndex).toBe(7);
  expect(snapshot.fields[0].sourcePdfRef?.objectNumber).toBe(21);
});

it("does not generate overlays for untouched native appearances or empty pages", async () => {
  const snapshot = content();
  expect(await createThumbnailOverlay(snapshot)).toBeNull();
  snapshot.annotations = [shape("original", 1)];
  expect(await createThumbnailOverlay(snapshot)).toBeNull();
  snapshot.annotations[0] = { ...snapshot.annotations[0], isEdited: true };
  expect(await createThumbnailOverlay(snapshot)).toBeInstanceOf(Uint8Array);
});
