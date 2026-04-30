import { describe, expect, it, vi } from "vitest";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  PDFBool,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
} from "@cantoo/pdf-lib";
import { decodePdfStreamToText } from "@/services/pdfService/lib/pdf-import-utils";
import { exportPDF } from "@/services/pdfService";
import { FieldType, type Annotation, type FormField } from "@/types";

const createTextFieldPdf = async (options?: { withXfa?: boolean }) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([200, 200]);
  page.drawText("Name:", { x: 20, y: 125, size: 12 });

  const form = pdfDoc.getForm();
  const textField = form.createTextField("name");
  textField.addToPage(page, {
    x: 60,
    y: 120,
    width: 100,
    height: 20,
  });

  if (options?.withXfa) {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    if (!(acroForm instanceof PDFDict)) {
      throw new Error("Expected AcroForm to exist.");
    }
    acroForm.set(
      PDFName.of("XFA"),
      PDFString.of('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/" />'),
    );
    acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
  }

  return await pdfDoc.save({ updateFieldAppearances: false });
};

const createMergedWidgetTextFieldPdf = async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([200, 200]);
  const context = pdfDoc.context;
  const fieldDict = context.obj({
    FT: PDFName.of("Tx"),
    T: PDFString.of("mergedName"),
    V: PDFString.of("Old value"),
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Widget"),
    Rect: [40, 120, 160, 144],
    P: page.ref,
    F: 4,
    DA: PDFString.of("/Helv 12 Tf 0 g"),
  });
  const fieldRef = context.register(fieldDict);
  page.node.addAnnot(fieldRef);
  pdfDoc.catalog.set(
    PDFName.of("AcroForm"),
    context.obj({
      Fields: [fieldRef],
      NeedAppearances: true,
    }),
  );

  return {
    bytes: await pdfDoc.save({ updateFieldAppearances: false }),
    fieldRef,
  };
};

const filledNameField = {
  id: "name-field",
  pageIndex: 0,
  layerOrder: 0,
  type: FieldType.TEXT,
  name: "name",
  rect: { x: 60, y: 60, width: 100, height: 20 },
  value: "Alice",
} satisfies FormField;

const getAcroForm = async (bytes: Uint8Array) => {
  const pdfDoc = await PDFDocument.load(bytes);
  const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) {
    throw new Error("Expected exported AcroForm to exist.");
  }
  return { pdfDoc, acroForm };
};

const getPageAnnotationCount = (pdfDoc: PDFDocument, pageIndex = 0) => {
  const annots = pdfDoc.getPage(pageIndex).node.Annots();
  return annots instanceof PDFArray ? annots.size() : 0;
};

const getPageContentText = async (pdfDoc: PDFDocument, pageIndex = 0) => {
  const contents = pdfDoc
    .getPage(pageIndex)
    .node.lookup(PDFName.of("Contents"));
  if (contents instanceof PDFStream) {
    return await decodePdfStreamToText(contents);
  }
  if (contents instanceof PDFArray) {
    const chunks: string[] = [];
    for (let index = 0; index < contents.size(); index++) {
      const stream = contents.lookup(index);
      if (stream instanceof PDFStream) {
        chunks.push(await decodePdfStreamToText(stream));
      }
    }
    return chunks.join("\n");
  }
  return "";
};

const getPdfJsPage = async (bytes: Uint8Array, pageNumber = 1) => {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
  } as unknown as Parameters<typeof pdfjsLib.getDocument>[0]);
  const pdfDoc = await task.promise;
  return await pdfDoc.getPage(pageNumber);
};

const toSourcePdfRef = (ref: PDFRef) => ({
  objectNumber: ref.objectNumber,
  generationNumber: ref.generationNumber,
});

const getFirstWidgetRef = (field: {
  ref: PDFRef;
  acroField: { Kids?: () => PDFArray | undefined };
}) => {
  const kids = field.acroField.Kids?.();
  const firstKid = kids?.get(0);
  return firstKid instanceof PDFRef ? firstKid : field.ref;
};

