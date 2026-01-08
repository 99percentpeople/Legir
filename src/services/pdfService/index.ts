import * as pdfjsLib from "pdfjs-dist";
import { pdfWorkerService } from "./pdfWorkerService";
import { mapOutline } from "./lib/outline";
import { getFontMap, getGlobalDA } from "./lib/appearance";
import { loadAndEmbedExportFonts } from "./lib/built-in-fonts";
import {
  containsNonAscii,
  isSerifFamily,
  isExplicitCjkFontSelection,
} from "./lib/text";
import { parsePDFDate } from "@/utils/pdfUtils";
import {
  buildFullFieldNameFromChain,
  decodePdfStreamToText,
  extractBorderStyle,
  extractBorderWidth,
  extractChoiceOptions,
  extractFieldValue,
  extractMkColor,
  extractPdfStreamFilters,
  extractWidgetOnValue,
  lookupInFieldChain,
  parseBorderFromAppearanceStream,
  pdfArrayToNumberList,
  pdfObjToString,
  pdfRectFromObj,
  summarizePdfObjForDebug,
} from "./lib/pdf-import-utils";
import {
  PDFDocument,
  StandardFonts,
  type PDFFont,
  PDFRef,
  PDFName,
  PDFString,
  PDFDict,
  PDFBool,
  PDFArray,
  PDFStream,
  PDFNumber,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
} from "@cantoo/pdf-lib";
import fontkit from "pdf-fontkit";
import { pdfDebug, pdfDebugEnabled } from "./lib/debug";
import { appEventBus } from "@/lib/eventBus";
import {
  FormField,
  PageData,
  PDFMetadata,
  PDFOutlineItem,
  Annotation,
} from "@/types";
import {
  IAnnotationParser,
  IControlParser,
  IAnnotationExporter,
  IControlExporter,
  ParserContext,
} from "./types";
import type { PdfJsAnnotation } from "./types";
import {
  InkParser,
  HighlightParser,
  CommentParser,
  FreeTextParser,
} from "./parsers/AnnotationParsers";
import {
  TextControlParser,
  CheckboxControlParser,
  RadioControlParser,
  DropdownControlParser,
  SignatureControlParser,
} from "./parsers/ControlParsers";
import {
  InkExporter,
  HighlightExporter,
  CommentExporter,
  FreeTextExporter,
} from "./exporters/AnnotationExporters";
import {
  TextControlExporter,
  CheckboxControlExporter,
  RadioControlExporter,
  DropdownControlExporter,
  SignatureControlExporter,
} from "./exporters/ControlExporters";
import PdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
import { PDFJS_CMAP_URL, PDFJS_STANDARD_FONT_URL } from "./pdfRenderer";

// PDF pipeline service.
//
// This module is the authoritative boundary for:
// - Loading a PDF (bytes -> pdfjs document/pages/outline + pdf-lib document resources)
// - Rendering pages/thumbnails (mostly via worker for responsiveness)
// - Importing existing PDF form fields / annotations into our internal models
// - Exporting internal models back into a new PDF
//
// Key design: we use BOTH libraries for different responsibilities.
// - `pdfjs-dist`: viewing/metadata/outline + render surfaces
// - `pdf-lib`: writing/export + certain resource introspection (fonts/DA)
//
// Extension points:
// - Add a new control/annotation type by implementing a Parser + Exporter and registering it
//   in the arrays below. The rest of the app treats `FormField` / `Annotation` as plain data.

// pdfjs worker for parsing/render internals.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfjsWorker({
  name: "pdfjs-worker",
});

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

const createPdfJsLoadTask = (options: {
  data: Uint8Array;
  label?: string;
  password?: string;
}) => {
  const id = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  appEventBus.emit("pdf:loadStart", { id, label: options.label });

  const task = pdfjsLib.getDocument({
    data: options.data,
    password: options.password || "",
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
    useSystemFonts: false,
    disableFontFace: false,
    stopAtErrors: false,
  });

  task.onProgress = (progress) => {
    appEventBus.emit("pdf:loadProgress", {
      id,
      loaded: progress?.loaded ?? 0,
      total: progress?.total,
    });
  };

  let lastPassword: string | undefined = undefined;

  task.onPassword = (callback: (password: string) => void, reason: unknown) => {
    const pr = (pdfjsLib as any)?.PasswordResponses;
    const mappedReason =
      typeof pr === "object" && reason === pr.INCORRECT_PASSWORD
        ? "incorrect_password"
        : "need_password";

    let settled = false;
    const submit = (password: string) => {
      if (settled) return;
      settled = true;
      lastPassword = password;
      callback(password);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      void task.destroy().catch(() => {
        // ignore
      });
      callback("");
    };

    appEventBus.emit("pdf:passwordRequired", {
      id,
      reason: mappedReason,
      submit,
      cancel,
    });
  };

  let ok = false;

  task.promise
    .then(() => (ok = true))
    .catch(() => (ok = false))
    .finally(() => {
      appEventBus.emit("pdf:loadEnd", { id, ok });
    });

  return {
    task,
    id,
    getLastPassword: () => lastPassword,
  };
};

