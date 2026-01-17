import { pdfWorkerService } from "./pdfWorkerService";
import { getFontMap, getGlobalDA } from "./lib/appearance";
import { loadAndEmbedExportFonts } from "./lib/built-in-fonts";
import {
  containsNonAscii,
  isSerifFamily,
  isExplicitCjkFontSelection,
} from "./lib/text";
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
  EncryptedPDFError,
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
  PDFNull,
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
  ViewportLike,
} from "./types";
import type { PdfJsAnnotation } from "./types";
import {
  InkParser,
  HighlightParser,
  CommentParser,
  FreeTextParser,
  LinkParser,
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
import { createPdfLibViewport } from "./lib/coords";

// PDF pipeline service.
//
// This module is the authoritative boundary for:
// - Loading a PDF (bytes -> pdf-lib document/pages + worker outline/render)
// - Rendering pages/thumbnails (mostly via worker for responsiveness)
// - Importing existing PDF form fields / annotations into our internal models
// - Exporting internal models back into a new PDF
//
// Key design: we use BOTH libraries for different responsibilities.
// - `pdfjs-dist`: render/text/outline in the worker
// - `pdf-lib`: page/metadata parsing + writing/export + resource introspection
//
// Extension points:
// - Add a new control/annotation type by implementing a Parser + Exporter and registering it
//   in the arrays below. The rest of the app treats `FormField` / `Annotation` as plain data.

// Register parsers and exporters
const annotationParsers: IAnnotationParser[] = [
  new InkParser(),
  new HighlightParser(),
  new CommentParser(),
  new FreeTextParser(),
  new LinkParser(),
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

type PdfLoadSession = {
  id: string;
  requestPassword: (
    reason: "need_password" | "incorrect_password",
  ) => Promise<string>;
  getLastPassword: () => string | undefined;
  markProgress: (loaded: number, total?: number) => void;
  finish: (ok: boolean) => void;
};

const createPdfLoadSession = (label?: string): PdfLoadSession => {
  const id = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let lastPassword: string | undefined = undefined;

  const markProgress = (loaded: number, total?: number) => {
    appEventBus.emit("pdf:loadProgress", {
      id,
      loaded,
      total,
    });
  };

  appEventBus.emit("pdf:loadStart", { id, label });
  markProgress(0, 1);

  const requestPassword = (reason: "need_password" | "incorrect_password") =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      const submit = (password: string) => {
        if (settled) return;
        settled = true;
        lastPassword = password;
        resolve(password);
      };
      const cancel = () => {
        if (settled) return;
        settled = true;
        reject(new Error("Password prompt cancelled"));
      };

      appEventBus.emit("pdf:passwordRequired", {
        id,
        reason,
        submit,
        cancel,
      });
    });

  const finish = (ok: boolean) => {
    appEventBus.emit("pdf:loadEnd", { id, ok });
  };

  return {
    id,
    requestPassword,
    getLastPassword: () => lastPassword,
    markProgress,
    finish,
  };
};

const getPdfLibPasswordReason = (
  error: unknown,
  hadPassword: boolean,
): "need_password" | "incorrect_password" | null => {
  if (error instanceof EncryptedPDFError) {
    return hadPassword ? "incorrect_password" : "need_password";
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("password")) {
      return hadPassword ? "incorrect_password" : "need_password";
    }
  }

  return null;
};

const loadPdfLibDocumentWithPassword = async (
  pdfBytes: Uint8Array,
  session: PdfLoadSession,
  initialPassword?: string | null,
): Promise<{ pdfDoc: PDFDocument; openPassword?: string }> => {
  let password: string | undefined =
    typeof initialPassword === "string" ? initialPassword : undefined;

  while (true) {
    try {
      const pdfDoc = await PDFDocument.load(pdfBytes, {
        password,
        updateMetadata: false,
      });
      return { pdfDoc, openPassword: password };
    } catch (error) {
      const reason = getPdfLibPasswordReason(error, password !== undefined);
      if (!reason) throw error;
      password = await session.requestPassword(reason);
    }
  }
};

