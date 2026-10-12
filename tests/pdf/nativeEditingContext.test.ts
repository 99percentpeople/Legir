import { describe, expect, it, vi } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
} from "@cantoo/pdf-lib";
import { getMuPdf } from "@/services/pdfService/engine/runtime";
import { NativeEditingContext } from "@/services/pdfService/engine/nativeEditingContext";

describe("native editing views", () => {
  it("edits the existing native document without reading or copying untouched stream bodies", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([400, 500]);
    page.drawText("KEEP", {
      font: await source.embedFont(StandardFonts.Helvetica),
    });
    const field = source.getForm().createTextField("name");
    field.setText("Alice");
    field.addToPage(page, { x: 30, y: 100, width: 150, height: 30 });
    const mupdf = await getMuPdf();
    const native = new mupdf.PDFDocument(await source.save());
    native.enableJournal();
    native.beginOperation("edit");
    const reads = vi.spyOn(mupdf.PDFObject.prototype, "readRawStream");
    const view = new NativeEditingContext(mupdf, native);
    try {
      expect(view.document.getPages()).toHaveLength(1);
      expect(view.document.getForm().getTextField("name").getText()).toBe(
        "Alice",
      );
      expect(reads).not.toHaveBeenCalled();
      view.document.getForm().getTextField("name").setText("Bob");
      view.document
        .getForm()
        .updateFieldAppearances(
          await view.document.embedFont(StandardFonts.Helvetica),
        );
      view.document.getPage(0).drawText("NEW", { x: 30, y: 400 });
      const dict = view.context.obj({});
      view.document.catalog.set(PDFName.of("Custom"), dict);
      const array = view.context.obj([1]);
      dict.set(PDFName.of("List"), array);
      array.push(PDFString.of("late edit"));
      dict.set(PDFName.of("Text"), PDFString.of("live"));
      await view.flush();
      view.document.getPage(0).drawText("AFTER FLUSH", { x: 30, y: 350 });
      await view.flush();
      const nativePage = native.loadPage(0);
      const text = nativePage.toStructuredText("");
      try {
        expect(nativePage.getWidgets()[0].getValue()).toBe("Bob");
        expect(text.asText()).toContain("NEW");
        expect(text.asText()).toContain("KEEP");
        expect(text.asText()).toContain("AFTER FLUSH");
        const trailer = native.getTrailer();
        const custom = trailer.get("Root", "Custom");
        try {
          expect(custom.get("Text").asString()).toBe("live");
          expect(custom.get("List", 1).asString()).toBe("late edit");
        } finally {
          custom.destroy();
          trailer.destroy();
        }
      } finally {
        text.destroy();
        for (const widget of nativePage._widgets ?? []) widget.destroy();
        nativePage.destroy();
      }
    } finally {
      reads.mockRestore();
      view.dispose();
      native.abandonOperation();
    }
    const restored = new NativeEditingContext(mupdf, native);
    try {
      expect(restored.document.getForm().getTextField("name").getText()).toBe(
        "Alice",
      );
      expect(restored.document.catalog.has(PDFName.of("Custom"))).toBe(false);
    } finally {
      restored.dispose();
      native.destroy();
    }
  });
});
