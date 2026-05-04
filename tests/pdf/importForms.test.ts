import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString } from "@cantoo/pdf-lib";
import { loadPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { FieldType } from "@/types";

const createMockWorkerService = () =>
  ({
    loadDocument: async () => true,
    resolveDest: async () => null,
    getOutline: async () => [],
    renderPageImage: async () => undefined,
  }) as unknown as PDFWorkerService;

const createEmptyAppearance = async (pdfDoc: PDFDocument) => {
  return pdfDoc.context.flateStream("", {
    Type: PDFName.of("XObject"),
    Subtype: PDFName.of("Form"),
    BBox: [0, 0, 12, 12],
    Resources: {},
  });
};

const createRadioPdfWithWidgetFlags = async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([200, 200]);
  const context = pdfDoc.context;

  const parent = context.obj({
    FT: PDFName.of("Btn"),
    T: PDFString.of("choice"),
    Ff: 1 << 15,
    V: PDFName.of("ChoiceA"),
  });
  const parentRef = context.register(parent);

  const makeWidget = async (
    rect: [number, number, number, number],
    onValue: string,
    selected: boolean,
  ) => {
    const offAppearance = await createEmptyAppearance(pdfDoc);
    const onAppearance = await createEmptyAppearance(pdfDoc);
    const widget = context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Widget"),
      Rect: rect,
      P: page.ref,
      Parent: parentRef,
      F: 4,
      Ff: 0,
      AS: PDFName.of(selected ? onValue : "Off"),
      AP: {
        N: {
          Off: offAppearance,
          [onValue]: onAppearance,
        },
      },
    });
    return context.register(widget);
  };

  const widgetARef = await makeWidget([40, 120, 52, 132], "ChoiceA", true);
  const widgetBRef = await makeWidget([40, 96, 52, 108], "ChoiceB", false);

  parent.set(PDFName.of("Kids"), context.obj([widgetARef, widgetBRef]));
  page.node.addAnnot(widgetARef);
  page.node.addAnnot(widgetBRef);
  pdfDoc.catalog.set(
    PDFName.of("AcroForm"),
    context.obj({
      Fields: [parentRef],
      NeedAppearances: true,
    }),
  );

  return await pdfDoc.save({ updateFieldAppearances: false });
};

const createCheckboxPdf = async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([200, 200]);
  const context = pdfDoc.context;
  const offAppearance = await createEmptyAppearance(pdfDoc);
  const onAppearance = await createEmptyAppearance(pdfDoc);
  const widget = context.obj({
    FT: PDFName.of("Btn"),
    T: PDFString.of("agree"),
    V: PDFName.of("Yes"),
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Widget"),
    Rect: [40, 120, 52, 132],
    P: page.ref,
    F: 4,
    AP: {
      N: {
        Off: offAppearance,
        Yes: onAppearance,
      },
    },
  });
  const widgetRef = context.register(widget);
  page.node.addAnnot(widgetRef);
  pdfDoc.catalog.set(
    PDFName.of("AcroForm"),
    context.obj({
      Fields: [widgetRef],
      NeedAppearances: true,
    }),
  );

  return await pdfDoc.save({ updateFieldAppearances: false });
};

const loadFields = async (bytes: Uint8Array) => {
  const result = await loadPDF(bytes, {
    workerService: createMockWorkerService(),
  });

  try {
    return result.fields;
  } finally {
    result.dispose();
  }
};

describe("PDF form import", () => {
  it("imports radio widgets as radio controls when child widget flags mask the parent field flags", async () => {
    const fields = await loadFields(await createRadioPdfWithWidgetFlags());

    const choiceFields = fields.filter((field) => field.name === "choice");
    expect(choiceFields).toHaveLength(2);
    expect(choiceFields.map((field) => field.type)).toEqual([
      FieldType.RADIO,
      FieldType.RADIO,
    ]);
    expect(choiceFields.map((field) => field.radioValue)).toEqual([
      "ChoiceA",
      "ChoiceB",
    ]);
    expect(choiceFields.map((field) => field.isChecked)).toEqual([true, false]);
    expect(fields.some((field) => field.type === FieldType.CHECKBOX)).toBe(
      false,
    );
  });

  it("continues to import plain button widgets without radio flags as checkboxes", async () => {
    const fields = await loadFields(await createCheckboxPdf());

    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      name: "agree",
      type: FieldType.CHECKBOX,
      isChecked: true,
    });
  });
});