const buildPdfLibAnnotsByPageIndex = async (pdfDoc: PDFDocument) => {
  const out = new Map<number, PdfJsAnnotation[]>();
  const pages = pdfDoc.getPages();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    let annots: unknown;
    try {
      annots = page.node.Annots();
    } catch {
      annots = undefined;
    }
    if (!(annots instanceof PDFArray)) continue;

    for (let i = 0; i < annots.size(); i++) {
      let sourcePdfRef:
        | { objectNumber: number; generationNumber: number }
        | undefined = undefined;
      try {
        const rawRef = (
          annots as unknown as { get?: (i: number) => unknown }
        ).get?.(i);
        if (rawRef instanceof PDFRef) {
          sourcePdfRef = {
            objectNumber: rawRef.objectNumber,
            generationNumber: rawRef.generationNumber,
          };
        }
      } catch {
        // ignore
      }

      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;

      const subtype = annot.lookup(PDFName.of("Subtype"));

      const subtypeName =
        subtype instanceof PDFName ? subtype.decodeText() : undefined;
      if (!subtypeName) continue;

      const rect = pdfRectFromObj(annot.lookup(PDFName.of("Rect")));
      if (!rect) continue;

      const pushForPage = (a: PdfJsAnnotation) => {
        const arr = out.get(pageIndex) || [];
        arr.push(a);
        out.set(pageIndex, arr);
      };

      if (subtypeName === "Widget") {
        const fieldName = buildFullFieldNameFromChain(annot);
        if (!fieldName) continue;

        const fieldType = pdfObjToString(lookupInFieldChain(annot, "FT"));
        if (!fieldType) continue;

        const rawFf = lookupInFieldChain(annot, "Ff");
        const fieldFlags = rawFf instanceof PDFNumber ? rawFf.asNumber() : 0;

        const rawDa = lookupInFieldChain(annot, "DA");
        const da = pdfObjToString(rawDa);

        const rawQ = lookupInFieldChain(annot, "Q");
        const textAlignment =
          rawQ instanceof PDFNumber ? rawQ.asNumber() : undefined;

        const rawTu = lookupInFieldChain(annot, "TU");
        const tu = pdfObjToString(rawTu);

        const rawV = lookupInFieldChain(annot, "V");
        const fieldValue = extractFieldValue(rawV);

        const optObj = lookupInFieldChain(annot, "Opt");
        const options = extractChoiceOptions(optObj);

        const bsDirect = (() => {
          try {
            return annot.lookup(PDFName.of("BS"));
          } catch {
            return undefined;
          }
        })();
        const borderDirect = (() => {
          try {
            return annot.lookup(PDFName.of("Border"));
          } catch {
            return undefined;
          }
        })();
        const mkDirect = (() => {
          try {
            return annot.lookup(PDFName.of("MK"));
          } catch {
            return undefined;
          }
        })();
        const apDirect = (() => {
          try {
            return annot.lookup(PDFName.of("AP"));
          } catch {
            return undefined;
          }
        })();

        const bsChain = lookupInFieldChain(annot, "BS");
        const borderChain = lookupInFieldChain(annot, "Border");
        const mkChain = lookupInFieldChain(annot, "MK");

        const debugRaw = {
          bsDirect: summarizePdfObjForDebug(bsDirect),
          bsChain: summarizePdfObjForDebug(bsChain),
          borderDirect: summarizePdfObjForDebug(borderDirect),
          borderChain: summarizePdfObjForDebug(borderChain),
          mkDirect: summarizePdfObjForDebug(mkDirect),
          mkChain: summarizePdfObjForDebug(mkChain),
          apDirect: summarizePdfObjForDebug(apDirect),
        };

        const color = extractMkColor(annot, "BC");
        const backgroundColor = extractMkColor(annot, "BG");

        const borderWidth = extractBorderWidth(annot);
        const borderStyle = extractBorderStyle(annot);

        let finalBorderWidth: number | undefined = borderWidth;
        let finalBorderStyle: "solid" | "dashed" | "underline" | undefined =
          borderStyle;

        // Fallback: Some PDFs draw widget borders only inside the appearance stream (AP/N)
        // and omit BS/Border entirely.
        if (
          typeof finalBorderWidth !== "number" &&
          typeof finalBorderStyle !== "string"
        ) {
          try {
            const ap = apDirect;
            if (ap instanceof PDFDict) {
              const n = ap.lookup(PDFName.of("N"));
              let stream: PDFStream | undefined = undefined;
              if (n instanceof PDFStream) {
                stream = n;
              } else if (n instanceof PDFDict) {
                // pick first appearance state stream
                for (const [k] of n.entries()) {
                  const candidate = n.lookup(k);
                  if (candidate instanceof PDFStream) {
                    stream = candidate;
                    break;
                  }
                }
              }

              if (stream) {
                const apContent = await decodePdfStreamToText(stream);
                const parsed = parseBorderFromAppearanceStream(apContent);
                if (typeof parsed.width === "number")
                  finalBorderWidth = parsed.width;
                if (parsed.style) finalBorderStyle = parsed.style;
              }
            }
          } catch {
            // ignore
          }
        }

        if (pdfDebugEnabled("import:controls")) {
          let apInfo: unknown = undefined;
          try {
            const ap = apDirect;
            if (ap instanceof PDFDict) {
              const n = ap.lookup(PDFName.of("N"));
              let stream: PDFStream | undefined = undefined;
              let state: string | undefined = undefined;
              if (n instanceof PDFStream) {
                stream = n;
              } else if (n instanceof PDFDict) {
                for (const [k] of n.entries()) {
                  const candidate = n.lookup(k);
                  if (candidate instanceof PDFStream) {
                    stream = candidate;
                    state = k.decodeText();
                    break;
                  }
                }
              }

              if (stream) {
                const filters = extractPdfStreamFilters(stream);
                const content = await decodePdfStreamToText(stream);
                apInfo = {
                  state,
                  filters,
                  length: content.length,
                  head: content.slice(0, 600),
                };
              }
            }
          } catch (e) {
            apInfo = { error: e };
          }

          pdfDebug("import:controls", "widget_border_debug", () => ({
            fieldName,
            raw: debugRaw,
            ap: apInfo,
            borderWidth: finalBorderWidth,
            borderStyle: finalBorderStyle,
          }));
        }

        const isRadio = (fieldFlags & (1 << 15)) !== 0;
        const isPushButton = (fieldFlags & (1 << 16)) !== 0;
        const isBtn = fieldType === "Btn";
        const checkBox = isBtn && !isRadio && !isPushButton;
        const radioButton = isBtn && isRadio;

        const buttonValue = isBtn ? extractWidgetOnValue(annot) : undefined;

        pushForPage({
          subtype: "Widget",
          rect,
          sourcePdfRef,
          fieldName,
          fieldType,
          fieldFlags,
          fieldValue,
          alternativeText: tu,
          options,
          color,
          backgroundColor,
          borderStyle:
            typeof finalBorderWidth === "number" || finalBorderStyle
              ? { width: finalBorderWidth, style: finalBorderStyle }
              : undefined,
          defaultAppearance: da,
          DA: da,
          textAlignment,
          checkBox: checkBox || undefined,
          radioButton: radioButton || undefined,
          buttonValue,
        });
        continue;
      }

      if (
        subtypeName !== "Highlight" &&
        subtypeName !== "Text" &&
        subtypeName !== "FreeText"
      ) {
        continue;
      }

      const c = annot.lookup(PDFName.of("C"));
      const color = pdfArrayToNumberList(c);

      const caObj = annot.lookup(PDFName.of("CA"));
      const caObjLower = annot.lookup(PDFName.of("ca"));
      const opacity =
        caObj instanceof PDFNumber
          ? caObj.asNumber()
          : caObjLower instanceof PDFNumber
            ? caObjLower.asNumber()
            : undefined;

      const title = pdfObjToString(annot.lookup(PDFName.of("T")));
      const contents = pdfObjToString(annot.lookup(PDFName.of("Contents")));
      const modificationDate = pdfObjToString(annot.lookup(PDFName.of("M")));

      const base: PdfJsAnnotation = {
        subtype: subtypeName,
        rect,
        sourcePdfRef,
        color,
        opacity,
        title,
        contents,
        modificationDate,
      };

      if (subtypeName === "Highlight") {
        const qp = pdfArrayToNumberList(annot.lookup(PDFName.of("QuadPoints")));
        pushForPage({
          ...base,
          quadPoints: qp,
        });
        continue;
      }

      if (subtypeName === "FreeText") {
        const da = pdfObjToString(annot.lookup(PDFName.of("DA")));
        const q = annot.lookup(PDFName.of("Q"));
        const textAlignment = q instanceof PDFNumber ? q.asNumber() : undefined;
        pushForPage({
          ...base,
          defaultAppearance: da,
          DA: da,
          textAlignment,
        });
        continue;
      }

      // subtypeName === "Text" (comment)
      const richText = pdfObjToString(annot.lookup(PDFName.of("RC")));
      pushForPage({
        ...base,
        richText,
      });
    }
  }

  return out;
};

