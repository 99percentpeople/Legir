import {
  PDFDocument,
  rgb,
  PDFDict,
  PDFName,
  PDFString,
  PDFStream,
} from "pdf-lib";
import { PDFOutlineItem } from "../types";

// Helper to convert Hex to PDF RGB
export const hexToPdfColor = (hex: string | undefined) => {
  if (!hex) return undefined;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? rgb(
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
      )
    : undefined;
};

export const rgbArrayToHex = (
  color: number[] | Uint8ClampedArray | null | undefined,
): string | undefined => {
  if (!color || color.length < 3) return undefined;
  const toHex = (n: number) => {
    const val = Math.max(0, Math.min(255, Math.round(n)));
    return val.toString(16).padStart(2, "0");
  };
  return `#${toHex(color[0])}${toHex(color[1])}${toHex(color[2])}`;
};

export const resolveDest = async (
  pdf: any,
  dest: any,
): Promise<number | null> => {
  if (typeof dest === "string") {
    try {
      dest = await pdf.getDestination(dest);
    } catch (e) {
      return null;
    }
  }
  if (!dest || !Array.isArray(dest) || dest.length < 1) return null;
  const ref = dest[0];
  if (!ref) return null;
  try {
    if (typeof ref === "number") return ref;
    const index = await pdf.getPageIndex(ref);
    return index;
  } catch (e) {
    return null;
  }
};

export const mapOutline = async (
  pdf: any,
  items: any[],
): Promise<PDFOutlineItem[]> => {
  const mapped: PDFOutlineItem[] = [];
  for (const item of items) {
    let pageIndex: number | undefined = undefined;
    let destination = item.dest;
    if (!destination && item.action && typeof item.action === "object") {
      if (item.action.dest) destination = item.action.dest;
    }
    if (destination) {
      const idx = await resolveDest(pdf, destination);
      if (idx !== null) pageIndex = idx;
    }
    const children =
      item.items && item.items.length > 0
        ? await mapOutline(pdf, item.items)
        : [];
    mapped.push({ title: item.title, items: children, pageIndex });
  }
  return mapped;
};

// Helper to extract font map from AcroForm DR AND Page Resources to resolve /F1 -> TimesNewRoman
export const getFontMap = (pdfDoc: PDFDocument): Map<string, string> => {
  const map = new Map<string, string>();

  const processFontDict = (fontDict: PDFDict, source: string) => {
    fontDict.entries().forEach(([key, _]) => {
      const shortName = key.decodeText(); // e.g. "Helv", "F1", "/Helv"

      // Normalize key: remove leading slash if present for easier lookup
      const normalizedKey = shortName.startsWith("/")
        ? shortName.substring(1)
        : shortName;

      try {
        // .lookup() resolves references automatically in pdf-lib
        const fontObj = fontDict.lookup(key);
        if (fontObj instanceof PDFDict) {
          const baseFont = fontObj.lookup(PDFName.of("BaseFont"));
          if (baseFont instanceof PDFName) {
            const fullName = baseFont.decodeText();
            // Store both variations to be safe
            map.set(shortName, fullName);
            map.set(normalizedKey, fullName);
            map.set("/" + normalizedKey, fullName);
          }
        }
      } catch (e) {
        console.warn(`Error resolving font ${shortName} from ${source}`, e);
      }
    });
  };

  try {
    // 1. AcroForm DR (Global Resources)
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    if (acroForm instanceof PDFDict) {
      const dr = acroForm.lookup(PDFName.of("DR"));
      if (dr instanceof PDFDict) {
        const fontDict = dr.lookup(PDFName.of("Font"));
        if (fontDict instanceof PDFDict) processFontDict(fontDict, "AcroForm");
      }
    }

    // 2. Scan Pages Resources (Fallback or Local Resources)
    // Limit to first 3 pages to avoid performance hit on huge docs
    const pages = pdfDoc.getPages();
    for (let i = 0; i < Math.min(pages.length, 3); i++) {
      try {
        const resources = pages[i].node.Resources();
        if (resources instanceof PDFDict) {
          const fontDict = resources.lookup(PDFName.of("Font"));
          if (fontDict instanceof PDFDict)
            processFontDict(fontDict, `Page ${i + 1}`);
        }
      } catch (e) {
        /* Ignore page resource errors */
      }
    }
  } catch (e) {
    console.warn("Failed to extract font map", e);
  }

  console.debug("[PDF Import] Extracted Font Map:", map);
  return map;
};

