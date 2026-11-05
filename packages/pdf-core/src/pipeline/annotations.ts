import {
  PDFButton,
  PDFSignature,
  PDFWidgetAnnotation,
} from "@legir/pdfium/authoring";
import {
  renderButtonIcon,
  renderWidgetAppearance,
} from "../engine/widgetAppearance.js";
import {
  buildFullFieldNameFromChain,
  collectFieldFlagsFromChain,
  createPdfStreamTextReader,
  extractBorderDashArray,
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
} from "../lib/pdf-import-utils.js";
import {
  getAppearanceStreamMetadata,
  getRotationDegFromPdfMatrix,
  parseRotationDegFromAppearanceContent,
} from "../lib/appearanceRotation.js";
import { extractStampImageDataFromAppearance } from "../lib/stampAppearance.js";
import { extractStampSvgDataFromAppearance } from "../lib/stampVector.js";
import { getFreeTextAppearanceRotation } from "../lib/freeTextAppearance.js";
import { getAppHighlightedText } from "../lib/annotationMetadata.js";
import {
  PDFDocument,
  PDFRef,
  PDFName,
  PDFString,
  PDFDict,
  PDFArray,
  PDFStream,
  PDFNumber,
  PDFNull,
} from "@legir/pdfium/authoring";
import { pdfDebug, pdfDebugEnabled } from "../lib/debug.js";
import { PDF_CUSTOM_KEYS } from "@legir/pdf-model/constants";
import {
  createStampImageAppearance,
  createStampImageResource,
  getStampSvgIntrinsicSize,
} from "@legir/pdf-model/stampImage";
import {
  getControlRotationFromWidgetRotation,
  normalizeRotationDeg,
} from "@legir/pdf-model/controlRotation";
import type { PdfJsAnnotation } from "../types.js";
import { pdfRefToKey } from "./export.js";
import { yieldPdfHydrationWork } from "./load.js";