export const loadPDF = async (
  input: File | Uint8Array,
  options?: {
    password?: string | null;
  },
): Promise<{
  pdfBytes: Uint8Array;
  pdfDocument: pdfjsLib.PDFDocumentProxy;
  pages: PageData[];
  fields: FormField[];
  annotations: Annotation[];
  metadata: PDFMetadata;
  outline: PDFOutlineItem[];
  openPassword?: string;
  dispose: () => void;
}> => {
  let pdfBytes: Uint8Array;
  if (input instanceof File) {
    const arrayBuffer = await input.arrayBuffer();
    pdfBytes = new Uint8Array(arrayBuffer);
  } else {
    pdfBytes = new Uint8Array(input);
  }

  let fontMap = new Map<string, string>();
  let globalDA: string | undefined = undefined;
  let pdfDoc: PDFDocument | null = null;

  const renderBuffer = pdfBytes;
  const pdfJsData = new Uint8Array(pdfBytes);
  const { task: pdfJsLoadTask, getLastPassword } = createPdfJsLoadTask({
    data: pdfJsData,
    label: "loadPDF",
    password: options?.password,
  });

  const pdf = await pdfJsLoadTask.promise;

  const openPassword = getLastPassword() ?? options?.password;
  try {
    pdfDoc = await PDFDocument.load(
      pdfBytes,
      openPassword ? { password: openPassword } : undefined,
    );
    try {
      fontMap = getFontMap(pdfDoc);
      globalDA = getGlobalDA(pdfDoc);
    } catch (e) {
      console.warn("Failed to parse PDF resources with pdf-lib", e);
    }
  } catch (e) {
    console.warn("Failed to parse PDF resources with pdf-lib", e);
  }

  try {
    await pdfWorkerService.loadDocument(renderBuffer, {
      password: openPassword,
    });
  } catch (e) {
    console.warn("Failed to load PDF into render worker", e);
  }

  const numPages = pdf.numPages;
  const pages: PageData[] = [];
  const fields: FormField[] = [];
  const annotations: Annotation[] = [];

  let pdfLibAnnotsByPageIndex: Map<number, PdfJsAnnotation[]> | undefined =
    undefined;
  if (pdfDoc) {
    try {
      pdfLibAnnotsByPageIndex = await buildPdfLibAnnotsByPageIndex(pdfDoc);
    } catch (e) {
      console.warn("Failed to extract annotations with pdf-lib", e);
    }
  }

  const embeddedFontCache = new Map<string, Promise<string | undefined>>();
  const embeddedFontFaces = new Set<FontFace>();

  const dispose = () => {
    embeddedFontCache.clear();

    if (typeof document !== "undefined" && document.fonts) {
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
          (k: unknown) => typeof k === "string" && k.trim().length > 0,
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
      const pageAnnotations = (pdfLibAnnotsByPageIndex?.get(idx) || []) as any;

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
    openPassword,
    dispose,
  };
};

export const exportPDF = async (
  originalBytes: Uint8Array,
  fields: FormField[],
  metadata?: PDFMetadata,
  annotations: Annotation[] = [],
  customFont?: { bytes?: Uint8Array; name?: string },
  options?: {
    openPassword?: string | null;
    exportPassword?: string | null;
  },
): Promise<Uint8Array> => {
  if (originalBytes.byteLength === 0) throw new Error("PDF buffer is empty.");

  const openPassword =
    typeof options?.openPassword === "string" && options.openPassword
      ? options.openPassword
      : undefined;

  const exportPassword =
    typeof options?.exportPassword === "string" && options.exportPassword
      ? options.exportPassword
      : undefined;

  const resolveExportFontNeeds = () => {
    const includeFontIds = new Set<"cjk_sans" | "cjk_serif">();
    let needsCustomFont = false;

    const consider = (
      text: string | undefined,
      fontFamily: string | undefined,
    ) => {
      const hasText = typeof text === "string" && text.length > 0;
      const hasNonAscii = hasText ? containsNonAscii(text) : false;
      const explicitCjk = isExplicitCjkFontSelection(fontFamily);

      if (explicitCjk) {
        if (
          fontFamily === "Source Han Serif SC" ||
          fontFamily === "CustomSerif"
        ) {
          includeFontIds.add("cjk_serif");
        } else {
          includeFontIds.add("cjk_sans");
        }
        if (
          fontFamily === "Custom" ||
          fontFamily === "CustomSans" ||
          fontFamily === "CustomSerif"
        ) {
          needsCustomFont = true;
        }
      }

      if (hasNonAscii) {
        if (isSerifFamily(fontFamily)) includeFontIds.add("cjk_serif");
        else includeFontIds.add("cjk_sans");
      }
    };

    for (const f of fields || []) {
      const fontFamily = f.style?.fontFamily;
      consider(f.value, fontFamily);
      consider(f.toolTip, fontFamily);
    }

    for (const a of annotations || []) {
      const fontFamily = a.fontFamily;
      consider(a.text, fontFamily);
      consider(a.author, fontFamily);
    }

    if (!customFont?.bytes || customFont.bytes.byteLength === 0) {
      needsCustomFont = false;
    }

    return { includeFontIds, needsCustomFont };
  };

  let pdfJsDoc: pdfjsLib.PDFDocumentProxy | undefined;
  let resolvedOpenPassword: string | undefined = openPassword;
  try {
    const renderBuffer = new Uint8Array(originalBytes.slice(0));
    const { task, getLastPassword } = createPdfJsLoadTask({
      data: renderBuffer,
      label: "exportPDF",
      password: openPassword,
    });
    pdfJsDoc = await task.promise;

    const pw = getLastPassword();
    if (typeof pw === "string" && pw) {
      resolvedOpenPassword = pw;
    }
  } catch (e) {
    console.warn(
      "[PDF Export] Failed to load PDF with pdf.js; rotation-aware export disabled",
      e,
    );
  }

  const viewportCache = new Map<number, pdfjsLib.PageViewport>();
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

  const pdfDoc = await PDFDocument.load(
    originalBytes,
    resolvedOpenPassword ? { password: resolvedOpenPassword } : undefined,
  );

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

  const fontMap = new Map<string, PDFFont>();
  fontMap.set("Helvetica", helvetica);
  fontMap.set("Times Roman", timesRoman);
  fontMap.set("Courier", courier);

  const { includeFontIds, needsCustomFont } = resolveExportFontNeeds();

  await loadAndEmbedExportFonts({
    pdfDoc,
    fontMap,
    fontkit,
    customFont:
      needsCustomFont && customFont?.bytes
        ? { bytes: customFont.bytes, name: customFont.name }
        : undefined,
    includeFontIds,
    subset: true,
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
          const fieldRef = (field as unknown as { ref?: PDFRef }).ref;
          const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
          if (acroForm instanceof PDFDict) {
            const acroFields = acroForm.lookup(PDFName.of("Fields"));
            if (acroFields instanceof PDFArray) {
              if (fieldRef) {
                const idx = acroFields.indexOf(fieldRef);
                if (idx !== -1) {
                  acroFields.remove(idx);
                }
              }
            }
          }

          const acroField = (field as unknown as { acroField?: unknown })
            .acroField;
          const acroFieldWithWidgets = acroField as
            | { getWidgets?: unknown }
            | undefined;
          if (typeof acroFieldWithWidgets?.getWidgets === "function") {
            const widgets = (
              acroFieldWithWidgets.getWidgets as () => unknown
            )();
            if (Array.isArray(widgets)) {
              const pages = pdfDoc.getPages();
              for (const page of pages) {
                const annots = page.node.Annots();
                if (annots instanceof PDFArray) {
                  for (const widget of widgets) {
                    if (!(widget instanceof PDFRef)) continue;
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
          if (keepKeys) {
            const raw = annots.get(i);
            if (raw instanceof PDFRef) {
              const k = `${raw.objectNumber}:${raw.generationNumber}`;
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

  if (typeof exportPassword === "string" && exportPassword) {
    pdfDoc.encrypt({
      userPassword: exportPassword,
      ownerPassword: exportPassword,
    });
  } else {
    // If the source PDF was encrypted, pdf-lib may preserve the original
    // trailer's /Encrypt entry. If we save without re-encrypting, we must clear
    // this or PDF.js will attempt to decrypt unencrypted streams.
    pdfDoc.context.security = undefined;
    pdfDoc.context.trailerInfo.Encrypt = undefined;
    pdfDoc.context.trailerInfo.ID = undefined;
  }

  return await pdfDoc.save();
};

export { renderPage, renderPageBytes } from "./pdfRenderer";
