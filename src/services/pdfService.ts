import * as pdfjsLib from "pdfjs-dist";
import { pdfWorkerService } from "./pdfWorkerService";
import { mapOutline } from "./pdf/lib/outline";
import { getFontMap, getGlobalDA } from "./pdf/lib/appearance";
import { loadAndEmbedExportFonts } from "./pdf/lib/built-in-fonts";
import { parsePDFDate } from "../utils/pdfUtils";
import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFString,
  PDFDict,
  PDFBool,
  PDFArray,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  FormField,
  PageData,
  PDFMetadata,
  PDFOutlineItem,
  Annotation,
} from "../types";
import {
  IAnnotationParser,
  IControlParser,
  IAnnotationExporter,
  IControlExporter,
  ParserContext,
} from "./pdf/types";
import {
  InkParser,
  HighlightParser,
  CommentParser,
  FreeTextParser,
} from "./pdf/parsers/AnnotationParsers";
import {
  TextControlParser,
  CheckboxControlParser,
  RadioControlParser,
  DropdownControlParser,
  SignatureControlParser,
} from "./pdf/parsers/ControlParsers";
import {
  InkExporter,
  HighlightExporter,
  CommentExporter,
  FreeTextExporter,
} from "./pdf/exporters/AnnotationExporters";
import {
  TextControlExporter,
  CheckboxControlExporter,
  RadioControlExporter,
  DropdownControlExporter,
  SignatureControlExporter,
} from "./pdf/exporters/ControlExporters";

// Register parsers and exporters
const annotationParsers: IAnnotationParser[] = [
  new InkParser(),
  new HighlightParser(),
  new CommentParser(),
  new FreeTextParser(),
];

const controlParsers: IControlParser[] = [
  new TextControlParser(),
  new CheckboxControlParser(),
  new RadioControlParser(),
  new DropdownControlParser(),
  new SignatureControlParser(),
];

const annotationExporters: IAnnotationExporter[] = [
  new InkExporter(),
  new HighlightExporter(),
  new CommentExporter(),
  new FreeTextExporter(),
];

const controlExporters: IControlExporter[] = [
  new TextControlExporter(),
  new CheckboxControlExporter(),
  new RadioControlExporter(),
  new DropdownControlExporter(),
  new SignatureControlExporter(),
];

