import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFStream,
  PDFString,
} from "@cantoo/pdf-lib";
import type { PdfJsAnnotationOption } from "../types";
import { decodePdfString } from "./pdf-objects";

/**
 * Utilities for importing/parsing PDF objects (mostly from `pdf-lib` structures)
 * into our internal representation.
 *
 * Keep these helpers pure (no global state) so `index.ts` can stay focused on
 * the higher-level pipeline logic.
 */

/**
 * Best-effort conversion of common PDF object types to a displayable string.
 */
export const pdfObjToString = (obj: unknown): string | undefined => {
  if (obj instanceof PDFName) return obj.decodeText();
  if (obj instanceof PDFString || obj instanceof PDFHexString)
    return obj.decodeText();
  return decodePdfString(obj);
};

/**
 * Produces a stable, JSON-friendly summary of a PDF object for debug logging.
 */
export const summarizePdfObjForDebug = (obj: unknown): unknown => {
  try {
    if (obj === undefined) return undefined;
    if (obj === null) return null;

    if (obj instanceof PDFName)
      return { type: "PDFName", value: obj.decodeText() };
    if (obj instanceof PDFNumber)
      return { type: "PDFNumber", value: obj.asNumber() };
    if (obj instanceof PDFBool)
      return { type: "PDFBool", value: obj.asBoolean() };
    if (obj instanceof PDFString || obj instanceof PDFHexString)
      return { type: obj.constructor.name, value: obj.decodeText() };

    if (obj instanceof PDFArray) {
      const out: unknown[] = [];
      for (let i = 0; i < Math.min(obj.size(), 12); i++) {
        out.push(summarizePdfObjForDebug(obj.lookup(i)));
      }
      return { type: "PDFArray", size: obj.size(), items: out };
    }

    if (obj instanceof PDFDict) {
      const keys: string[] = [];
      for (const [k] of obj.entries()) {
        keys.push(k.decodeText());
        if (keys.length >= 30) break;
      }
      return { type: "PDFDict", keys };
    }

    const unknownObj = obj as {
      constructor?: { name?: string };
      toString?: () => string;
    };

    return {
      type: unknownObj.constructor?.name ?? typeof obj,
      value: unknownObj.toString?.(),
    };
  } catch {
    return { type: "unknown" };
  }
};

/**
 * Extracts stream `Filter` / `DecodeParms` names from a PDF stream.
 * Used for debugging and to decide whether we can try client-side decompression.
 */