// Helper to get Global Default Appearance from AcroForm
export const getGlobalDA = (pdfDoc: PDFDocument): string | undefined => {
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    if (acroForm instanceof PDFDict) {
      const da = acroForm.lookup(PDFName.of("DA"));
      if (da instanceof PDFString) {
        return da.decodeText();
      }
    }
  } catch (e) {
    return undefined;
  }
  return undefined;
};

// Robust Token-based Parser for Default Appearance String
export const parseDefaultAppearance = (
  da: string,
  fontMap: Map<string, string>,
) => {
  const style = {
    fontFamily: "Helvetica",
    fontSize: 12,
    textColor: "#000000",
  };

  if (!da || !da.trim()) return style;

  // Split by whitespace to get tokens
  const tokens = da.trim().split(/\s+/);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Font Operator: /Name size Tf
    if (token === "Tf" && i >= 2) {
      const size = parseFloat(tokens[i - 1]);
      let fontName = tokens[i - 2];

      if (!isNaN(size)) {
        style.fontSize = size > 0 ? size : 12;
      }

      // Clean font name (remove leading /)
      if (fontName.startsWith("/")) fontName = fontName.substring(1);

      // Resolve
      const resolvedFontName =
        fontMap.get(fontName) || fontMap.get("/" + fontName) || fontName;
      const lowerName = resolvedFontName.toLowerCase();

      if (
        lowerName.includes("tiro") ||
        lowerName.includes("times") ||
        lowerName.includes("serif") ||
        lowerName.includes("roman") ||
        lowerName.includes("minion") ||
        lowerName.includes("garamond")
      ) {
        style.fontFamily = "Times Roman";
      } else if (
        lowerName.includes("cour") ||
        lowerName.includes("mono") ||
        lowerName.includes("code")
      ) {
        style.fontFamily = "Courier";
      } else {
        // Includes Arial, Helvetica, Sans-Serif
        style.fontFamily = "Helvetica";
      }
    }
    // RGB Color Operator: r g b rg (or RG)
    else if ((token === "rg" || token === "RG") && i >= 3) {
      const r = parseFloat(tokens[i - 3]);
      const g = parseFloat(tokens[i - 2]);
      const b = parseFloat(tokens[i - 1]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        style.textColor =
          rgbArrayToHex([r * 255, g * 255, b * 255]) || "#000000";
      }
    }
    // Grayscale Operator: g g (or G)
    else if ((token === "g" || token === "G") && i >= 1) {
      const gray = parseFloat(tokens[i - 1]);
      if (!isNaN(gray)) {
        const val = gray * 255;
        style.textColor = rgbArrayToHex([val, val, val]) || "#000000";
      }
    }
    // CMYK Color Operator: c m y k k (or K)
    else if ((token === "k" || token === "K") && i >= 4) {
      const c = parseFloat(tokens[i - 4]);
      const m = parseFloat(tokens[i - 3]);
      const y = parseFloat(tokens[i - 2]);
      const k = parseFloat(tokens[i - 1]);

      if (!isNaN(c) && !isNaN(m) && !isNaN(y) && !isNaN(k)) {
        const r = 255 * (1 - c) * (1 - k);
        const g = 255 * (1 - m) * (1 - k);
        const b = 255 * (1 - y) * (1 - k);
        style.textColor = rgbArrayToHex([r, g, b]) || "#000000";
      }
    }
  }

  return style;
};

// New Helper: Get authoritative DA and Q from pdf-lib for a named field
export const getFieldPropertiesFromPdfLib = (
  pdfDoc: PDFDocument,
  fieldName: string,
) => {
  try {
    const form = pdfDoc.getForm();
    const field = form.getField(fieldName);
    if (!field) return null;

    const rawDa = field.acroField.dict.lookup(PDFName.of("DA"));
    const rawQ = field.acroField.dict.lookup(PDFName.of("Q"));

    let da: string | undefined = undefined;
    let q: number | undefined = undefined;

    if (rawDa instanceof PDFString) {
      da = rawDa.decodeText();
    }
    if (typeof rawQ === "number") {
      // Direct number sometimes?
      q = rawQ;
    } else if (rawQ && (rawQ as any).numberValue) {
      // PDFNumber
      q = (rawQ as any).numberValue;
    }

    return { da, q };
  } catch (e) {
    return null;
  }
};