export const loadPDF = async (
  input: File | Uint8Array,
): Promise<{
  pdfBytes: Uint8Array;
  pdfDocument: any;
  pages: PageData[];
  fields: FormField[];
  annotations: Annotation[];
  metadata: PDFMetadata;
  outline: PDFOutlineItem[];
  dispose: () => void;
}> => {
  let pdfBytes: Uint8Array;
  if (input instanceof File) {
    const arrayBuffer = await input.arrayBuffer();
    pdfBytes = new Uint8Array(arrayBuffer.slice(0));
  } else {
    pdfBytes = input;
  }

  let fontMap = new Map<string, string>();
  let globalDA: string | undefined = undefined;
  let pdfDoc: PDFDocument | null = null;

  const renderBuffer = new Uint8Array(pdfBytes.slice(0));
  pdfWorkerService.loadDocument(renderBuffer);

  const pdfLibPromise = PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pdfJsPromise = pdfjsLib.getDocument({
    data: renderBuffer,
    password: "",
  }).promise;

  const [pdfLibResult, pdfJsResult] = await Promise.allSettled([
    pdfLibPromise,
    pdfJsPromise,
  ]);

  if (pdfLibResult.status === "fulfilled") {
    pdfDoc = pdfLibResult.value;
    try {
      fontMap = getFontMap(pdfDoc);
      globalDA = getGlobalDA(pdfDoc);
    } catch (e) {
      console.warn("Failed to parse PDF resources with pdf-lib", e);
    }
  } else {
    console.warn(
      "Failed to parse PDF resources with pdf-lib",
      pdfLibResult.reason,
    );
  }

  if (pdfJsResult.status !== "fulfilled") {
    throw pdfJsResult.reason;
  }
  const pdf = pdfJsResult.value;

  const numPages = pdf.numPages;
  const pages: PageData[] = [];
  const fields: FormField[] = [];
  const annotations: Annotation[] = [];

  const embeddedFontCache = new Map<string, Promise<string | undefined>>();
  const embeddedFontFaces = new Set<FontFace>();

  const dispose = () => {
    embeddedFontCache.clear();

    if (typeof document !== "undefined" && (document as any).fonts) {
      embeddedFontFaces.forEach((face) => {
        try {
          document.fonts.delete(face);
        } catch {
          // Ignore removal errors
        }
      });
    }
    embeddedFontFaces.clear();
  };

  const metadataPromise = (async (): Promise<PDFMetadata> => {
    try {
      const { info } = await pdf.getMetadata();
      if (!info) return {};

      const toLocalISO = (d: Date) => {
        const pad = (n: number) => n.toString().padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };

      const cDateStr = parsePDFDate(info["CreationDate"]);
      const mDateStr = parsePDFDate(info["ModDate"]);

      const cDate = cDateStr ? new Date(cDateStr) : undefined;
      const mDate = mDateStr ? new Date(mDateStr) : undefined;

      let keywords = info["Keywords"];
      if (typeof keywords === "string") {
        keywords = [keywords];
      } else if (!Array.isArray(keywords)) {
        keywords = undefined;
      }

      if (keywords) {
        keywords = keywords.filter(
          (k: any) => typeof k === "string" && k.trim().length > 0,
        );
        if (keywords.length === 0) keywords = undefined;
      }

      return {
        title: info["Title"],
        author: info["Author"],
        subject: info["Subject"],
        keywords: keywords,
        creator: info["Creator"],
        producer: info["Producer"],
        creationDate: cDate ? toLocalISO(cDate) : undefined,
        modificationDate: mDate ? toLocalISO(mDate) : undefined,
        isModDateManual: false,
        isProducerManual: false,
      };
    } catch (e) {
      console.warn("Failed to extract metadata", e);
      return {};
    }
  })();

  const outlinePromise = (async (): Promise<PDFOutlineItem[]> => {
    try {
      const rawOutline = await pdf.getOutline();
      if (!rawOutline) return [];
      return await mapOutline(pdf, rawOutline);
    } catch (e) {
      console.warn("Failed to extract outline", e);
      return [];
    }
  })();

  const pageResults: {
    page: PageData;
    fields: FormField[];
    annotations: Annotation[];
  }[] = new Array(numPages);

  const maxConcurrency = Math.min(4, numPages);
  let nextPageIndex = 0;

  const worker = async () => {
    while (true) {
      const idx = nextPageIndex;
      nextPageIndex += 1;
      if (idx >= numPages) return;

      const pageNumber = idx + 1;
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.0 });
      const pageAnnotations = await page.getAnnotations();

      const context: ParserContext = {
        pageAnnotations,
        pageIndex: idx,
        viewport,
        pdfDoc: pdfDoc || undefined,
        fontMap,
        globalDA,
        embeddedFontCache,
        embeddedFontFaces,
      };

      const annotsForPage: Annotation[] = [];
      for (const parser of annotationParsers) {
        try {
          const parsedAnnots = await parser.parse(context);
          annotsForPage.push(...parsedAnnots);
        } catch (e) {
          console.warn(`Annotation parser failed for page ${pageNumber}`, e);
        }
      }

      const fieldsForPage: FormField[] = [];
      for (const parser of controlParsers) {
        try {
          const parsedFields = await parser.parse(context);
          fieldsForPage.push(...parsedFields);
        } catch (e) {
          console.warn(`Control parser failed for page ${pageNumber}`, e);
        }
      }

      pageResults[idx] = {
        page: {
          pageIndex: idx,
          width: viewport.width,
          height: viewport.height,
        },
        fields: fieldsForPage,
        annotations: annotsForPage,
      };
    }
  };

  await Promise.all(new Array(maxConcurrency).fill(null).map(() => worker()));

  for (let i = 0; i < pageResults.length; i++) {
    const r = pageResults[i];
    if (!r) continue;
    pages.push(r.page);
    fields.push(...r.fields);
    annotations.push(...r.annotations);
  }

  const [metadata, outline] = await Promise.all([
    metadataPromise,
    outlinePromise,
  ]);

  return {
    pdfBytes,
    pdfDocument: pdf,
    pages,
    fields,
    annotations,
    metadata,
    outline,
    dispose,
  };
};

export const renderPage = async (
  page: any,
  scale: number = 1.0,
): Promise<string | null> => {
  try {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      await page.render({
        canvasContext: context,
        viewport: viewport,
        annotationMode: pdfjsLib.AnnotationMode.DISABLE,
      }).promise;
      return canvas.toDataURL("image/jpeg", 0.8);
    }
    return null;
  } catch (e) {
    console.error("Failed to render page to DataURL", e);
    return null;
  }
};