describe("exportPDF form handling", () => {
  it("preserves XFA data when updating AcroForm fields", async () => {
    const sourceBytes = await createTextFieldPdf({ withXfa: true });

    const exportedBytes = await exportPDF(sourceBytes, [filledNameField]);
    const { acroForm } = await getAcroForm(exportedBytes);

    expect(acroForm.get(PDFName.of("XFA"))).toBeDefined();
    expect(acroForm.lookup(PDFName.of("NeedAppearances"))).toBe(PDFBool.True);
  });

  it("can flatten form fields for print output", async () => {
    const sourceBytes = await createTextFieldPdf();

    const exportedBytes = await exportPDF(
      sourceBytes,
      [filledNameField],
      undefined,
      [],
      undefined,
      { flattenFormFields: true },
    );
    const { pdfDoc } = await getAcroForm(exportedBytes);

    expect(pdfDoc.getForm().getFields()).toHaveLength(0);
  });

  it("does not flatten unsupported source buttons into print output", async () => {
    const sourceDoc = await PDFDocument.create();
    const page = sourceDoc.addPage([200, 200]);
    const font = await sourceDoc.embedFont(StandardFonts.Helvetica);
    const button = sourceDoc.getForm().createButton("clearAll");
    button.addToPage("Clear All", page, {
      x: 50,
      y: 80,
      width: 80,
      height: 24,
      font,
    });

    const exportedBytes = await exportPDF(
      await sourceDoc.save(),
      [],
      undefined,
      [],
      undefined,
      { flattenFormFields: true },
    );
    const exportedDoc = await PDFDocument.load(exportedBytes);

    expect(exportedDoc.getForm().getFields()).toHaveLength(0);
    expect(getPageAnnotationCount(exportedDoc)).toBe(0);
    await expect(getPageContentText(exportedDoc)).resolves.not.toContain(
      "FlatWidget",
    );
  });

  it("preserves source field appearances while removing source buttons for print output", async () => {
    const sourceDoc = await PDFDocument.create();
    const page = sourceDoc.addPage([240, 200]);
    const font = await sourceDoc.embedFont(StandardFonts.Helvetica);
    const form = sourceDoc.getForm();
    const textField = form.createTextField("sourceName");
    textField.addToPage(page, {
      x: 40,
      y: 130,
      width: 120,
      height: 24,
      font,
    });
    textField.setText("Source Alice");
    textField.updateAppearances(font);

    const button = form.createButton("clearAll");
    button.addToPage("Clear All", page, {
      x: 40,
      y: 80,
      width: 80,
      height: 24,
      font,
    });

    const exportedBytes = await exportPDF(
      await sourceDoc.save(),
      [],
      undefined,
      [],
      undefined,
      { flattenFormFields: true },
    );
    const exportedDoc = await PDFDocument.load(exportedBytes);

    expect(exportedDoc.getForm().getFields()).toHaveLength(0);
    expect(getPageAnnotationCount(exportedDoc)).toBe(0);

    const pdfJsPage = await getPdfJsPage(exportedBytes);
    const textContent = await pdfJsPage.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(text).toContain("Source Alice");
    expect(text).not.toContain("Clear All");
    await expect(
      pdfJsPage.getOperatorList({
        annotationMode: pdfjsLib.AnnotationMode.DISABLE,
      }),
    ).resolves.toBeTruthy();
  });

  it("prints highlight and comment fallbacks as static page content", async () => {
    const sourceBytes = await createTextFieldPdf();
    const highlight = {
      id: "highlight",
      pageIndex: 0,
      type: "highlight",
      rect: { x: 20, y: 40, width: 60, height: 12 },
      color: "#ffea00",
      opacity: 0.5,
    } satisfies Annotation;
    const comment = {
      id: "comment",
      pageIndex: 0,
      type: "comment",
      rect: { x: 100, y: 40, width: 16, height: 16 },
      color: "#ffc400",
      opacity: 1,
    } satisfies Annotation;

    const exportedBytes = await exportPDF(
      sourceBytes,
      [],
      undefined,
      [highlight, comment],
      undefined,
      { flattenFormFields: true },
    );
    const exportedDoc = await PDFDocument.load(exportedBytes);

    expect(getPageAnnotationCount(exportedDoc)).toBe(0);

    const pdfJsPage = await getPdfJsPage(exportedBytes);
    const operatorList = await pdfJsPage.getOperatorList({
      annotationMode: pdfjsLib.AnnotationMode.DISABLE,
    });
    expect(operatorList.fnArray.length).toBeGreaterThan(0);
  });

  it("updates imported source fields without removing and recreating malformed widgets", async () => {
    const sourceDoc = await PDFDocument.create();
    const page = sourceDoc.addPage([240, 200]);
    const font = await sourceDoc.embedFont(StandardFonts.Helvetica);
    const textField = sourceDoc.getForm().createTextField("sourceName");
    textField.addToPage(page, {
      x: 40,
      y: 130,
      width: 120,
      height: 24,
      font,
    });
    textField.setText("Old value");
    textField.updateAppearances(font);

    const widgetRef = getFirstWidgetRef(textField);
    const exportedBytes = await exportPDF(
      await sourceDoc.save(),
      [
        {
          id: "source-name",
          pageIndex: 0,
          type: FieldType.TEXT,
          name: "sourceName",
          rect: { x: 40, y: 46, width: 120, height: 24 },
          value: "New value",
          sourcePdfRef: toSourcePdfRef(widgetRef),
        },
      ],
      undefined,
      [],
    );
    const exportedDoc = await PDFDocument.load(exportedBytes);

    expect(exportedDoc.getForm().getTextField("sourceName").getText()).toBe(
      "New value",
    );
    expect(getPageAnnotationCount(exportedDoc)).toBe(1);
  });

  it("does not create self-referential kids for merged source widgets", async () => {
    const { bytes, fieldRef } = await createMergedWidgetTextFieldPdf();

    const exportedBytes = await exportPDF(
      bytes,
      [
        {
          id: "merged-name",
          pageIndex: 0,
          type: FieldType.TEXT,
          name: "mergedName",
          rect: { x: 40, y: 56, width: 120, height: 24 },
          value: "New value",
          sourcePdfRef: toSourcePdfRef(fieldRef),
        },
      ],
      undefined,
      [],
    );
    const exportedDoc = await PDFDocument.load(exportedBytes);
    const exportedForm = exportedDoc.getForm();
    const fields = exportedForm.getFields();

    expect(fields.map((field) => field.getName())).toEqual(["mergedName"]);
    expect(exportedForm.getTextField("mergedName").getText()).toBe("New value");

    const exportedFieldDict = exportedDoc.context.lookup(fieldRef, PDFDict);
    const kids = exportedFieldDict.lookup(PDFName.of("Kids"));
    if (kids instanceof PDFArray) {
      for (let index = 0; index < kids.size(); index++) {
        expect(kids.get(index)).not.toBe(fieldRef);
      }
    }
  });

  it("preserves current source fields by name when source refs are unavailable", async () => {
    const sourceDoc = await PDFDocument.create();
    const page = sourceDoc.addPage([240, 200]);
    const font = await sourceDoc.embedFont(StandardFonts.Helvetica);
    const textField = sourceDoc.getForm().createTextField("sourceName");
    textField.addToPage(page, {
      x: 40,
      y: 130,
      width: 120,
      height: 24,
      font,
    });
    textField.setText("Old value");
    textField.updateAppearances(font);

    const exportedBytes = await exportPDF(
      await sourceDoc.save(),
      [
        {
          id: "source-name",
          pageIndex: 0,
          type: FieldType.TEXT,
          name: "sourceName",
          rect: { x: 40, y: 46, width: 120, height: 24 },
          value: "New value",
        },
      ],
      undefined,
      [],
    );
    const exportedDoc = await PDFDocument.load(exportedBytes);

    expect(exportedDoc.getForm().getTextField("sourceName").getText()).toBe(
      "New value",
    );
    expect(exportedDoc.getForm().getFields()).toHaveLength(1);
    expect(getPageAnnotationCount(exportedDoc)).toBe(1);
  });

  it("removes malformed source widgets without reading missing appearances", async () => {
    const sourceDoc = await PDFDocument.create();
    const page = sourceDoc.addPage([240, 200]);
    const form = sourceDoc.getForm();
    const checkbox = form.createCheckBox("toggle_1");
    checkbox.addToPage(page, {
      x: 40,
      y: 120,
      width: 16,
      height: 16,
    });
    checkbox.acroField.getWidgets()[0]?.dict.delete(PDFName.of("AP"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let exportedBytes: Uint8Array;
    try {
      exportedBytes = await exportPDF(
        await sourceDoc.save({ updateFieldAppearances: false }),
        [filledNameField],
      );
    } finally {
      errorSpy.mockRestore();
    }
    expect(errorSpy).not.toHaveBeenCalled();

    const exportedDoc = await PDFDocument.load(exportedBytes!);
    expect(
      exportedDoc
        .getForm()
        .getFields()
        .map((field) => field.getName()),
    ).toEqual(["name"]);
    expect(getPageAnnotationCount(exportedDoc)).toBe(1);

    const pdfJsPage = await getPdfJsPage(exportedBytes!);
    await expect(
      pdfJsPage.getOperatorList({
        annotationMode: pdfjsLib.AnnotationMode.DISABLE,
      }),
    ).resolves.toBeTruthy();

    await expect(
      exportPDF(exportedBytes!, [filledNameField], undefined, []),
    ).resolves.toBeInstanceOf(Uint8Array);
    await expect(
      exportPDF(exportedBytes!, [filledNameField], undefined, [], undefined, {
        flattenFormFields: true,
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
