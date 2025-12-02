import * as pdfjsLib from "pdfjs-dist";
import {
  PDFDocument,
  rgb,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  StandardFonts,
  TextAlignment,
  PDFName,
  PDFString,
  PDFSignature,
  PDFDict,
  PDFArray,
  PDFNumber,
} from "pdf-lib";
import {
  FormField,
  FieldType,
  PageData,
  FieldStyle,
  PDFMetadata,
  PDFOutlineItem,
  Annotation,
} from "../types";
import { DEFAULT_FIELD_STYLE } from "../constants";

// Helper to convert Hex to PDF RGB
const hexToPdfColor = (hex: string | undefined) => {
  if (!hex) return undefined;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? rgb(
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255
      )
    : undefined;
};

const rgbArrayToHex = (
  color: number[] | Uint8ClampedArray | null | undefined
): string | undefined => {
  if (!color || color.length < 3) return undefined;
  const toHex = (n: number) => {
    const val = Math.max(0, Math.min(255, Math.round(n)));
    return val.toString(16).padStart(2, "0");
  };
  return `#${toHex(color[0])}${toHex(color[1])}${toHex(color[2])}`;
};

const resolveDest = async (pdf: any, dest: any): Promise<number | null> => {
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

const mapOutline = async (
  pdf: any,
  items: any[]
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
const getFontMap = (pdfDoc: PDFDocument): Map<string, string> => {
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

  console.log("[PDF Import] Extracted Font Map:", map);
  return map;
};

// Helper to get Global Default Appearance from AcroForm
const getGlobalDA = (pdfDoc: PDFDocument): string | undefined => {
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
const parseDefaultAppearance = (da: string, fontMap: Map<string, string>) => {
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
const getFieldPropertiesFromPdfLib = (
  pdfDoc: PDFDocument,
  fieldName: string
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

export const loadPDF = async (
  input: File | Uint8Array
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

  // 1. Load with pdf-lib to get robust resource mapping and global defaults
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

  // 2. Load with pdf.js for rendering and basic annotation extraction
  const renderBuffer = new Uint8Array(pdfBytes.slice(0));
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
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const pageAnnotations = await page.getAnnotations();
    if (pageAnnotations.length > 0) {
      console.log(`[Debug] Page ${i} Annotations:`, pageAnnotations);
    }

    // Extract Ink Annotations using pdf-lib (more robust access to raw data)
    if (pdfDoc) {
      try {
        const pdfLibPage = pdfDoc.getPage(i - 1);
        const annots = pdfLibPage.node.Annots();

        if (annots instanceof PDFArray) {
          for (let idx = 0; idx < annots.size(); idx++) {
            const annot = annots.lookup(idx);
            if (annot instanceof PDFDict) {
              const subtype = annot.lookup(PDFName.of("Subtype"));
              if (subtype === PDFName.of("Ink")) {
                const inkList = annot.lookup(PDFName.of("InkList"));
                if (inkList instanceof PDFArray) {
                  // Parse Color
                  let color = "#000000";
                  const c = annot.lookup(PDFName.of("C")); // C is Color in PDF Spec
                  if (c instanceof PDFArray && c.size() === 3) {
                    const r = (c.lookup(0) as PDFNumber).asNumber();
                    const g = (c.lookup(1) as PDFNumber).asNumber();
                    const b = (c.lookup(2) as PDFNumber).asNumber();
                    color =
                      rgbArrayToHex([r * 255, g * 255, b * 255]) || "#000000";
                  }

                  // Parse Thickness (BS -> W) or Border -> W
                  let thickness = 2;
                  const bs = annot.lookup(PDFName.of("BS"));
                  if (bs instanceof PDFDict) {
                    const w = bs.lookup(PDFName.of("W"));
                    if (w instanceof PDFNumber) thickness = w.asNumber();
                  } else {
                    const border = annot.lookup(PDFName.of("Border"));
                    if (border instanceof PDFArray && border.size() >= 3) {
                      const w = border.lookup(2);
                      if (w instanceof PDFNumber) thickness = w.asNumber();
                    }
                  }

                  // Parse Opacity (CA/ca)
                  let opacity = 1.0;
                  const CA = annot.lookup(PDFName.of("CA"));
                  const ca = annot.lookup(PDFName.of("ca"));
                  if (CA instanceof PDFNumber) opacity = CA.asNumber();
                  else if (ca instanceof PDFNumber) opacity = ca.asNumber();

                  // Parse Intent (IT)
                  let intent: string | undefined = undefined;
                  const IT = annot.lookup(PDFName.of("IT"));
                  if (IT instanceof PDFName) intent = IT.decodeText();
                  else if (IT instanceof PDFString) intent = IT.decodeText();

                  // Parse Points
                  for (let s = 0; s < inkList.size(); s++) {
                    const stroke = inkList.lookup(s);
                    if (stroke instanceof PDFArray) {
                      const points: { x: number; y: number }[] = [];
                      for (let p = 0; p < stroke.size(); p += 2) {
                        const px = (stroke.lookup(p) as PDFNumber).asNumber();
                        const py = (
                          stroke.lookup(p + 1) as PDFNumber
                        ).asNumber();
                        const [vx, vy] =
                          unscaledViewport.convertToViewportPoint(px, py);
                        points.push({ x: vx, y: vy });
                      }

                      if (points.length > 0) {
                        annotations.push({
                          id: `imported_ink_lib_${i}_${idx}_${s}`,
                          pageIndex: i - 1,
                          type: "ink",
                          subtype: "ink",
                          intent: intent,
                          points: points,
                          color: color,
                          thickness: thickness,
                          opacity: opacity,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn(
          `Failed to extract Ink annotations from page ${i} using pdf-lib`,
          e
        );
      }
    }

    pageAnnotations.forEach((annotation: any, index: number) => {
      const subtype = annotation.subtype;
      // Skip Ink in pdf.js loop since we handle it via pdf-lib
      const isInk = false;
      const isPolyLine = subtype === "PolyLine" || subtype === "polyline";
      const isLine = subtype === "Line" || subtype === "line";

      if (isInk || isPolyLine || isLine) {
        let strokeLists: any[] = [];

        if (isInk && Array.isArray(annotation.inkList)) {
          strokeLists = annotation.inkList;
        } else if (isPolyLine && Array.isArray(annotation.vertices)) {
          // PolyLine has a single array of vertices
          strokeLists = [annotation.vertices];
        } else if (isLine && Array.isArray(annotation.lineCoordinates)) {
          // Line has [x1, y1, x2, y2]
          strokeLists = [annotation.lineCoordinates];
        }

        const color = annotation.color
          ? rgbArrayToHex(annotation.color)
          : "#000000";
        const thickness = annotation.borderStyle?.width || 2;

        strokeLists.forEach((pointsList: any[], strokeIndex: number) => {
          if (!Array.isArray(pointsList) || pointsList.length === 0) return;

          const points: { x: number; y: number }[] = [];

          // Handle flat array [x1, y1, x2, y2...] vs object array [{x,y}, {x,y}...]
          if (pointsList.length > 0 && typeof pointsList[0] === "number") {
            for (let k = 0; k < pointsList.length; k += 2) {
              const px = pointsList[k];
              const py = pointsList[k + 1];
              if (typeof px === "number" && typeof py === "number") {
                const [vx, vy] = unscaledViewport.convertToViewportPoint(
                  px,
                  py
                );
                points.push({ x: vx, y: vy });
              }
            }
          } else {
            // Assume objects {x, y}
            pointsList.forEach((p: any) => {
              const px = typeof p.x === "number" ? p.x : 0;
              const py = typeof p.y === "number" ? p.y : 0;
              const [vx, vy] = unscaledViewport.convertToViewportPoint(px, py);
              points.push({ x: vx, y: vy });
            });
          }

          if (points.length > 0) {
            annotations.push({
              id: `imported_ink_${i}_${index}_${strokeIndex}`,
              pageIndex: i - 1,
              type: "ink",
              subtype: isPolyLine ? "polyline" : isLine ? "line" : "ink",
              points: points,
              color: color,
              thickness: thickness,
            });
          }
        });
      } else if (subtype === "Highlight" || subtype === "highlight") {
        const color = annotation.color
          ? rgbArrayToHex(annotation.color)
          : "#FFFF00";
        const [x1, y1, x2, y2] = annotation.rect;
        const [vx1, vy1] = unscaledViewport.convertToViewportPoint(x1, y1);
        const [vx2, vy2] = unscaledViewport.convertToViewportPoint(x2, y2);

        // Normalize rect (min/max) because rotation might flip coordinates
        const x = Math.min(vx1, vx2);
        const y = Math.min(vy1, vy2);
        const width = Math.abs(vx2 - vx1);
        const height = Math.abs(vy2 - vy1);

        // Process QuadPoints if available (for multi-line highlights)
        let rects:
          | { x: number; y: number; width: number; height: number }[]
          | undefined = undefined;

        // Try to get QuadPoints from PDF.js annotation or fallback to PDF-lib lookup
        let qp = annotation.quadPoints;

        if (!qp || !Array.isArray(qp) || qp.length === 0) {
          try {
            const pdfLibPage = pdfDoc.getPage(i - 1);
            const libAnnots = pdfLibPage.node.Annots();
            if (libAnnots instanceof PDFArray) {
              for (let idx = 0; idx < libAnnots.size(); idx++) {
                const libAnnot = libAnnots.lookup(idx);
                if (libAnnot instanceof PDFDict) {
                  const libSubtype = libAnnot.lookup(PDFName.of("Subtype"));
                  if (libSubtype === PDFName.of("Highlight")) {
                    const libRect = libAnnot.lookup(PDFName.of("Rect"));
                    if (libRect instanceof PDFArray) {
                      // Simple check: match the first coordinate approximately
                      // We use loose epsilon because of potential float diffs
                      const rArray = libRect.asArray();
                      if (rArray.length >= 4) {
                        const lx1 = (rArray[0] as PDFNumber).asNumber();
                        const ly1 = (rArray[1] as PDFNumber).asNumber();
                        // Check if this matches our annotation.rect [x1, y1, x2, y2] (PDF coords)
                        if (Math.abs(lx1 - x1) < 1 && Math.abs(ly1 - y1) < 1) {
                          const libQP = libAnnot.lookup(
                            PDFName.of("QuadPoints")
                          );
                          if (libQP instanceof PDFArray) {
                            qp = libQP
                              .asArray()
                              .map((n) => (n as PDFNumber).asNumber());
                            break;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn("Fallback QuadPoints extraction failed", e);
          }
        }

        if (qp && Array.isArray(qp)) {
          rects = [];
          // Each quad has 8 coordinates (4 points * 2 coords)
          for (let k = 0; k < qp.length; k += 8) {
            let minVX = Infinity,
              minVY = Infinity,
              maxVX = -Infinity,
              maxVY = -Infinity;

            // Iterate through the 4 points of the quad
            for (let p = 0; p < 8; p += 2) {
              const qx = qp[k + p];
              const qy = qp[k + p + 1];
              const [vx, vy] = unscaledViewport.convertToViewportPoint(qx, qy);
              minVX = Math.min(minVX, vx);
              minVY = Math.min(minVY, vy);
              maxVX = Math.max(maxVX, vx);
              maxVY = Math.max(maxVY, vy);
            }

            if (minVX !== Infinity) {
              rects.push({
                x: minVX,
                y: minVY,
                width: maxVX - minVX,
                height: maxVY - minVY,
              });
            }
          }
        }

        // Try to parse opacity from CA (fill alpha) in the annotation dict
        let opacity = 1.0;
        try {
          const pdfLibPage = pdfDoc.getPage(i - 1);
          const libAnnots = pdfLibPage.node.Annots();
          if (libAnnots instanceof PDFArray) {
            // We need to find the matching annotation again to get CA
            // Since we might have already found qp via fallback, we can reuse logic or just do it again.
            // To be safe and robust, let's iterate again or merge with the qp block if we refactor.
            // For now, let's just do a quick lookup loop similar to qp fallback.
            for (let idx = 0; idx < libAnnots.size(); idx++) {
              const libAnnot = libAnnots.lookup(idx);
              if (libAnnot instanceof PDFDict) {
                const libSubtype = libAnnot.lookup(PDFName.of("Subtype"));
                if (libSubtype === PDFName.of("Highlight")) {
                  const libRect = libAnnot.lookup(PDFName.of("Rect"));
                  if (libRect instanceof PDFArray) {
                    const rArray = libRect.asArray();
                    if (rArray.length >= 4) {
                      const lx1 = (rArray[0] as PDFNumber).asNumber();
                      const ly1 = (rArray[1] as PDFNumber).asNumber();
                      if (Math.abs(lx1 - x1) < 1 && Math.abs(ly1 - y1) < 1) {
                        // Found match, check for CA or ca
                        const CA = libAnnot.lookup(PDFName.of("CA")); // Uppercase usually for stroke, but often used for fill in annots
                        const ca = libAnnot.lookup(PDFName.of("ca")); // Lowercase for non-stroking (fill)

                        if (ca instanceof PDFNumber) {
                          opacity = ca.asNumber();
                        } else if (CA instanceof PDFNumber) {
                          opacity = CA.asNumber();
                        }
                        break;
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn("Failed to parse opacity", e);
        }

        annotations.push({
          id: `imported_highlight_${i}_${index}`,
          pageIndex: i - 1,
          type: "highlight",
          rect: { x, y, width, height },
          rects: rects,
          color: color,
          opacity: opacity,
        });
      } else if (
        subtype === "Text" ||
        subtype === "text" ||
        subtype === "FreeText" ||
        subtype === "freetext"
      ) {
        const color = annotation.color
          ? rgbArrayToHex(annotation.color)
          : "#FFFF00";
        const [x1, y1, x2, y2] = annotation.rect;
        const [vx1, vy1] = unscaledViewport.convertToViewportPoint(x1, y1);
        const [vx2, vy2] = unscaledViewport.convertToViewportPoint(x2, y2);

        // Normalize rect
        const x = Math.min(vx1, vx2);
        const y = Math.min(vy1, vy2);
        let width = Math.abs(vx2 - vx1);
        let height = Math.abs(vy2 - vy1);

        // If width/height is too small (e.g. sticky note point), give it default size
        if (width < 5) width = 30;
        if (height < 5) height = 30;

        annotations.push({
          id: `imported_note_${i}_${index}`,
          pageIndex: i - 1,
          type: "note",
          rect: { x, y, width, height },
          color: color,
          text: annotation.contents || "",
        });
      } else if (annotation.subtype === "Widget" && annotation.fieldName) {
        let type: FieldType | null = null;
        let options: string[] | undefined = undefined;
        let radioValue: string | undefined = undefined;
        let isChecked = false;
        let alignment: "left" | "center" | "right" = "left";

        if (annotation.fieldType === "Tx") {
          type = FieldType.TEXT;
        } else if (annotation.fieldType === "Btn") {
          if (annotation.checkBox) {
            type = FieldType.CHECKBOX;
            isChecked =
              annotation.fieldValue && annotation.fieldValue !== "Off";
          } else if (annotation.radioButton) {
            type = FieldType.RADIO;
            radioValue = annotation.buttonValue;
            isChecked = annotation.fieldValue === radioValue;
          }
        } else if (annotation.fieldType === "Ch") {
          type = FieldType.DROPDOWN;
          if (Array.isArray(annotation.options)) {
            options = annotation.options.map((opt: any) =>
              typeof opt === "string" ? opt : opt.display || opt.exportValue
            );
          }
        } else if (annotation.fieldType === "Sig") {
          type = FieldType.SIGNATURE;
        }

        if (type) {
          const [x1, y1, x2, y2] = annotation.rect;
          const width = x2 - x1;
          const height = y2 - y1;
          const x = x1;
          const y = unscaledViewport.height - y2;

          const importedStyle: FieldStyle = { ...DEFAULT_FIELD_STYLE };

          if (annotation.color) {
            const hex = rgbArrayToHex(annotation.color);
            if (hex) importedStyle.borderColor = hex;
          }

          if (annotation.backgroundColor) {
            const hex = rgbArrayToHex(annotation.backgroundColor);
            if (hex) {
              importedStyle.backgroundColor = hex;
              importedStyle.isTransparent = false;
            }
          } else {
            importedStyle.isTransparent = true;
          }

          if (
            annotation.borderStyle &&
            typeof annotation.borderStyle.width === "number"
          ) {
            importedStyle.borderWidth = annotation.borderStyle.width;
          }

          let da = annotation.defaultAppearance || annotation.DA;
          if (pdfDoc && annotation.fieldName) {
            const libProps = getFieldPropertiesFromPdfLib(
              pdfDoc,
              annotation.fieldName
            );
            if (libProps) {
              if (libProps.da) {
                da = libProps.da;
              }
              if (libProps.q !== undefined) {
                if (libProps.q === 1) alignment = "center";
                else if (libProps.q === 2) alignment = "right";
              }
            }
          }

          const finalDa = da || globalDA;

          if (finalDa) {
            const parsed = parseDefaultAppearance(finalDa, fontMap);
            importedStyle.fontFamily = parsed.fontFamily;
            importedStyle.fontSize = parsed.fontSize;
            importedStyle.textColor = parsed.textColor;
          }

          if (
            alignment === "left" &&
            typeof annotation.textAlignment === "number"
          ) {
            if (annotation.textAlignment === 1) alignment = "center";
            else if (annotation.textAlignment === 2) alignment = "right";
          }

          // Extract tooltip (AlternateName / TU)
          // Note: pdf.js annotation object might have 'alternativeText' or similar, but often it's not exposed cleanly in the simplified object.
          // For thorough extraction we would check the raw dict via pdf-lib if needed, but basic pdf.js might miss it.
          // We'll stick to basic extraction here or improve if requested.
          const toolTip = annotation.alternativeText || undefined;

          fields.push({
            id: `imported_${i}_${index}_${annotation.fieldName}`,
            pageIndex: i - 1,
            type: type,
            name: annotation.fieldName,
            rect: { x, y, width, height },
            required: !!(annotation.fieldFlags & 2),
            style: importedStyle,
            options: options,
            radioValue: radioValue || undefined,
            exportValue: radioValue,
            value:
              typeof annotation.fieldValue === "string"
                ? annotation.fieldValue
                : undefined,
            isChecked: isChecked,
            alignment: alignment,
            multiline: !!(annotation.fieldFlags & 4096),
            toolTip: toolTip,
          });
        }
      }
    });

    // We do NOT eagerly render pages to imageData anymore to improve performance.
    // We just store the dimensions.
    pages.push({
      pageIndex: i - 1,
      width: unscaledViewport.width,
      height: unscaledViewport.height,
      // imageData is now optional and will be generated on demand via renderPageToDataURL or PDFPage component
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

// New helper to render a single page to base64 on demand (e.g. for AI detection)
export const renderPageToDataURL = async (
  pdfDocument: any,
  pageIndex: number,
  scale = 1.5
): Promise<string | null> => {
  try {
    const page = await pdfDocument.getPage(pageIndex + 1);
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
  annotations: Annotation[] = []
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
    if (metadata.keywords)
      pdfDoc.setKeywords(metadata.keywords.split(/,|;/).map((k) => k.trim()));
  }

  // Embed Standard Fonts
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const courier = await pdfDoc.embedFont(StandardFonts.Courier);

  const getFont = (name?: string) => {
    if (name === "Times Roman") return timesRoman;
    if (name === "Courier") return courier;
    return helvetica;
  };

  const form = pdfDoc.getForm();

  // 1. Cleanup Existing Fields
  const existingFields = form.getFields();
  for (const field of existingFields) {
    let shouldRemove = false;
    try {
      // Robust check for field types including fallback to constructor name
      const typeName = field.constructor.name;
      const isText =
        field instanceof PDFTextField || typeName === "PDFTextField";
      const isCheck =
        field instanceof PDFCheckBox || typeName === "PDFCheckBox";
      const isDropdown =
        field instanceof PDFDropdown || typeName === "PDFDropdown";
      const isRadio =
        field instanceof PDFRadioGroup || typeName === "PDFRadioGroup";
      const isSig =
        (typeof PDFSignature !== "undefined" &&
          field instanceof PDFSignature) ||
        typeName === "PDFSignature";

      shouldRemove = isText || isCheck || isDropdown || isRadio || isSig;

      if (shouldRemove) {
        form.removeField(field);
      }
    } catch (e) {
      // Warning only - prevents crash on corrupt PDFs
      console.warn(
        `Attempting manual removal for corrupt field: ${field.getName()}`
      );

      // Fallback: Try to remove from AcroForm fields array manually to prevent collisions
      if (shouldRemove) {
        try {
          const fieldRef = (field as any).ref;

          // 1. Detach from AcroForm
          // Use lookup to get AcroForm safely
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

          // 2. Detach visual widgets from pages
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

  // 1.5 Cleanup Existing Annotations (Ink, Highlight, Note)
  // We must remove existing annotations of types we manage (Ink, Highlight, Text)
  // so that we don't duplicate them (if they were imported) and so we honor deletions.
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

            // Remove types that we manage in the editor
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

        // Remove from back to front to maintain indices
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

  // 2. Render Annotations
  for (const annot of annotations) {
    try {
      const page = pdfDoc.getPage(annot.pageIndex);
      const { height: pageHeight } = page.getSize();

      // Helper to flip coordinates: PDF Y starts from bottom
      const flipY = (y: number, h: number) => pageHeight - y - h;

      if (annot.type === "highlight" && annot.rect) {
        // Convert to proper PDF Highlight Annotation so it is editable/selectable
        const targetRects =
          annot.rects && annot.rects.length > 0 ? annot.rects : [annot.rect];

        const quadPoints: number[] = [];
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;

        for (const r of targetRects) {
          // React coords: x, y(top), w, h
          // PDF coords (Bottom-Left origin):
          // LLX = x
          // LLY = pageHeight - (y + height)
          // URX = x + width
          // URY = pageHeight - y

          const llx = r.x;
          const lly = pageHeight - (r.y + r.height);
          const urx = r.x + r.width;
          const ury = pageHeight - r.y;

          // Update global bounding box
          minX = Math.min(minX, llx);
          minY = Math.min(minY, lly);
          maxX = Math.max(maxX, urx);
          maxY = Math.max(maxY, ury);

          // QuadPoints Order: Top-Left, Top-Right, Bottom-Left, Bottom-Right
          // TL
          quadPoints.push(llx);
          quadPoints.push(ury);
          // TR
          quadPoints.push(urx);
          quadPoints.push(ury);
          // BL
          quadPoints.push(llx);
          quadPoints.push(lly);
          // BR
          quadPoints.push(urx);
          quadPoints.push(lly);
        }

        const colorObj = hexToPdfColor(annot.color) || rgb(1, 1, 0);
        // Extract RGB components safely
        const cr =
          (colorObj as any).red !== undefined ? (colorObj as any).red : 1;
        const cg =
          (colorObj as any).green !== undefined ? (colorObj as any).green : 1;
        const cb =
          (colorObj as any).blue !== undefined ? (colorObj as any).blue : 0;

        const highlightAnnot = pdfDoc.context.obj({
          Type: "Annot",
          Subtype: "Highlight",
          Rect: [minX, minY, maxX, maxY],
          QuadPoints: quadPoints,
          C: [cr, cg, cb],
          CA: annot.opacity ?? 0.4,
          P: page.ref,
          // Optional: Set title to Author if available
          T: metadata?.author ? PDFString.of(metadata.author) : undefined,
        });

        const ref = pdfDoc.context.register(highlightAnnot);
        page.node.addAnnot(ref);
      } else if (annot.type === "note" && annot.rect && annot.text) {
        // Draw a background box for the note
        page.drawRectangle({
          x: annot.rect.x,
          y: flipY(annot.rect.y, annot.rect.height),
          width: annot.rect.width,
          height: annot.rect.height,
          color: hexToPdfColor("#fff9c4"), // Light yellow
          borderColor: hexToPdfColor("#fbc02d"),
          borderWidth: 1,
        });

        // Calculate font size (default 12 to match workspace)
        const fontSize = annot.size || 12;
        // Padding 4px (to match p-1)
        const padding = 4;
        const lineHeight = fontSize * 1.25;
        const maxWidth = annot.rect.width - padding * 2;

        const text = annot.text || "";

        // Use Default Font (Helvetica) for notes
        const noteFont = helvetica;

        // Manual wrapping and alignment to support left/center/right
        const paragraphs = text.split("\n");
        const lines: string[] = [];

        for (const paragraph of paragraphs) {
          const words = paragraph.split(" ");
          let currentLine = "";

          for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const width = noteFont.widthOfTextAtSize(testLine, fontSize);

            if (width <= maxWidth) {
              currentLine = testLine;
            } else {
              if (currentLine) lines.push(currentLine);
              currentLine = word;
            }
          }
          lines.push(currentLine);
        }

        // Start y: Top of box - padding - fontSize (approx baseline for first line)
        let currentY =
          flipY(annot.rect.y, annot.rect.height) +
          annot.rect.height -
          padding -
          fontSize;

        for (const line of lines) {
          if (!line) {
            currentY -= lineHeight;
            continue;
          }

          const lineWidth = noteFont.widthOfTextAtSize(line, fontSize);
          let x = annot.rect.x + padding;

          if (annot.alignment === "center") {
            x = annot.rect.x + annot.rect.width / 2 - lineWidth / 2;
          } else if (annot.alignment === "right") {
            x = annot.rect.x + annot.rect.width - padding - lineWidth;
          }

          page.drawText(line, {
            x: x,
            y: currentY,
            size: fontSize,
            font: noteFont,
            color: hexToPdfColor(annot.color),
          });

          currentY -= lineHeight;
        }
      } else if (
        annot.type === "ink" &&
        annot.points &&
        annot.points.length > 1
      ) {
        // Implement standard PDF Ink Annotation so browsers can recognize and erase it

        // 1. Convert points to PDF coordinates (Bottom-Left origin)
        // InkList expects flat array of numbers [x1, y1, x2, y2, ...] for each stroke
        const pdfPoints: number[] = [];
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const p of annot.points) {
          const pdfX = p.x;
          const pdfY = pageHeight - p.y;

          pdfPoints.push(pdfX);
          pdfPoints.push(pdfY);

          if (pdfX < minX) minX = pdfX;
          if (pdfY < minY) minY = pdfY;
          if (pdfX > maxX) maxX = pdfX;
          if (pdfY > maxY) maxY = pdfY;
        }

        // 2. Padding for the bounding box based on thickness
        const thickness = annot.thickness || 2;
        const padding = thickness;
        // PDF Rect: [llx, lly, urx, ury]
        const rect = [
          minX - padding,
          minY - padding,
          maxX + padding,
          maxY + padding,
        ];

        // 3. Color
        const colorObj = hexToPdfColor(annot.color) || rgb(1, 0, 0);
        const r = (colorObj as any).red;
        const g = (colorObj as any).green;
        const b = (colorObj as any).blue;

        // 4. Create Annotation Object based on subtype
        let annotObj;

        if (annot.subtype === "polyline") {
          annotObj = pdfDoc.context.obj({
            Type: "Annot",
            Subtype: "PolyLine",
            Rect: rect,
            Vertices: pdfPoints,
            C: [r, g, b],
            BS: { W: thickness, S: "S" },
            CA: annot.opacity ?? 1.0,
            P: page.ref,
          });
        } else if (annot.subtype === "line") {
          // Line expects L [x1, y1, x2, y2]
          const x1 = pdfPoints[0];
          const y1 = pdfPoints[1];
          const x2 = pdfPoints[pdfPoints.length - 2];
          const y2 = pdfPoints[pdfPoints.length - 1];

          annotObj = pdfDoc.context.obj({
            Type: "Annot",
            Subtype: "Line",
            Rect: rect,
            L: [x1, y1, x2, y2],
            C: [r, g, b],
            BS: { W: thickness, S: "S" },
            CA: annot.opacity ?? 1.0,
            P: page.ref,
          });
        } else {
          // Default Ink (Subtype: Ink)
          annotObj = pdfDoc.context.obj({
            Type: "Annot",
            Subtype: "Ink",
            Rect: rect,
            InkList: [pdfPoints], // Single stroke (array of arrays)
            C: [r, g, b],
            Border: [0, 0, thickness],
            CA: annot.opacity ?? 1.0,
            IT: annot.intent ? PDFName.of(annot.intent) : undefined,
            P: page.ref,
          });
        }

        const ref = pdfDoc.context.register(annotObj);
        page.node.addAnnot(ref);
      }
    } catch (err) {
      console.error(`Failed to export annotation ${annot.id}`, err);
    }
  }

  // 3. Render Form Fields
  const radioGroups: Record<string, FormField[]> = {};
  const otherFields: FormField[] = [];

  fields.forEach((f) => {
    if (f.type === FieldType.RADIO) {
      (radioGroups[f.name] = radioGroups[f.name] || []).push(f);
    } else {
      otherFields.push(f);
    }
  });

  const getCommonOpts = (field: FormField, pageHeight: number) => ({
    x: field.rect.x,
    y: pageHeight - field.rect.y - field.rect.height,
    width: field.rect.width,
    height: field.rect.height,
    borderColor: hexToPdfColor(field.style?.borderColor),
    backgroundColor: field.style?.isTransparent
      ? undefined
      : hexToPdfColor(field.style?.backgroundColor),
    borderWidth: field.style?.borderWidth ?? 1,
    textColor: hexToPdfColor(field.style?.textColor),
  });

  // Process normal fields
  for (const field of otherFields) {
    try {
      const page = pdfDoc.getPage(field.pageIndex);
      const { height: pageHeight } = page.getSize();
      const fieldFont = getFont(field.style?.fontFamily);

      // Special Handling for Signature Images
      if (field.type === FieldType.SIGNATURE && field.signatureData) {
        const imageBytes = await fetch(field.signatureData).then((res) =>
          res.arrayBuffer()
        );
        let image;
        if (field.signatureData.startsWith("data:image/png")) {
          image = await pdfDoc.embedPng(imageBytes);
        } else {
          image = await pdfDoc.embedJpg(imageBytes);
        }

        // Calculate dimensions based on scaling mode
        const imgDims = image.scale(1);
        const boxWidth = field.rect.width;
        const boxHeight = field.rect.height;

        let drawWidth = boxWidth;
        let drawHeight = boxHeight;
        let drawX = field.rect.x;
        // PDF Y is bottom-left. The logic below calculates based on visual top-down conversion
        let drawY = pageHeight - field.rect.y - field.rect.height;

        const scaleMode = field.imageScaleMode || "contain";

        if (scaleMode === "contain") {
          const widthRatio = boxWidth / imgDims.width;
          const heightRatio = boxHeight / imgDims.height;
          const scale = Math.min(widthRatio, heightRatio);

          drawWidth = imgDims.width * scale;
          drawHeight = imgDims.height * scale;

          // Center the image in the box
          const offsetX = (boxWidth - drawWidth) / 2;
          const offsetY = (boxHeight - drawHeight) / 2;

          drawX += offsetX;
          drawY += offsetY;
        }

        page.drawImage(image, {
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
        });
        continue; // Skip creating the widget field since we burned the image
      }

      const commonOpts = getCommonOpts(field, pageHeight);

      if (field.type === FieldType.TEXT || field.type === FieldType.SIGNATURE) {
        let tf;
        try {
          tf = form.getTextField(field.name);
        } catch (e) {
          tf = form.createTextField(field.name);
        }

        tf.addToPage(page, { ...commonOpts, font: fieldFont });

        // Add fields properties AFTER setting style
        if (field.value) {
          tf.setText(field.value);
        }
        if (field.toolTip) {
          tf.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
        }

        if (field.style?.fontSize) tf.setFontSize(field.style.fontSize);
        if (field.alignment === "center") tf.setAlignment(TextAlignment.Center);
        else if (field.alignment === "right")
          tf.setAlignment(TextAlignment.Right);
        if (field.multiline) tf.enableMultiline();

        // Explicitly update appearances to ensure the font is embedded correctly
        // Must be called AFTER setting text, size, alignment, etc.
        tf.updateAppearances(fieldFont);
      } else if (field.type === FieldType.CHECKBOX) {
        let cb;
        try {
          cb = form.getCheckBox(field.name);
        } catch (e) {
          cb = form.createCheckBox(field.name);
        }

        cb.addToPage(page, commonOpts); // Use defaults (ZapfDingbats) for check appearance
        if (field.isChecked) cb.check();
        else cb.uncheck(); // Ensure state is synced

        if (field.toolTip) {
          cb.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
        }
      } else if (field.type === FieldType.DROPDOWN) {
        let dd;
        try {
          dd = form.getDropdown(field.name);
        } catch (e) {
          dd = form.createDropdown(field.name);
        }

        dd.addToPage(page, { ...commonOpts, font: fieldFont });
        if (field.options) dd.setOptions(field.options);
        if (field.value) dd.select(field.value);
        if (field.toolTip) {
          dd.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
        }

        if (field.style?.fontSize) dd.setFontSize(field.style.fontSize);

        // Also update appearances for dropdowns to ensure font consistency
        dd.updateAppearances(fieldFont);
      }
    } catch (e) {
      console.warn(`Skipping field ${field.name}`, e);
    }
  }

  for (const [name, group] of Object.entries(radioGroups)) {
    try {
      const rg = form.createRadioGroup(name);
      const toolTip = group.find((f) => f.toolTip)?.toolTip;
      if (toolTip) {
        rg.acroField.dict.set(PDFName.of("TU"), PDFString.of(toolTip));
      }
      group.forEach((f) => {
        const page = pdfDoc.getPage(f.pageIndex);
        const opts = getCommonOpts(f, page.getSize().height);
        const val = f.radioValue || f.exportValue || `Choice_${f.id}`;
        rg.addOptionToPage(val, page, opts);
        if (f.isChecked) rg.select(val);
      });
    } catch (e) {}
  }

  return await pdfDoc.save();
};
