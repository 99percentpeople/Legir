import * as pdfjsLib from "pdfjs-dist";
import { pdfWorkerService } from "./pdfWorkerService";
import { mapOutline, getFontMap, getGlobalDA } from "../lib/pdf-helpers";
import {
  PDFDocument,
  StandardFonts,
  PDFName,
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
}> => {
  let pdfBytes: Uint8Array;
  if (input instanceof File) {
    const arrayBuffer = await input.arrayBuffer();
    pdfBytes = new Uint8Array(arrayBuffer.slice(0));
  } else {
    pdfBytes = input;
  }

  // 1. Load with pdf-lib
  let fontMap = new Map<string, string>();
  let globalDA: string | undefined = undefined;
  let pdfDoc: PDFDocument | null = null;

  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    fontMap = getFontMap(pdfDoc);
    globalDA = getGlobalDA(pdfDoc);
  } catch (e) {
    console.warn("Failed to parse PDF resources with pdf-lib", e);
  }

  // 2. Load with pdf.js
  const renderBuffer = new Uint8Array(pdfBytes.slice(0));
  pdfWorkerService.loadDocument(renderBuffer);

  const loadingTask = pdfjsLib.getDocument({
    data: renderBuffer,
    password: "",
  });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const pages: PageData[] = [];
  const fields: FormField[] = [];
  const annotations: Annotation[] = [];

  let metadata: PDFMetadata = {};
  try {
    const { info } = await pdf.getMetadata();
    if (info) {
      metadata = {
        title: info["Title"],
        author: info["Author"],
        subject: info["Subject"],
        keywords: info["Keywords"],
        creator: info["Creator"],
        producer: info["Producer"],
      };
    }
  } catch (e) {
    console.warn("Failed to extract metadata", e);
  }

  let outline: PDFOutlineItem[] = [];
  try {
    const rawOutline = await pdf.getOutline();
    if (rawOutline) outline = await mapOutline(pdf, rawOutline);
  } catch (e) {
    console.warn("Failed to extract outline", e);
  }

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const pageAnnotations = await page.getAnnotations();

    // Create Context
    const context: ParserContext = {
      pageAnnotations,
      pageIndex: i - 1,
      viewport,
      pdfDoc: pdfDoc || undefined,
    };

    // Run Annotation Parsers
    for (const parser of annotationParsers) {
      try {
        const parsedAnnots = await parser.parse(context);
        annotations.push(...parsedAnnots);
      } catch (e) {
        console.warn(`Annotation parser failed for page ${i}`, e);
      }
    }

    // Run Control Parsers
    for (const parser of controlParsers) {
      try {
        const parsedFields = await parser.parse(context);
        fields.push(...parsedFields);
      } catch (e) {
        console.warn(`Control parser failed for page ${i}`, e);
      }
    }

    pages.push({
      pageIndex: i - 1,
      width: viewport.width,
      height: viewport.height,
    });
  }

  return {
    pdfBytes,
    pdfDocument: pdf,
    pages,
    fields,
    annotations,
    metadata,
    outline,
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
): Promise<Uint8Array> => {
  if (originalBytes.byteLength === 0) throw new Error("PDF buffer is empty.");
  const pdfDoc = await PDFDocument.load(originalBytes, {
    ignoreEncryption: true,
  });

  // Metadata update
  if (metadata) {
    if (metadata.title) pdfDoc.setTitle(metadata.title);
    if (metadata.author) pdfDoc.setAuthor(metadata.author);
    if (metadata.subject) pdfDoc.setSubject(metadata.subject);
    if (metadata.creator) pdfDoc.setCreator(metadata.creator);
    if (metadata.keywords) pdfDoc.setKeywords(metadata.keywords);
  }

  // Embed Standard Fonts
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const courier = await pdfDoc.embedFont(StandardFonts.Courier);

  const fontMap = new Map<string, any>();
  fontMap.set("Helvetica", helvetica);
  fontMap.set("Times Roman", timesRoman);
  fontMap.set("Courier", courier);

  const form = pdfDoc.getForm();

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
  for (const page of pages) {
    try {
      const annots = page.node.Annots();
      if (annots instanceof PDFArray) {
        const toRemove: number[] = [];

        for (let i = 0; i < annots.size(); i++) {
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
    const page = pdfDoc.getPage(annot.pageIndex);
    const exporter = annotationExporters.find((e) => e.shouldExport(annot));
    if (exporter) {
      try {
        await exporter.save(pdfDoc, page, annot, fontMap);
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
        await exporter.save(form, field, fontMap);
      } catch (e) {
        console.error(`Failed to export field ${field.name}`, e);
      }
    }
  }

  return await pdfDoc.save();
};
