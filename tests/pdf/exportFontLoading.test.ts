import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFHexString,
  StandardFonts,
  type PDFFont,
} from "@cantoo/pdf-lib";
import fontkit from "pdf-fontkit";
import { FieldType, type FormField, type Annotation } from "@/types";
import {
  canFontEncodeText,
  pickControlValueFont,
} from "@/services/pdfService/lib/font-selection";
import { prepareExportFonts } from "@/services/pdfService/lib/export-fonts";

let fontBytes: Uint8Array;
beforeAll(async () => {
  fontBytes = new Uint8Array(
    await readFile("public/fonts/NotoSansSC-Regular.ttf"),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const field = (patch: Partial<FormField> = {}): FormField => ({
  id: "text",
  name: "text",
  type: FieldType.TEXT,
  pageIndex: 0,
  rect: { x: 10, y: 10, width: 200, height: 25 },
  value: "Alice",
  style: { fontFamily: "Helvetica" },
  ...patch,
});
const createFontMap = async () => {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([300, 300]);
  const fontMap = new Map<string, PDFFont>([
    ["Helvetica", await pdfDoc.embedFont(StandardFonts.Helvetica)],
  ]);
  return { pdfDoc, fontMap };
};

describe("font coverage without encoding probes", () => {
  it("checks coverage once per font without mutating its subset", async () => {
    const { fontMap } = await createFontMap();
    const font = fontMap.get("Helvetica")!;
    const coverage = vi.spyOn(font, "getCharacterSet");
    const encode = vi.spyOn(font, "encodeText");
    for (let i = 0; i < 100; i++)
      expect(canFontEncodeText(font, "Café €\nRésumé")).toBe(true);
    expect(canFontEncodeText(font, "中文")).toBe(false);
    expect(coverage).toHaveBeenCalledTimes(1);
    expect(encode).not.toHaveBeenCalled();
  });

  it("checks full Unicode code points rather than UTF-16 halves", () => {
    const font = { getCharacterSet: () => [0x1f600, 65] } as unknown as PDFFont;
    expect(canFontEncodeText(font, "A😀")).toBe(true);
    expect(canFontEncodeText(font, "A😁")).toBe(false);
  });

  it("includes all visible option-list labels in the font decision", async () => {
    const { pdfDoc, fontMap } = await createFontMap();
    pdfDoc.registerFontkit(fontkit);
    const cjk = await pdfDoc.embedFont(fontBytes, { subset: true });
    fontMap.set("CustomSans", cjk);
    const control = field({
      type: FieldType.DROPDOWN,
      isMultiSelect: true,
      value: "A",
      options: ["A", "中文"],
    });
    expect(
      pickControlValueFont(control, pdfDoc.getForm(), fontMap) === cjk,
    ).toBe(true);
    expect(
      pickControlValueFont(
        field({ value: "Café €" }),
        pdfDoc.getForm(),
        fontMap,
      ) === fontMap.get("Helvetica"),
    ).toBe(true);
  });
});

describe("load fonts only for actual appearances", () => {
  it("does not load CJK fonts for Western text, authors, tooltips or comments", async () => {
    const args = await createFontMap();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const register = vi.spyOn(args.pdfDoc, "registerFontkit");
    await prepareExportFonts({
      ...args,
      fields: [
        field({ value: "Café €", toolTip: "中文提示" }),
        field({
          type: FieldType.CHECKBOX,
          style: { fontFamily: "Noto Sans SC" },
          value: "中文",
        }),
      ],
      annotations: [
        {
          id: "comment",
          type: "comment",
          pageIndex: 0,
          text: "中文批注",
          author: "作者",
        },
        {
          id: "free",
          type: "freetext",
          pageIndex: 0,
          text: "ASCII",
          author: "作者",
          fontFamily: "Helvetica",
        },
      ],
    });
    expect(register).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not load a bundled fallback when the selected custom font covers the text", async () => {
    const args = await createFontMap();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const embed = vi.spyOn(args.pdfDoc, "embedFont");
    await prepareExportFonts({
      ...args,
      fields: [field({ value: "中文", style: { fontFamily: "CustomSans" } })],
      annotations: [],
      customFont: { bytes: fontBytes },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(embed).toHaveBeenCalledTimes(1);
    expect(canFontEncodeText(args.fontMap.get("CustomSans")!, "中文")).toBe(
      true,
    );
  });

  it("retries failed downloads and shares successful bytes without sharing PDF fonts", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementation(async () => new Response(fontBytes.slice().buffer));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = await createFontMap();
    await prepareExportFonts({
      ...failed,
      fields: [field({ value: "中文" })],
      annotations: [],
    });
    expect(failed.fontMap.has("Noto Sans SC")).toBe(false);

    const first = await createFontMap();
    const second = await createFontMap();
    // The visible Chinese option is not selected, but still needs glyphs.
    const control = field({
      type: FieldType.DROPDOWN,
      isMultiSelect: true,
      value: "A",
      options: ["A", "中文"],
    });
    await Promise.all(
      [first, second].map((args) =>
        prepareExportFonts({ ...args, fields: [control], annotations: [] }),
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstFont = first.fontMap.get("Noto Sans SC");
    const secondFont = second.fontMap.get("Noto Sans SC");
    expect(!!firstFont && !!secondFont && firstFont !== secondFont).toBe(true);
    expect(firstFont?.doc === first.pdfDoc).toBe(true);
    expect(secondFont?.doc === second.pdfDoc).toBe(true);
    expect(canFontEncodeText(firstFont!, "中文")).toBe(true);

    const later = await createFontMap();
    await prepareExportFonts({ ...later, fields: [control], annotations: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(later.fontMap.has("Noto Sans SC")).toBe(true);
  });

  it("does not resolve fonts from excluded pages or preserved source annotations", async () => {
    const { exportPDF } = await import("@/services/pdfService");
    const source = await PDFDocument.create();
    source.addPage([300, 300]);
    source.addPage([300, 300]);
    const ref = source.context.register(
      source.context.obj({
        Type: "Annot",
        Subtype: "FreeText",
        Rect: [20, 20, 100, 40],
        Contents: PDFHexString.fromText("中文"),
      }),
    );
    source.getPage(0).node.addAnnot(ref);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const register = vi.spyOn(PDFDocument.prototype, "registerFontkit");
    const annotations: Annotation[] = [
      {
        id: "preserved",
        type: "freetext",
        pageIndex: 0,
        text: "中文",
        fontFamily: "Noto Sans SC",
        sourcePdfRef: {
          objectNumber: ref.objectNumber,
          generationNumber: ref.generationNumber,
        },
        isEdited: false,
      },
    ];
    const output = await exportPDF(
      await source.save(),
      [
        field({
          pageIndex: 1,
          value: "中文",
          style: { fontFamily: "Noto Sans SC" },
        }),
      ],
      undefined,
      annotations,
      undefined,
      { pageIndexes: [0] },
    );
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