const buildPdfLibAnnotsByPageIndex = async (
  pdfDoc: PDFDocument,
  options?: {
    resolveDest?: (dest: unknown) => Promise<number | null>;
  },
) => {
  const out = new Map<number, PdfJsAnnotation[]>();
  const pages = pdfDoc.getPages();
  const pageIndexByRefKey = new Map<string, number>();
  const pageIndexByNode = new Map<PDFDict, number>();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const pageNode = page.node;
    if (pageNode instanceof PDFDict) {
      pageIndexByNode.set(pageNode, pageIndex);
      const ref = pdfDoc.context.getObjectRef(pageNode);
      if (ref) {
        pageIndexByRefKey.set(
          `${ref.objectNumber}:${ref.generationNumber}`,
          pageIndex,
        );
      }
    }
  }

  const normalizeDestForResolve = (
    value: unknown,
    depth = 0,
    seenRefs: Set<string> = new Set(),
  ): unknown => {
    if (value === undefined || value === null) return undefined;
    if (depth > 6) return undefined;

    const refToProxy = (ref: PDFRef) => ({
      num: ref.objectNumber,
      gen: ref.generationNumber,
    });

    if (value instanceof PDFRef) {
      const key = `${value.objectNumber}:${value.generationNumber}`;
      if (seenRefs.has(key)) return undefined;
      seenRefs.add(key);

      let resolved: unknown = undefined;
      try {
        resolved = pdfDoc.context.lookup(value);
      } catch {
        resolved = undefined;
      }

      if (resolved && resolved !== value) {
        const normalized = normalizeDestForResolve(
          resolved,
          depth + 1,
          seenRefs,
        );
        if (normalized !== undefined) return normalized;
      }

      return [refToProxy(value)];
    }

    if (typeof value === "string" || Array.isArray(value)) return value;
    if (value instanceof PDFString || value instanceof PDFName) {
      return pdfObjToString(value);
    }
    if (value instanceof PDFDict) {
      const ref = pdfDoc.context.getObjectRef(value);
      return ref ? [refToProxy(ref)] : undefined;
    }
    if (value instanceof PDFNumber) {
      return [value.asNumber()];
    }
    if (value instanceof PDFArray) {
      let rawFirst: unknown = undefined;
      try {
        rawFirst = value.get(0);
      } catch {
        rawFirst = undefined;
      }

      if (rawFirst instanceof PDFRef) {
        return [refToProxy(rawFirst)];
      }
      if (rawFirst instanceof PDFDict) {
        const ref = pdfDoc.context.getObjectRef(rawFirst);
        return ref ? [refToProxy(ref)] : undefined;
      }
      if (rawFirst instanceof PDFNumber) {
        return [rawFirst.asNumber()];
      }
      if (rawFirst instanceof PDFString || rawFirst instanceof PDFName) {
        const named = pdfObjToString(rawFirst);
        return named || undefined;
      }

      let first: unknown = undefined;
      try {
        first = value.lookup(0);
      } catch {
        first = undefined;
      }
      if (first instanceof PDFRef) {
        return [refToProxy(first)];
      }
      if (first instanceof PDFNumber) {
        return [first.asNumber()];
      }
      if (first instanceof PDFString || first instanceof PDFName) {
        const named = pdfObjToString(first);
        return named || undefined;
      }
      if (first instanceof PDFDict) {
        const ref = pdfDoc.context.getObjectRef(first);
        return ref ? [refToProxy(ref)] : undefined;
      }

      return undefined;
    }
    return value;
  };

  const readDictValue = (dict: PDFDict, key: string): unknown => {
    const pdfKey = PDFName.of(key);
    let value: unknown = undefined;
    try {
      value = dict.lookup(pdfKey);
    } catch {
      value = undefined;
    }

    if (value === undefined || value === PDFNull) {
      try {
        value = dict.get(pdfKey, true);
      } catch {
        value = undefined;
      }
      if (value instanceof PDFRef) {
        try {
          value = dict.context.lookup(value);
        } catch {
          // ignore
        }
      }
    }

    if (value === PDFNull) return undefined;
    return value;
  };

  const extractActionDest = (action: PDFDict, depth = 0): unknown => {
    if (depth > 4) return undefined;

    const direct = readDictValue(action, "D") ?? readDictValue(action, "Dest");
    if (direct !== undefined) return direct;

    const next = readDictValue(action, "Next");
    if (next instanceof PDFDict) {
      return extractActionDest(next, depth + 1);
    }
    if (next instanceof PDFArray) {
      for (let i = 0; i < next.size(); i++) {
        let item: unknown = undefined;
        try {
          item = next.lookup(i);
        } catch {
          item = undefined;
        }
        if (item instanceof PDFDict) {
          const found = extractActionDest(item, depth + 1);
          if (found !== undefined) return found;
        }
      }
    }

    return undefined;
  };

  const resolveDestPageIndexFromPdfLib = (
    value: unknown,
  ): number | undefined => {
    const resolveFromNumber = (num: number): number | undefined => {
      if (!Number.isFinite(num)) return undefined;
      if (num >= 0 && num < pages.length) return num;
      if (num >= 1 && num <= pages.length) return num - 1;
      return undefined;
    };

    const resolveFromRef = (ref: PDFRef): number | undefined => {
      const key = `${ref.objectNumber}:${ref.generationNumber}`;
      return pageIndexByRefKey.get(key);
    };

    const resolveFromDict = (dict: PDFDict): number | undefined => {
      const direct = pageIndexByNode.get(dict);
      if (typeof direct === "number") return direct;
      const ref = pdfDoc.context.getObjectRef(dict);
      if (!ref) return undefined;
      return resolveFromRef(ref);
    };

    const resolveFromValue = (val: unknown): number | undefined => {
      if (!val) return undefined;
      if (val instanceof PDFRef) return resolveFromRef(val);
      if (val instanceof PDFDict) return resolveFromDict(val);
      if (val instanceof PDFNumber) return resolveFromNumber(val.asNumber());
      if (typeof val === "number") return resolveFromNumber(val);
      return undefined;
    };

    if (value instanceof PDFArray) {
      let rawFirst: unknown = undefined;
      try {
        rawFirst = value.get(0);
      } catch {
        rawFirst = undefined;
      }
      const rawResolved = resolveFromValue(rawFirst);
      if (typeof rawResolved === "number") return rawResolved;

      let lookedUp: unknown = undefined;
      try {
        lookedUp = value.lookup(0);
      } catch {
        lookedUp = undefined;
      }
      return resolveFromValue(lookedUp);
    }

    return resolveFromValue(value);
  };

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    let annots: unknown;
    try {
      annots = page.node.Annots();
    } catch {
      annots = undefined;
    }
    if (!(annots instanceof PDFArray)) {
      pdfDebug("import:annotations", "page_annots_missing", () => ({
        pageIndex,
        annots: summarizePdfObjForDebug(annots),
      }));
      continue;
    }
    pdfDebug("import:annotations", "page_annots", () => ({
      pageIndex,
      count: annots.size(),
    }));

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

      let subtype: unknown;
      try {
        subtype = annot.lookup(PDFName.of("Subtype"));
      } catch {
        subtype = undefined;
      }
      const subtypeName =
        subtype instanceof PDFName ? subtype.decodeText() : undefined;

      let rectObj: unknown;
      try {
        rectObj = annot.lookup(PDFName.of("Rect"));
      } catch {
        rectObj = undefined;
      }
      const rect = pdfRectFromObj(rectObj);

      pdfDebug("import:annotations", "annot_raw", () => ({
        pageIndex,
        annotIndex: i,
        subtypeName,
        rect,
        rectObj: summarizePdfObjForDebug(rectObj),
        sourcePdfRef,
        annot: summarizePdfObjForDebug(annot),
      }));

      if (!subtypeName) continue;

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

      if (subtypeName === "Link") {
        let url: string | undefined = undefined;
        let dest: unknown = undefined;
        let action: PDFDict | undefined = undefined;
        let actionType: string | undefined = undefined;

        try {
          const actionValue = readDictValue(annot, "A");
          if (actionValue instanceof PDFDict) {
            action = actionValue;
            actionType = pdfObjToString(readDictValue(action, "S"));
            if (actionType === "URI") {
              url = pdfObjToString(readDictValue(action, "URI"));
            }
            const actionDest = extractActionDest(action);
            if (actionDest !== undefined) dest = actionDest;
          }
        } catch {
          // ignore
        }

        if (dest === undefined) {
          try {
            dest = readDictValue(annot, "Dest");
          } catch {
            // ignore
          }
        }

        let destPageIndex: number | null | undefined = undefined;
        const normalizedDest = normalizeDestForResolve(dest);
        const resolveDestPageIndex = options?.resolveDest;
        if (normalizedDest !== undefined && resolveDestPageIndex) {
          destPageIndex = await resolveDestPageIndex(normalizedDest);
        }
        if (typeof destPageIndex !== "number") {
          const fallbackIndex = resolveDestPageIndexFromPdfLib(dest);
          if (typeof fallbackIndex === "number") destPageIndex = fallbackIndex;
        }

        pdfDebug("import:annotations", "link_extracted", () => ({
          pageIndex,
          annotIndex: i,
          url,
          actionType,
          actionKeys: action ? action.keys().map((k) => k.decodeText()) : [],
          action: summarizePdfObjForDebug(action),
          dest: summarizePdfObjForDebug(dest),
          normalizedDest,
          destPageIndex,
        }));

        if (!url && typeof destPageIndex !== "number") {
          continue;
        }

        pushForPage({
          subtype: "Link",
          rect,
          sourcePdfRef,
          url,
          dest,
          destPageIndex,
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

  const loadSession = createPdfLoadSession("loadPDF");
  let openPassword: string | undefined = undefined;
  let pdfDoc: PDFDocument;
  try {
    const loaded = await loadPdfLibDocumentWithPassword(
      pdfBytes,
      loadSession,
      options?.password,
    );
    pdfDoc = loaded.pdfDoc;
    openPassword = loaded.openPassword;
    loadSession.markProgress(1, 1);
    loadSession.finish(true);
  } catch (error) {
    loadSession.finish(false);
    throw error;
  }

  try {
    fontMap = getFontMap(pdfDoc);
    globalDA = getGlobalDA(pdfDoc);
  } catch (e) {
    console.warn("Failed to parse PDF resources with pdf-lib", e);
  }

  const renderBuffer = pdfBytes;

  let workerReady = false;
  try {
    workerReady = await pdfWorkerService.loadDocument(renderBuffer, {
      password: openPassword,
    });
  } catch (e) {
    console.warn("Failed to load PDF into render worker", e);
  }

  const pdfLibPages = pdfDoc.getPages();
  const numPages = pdfLibPages.length;
  const pages: PageData[] = [];
  const fields: FormField[] = [];
  const annotations: Annotation[] = [];

  let pdfLibAnnotsByPageIndex: Map<number, PdfJsAnnotation[]> | undefined =
    undefined;
  try {
    const resolveDestWithWorker = async (
      normalizedDest: unknown,
    ): Promise<number | null> => {
      if (!workerReady) return null;
      try {
        return await pdfWorkerService.resolveDest({ dest: normalizedDest });
      } catch {
        return null;
      }
    };
    const resolveDestPageIndex = async (
      normalizedDest: unknown,
    ): Promise<number | null> => {
      return await resolveDestWithWorker(normalizedDest);
    };

    pdfLibAnnotsByPageIndex = await buildPdfLibAnnotsByPageIndex(pdfDoc, {
      resolveDest: resolveDestPageIndex,
    });
  } catch (e) {
    console.warn("Failed to extract annotations with pdf-lib", e);
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

  const toLocalISO = (d: Date) => {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const readMetadataFromPdfLib = (doc: PDFDocument): PDFMetadata => {
    const keywords = doc.getKeywords();
    let keywordsOut: string[] | undefined = undefined;
    if (typeof keywords === "string") {
      keywordsOut = [keywords];
    }
    if (keywordsOut) {
      keywordsOut = keywordsOut.filter(
        (k) => typeof k === "string" && k.trim().length > 0,
      );
      if (keywordsOut.length === 0) keywordsOut = undefined;
    }

    const created = doc.getCreationDate();
    const modified = doc.getModificationDate();

    return {
      title: doc.getTitle(),
      author: doc.getAuthor(),
      subject: doc.getSubject(),
      keywords: keywordsOut,
      creator: doc.getCreator(),
      producer: doc.getProducer(),
      creationDate: created ? toLocalISO(created) : undefined,
      modificationDate: modified ? toLocalISO(modified) : undefined,
      isModDateManual: false,
      isProducerManual: false,
    };
  };

  const metadataPromise = (async (): Promise<PDFMetadata> => {
    if (pdfDoc) {
      try {
        return readMetadataFromPdfLib(pdfDoc);
      } catch (e) {
        console.warn("Failed to extract metadata with pdf-lib", e);
      }
    }
    return {};
  })();

  const outlinePromise = (async (): Promise<PDFOutlineItem[]> => {
    if (workerReady) {
      try {
        const outline = await pdfWorkerService.getOutline();
        if (outline) return outline;
      } catch (e) {
        console.warn("Failed to extract outline via worker", e);
      }
    }
    return [];
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

      const pdfLibPage = pdfLibPages[idx];
      if (!pdfLibPage) continue;
      const pageNumber = idx + 1;

      const viewport: ViewportLike = createPdfLibViewport(pdfLibPage, {
        scale: 1.0,
      });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;
      const userUnit = viewport.userUnit ?? 1;
      const viewBox =
        viewport.viewBox ??
        ([0, 0, pageWidth / userUnit, pageHeight / userUnit] as [
          number,
          number,
          number,
          number,
        ]);
      const pageAnnotations = pdfLibAnnotsByPageIndex?.get(idx) || [];

      const context: ParserContext = {
        pageAnnotations,
        pageIndex: idx,
        viewport,
        pdfDoc,
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
          width: pageWidth,
          height: pageHeight,
          viewBox,
          userUnit,
          rotation: viewport.rotation,
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

  pdfDebug("import:annotations", "annotations_final", () => {
    const counts: Record<string, number> = {};
    for (const a of annotations) {
      const key = a.type || "unknown";
      counts[key] = (counts[key] || 0) + 1;
    }
    const linkWithDest = annotations.filter(
      (a) => a.type === "link" && typeof a.linkDestPageIndex === "number",
    ).length;
    return {
      total: annotations.length,
      counts,
      linkWithDest,
    };
  });

  const [metadata, outline] = await Promise.all([
    metadataPromise,
    outlinePromise,
  ]);

  return {
    pdfBytes,
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

  const resolvedOpenPassword = openPassword ?? undefined;

  const pdfDoc = await PDFDocument.load(
    originalBytes,
    resolvedOpenPassword ? { password: resolvedOpenPassword } : undefined,
  );

  const pdfLibPages = pdfDoc.getPages();
  const viewportCache = new Map<number, ViewportLike>();
  const getViewportForPage = async (pageIndex: number) => {
    const cached = viewportCache.get(pageIndex);
    if (cached) return cached;
    const page = pdfLibPages[pageIndex];
    if (!page) return undefined;
    const vp = createPdfLibViewport(page, { scale: 1.0 });
    viewportCache.set(pageIndex, vp);
    return vp;
  };

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