export const buildPdfLibAnnotsByPageIndex = async (
  pdfDoc: PDFDocument,
  options?: {
    pageIndexes?: ReadonlySet<number>;
    signal?: AbortSignal;
    resolveDest?: (dest: unknown) => Promise<number | null>;
    readStreamText?: (stream: PDFStream) => Promise<string>;
  },
) => {
  const readStreamText = options?.readStreamText ?? createPdfStreamTextReader();
  const resolvedDestinations = new Map<string, Promise<number | null>>();
  const out = new Map<number, PdfJsAnnotation[]>();
  const pages = pdfDoc.getPages();
  const pageIndexByRefKey = new Map<string, number>();
  const pageIndexByNode = new Map<PDFDict, number>();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const pageNode = page.node;
    if (pageNode instanceof PDFDict) {
      pageIndexByNode.set(pageNode, pageIndex);
      pageIndexByRefKey.set(
        `${page.ref.objectNumber}:${page.ref.generationNumber}`,
        pageIndex,
      );
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
      return Number.isInteger(num) && num >= 0 && num < pages.length
        ? num
        : undefined;
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

  let lastAnnotationYield = performance.now();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    if (options?.pageIndexes && !options.pageIndexes.has(pageIndex)) continue;
    if (performance.now() - lastAnnotationYield > 8) {
      await yieldPdfHydrationWork();
      lastAnnotationYield = performance.now();
    }
    options?.signal?.throwIfAborted();
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
      const rawRect = pdfRectFromObj(rectObj);
      const rawInReplyTo = annot.get(PDFName.of("IRT"));
      const inReplyTo =
        rawInReplyTo instanceof PDFRef ? pdfRefToKey(rawInReplyTo) : null;
      const replyType = pdfObjToString(annot.lookup(PDFName.of("RT")));
      const rawPopup = annot.get(PDFName.of("Popup"));
      const popupRef =
        rawPopup instanceof PDFRef ? pdfRefToKey(rawPopup) : null;
      const rectOrReplyFallback =
        rawRect ??
        (inReplyTo
          ? ([0, 0, 0, 0] as [number, number, number, number])
          : undefined);

      pdfDebug("import:annotations", "annot_raw", () => ({
        pageIndex,
        annotIndex: i,
        subtypeName,
        rect: rawRect,
        inReplyTo,
        replyType,
        rectObj: summarizePdfObjForDebug(rectObj),
        sourcePdfRef,
        annot: summarizePdfObjForDebug(annot),
      }));

      if (!subtypeName) continue;

      if (!rectOrReplyFallback) continue;
      const rect = rectOrReplyFallback;

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
        const inheritedFieldFlags =
          rawFf instanceof PDFNumber ? rawFf.asNumber() : 0;
        const fieldFlags =
          fieldType === "Btn"
            ? collectFieldFlagsFromChain(annot)
            : inheritedFieldFlags;

        const rawDa = lookupInFieldChain(annot, "DA");
        const da = pdfObjToString(rawDa);

        const rawQ = lookupInFieldChain(annot, "Q");
        const textAlignment =
          rawQ instanceof PDFNumber ? rawQ.asNumber() : undefined;
        const rawVerticalAlignment = pdfObjToString(
          lookupInFieldChain(annot, "LegirVAlign"),
        );
        const verticalAlignment =
          rawVerticalAlignment === "top" ||
          rawVerticalAlignment === "middle" ||
          rawVerticalAlignment === "bottom"
            ? rawVerticalAlignment
            : undefined;

        const rawTu = lookupInFieldChain(annot, "TU");
        const tu = pdfObjToString(rawTu);
        const rawPlaceholder = lookupInFieldChain(
          annot,
          PDF_CUSTOM_KEYS.placeholder,
        );
        const placeholder = pdfObjToString(rawPlaceholder);

        const rawMaxLen = lookupInFieldChain(annot, "MaxLen");
        const maxLen =
          rawMaxLen instanceof PDFNumber &&
          Number.isInteger(rawMaxLen.asNumber()) &&
          rawMaxLen.asNumber() > 0
            ? rawMaxLen.asNumber()
            : undefined;

        const rawV = lookupInFieldChain(annot, "V");
        const fieldValue = extractFieldValue(rawV);

        const optObj = lookupInFieldChain(annot, "Opt");
        const options = extractChoiceOptions(optObj);

        const apDirect = (() => {
          try {
            return annot.lookup(PDFName.of("AP"));
          } catch {
            return undefined;
          }
        })();

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
                const apContent = await readStreamText(stream);
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
                const content = await readStreamText(stream);
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
            raw: {
              bsDirect: summarizePdfObjForDebug(readDictValue(annot, "BS")),
              bsChain: summarizePdfObjForDebug(lookupInFieldChain(annot, "BS")),
              borderDirect: summarizePdfObjForDebug(
                readDictValue(annot, "Border"),
              ),
              borderChain: summarizePdfObjForDebug(
                lookupInFieldChain(annot, "Border"),
              ),
              mkDirect: summarizePdfObjForDebug(readDictValue(annot, "MK")),
              mkChain: summarizePdfObjForDebug(lookupInFieldChain(annot, "MK")),
              apDirect: summarizePdfObjForDebug(apDirect),
            },
            ap: apInfo,
            borderWidth: finalBorderWidth,
            borderStyle: finalBorderStyle,
          }));
        }

        const isRadio = (fieldFlags & (1 << 15)) !== 0;
        const isPushButton = (fieldFlags & (1 << 16)) !== 0;
        const isBtn = fieldType === "Btn";
        const checkBox = isBtn && !isRadio && !isPushButton;
        const radioButton = isBtn && isRadio && !isPushButton;

        const buttonValue = isBtn ? extractWidgetOnValue(annot) : undefined;
        const rawWidgetRotation = (() => {
          let r: number | undefined = undefined;
          try {
            const rotateObj = annot.lookup(PDFName.of("Rotate"));
            if (rotateObj instanceof PDFNumber) r = rotateObj.asNumber();
          } catch {
            // ignore
          }

          if (typeof r !== "number") {
            try {
              const mk = annot.lookup(PDFName.of("MK"));
              if (mk instanceof PDFDict) {
                const mkR = mk.lookup(PDFName.of("R"));
                if (mkR instanceof PDFNumber) r = mkR.asNumber();
              }
            } catch {
              // ignore
            }
          }

          if (typeof r !== "number" || !Number.isFinite(r)) return undefined;
          return r;
        })();
        // An absent widget angle means zero in PDF space, not in the page's
        // displayed viewport. The page rotation still applies to its contents.
        const rotation = getControlRotationFromWidgetRotation(
          page.getRotation().angle,
          rawWidgetRotation ?? 0,
        );

        const special: Partial<PdfJsAnnotation> = {};
        if ((isBtn && isPushButton) || fieldType === "Sig") {
          const widget = PDFWidgetAnnotation.fromDict(annot);
          const ref = sourcePdfRef
            ? PDFRef.of(
                sourcePdfRef.objectNumber,
                sourcePdfRef.generationNumber,
              )
            : undefined;
          if (isBtn && isPushButton) {
            const button = new PDFButton(annot, ref ?? PDFRef.of(0), pdfDoc);
            special.pushButton = true;
            special.buttonCaption = button.getCaption(widget);
            special.buttonLayout = button.getLayout(widget);
            special.buttonImageFit = button.getImageFit(widget);
            const icon = button.getIcon(widget);
            if (icon)
              try {
                special.buttonIconPreview = await renderButtonIcon(
                  pdfDoc,
                  pageIndex,
                  icon,
                );
              } catch (error) {
                pdfDebug("import:controls", "buttonIconPreviewFailed", () => ({
                  fieldName,
                  error,
                }));
              }
          } else
            special.signature = new PDFSignature(
              annot,
              ref ?? PDFRef.of(0),
              pdfDoc,
            ).getSignatureInfo();
          if (ref)
            try {
              special.sourceAppearance = await renderWidgetAppearance(
                pdfDoc,
                pageIndex,
                widget,
                ref,
              );
            } catch (error) {
              pdfDebug("import:controls", "widgetPreviewFailed", () => ({
                fieldName,
                error,
              }));
            }
        }
        pushForPage({
          ...special,
          subtype: "Widget",
          rect,
          sourcePdfRef,
          fieldName,
          fieldType,
          fieldFlags,
          fieldValue,
          maxLen,
          alternativeText: tu,
          placeholder,
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
          verticalAlignment,
          rotation,
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

        // Explicit page references are already indexed locally. Only named or
        // otherwise unresolved destinations need a worker round trip.
        let destPageIndex: number | null | undefined =
          resolveDestPageIndexFromPdfLib(dest);
        const normalizedDest =
          destPageIndex === undefined
            ? normalizeDestForResolve(dest)
            : undefined;
        const resolveDestPageIndex = options?.resolveDest;
        if (normalizedDest !== undefined && resolveDestPageIndex) {
          const key = JSON.stringify(normalizedDest);
          let pending = resolvedDestinations.get(key);
          if (!pending) {
            pending = resolveDestPageIndex(normalizedDest);
            resolvedDestinations.set(key, pending);
          }
          destPageIndex = await pending;
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
        subtypeName !== "FreeText" &&
        subtypeName !== "Stamp" &&
        subtypeName !== "Square" &&
        subtypeName !== "Circle" &&
        subtypeName !== "Line" &&
        subtypeName !== "PolyLine" &&
        subtypeName !== "Polygon"
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
      const rawStampName = pdfObjToString(annot.lookup(PDFName.of("Name")));
      const modificationDate = pdfObjToString(annot.lookup(PDFName.of("M")));
      const annotationFlagsObj = annot.lookup(PDFName.of("F"));
      const annotationFlags =
        annotationFlagsObj instanceof PDFNumber
          ? annotationFlagsObj.asNumber()
          : undefined;
      const highlightedText = getAppHighlightedText(annot);
      const borderWidth = extractBorderWidth(annot);
      const borderStyleType = extractBorderStyle(annot);
      let finalBorderWidth: number | undefined = borderWidth;
      let finalBorderStyle: "solid" | "dashed" | "underline" | undefined =
        borderStyleType;
      let finalBorderDashArray = extractBorderDashArray(annot);
      const interiorColor = pdfArrayToNumberList(
        annot.lookup(PDFName.of("IC")),
      );
      const line = pdfArrayToNumberList(annot.lookup(PDFName.of("L")));
      const vertices = pdfArrayToNumberList(
        annot.lookup(PDFName.of("Vertices")),
      );
      const lineEndings = (() => {
        const raw = annot.lookup(PDFName.of("LE"));
        if (!(raw instanceof PDFArray)) return undefined;
        const values: string[] = [];
        for (let idx = 0; idx < raw.size(); idx++) {
          const value = pdfObjToString(raw.lookup(idx));
          if (value) values.push(value);
        }
        return values.length > 0 ? values : undefined;
      })();
      const intent = (() => {
        const raw = annot.lookup(PDFName.of("IT"));
        return pdfObjToString(raw);
      })();
      const borderEffect = (() => {
        const raw = annot.lookup(PDFName.of("BE"));
        if (!(raw instanceof PDFDict)) return undefined;
        const style = pdfObjToString(raw.lookup(PDFName.of("S")));
        const intensityObj = raw.lookup(PDFName.of("I"));
        const intensity =
          intensityObj instanceof PDFNumber
            ? intensityObj.asNumber()
            : undefined;
        if (!style && typeof intensity !== "number") return undefined;
        return { style, intensity };
      })();
      const rectDifferences = pdfArrayToNumberList(
        annot.lookup(PDFName.of("RD")),
      );
      const cloudSpacingObj = annot.lookup(
        PDFName.of(PDF_CUSTOM_KEYS.cloudSpacing),
      );
      const cloudSpacing =
        cloudSpacingObj instanceof PDFNumber
          ? cloudSpacingObj.asNumber()
          : undefined;
      const shapeFillOpacityObj = annot.lookup(
        PDFName.of(PDF_CUSTOM_KEYS.shapeFillOpacity),
      );
      const shapeFillOpacity =
        shapeFillOpacityObj instanceof PDFNumber
          ? shapeFillOpacityObj.asNumber()
          : undefined;
      const arrowSizeObj = annot.lookup(PDFName.of(PDF_CUSTOM_KEYS.arrowSize));
      const arrowSize =
        arrowSizeObj instanceof PDFNumber ? arrowSizeObj.asNumber() : undefined;
      const startArrowStyle = pdfObjToString(
        annot.lookup(PDFName.of(PDF_CUSTOM_KEYS.startArrowStyle)),
      );
      const endArrowStyle = pdfObjToString(
        annot.lookup(PDFName.of(PDF_CUSTOM_KEYS.endArrowStyle)),
      );
      const stampSourceSvgData = pdfObjToString(
        annot.lookup(PDFName.of(PDF_CUSTOM_KEYS.stampSourceSvgData)),
      );
      const stampSourceSvgSize = stampSourceSvgData
        ? getStampSvgIntrinsicSize(stampSourceSvgData)
        : undefined;
      const stampImageScaleMode = pdfObjToString(
        annot.lookup(PDFName.of(PDF_CUSTOM_KEYS.stampImageScaleMode)),
      );
      let stampImage = createStampImageResource({
        dataUrl: stampSourceSvgData ?? undefined,
        width: stampSourceSvgSize?.width,
        height: stampSourceSvgSize?.height,
      });
      let stampAppearance = createStampImageAppearance();
      let extractedStampSvg = false;
      const appearance = getAppearanceStreamMetadata(annot);
      if (subtypeName === "Stamp" && !stampImage?.dataUrl) {
        try {
          const extractedSvg = await extractStampSvgDataFromAppearance(annot);
          if (extractedSvg) {
            extractedStampSvg = true;
            if (!stampImage?.dataUrl) {
              stampImage = createStampImageResource({
                dataUrl: extractedSvg.dataUrl,
                width: extractedSvg.width,
                height: extractedSvg.height,
              });
            }
            stampImage ??= createStampImageResource({
              dataUrl: extractedSvg.dataUrl,
              width: extractedSvg.width,
              height: extractedSvg.height,
            });
            stampAppearance = createStampImageAppearance({
              frame: stampAppearance?.frame ?? "plain",
              box: stampAppearance?.box,
              // The SVG contains AP content transforms, but not the outer AP
              // matrix or page rotation. It is not a rendered-page crop.
              source: "native",
            });
          }
        } catch {
          // ignore
        }
      }
      if (!stampImage?.dataUrl && subtypeName === "Stamp") {
        try {
          const extractedStamp =
            await extractStampImageDataFromAppearance(annot);
          if (extractedStamp) {
            stampImage = createStampImageResource({
              dataUrl: extractedStamp.dataUrl,
              width: extractedStamp.imageWidth,
              height: extractedStamp.imageHeight,
            });
            stampAppearance = createStampImageAppearance({
              box: extractedStamp.imageBox,
              frame: extractedStamp.imageFrame,
              source: "native",
            });
          }
        } catch {
          // ignore
        }
      }
      if (stampSourceSvgData) {
        stampImage = createStampImageResource({
          dataUrl: stampSourceSvgData,
          width: stampImage?.intrinsicSize?.width ?? stampSourceSvgSize?.width,
          height:
            stampImage?.intrinsicSize?.height ?? stampSourceSvgSize?.height,
        });
        stampAppearance = createStampImageAppearance({
          frame: stampAppearance?.frame ?? "plain",
          box: stampAppearance?.box,
          source: "native",
        });
      }
      if (
        stampAppearance?.source === "native" &&
        (stampImageScaleMode === "contain" || stampImageScaleMode === "fill")
      ) {
        stampAppearance = createStampImageAppearance({
          ...stampAppearance,
          // The image box in the AP includes any contain-mode margins. Keep the
          // full annotation rectangle so changing mode or resizing stays editable.
          box: undefined,
          scaleMode: stampImageScaleMode,
        });
      }
      let appearanceContent: string | undefined = undefined;
      let appearanceContentLoaded = false;
      const loadAppearanceContent = async () => {
        if (appearanceContentLoaded) return appearanceContent;
        appearanceContentLoaded = true;
        if (!appearance.stream) return undefined;
        appearanceContent = await readStreamText(appearance.stream);
        return appearanceContent;
      };

      let rotation = (() => {
        let value: number | undefined = undefined;
        try {
          const rotateObj = annot.lookup(PDFName.of("Rotate"));
          if (rotateObj instanceof PDFNumber) {
            value = rotateObj.asNumber();
          }
        } catch {
          // ignore
        }

        if (typeof value !== "number") {
          try {
            const mk = annot.lookup(PDFName.of("MK"));
            if (mk instanceof PDFDict) {
              const mkR = mk.lookup(PDFName.of("R"));
              if (mkR instanceof PDFNumber) {
                value = mkR.asNumber();
              }
            }
          } catch {
            // ignore
          }
        }

        return typeof value === "number" && Number.isFinite(value)
          ? value
          : undefined;
      })();
      let appearanceRotation =
        appearance.matrix && getRotationDegFromPdfMatrix(appearance.matrix);

      if (extractedStampSvg) {
        // Internal cm operators are already baked into the extracted paths.
        // Only the outer AP matrix still needs applying to this image.
        rotation = appearanceRotation ?? 0;
        appearanceRotation = rotation;
      }

      if (
        typeof finalBorderWidth !== "number" ||
        typeof finalBorderStyle !== "string" ||
        !finalBorderDashArray ||
        typeof appearanceRotation !== "number"
      ) {
        try {
          const apContent = await loadAppearanceContent();
          if (apContent) {
            const parsedBorder = parseBorderFromAppearanceStream(apContent);
            if (
              typeof finalBorderWidth !== "number" &&
              typeof parsedBorder.width === "number"
            ) {
              finalBorderWidth = parsedBorder.width;
            }
            if (typeof finalBorderStyle !== "string" && parsedBorder.style) {
              finalBorderStyle = parsedBorder.style;
            }
            if (
              !finalBorderDashArray &&
              Array.isArray(parsedBorder.dashArray) &&
              parsedBorder.dashArray.length > 0
            ) {
              finalBorderDashArray = parsedBorder.dashArray;
            }
            if (typeof appearanceRotation !== "number") {
              appearanceRotation =
                parseRotationDegFromAppearanceContent(apContent);
            }
          }
        } catch {
          // ignore
        }
      }

      if (subtypeName === "FreeText" && appearance.stream) {
        try {
          const textRotation = await getFreeTextAppearanceRotation(
            appearance.stream,
            readStreamText,
            rectOrReplyFallback,
          );
          if (textRotation !== undefined) {
            // Match the native AP, including when /Rotate uses the opposite
            // sign. The parser applies page rotation and PDF-to-CSS conversion.
            // Keep the exact editing angle if the serialized AP differs only
            // by rounded matrix coefficients (e.g. cos(30deg) = 0.866025).
            if (
              rotation === undefined ||
              Math.abs(normalizeRotationDeg(rotation - textRotation)) > 1e-3
            ) {
              rotation = textRotation;
            }
            appearanceRotation = textRotation;
          }
        } catch {
          // Unreadable/unsupported appearances retain the metadata fallback.
        }
      }

      const base: PdfJsAnnotation = {
        subtype: subtypeName,
        rect: rectOrReplyFallback,
        sourcePdfRef,
        annotationFlags,
        color,
        interiorColor,
        opacity,
        title,
        contents,
        stamp:
          subtypeName === "Stamp"
            ? {
                name: rawStampName,
                image: stampImage,
                appearance: stampAppearance,
              }
            : undefined,
        highlightedText,
        modificationDate,
        inReplyTo,
        replyType,
        popupRef,
        borderStyle:
          typeof finalBorderWidth === "number" || finalBorderStyle
            ? {
                width: finalBorderWidth,
                style: finalBorderStyle,
                dashArray: finalBorderDashArray,
              }
            : undefined,
        intent,
        rectDifferences,
        cloudSpacing,
        shapeFillOpacity,
        arrowSize,
        startArrowStyle,
        endArrowStyle,
        rotation,
        appearanceRotation,
        appearanceSize:
          (subtypeName === "Square" || subtypeName === "Circle") &&
          appearance.bbox
            ? {
                width: Math.abs(appearance.bbox[2] - appearance.bbox[0]),
                height: Math.abs(appearance.bbox[3] - appearance.bbox[1]),
              }
            : undefined,
      };

      if (
        subtypeName === "Square" ||
        subtypeName === "Circle" ||
        subtypeName === "Line" ||
        subtypeName === "PolyLine" ||
        subtypeName === "Polygon"
      ) {
        pushForPage({
          ...base,
          line,
          vertices,
          lineEndings,
          borderEffect,
        });
        continue;
      }

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

      if (subtypeName === "Stamp") {
        pushForPage(base);
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
