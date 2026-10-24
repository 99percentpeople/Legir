import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "@legir/pdfium/authoring";
import { exportPDF, loadPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { copySelectedControl } from "@/lib/controlClipboard";
import { prepareInkAnnotationForStore } from "@/lib/inkGeometry";
import { FieldType, type Annotation } from "@/types";
import { createTestEditorStore, field } from "../helpers/editorStore";

const worker = {
  loadDocument: async () => true,
  getOutline: async () => [],
  getPermissions: async () => null,
  resolveDest: async () => null,
} as unknown as PDFWorkerService;
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAGUlEQVR4nD3BMQEAAAjAILR/5/kJJIi28Q5Y5gT/nBWRrgAAAABJRU5ErkJggg==";

describe("pasted controls PDF round trip", () => {
  it("saves imported controls into another PDF without overwriting existing objects", async () => {
    const sourceDoc = await PDFDocument.create();
    sourceDoc.addPage([600, 800]);
    const types = [
      FieldType.TEXT,
      FieldType.CHECKBOX,
      FieldType.RADIO,
      FieldType.DROPDOWN,
    ];
    const fields = types.map((type, index) =>
      field(type, {
        name: type,
        type,
        rect: { x: 20, y: 30 + index * 40, width: 100, height: 25 },
        value: "Choice A",
        options: ["Choice A", "Choice B"],
        exportValue: "Yes",
        radioValue: "Yes",
        isChecked: true,
      }),
    );
    const annotations: Annotation[] = [
      {
        id: "comment",
        type: "comment",
        pageIndex: 0,
        rect: { x: 200, y: 40, width: 24, height: 24 },
        text: "Copied comment",
        replies: [
          { id: "reply", parentAnnotationId: "comment", text: "First reply" },
          {
            id: "nested",
            parentAnnotationId: "comment",
            inReplyToReplyId: "reply",
            text: "Nested reply",
          },
        ],
      },
      {
        id: "highlight",
        type: "highlight",
        pageIndex: 0,
        rect: { x: 200, y: 100, width: 80, height: 30 },
        rects: [
          { x: 200, y: 100, width: 80, height: 10 },
          { x: 200, y: 120, width: 60, height: 10 },
        ],
        color: "#ffff00",
      },
      {
        id: "ink",
        type: "ink",
        pageIndex: 0,
        rect: { x: 200, y: 160, width: 80, height: 40 },
        strokes: [
          [
            { x: 200, y: 160 },
            { x: 220, y: 200 },
            { x: 280, y: 180 },
          ],
        ],
        color: "#ff0000",
        thickness: 2,
      },
      {
        id: "freetext",
        type: "freetext",
        pageIndex: 0,
        rect: { x: 200, y: 230, width: 120, height: 40 },
        text: "Copied text",
        size: 14,
        fontFamily: "Helvetica",
      },
      {
        id: "shape",
        type: "shape",
        pageIndex: 0,
        rect: { x: 200, y: 300, width: 80, height: 40 },
        shapeType: "square",
        color: "#0000ff",
        thickness: 2,
      },
      {
        id: "stamp",
        type: "stamp",
        pageIndex: 0,
        rect: { x: 200, y: 370, width: 80, height: 40 },
        stamp: {
          kind: "image",
          image: { dataUrl: png, intrinsicSize: { width: 4, height: 2 } },
          appearance: { scaleMode: "fill" },
        },
      },
      {
        id: "link",
        type: "link",
        pageIndex: 0,
        rect: { x: 200, y: 440, width: 80, height: 20 },
        linkUrl: "https://example.com",
      },
    ];
    const sourceBytes = await exportPDF(
      await sourceDoc.save(),
      fields,
      undefined,
      annotations,
    );
    const source = await loadPDF(sourceBytes, { workerService: worker });
    const sourceStore = createTestEditorStore({
      ...source,
      pdfBytes: sourceBytes,
    });
    const targetDoc = await PDFDocument.create();
    targetDoc.addPage([600, 800]);
    targetDoc.addPage([400, 500]).setRotation(degrees(90));
    const targetBytes = await exportPDF(
      await targetDoc.save(),
      [field("existing", { name: "Text", value: "Keep existing" })],
      undefined,
      [
        {
          id: "existing-comment",
          type: "comment",
          pageIndex: 0,
          rect: { x: 150, y: 50, width: 24, height: 24 },
          text: "Keep existing comment",
        },
      ],
    );
    const target = await loadPDF(targetBytes, { workerService: worker });
    const targetStore = createTestEditorStore({
      ...target,
      pdfBytes: targetBytes,
      currentPageIndex: 1,
    });
    try {
      expect(source.fields).toHaveLength(4);
      expect(source.annotations).toHaveLength(7);
      for (const control of [...source.fields, ...source.annotations]) {
        expect(control.sourcePdfRef).toBeDefined();
        sourceStore.setState({ selectedId: control.id });
        const payload = copySelectedControl(sourceStore.getState());
        expect(payload).not.toBeNull();
        expect(targetStore.getState().pasteControl(payload!)).toBe(true);
      }
      const state = targetStore.getState();
      const bytes = await exportPDF(
        targetBytes,
        state.fields,
        state.metadata,
        state.annotations,
      );
      const reopened = await loadPDF(bytes, { workerService: worker });
      try {
        expect(reopened.fields).toHaveLength(5);
        expect(
          reopened.fields.find((item) => item.name === "Text")?.value,
        ).toBe("Keep existing");
        expect(
          reopened.fields.find((item) => item.name === "Text_1"),
        ).toMatchObject({ value: "Choice A", pageIndex: 1 });
        expect(
          reopened.fields.filter((item) => item.pageIndex === 1),
        ).toHaveLength(4);
        expect(reopened.annotations).toHaveLength(8);
        expect(
          reopened.annotations.find((item) => item.pageIndex === 0)?.text,
        ).toBe("Keep existing comment");
        const pasted = reopened.annotations.filter(
          (item) => item.pageIndex === 1,
        );
        expect(pasted.map((item) => item.type).sort()).toEqual(
          annotations.map((item) => item.type).sort(),
        );
        const comment = pasted.find((item) => item.type === "comment")!;
        expect(comment.replies?.map((reply) => reply.text)).toEqual([
          "First reply",
          "Nested reply",
        ]);
        expect(comment.replies![1].inReplyToReplyId).toBe(
          comment.replies![0].id,
        );
        expect(
          pasted.find((item) => item.type === "stamp")?.stamp?.image?.dataUrl,
        ).toMatch(/^data:image\//);
        expect(pasted.find((item) => item.type === "link")?.linkUrl).toBe(
          "https://example.com",
        );
        for (const item of pasted) {
          const result = prepareInkAnnotationForStore(item);
          const original = state.annotations.find(
            (item) => item.pageIndex === 1 && item.type === result.type,
          )!;
          expect(result.rect!.x).toBeCloseTo(original.rect!.x, 1);
          expect(result.rect!.y).toBeCloseTo(original.rect!.y, 1);
        }
      } finally {
        reopened.dispose();
      }
    } finally {
      sourceStore.dispose();
      targetStore.dispose();
      source.dispose();
      target.dispose();
    }
  });
});