export const generateInkAppearanceOps = (
  points: { x: number; y: number }[],
  color: { red: number; green: number; blue: number },
  thickness: number,
) => {
  if (points.length < 2) return undefined;

  const operators: string[] = [];

  // Set graphics state
  operators.push(`${color.red} ${color.green} ${color.blue} RG`); // Stroke Color
  operators.push(`${thickness} w`); // Line Width
  operators.push(`1 J`); // Round Cap
  operators.push(`1 j`); // Round Join

  // Draw path
  operators.push(`${points[0].x} ${points[0].y} m`); // Move to start

  if (points.length === 2) {
    operators.push(`${points[1].x} ${points[1].y} l`);
  } else {
    let currentPoint = points[0];

    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i]; // Control point
      const nextP = points[i + 1];
      const midX = (p.x + nextP.x) / 2;
      const midY = (p.y + nextP.y) / 2;
      const mid = { x: midX, y: midY }; // End point

      // Convert Q(currentPoint, p, mid) to C
      // cp1 = start + (2/3)*(cp - start)
      // cp2 = mid + (2/3)*(cp - mid)

      const cp1x = currentPoint.x + (2 / 3) * (p.x - currentPoint.x);
      const cp1y = currentPoint.y + (2 / 3) * (p.y - currentPoint.y);
      const cp2x = mid.x + (2 / 3) * (p.x - mid.x);
      const cp2y = mid.y + (2 / 3) * (p.y - mid.y);

      operators.push(`${cp1x} ${cp1y} ${cp2x} ${cp2y} ${mid.x} ${mid.y} c`);

      currentPoint = mid;
    }

    const lastP = points[points.length - 1];
    operators.push(`${lastP.x} ${lastP.y} l`);
  }

  operators.push(`S`); // Stroke

  return operators.join("\n");
};

export const extractInkAppearance = (
  annot: PDFDict,
  transformPoint: (x: number, y: number) => [number, number],
): { strokePaths: string[]; rawStrokeStreams: string[] } => {
  const strokePaths: string[] = [];
  const rawStrokeStreams: string[] = [];
  try {
    const AP = annot.lookup(PDFName.of("AP"));
    if (AP instanceof PDFDict) {
      const N = AP.lookup(PDFName.of("N"));
      if (N instanceof PDFStream) {
        const contents = N.getContents();
        const str = new TextDecoder().decode(contents);

        // Simple parser for PDF path operators (m, l, c)
        // Assumes the stream is uncompressed (which we ensure for our exports)
        // and follows the structure m ... (l|c) ... S
        const ops = str.split("\n");
        let currentPath = "";
        let currentRawOps: string[] = [];

        for (const op of ops) {
          const parts = op.trim().split(/\s+/);
          if (parts.length === 0) continue;
          const cmd = parts[parts.length - 1];

          if (cmd === "m" && parts.length >= 3) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            const [vx, vy] = transformPoint(x, y);
            currentPath += `M ${vx} ${vy} `;
            currentRawOps.push(op);
          } else if (cmd === "l" && parts.length >= 3) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            const [vx, vy] = transformPoint(x, y);
            currentPath += `L ${vx} ${vy} `;
            currentRawOps.push(op);
          } else if (cmd === "c" && parts.length >= 7) {
            const [x1, y1] = transformPoint(
              parseFloat(parts[0]),
              parseFloat(parts[1]),
            );
            const [x2, y2] = transformPoint(
              parseFloat(parts[2]),
              parseFloat(parts[3]),
            );
            const [x3, y3] = transformPoint(
              parseFloat(parts[4]),
              parseFloat(parts[5]),
            );
            currentPath += `C ${x1} ${y1} ${x2} ${y2} ${x3} ${y3} `;
            currentRawOps.push(op);
          } else if (cmd === "S") {
            if (currentPath) {
              strokePaths.push(currentPath.trim());
              currentPath = "";
              currentRawOps.push(op);
              rawStrokeStreams.push(currentRawOps.join("\n"));
              currentRawOps = [];
            }
          }
        }
        // Catch-all if S is missing but path exists
        if (currentPath.trim()) {
          strokePaths.push(currentPath.trim());
          if (currentRawOps.length > 0) {
            if (!currentRawOps[currentRawOps.length - 1].endsWith("S")) {
              currentRawOps.push("S");
            }
            rawStrokeStreams.push(currentRawOps.join("\n"));
          }
        }
      }
    }
  } catch (e) {
    // Ignore AP parsing errors (e.g. compressed stream or invalid format)
    // We will fall back to points
  }
  return { strokePaths, rawStrokeStreams };
};
