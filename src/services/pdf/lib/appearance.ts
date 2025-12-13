import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import { rgbArrayToHex } from "./colors";
import { pdfDebug } from "./debug";
import { normalizePdfFontName } from "./pdf-font-names";
import { decodePdfString } from "./pdf-objects";

export const getFontMap = (pdfDoc: PDFDocument): Map<string, string> => {
  const map = new Map<string, string>();

  const processFontDict = (fontDict: PDFDict, source: string) => {
    fontDict.entries().forEach(([key, _]) => {
      const shortName = key.decodeText();
      const normalizedKey = normalizePdfFontName(shortName);

      try {
        const fontObj = fontDict.lookup(key);
        if (fontObj instanceof PDFDict) {
          const baseFont = fontObj.lookup(PDFName.of("BaseFont"));
          if (baseFont instanceof PDFName) {
            const fullName = baseFont.decodeText();
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
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    if (acroForm instanceof PDFDict) {
      const dr = acroForm.lookup(PDFName.of("DR"));
      if (dr instanceof PDFDict) {
        const fontDict = dr.lookup(PDFName.of("Font"));
        if (fontDict instanceof PDFDict) processFontDict(fontDict, "AcroForm");
      }
    }

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

  pdfDebug("import:fonts", "font_map_extracted", {
    size: map.size,
    entries: Array.from(map.entries()),
  });
  return map;
};

export const getGlobalDA = (pdfDoc: PDFDocument): string | undefined => {
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    if (acroForm instanceof PDFDict) {
      const da = acroForm.lookup(PDFName.of("DA"));
      return decodePdfString(da);
    }
  } catch (e) {
    return undefined;
  }
  return undefined;
};

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

  const tokens = da.trim().split(/\s+/);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "Tf" && i >= 2) {
      const size = parseFloat(tokens[i - 1]);
      let fontName = normalizePdfFontName(tokens[i - 2]);

      if (!isNaN(size)) {
        style.fontSize = size > 0 ? size : 12;
      }

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
        style.fontFamily = "Helvetica";
      }
    } else if ((token === "rg" || token === "RG") && i >= 3) {
      const r = parseFloat(tokens[i - 3]);
      const g = parseFloat(tokens[i - 2]);
      const b = parseFloat(tokens[i - 1]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        style.textColor =
          rgbArrayToHex([r * 255, g * 255, b * 255]) || "#000000";
      }
    } else if ((token === "g" || token === "G") && i >= 1) {
      const gray = parseFloat(tokens[i - 1]);
      if (!isNaN(gray)) {
        const val = gray * 255;
        style.textColor = rgbArrayToHex([val, val, val]) || "#000000";
      }
    } else if ((token === "k" || token === "K") && i >= 4) {
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

    da = decodePdfString(rawDa);
    if (typeof rawQ === "number") {
      q = rawQ;
    } else if (rawQ && (rawQ as any).numberValue) {
      q = (rawQ as any).numberValue;
    }

    return { da, q };
  } catch (e) {
    return null;
  }
};