export const extractPdfStreamFilters = (stream: PDFStream): string[] => {
  try {
    const filter = stream.dict.lookup(PDFName.of("Filter"));
    if (filter instanceof PDFName) {
      return [filter.decodeText().replace(/^\//, "")];
    }
    if (filter instanceof PDFArray) {
      const out: string[] = [];
      for (let i = 0; i < filter.size(); i++) {
        const item = filter.lookup(i);
        if (item instanceof PDFName) {
          out.push(item.decodeText().replace(/^\//, ""));
        }
      }
      return out;
    }
  } catch {
    // ignore
  }
  return [];
};

/**
 * Best-effort decoding of a PDF appearance/content stream into text.
 *
 * Notes:
 * - We only attempt decompression for FlateDecode and only if
 *   `DecompressionStream` is available in the runtime.
 */
export const decodePdfStreamToText = async (
  stream: PDFStream,
): Promise<string> => {
  const bytes = stream.getContents();
  const safeBytes = new Uint8Array(bytes);
  const filters = extractPdfStreamFilters(stream);

  let decodedBytes: Uint8Array = safeBytes;

  const g = globalThis as unknown as { DecompressionStream?: unknown };
  if (
    filters.includes("FlateDecode") &&
    typeof g.DecompressionStream !== "undefined"
  ) {
    const tryInflate = async (format: "deflate" | "deflate-raw") => {
      const DS = g.DecompressionStream as unknown as new (
        fmt: string,
      ) => DecompressionStream;
      const ds = new DS(format);
      const decompressed = await new Response(
        new Blob([safeBytes]).stream().pipeThrough(ds),
      ).arrayBuffer();
      return new Uint8Array(decompressed);
    };

    try {
      decodedBytes = await tryInflate("deflate");
    } catch {
      try {
        decodedBytes = await tryInflate("deflate-raw");
      } catch {
        decodedBytes = safeBytes;
      }
    }
  }

  try {
    return new TextDecoder().decode(decodedBytes);
  } catch {
    return "";
  }
};

/**
 * Heuristic border parser for appearance streams.
 *
 * Looks for a rectangle op (`re`) followed by a stroke op, then infers:
 * - width from the last `w`
 * - style from presence of `d` (dash array)
 */
export const parseBorderFromAppearanceStream = (
  content: string,
): { width?: number; style?: "solid" | "dashed" } => {
  // Conservative heuristic:
  // - Require a rectangle path op ('re') and a subsequent stroke op ('s'/'S'/'b'/'B')
  // - Width comes from last 'w' operator, defaulting to 1 when stroking occurs
  // - Dashed if any 'd' operator is present
  let sawRect = false;
  let sawStrokeAfterRect = false;
  let sawDash = false;
  let lastLineWidth: number | undefined = undefined;

  const lines = content.split(/\r\n|\r|\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length === 0) continue;
    const op = parts[parts.length - 1];

    if (op === "w" && parts.length >= 2) {
      const v = parseFloat(parts[0]);
      if (!Number.isNaN(v) && Number.isFinite(v)) lastLineWidth = v;
      continue;
    }

    if (op === "d") {
      sawDash = true;
      continue;
    }

    if (op === "re" && parts.length >= 5) {
      // x y w h re
      const nums = parts.slice(0, parts.length - 1).map((x) => parseFloat(x));
      if (
        nums.length >= 4 &&
        nums.slice(0, 4).every((n) => Number.isFinite(n))
      ) {
        sawRect = true;
      }
      continue;
    }

    if (op === "S" || op === "s" || op === "B" || op === "b") {
      if (sawRect) sawStrokeAfterRect = true;
      continue;
    }
  }

  if (!sawStrokeAfterRect) return {};
  return {
    width: typeof lastLineWidth === "number" ? lastLineWidth : 1,
    style: sawDash ? "dashed" : "solid",
  };
};

/**
 * Converts a PDFArray of numbers into a plain `number[]`.
 */
export const pdfArrayToNumberList = (obj: unknown): number[] | undefined => {
  if (!(obj instanceof PDFArray)) return undefined;
  const out: number[] = [];
  for (let i = 0; i < obj.size(); i++) {
    const v = obj.lookup(i);
    if (v instanceof PDFNumber) out.push(v.asNumber());
  }
  return out.length > 0 ? out : undefined;
};

/**
 * Reads a PDF `Rect` array into a tuple.
 */
export const pdfRectFromObj = (
  rectObj: unknown,
): [number, number, number, number] | undefined => {
  const nums = pdfArrayToNumberList(rectObj);
  if (!nums || nums.length < 4) return undefined;
  return [nums[0], nums[1], nums[2], nums[3]];
};

/**
 * Looks up a key on a widget/field dict, walking the Parent chain.
 */
export const lookupInFieldChain = (
  start: PDFDict,
  key: string,
): unknown | undefined => {
  let cur: PDFDict | undefined = start;
  for (let depth = 0; depth < 20 && cur; depth++) {
    try {
      const v = cur.lookup(PDFName.of(key));
      if (v !== undefined) return v;
    } catch {
      // ignore
    }

    try {
      const parent = cur.lookup(PDFName.of("Parent"));
      if (parent instanceof PDFDict) {
        cur = parent;
        continue;
      }
    } catch {
      // ignore
    }
    break;
  }
  return undefined;
};

/**
 * Extracts widget border style from BS/Border entries.
 */
export const extractBorderStyle = (
  widgetDict: PDFDict,
): "solid" | "dashed" | "underline" | undefined => {
  // Strict mode: only parse style when explicitly present.
  try {
    const bs = lookupInFieldChain(widgetDict, "BS");
    if (bs instanceof PDFDict) {
      const s = bs.lookup(PDFName.of("S"));
      if (s instanceof PDFName) {
        const v = s.decodeText();
        if (v === "D") return "dashed";
        if (v === "U") return "underline";
        if (v === "S" || v === "B" || v === "I") return "solid";
      }
    }
  } catch {
    // ignore
  }

  try {
    const border = lookupInFieldChain(widgetDict, "Border");
    if (border instanceof PDFArray && border.size() >= 4) {
      const dash = border.lookup(3);
      if (dash instanceof PDFArray && dash.size() > 0) return "dashed";
      if (dash instanceof PDFArray && dash.size() === 0) return "solid";
    }
  } catch {
    // ignore
  }

  return undefined;
};

/**
 * Builds a full field name by joining `T` values along the Parent chain.
 */
export const buildFullFieldNameFromChain = (
  start: PDFDict,
): string | undefined => {
  const parts: string[] = [];
  let cur: PDFDict | undefined = start;
  for (let depth = 0; depth < 20 && cur; depth++) {
    try {
      const t = pdfObjToString(cur.lookup(PDFName.of("T")));
      if (t) parts.unshift(t);
    } catch {
      // ignore
    }

    try {
      const parent = cur.lookup(PDFName.of("Parent"));
      if (parent instanceof PDFDict) {
        cur = parent;
        continue;
      }
    } catch {
      // ignore
    }
    break;
  }

  if (parts.length === 0) return undefined;
  return parts.join(".");
};

/**
 * Determines the widget's "on" value for checkbox/radio buttons.
 */
export const extractWidgetOnValue = (
  widgetDict: PDFDict,
): string | undefined => {
  try {
    const ap = widgetDict.lookup(PDFName.of("AP"));
    if (!(ap instanceof PDFDict)) return undefined;
    const n = ap.lookup(PDFName.of("N"));
    if (!(n instanceof PDFDict)) return undefined;

    for (const [k] of n.entries()) {
      const name = k.decodeText();
      if (name && name !== "Off") return name;
    }
  } catch {
    // ignore
  }

  try {
    const as = widgetDict.lookup(PDFName.of("AS"));
    const asStr = pdfObjToString(as);
    if (asStr && asStr !== "Off") return asStr;
  } catch {
    // ignore
  }

  return undefined;
};

/**
 * Extracts widget border width from BS/Border entries.
 */
export const extractBorderWidth = (widgetDict: PDFDict): number | undefined => {
  // Strict mode: only parse width when explicitly present.
  try {
    const bs = lookupInFieldChain(widgetDict, "BS");
    if (bs instanceof PDFDict) {
      const w = bs.lookup(PDFName.of("W"));
      if (w instanceof PDFNumber) return w.asNumber();
    }
  } catch {
    // ignore
  }

  try {
    const border = lookupInFieldChain(widgetDict, "Border");
    if (border instanceof PDFArray && border.size() >= 3) {
      const w = border.lookup(2);
      if (w instanceof PDFNumber) return w.asNumber();
    }
  } catch {
    // ignore
  }

  return undefined;
};

/**
 * Extracts MK appearance colors (border/background), normalizing grayscale.
 */
export const extractMkColor = (
  widgetDict: PDFDict,
  key: "BC" | "BG",
): number[] | undefined => {
  try {
    const mk = lookupInFieldChain(widgetDict, "MK");
    if (!(mk instanceof PDFDict)) return undefined;
    const c = mk.lookup(PDFName.of(key));
    const nums = pdfArrayToNumberList(c);
    if (!nums) return undefined;
    if (nums.length === 1) return [nums[0], nums[0], nums[0]];
    return nums;
  } catch {
    return undefined;
  }
};

/**
 * Parses choice field options from `/Opt`.
 */
export const extractChoiceOptions = (
  optObj: unknown,
): PdfJsAnnotationOption[] | undefined => {
  if (!(optObj instanceof PDFArray)) return undefined;
  const out: PdfJsAnnotationOption[] = [];

  for (let i = 0; i < optObj.size(); i++) {
    const item = optObj.lookup(i);
    if (item instanceof PDFString || item instanceof PDFHexString) {
      out.push(item.decodeText());
      continue;
    }

    if (item instanceof PDFArray) {
      const exportValue = pdfObjToString(item.lookup(0));
      const display = pdfObjToString(item.lookup(1));
      out.push({ display, exportValue });
      continue;
    }
  }

  return out.length > 0 ? out : undefined;
};

/**
 * Parses a field value (`/V`) into a JS value.
 */
export const extractFieldValue = (vObj: unknown): unknown => {
  if (vObj instanceof PDFName) return vObj.decodeText();
  if (vObj instanceof PDFString || vObj instanceof PDFHexString)
    return vObj.decodeText();
  if (vObj instanceof PDFArray) {
    const vals: string[] = [];
    for (let i = 0; i < vObj.size(); i++) {
      const item = vObj.lookup(i);
      const s = pdfObjToString(item);
      if (s) vals.push(s);
    }
    return vals;
  }
  return undefined;
};