export const exportPDF = async (
  originalBytes: Uint8Array,
  fields: FormField[],
  metadata?: PDFMetadata,
  annotations: Annotation[] = [],
  customFont?: { bytes: Uint8Array; name?: string },
): Promise<Uint8Array> => {
  if (originalBytes.byteLength === 0) throw new Error("PDF buffer is empty.");

  let pdfJsDoc: any | undefined;
  try {
    const renderBuffer = new Uint8Array(originalBytes.slice(0));
    pdfJsDoc = await pdfjsLib.getDocument({ data: renderBuffer, password: "" })
      .promise;
  } catch (e) {
    console.warn(
      "[PDF Export] Failed to load PDF with pdf.js; rotation-aware export disabled",
      e,
    );
  }

  const viewportCache = new Map<number, any>();
  const getViewportForPage = async (pageIndex: number) => {
    if (!pdfJsDoc) return undefined;
    if (viewportCache.has(pageIndex)) return viewportCache.get(pageIndex);
    try {
      const p = await pdfJsDoc.getPage(pageIndex + 1);
      const vp = p.getViewport({ scale: 1.0 });
      viewportCache.set(pageIndex, vp);
      return vp;
    } catch {
      return undefined;
    }
  };

  const pdfDoc = await PDFDocument.load(originalBytes, {
    ignoreEncryption: true,
  });

  // Metadata update
  if (metadata) {
    if (metadata.title) pdfDoc.setTitle(metadata.title);
    if (metadata.author) pdfDoc.setAuthor(metadata.author);
    if (metadata.subject) pdfDoc.setSubject(metadata.subject);
    if (metadata.creator) pdfDoc.setCreator(metadata.creator);
    if (metadata.keywords && metadata.keywords.length > 0) {
      pdfDoc.setKeywords(
        Array.isArray(metadata.keywords)
          ? metadata.keywords
          : [metadata.keywords],
      );
    }

    // Producer Logic
    if (metadata.isProducerManual && metadata.producer) {
      pdfDoc.setProducer(metadata.producer);
    } else {
      pdfDoc.setProducer("Formforge");
    }

    // Date Logic with explicit PDFString.fromDate formatting
    const infoDict = pdfDoc.catalog.lookup(PDFName.of("Info"));
    if (infoDict instanceof PDFDict) {
      if (metadata.creationDate) {
        infoDict.set(
          PDFName.of("CreationDate"),
          PDFString.fromDate(new Date(metadata.creationDate)),
        );
      }

      // Modification Date Logic
      let modDate: Date;
      if (metadata.isModDateManual && metadata.modificationDate) {
        modDate = new Date(metadata.modificationDate);
      } else {
        modDate = new Date();
      }

      infoDict.set(PDFName.of("ModDate"), PDFString.fromDate(modDate));
    }
  }

  // Embed Standard Fonts
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const courier = await pdfDoc.embedFont(StandardFonts.Courier);

  const fontMap = new Map<string, any>();
  fontMap.set("Helvetica", helvetica);
  fontMap.set("Times Roman", timesRoman);
  fontMap.set("Courier", courier);

  await loadAndEmbedExportFonts({
    pdfDoc,
    fontMap,
    fontkit,
    customFont,
  });

  const form = pdfDoc.getForm();

  const keepAnnotRefKeysByPage = new Map<number, Set<string>>();
  for (const a of annotations) {
    if (!a?.sourcePdfRef) continue;
    if (a.isEdited) continue;
    const key = `${a.sourcePdfRef.objectNumber}:${a.sourcePdfRef.generationNumber}`;
    const setForPage =
      keepAnnotRefKeysByPage.get(a.pageIndex) || new Set<string>();
    setForPage.add(key);
    keepAnnotRefKeysByPage.set(a.pageIndex, setForPage);
  }

  // Force NeedAppearances
  try {
    let acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    if (!acroForm) {
      acroForm = pdfDoc.context.obj({});
      pdfDoc.catalog.set(PDFName.of("AcroForm"), acroForm);
    }

    if (acroForm instanceof PDFDict) {
      acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
    }
  } catch (e) {
    console.warn("Failed to set NeedAppearances", e);
  }

  // 1. Cleanup Existing Fields
  const existingFields = form.getFields();
  for (const field of existingFields) {
    let shouldRemove = false;
    try {
      const typeName = field.constructor.name;
      const isText =
        field instanceof PDFTextField || typeName === "PDFTextField";
      const isCheck =
        field instanceof PDFCheckBox || typeName === "PDFCheckBox";
      const isDropdown =
        field instanceof PDFDropdown || typeName === "PDFDropdown";
      const isOptionList =
        field instanceof PDFOptionList || typeName === "PDFOptionList";
      const isRadio =
        field instanceof PDFRadioGroup || typeName === "PDFRadioGroup";
      const isSig =
        (typeof PDFSignature !== "undefined" &&
          field instanceof PDFSignature) ||
        typeName === "PDFSignature";

      shouldRemove =
        isText || isCheck || isDropdown || isOptionList || isRadio || isSig;

      if (shouldRemove) {
        form.removeField(field);
      }
    } catch (e) {
      console.warn(
        `Attempting manual removal for corrupt field: ${field.getName()}`,
      );

      if (shouldRemove) {
        try {
          const fieldRef = (field as any).ref;
          const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
          if (acroForm instanceof PDFDict) {
            const acroFields = acroForm.lookup(PDFName.of("Fields"));
            if (acroFields instanceof PDFArray) {
              const idx = acroFields.indexOf(fieldRef);
              if (idx !== -1) {
                acroFields.remove(idx);
              }
            }
          }

          const acroField = (field as any).acroField;
          if (acroField && typeof acroField.getWidgets === "function") {
            const widgets = acroField.getWidgets();
            if (Array.isArray(widgets)) {
              const pages = pdfDoc.getPages();
              for (const page of pages) {
                const annots = page.node.Annots();
                if (annots instanceof PDFArray) {
                  for (const widget of widgets) {
                    const wIdx = annots.indexOf(widget);
                    if (wIdx !== -1) {
                      annots.remove(wIdx);
                    }
                  }
                }
              }
            }
          }
        } catch (cleanupErr) {
          console.error("Manual cleanup failed:", cleanupErr);
        }
      }
    }
  }

  // 1.5 Cleanup Existing Annotations (Ink, Highlight, Comment)
  const pages = pdfDoc.getPages();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    try {
      const annots = page.node.Annots();
      if (annots instanceof PDFArray) {
        const toRemove: number[] = [];

        const keepKeys = keepAnnotRefKeysByPage.get(pageIndex);

        for (let i = 0; i < annots.size(); i++) {
          if (keepKeys && (annots as any).get) {
            const raw = (annots as any).get(i);
            if (
              raw &&
              typeof (raw as any).objectNumber === "number" &&
              typeof (raw as any).generationNumber === "number"
            ) {
              const k = `${(raw as any).objectNumber}:${(raw as any).generationNumber}`;
              if (keepKeys.has(k)) continue;
            }
          }

          const annot = annots.lookup(i);
          if (annot instanceof PDFDict) {
            const subtype = annot.lookup(PDFName.of("Subtype"));
            if (
              subtype === PDFName.of("Ink") ||
              subtype === PDFName.of("Highlight") ||
              subtype === PDFName.of("Text") ||
              subtype === PDFName.of("FreeText")
            ) {
              toRemove.push(i);
            }
          }
        }

        toRemove
          .sort((a, b) => b - a)
          .forEach((idx) => {
            annots.remove(idx);
          });
      }
    } catch (e) {
      console.warn("Failed to cleanup annotations on page", e);
    }
  }

  // 2. Export Annotations
  for (const annot of annotations) {
    if (annot?.sourcePdfRef && !annot.isEdited) continue;
    const page = pdfDoc.getPage(annot.pageIndex);
    const exporter = annotationExporters.find((e) => e.shouldExport(annot));
    if (exporter) {
      try {
        const viewport = await getViewportForPage(annot.pageIndex);
        await exporter.save(pdfDoc, page, annot, fontMap, viewport);
      } catch (e) {
        console.error(`Failed to export annotation ${annot.id}`, e);
      }
    }
  }

  // 3. Export Form Fields
  for (const field of fields) {
    const exporter = controlExporters.find((e) => e.shouldExport(field));
    if (exporter) {
      try {
        const viewport = await getViewportForPage(field.pageIndex);
        await exporter.save(form, field, fontMap, viewport);
      } catch (e) {
        console.error(`Failed to export field ${field.name}`, e);
      }
    }
  }

  return await pdfDoc.save();
};
