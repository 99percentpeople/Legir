import * as pdfjsLib from "pdfjs-dist";
import { pdfWorkerService } from "./pdfWorkerService";
import {
  hexToPdfColor,
  rgbArrayToHex,
  mapOutline,
  getFontMap,
  getGlobalDA,
  parseDefaultAppearance,
  getFieldPropertiesFromPdfLib,
} from "../lib/pdf-helpers";
import {
  PDFDocument,
  rgb,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  StandardFonts,
  TextAlignment,
  PDFName,
  PDFString,
  PDFSignature,
  PDFDict,
  PDFArray,
  PDFNumber,
  PDFHexString,
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

const parsePDFDate = (dateStr: string | undefined): string | undefined => {
  if (!dateStr) return undefined;
  try {
    // Remove D: prefix
    const str = dateStr.startsWith("D:") ? dateStr.substring(2) : dateStr;
    // Standard format: YYYYMMDDHHmmSS

    if (str.length >= 14) {
      const year = str.substring(0, 4);
      const month = str.substring(4, 6);
      const day = str.substring(6, 8);
      const hour = str.substring(8, 10);
      const minute = str.substring(10, 12);
      const second = str.substring(12, 14);

      // Construct ISO string with Timezone
      let iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

      if (str.length > 14) {
        const rest = str.substring(14);
        if (rest.startsWith("Z")) {
          iso += "Z";
        } else if (rest.startsWith("+") || rest.startsWith("-")) {
          // Handle format: +HH'mm' or +HHmm or +HH
          const sign = rest.charAt(0);
          let tzPart = rest.substring(1).replace(/'/g, "");

          let tzHour = "00";
          let tzMinute = "00";

          if (tzPart.length >= 2) {
            tzHour = tzPart.substring(0, 2);
            if (tzPart.length >= 4) {
              tzMinute = tzPart.substring(2, 4);
            }
          }
          iso += `${sign}${tzHour}:${tzMinute}`;
        }
      }

      return iso;
    }
    return undefined;
  } catch (e) {
    return undefined;
  }
};

interface PDFJsAnnotation {
  fieldType?: string;
  subtype: string;
  rect: number[];
  contents?: string;
  title?: string;
  modificationDate?: string;
  color?: number[];
  quadPoints?: number[];
  inkList?: Array<Array<{ x: number; y: number } | number>> | Array<number[]>;
  vertices?: number[];
  lineCoordinates?: number[];
  borderStyle?: { width: number };
  id?: string;
  checkBox?: boolean;
  fieldName?: string;
  fieldValue?: string;
  radioButton?: boolean;
  buttonValue?: string;
  fieldFlags?: number;
  textAlignment?: TextAlignment;
  backgroundColor?: number[];
  defaultAppearance?: any;
  options?: string[];
  alternativeText?: string;
  DA?: string;
}

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

  // Initialize worker with document data
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
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const pageAnnotations = await page.getAnnotations();
    if (pageAnnotations.length > 0) {
      console.debug(`[Debug] Page ${i} Annotations:`, pageAnnotations);
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

                  // Parse Author (T)
                  let author: string | undefined = undefined;
                  const T = annot.lookup(PDFName.of("T"));
                  if (T instanceof PDFString || T instanceof PDFHexString)
                    author = T.decodeText();

                  // Parse Contents
                  let contents: string | undefined = undefined;
                  const Contents = annot.lookup(PDFName.of("Contents"));
                  if (
                    Contents instanceof PDFString ||
                    Contents instanceof PDFHexString
                  )
                    contents = Contents.decodeText();

                  // Parse Modified Date (M)
                  let updatedAt: string | undefined = undefined;
                  const M = annot.lookup(PDFName.of("M"));
                  if (M instanceof PDFString || M instanceof PDFHexString)
                    updatedAt = parsePDFDate(M.decodeText());

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
                          author: author,
                          text: contents,
                          updatedAt: updatedAt,
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
          e,
        );
      }
    }

    pageAnnotations.forEach((annotation: PDFJsAnnotation, index: number) => {
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
        const author = annotation.title || undefined;
        const contents = annotation.contents || undefined;
        const updatedAt = parsePDFDate(annotation.modificationDate);

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
                  py,
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
              author: author,
              text: contents,
              updatedAt: updatedAt,
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

        let author = annotation.title || undefined;
        let contents = annotation.contents || undefined;
        let updatedAt = parsePDFDate(annotation.modificationDate);

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
                          // Extract Author/Time fallback
                          const rawTitle = libAnnot.lookup(PDFName.of("T"));
                          if (
                            rawTitle instanceof PDFString ||
                            rawTitle instanceof PDFHexString
                          ) {
                            author = rawTitle.decodeText();
                          }

                          const rawModDate = libAnnot.lookup(PDFName.of("M"));
                          if (
                            rawModDate instanceof PDFString ||
                            rawModDate instanceof PDFHexString
                          ) {
                            updatedAt = parsePDFDate(rawModDate.decodeText());
                          }

                          const rawContents = libAnnot.lookup(
                            PDFName.of("Contents"),
                          );
                          if (
                            rawContents instanceof PDFString ||
                            rawContents instanceof PDFHexString
                          ) {
                            contents = rawContents.decodeText();
                          }

                          const libQP = libAnnot.lookup(
                            PDFName.of("QuadPoints"),
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
          author: author,
          text: contents,
          updatedAt: updatedAt,
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

        // If width/height is too small (e.g. comment point), give it default size
        if (width < 5) width = 30;
        if (height < 5) height = 30;

        let contents = annotation.contents || "";
        let author = annotation.title || undefined;
        let updatedAt = parsePDFDate(annotation.modificationDate);

        // Fallback to pdf-lib for contents extraction if possible
        if (pdfDoc) {
          try {
            const pdfLibPage = pdfDoc.getPage(i - 1);
            const libAnnots = pdfLibPage.node.Annots();
            if (libAnnots instanceof PDFArray) {
              for (let idx = 0; idx < libAnnots.size(); idx++) {
                const libAnnot = libAnnots.lookup(idx);
                if (libAnnot instanceof PDFDict) {
                  const libSubtype = libAnnot.lookup(PDFName.of("Subtype"));
                  // Check for Text or FreeText
                  const sName =
                    libSubtype instanceof PDFName
                      ? libSubtype.decodeText()
                      : "";
                  if (sName === "Text" || sName === "FreeText") {
                    const libRect = libAnnot.lookup(PDFName.of("Rect"));
                    if (libRect instanceof PDFArray) {
                      const rArray = libRect.asArray();
                      if (rArray.length >= 4) {
                        const lx1 = (rArray[0] as PDFNumber).asNumber();
                        const ly1 = (rArray[1] as PDFNumber).asNumber();
                        // Approximate match - Increased tolerance for float errors
                        // Especially for newly created comments that might have slight position shifts
                        if (Math.abs(lx1 - x1) < 5 && Math.abs(ly1 - y1) < 5) {
                          const rawContents = libAnnot.lookup(
                            PDFName.of("Contents"),
                          );
                          if (
                            rawContents instanceof PDFString ||
                            rawContents instanceof PDFHexString
                          ) {
                            const decoded = rawContents.decodeText();
                            // If pdf.js failed to get content (empty string), ALWAYS use pdf-lib content
                            // Or if we have content, but pdf-lib content is valid, it might be better decoded
                            if (
                              decoded &&
                              (!contents || contents.trim() === "")
                            ) {
                              contents = decoded;
                            }
                          }

                          const rawTitle = libAnnot.lookup(PDFName.of("T"));
                          if (
                            rawTitle instanceof PDFString ||
                            rawTitle instanceof PDFHexString
                          ) {
                            const decodedAuthor = rawTitle.decodeText();
                            if (
                              decodedAuthor &&
                              (!author || author.trim() === "")
                            ) {
                              author = decodedAuthor;
                            }
                          }

                          const rawModDate = libAnnot.lookup(PDFName.of("M"));
                          if (
                            rawModDate instanceof PDFString ||
                            rawModDate instanceof PDFHexString
                          ) {
                            const parsed = parsePDFDate(
                              rawModDate.decodeText(),
                            );
                            // Prefer pdf-lib date if pdf.js date is missing
                            if (parsed && !updatedAt) updatedAt = parsed;
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
            console.warn("Fallback Text extraction failed", e);
          }
        }

        annotations.push({
          id: `imported_comment_${i}_${index}`,
          pageIndex: i - 1,
          type: "comment",
          rect: { x, y, width, height },
          color: color,
          text: contents,
          author: author,
          updatedAt: updatedAt,
        });
      } else if (annotation.subtype === "Widget" && annotation.fieldName) {
        let type: FieldType | null = null;
        let options: string[] | undefined = undefined;
        let radioValue: string | undefined = undefined;
        let isChecked = false;
        let isMultiSelect = false;
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
          if (annotation.fieldFlags && annotation.fieldFlags & 2097152) {
            isMultiSelect = true;
          }
          if (Array.isArray(annotation.options)) {
            options = annotation.options.map((opt: any) =>
              typeof opt === "string" ? opt : opt.display || opt.exportValue,
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
              annotation.fieldName,
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
            value: Array.isArray(annotation.fieldValue)
              ? annotation.fieldValue.join("\n")
              : typeof annotation.fieldValue === "string"
                ? annotation.fieldValue
                : undefined,
            isMultiSelect: isMultiSelect,
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
  scale = 1.5,
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
      // Warning only - prevents crash on corrupt PDFs
      console.warn(
        `Attempting manual removal for corrupt field: ${field.getName()}`,
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

  // 1.5 Cleanup Existing Annotations (Ink, Highlight, Comment)
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
          F: 4, // Print
          Rect: [minX, minY, maxX, maxY],
          QuadPoints: quadPoints,
          C: [cr, cg, cb],
          CA: annot.opacity ?? 0.4,
          P: page.ref,
          // Optional: Set title to Author if available
          T: annot.author // Use annotation specific author if available
            ? PDFHexString.fromText(annot.author)
            : metadata?.author
              ? PDFHexString.fromText(metadata.author)
              : undefined,
          Contents: annot.text ? PDFHexString.fromText(annot.text) : undefined,
          M: annot.updatedAt
            ? PDFString.fromDate(new Date(annot.updatedAt))
            : PDFString.fromDate(new Date()),
        });

        const ref = pdfDoc.context.register(highlightAnnot);
        page.node.addAnnot(ref);
      } else if (annot.type === "comment" && annot.rect) {
        // Export as PDF Text Annotation (Comment)
        const x = annot.rect.x;
        const y = pageHeight - annot.rect.y - annot.rect.height;
        const w = annot.rect.width;
        const h = annot.rect.height;

        const colorObj = hexToPdfColor(annot.color) || rgb(1, 1, 0);
        const r =
          (colorObj as any).red !== undefined ? (colorObj as any).red : 1;
        const g =
          (colorObj as any).green !== undefined ? (colorObj as any).green : 1;
        const b =
          (colorObj as any).blue !== undefined ? (colorObj as any).blue : 0;

        const commentAnnot = pdfDoc.context.obj({
          Type: "Annot",
          Subtype: "Text",
          F: 4, // Print
          Rect: [x, y, x + w, y + h],
          Contents: PDFHexString.fromText(annot.text || ""),
          C: [r, g, b],
          CA: annot.opacity,
          Name: PDFName.of("Comment"), // Icon name
          P: page.ref,
          T: annot.author
            ? PDFHexString.fromText(annot.author)
            : metadata?.author
              ? PDFHexString.fromText(metadata.author)
              : undefined,
          M: annot.updatedAt
            ? PDFString.fromDate(new Date(annot.updatedAt))
            : PDFString.fromDate(new Date()),
        });

        const ref = pdfDoc.context.register(commentAnnot);
        page.node.addAnnot(ref);
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
            F: 4, // Print
            Rect: rect,
            Vertices: pdfPoints,
            C: [r, g, b],
            BS: { W: thickness, S: "S" },
            CA: annot.opacity,
            P: page.ref,
            T: annot.author
              ? PDFHexString.fromText(annot.author)
              : metadata?.author
                ? PDFHexString.fromText(metadata.author)
                : undefined,
            Contents: annot.text
              ? PDFHexString.fromText(annot.text)
              : undefined,
            M: annot.updatedAt
              ? PDFString.fromDate(new Date(annot.updatedAt))
              : PDFString.fromDate(new Date()),
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
            F: 4, // Print
            Rect: rect,
            L: [x1, y1, x2, y2],
            C: [r, g, b],
            BS: { W: thickness, S: "S" },
            CA: annot.opacity,
            P: page.ref,
            T: annot.author
              ? PDFHexString.fromText(annot.author)
              : metadata?.author
                ? PDFHexString.fromText(metadata.author)
                : undefined,
            Contents: annot.text
              ? PDFHexString.fromText(annot.text)
              : undefined,
            M: annot.updatedAt
              ? PDFString.fromDate(new Date(annot.updatedAt))
              : PDFString.fromDate(new Date()),
          });
        } else {
          // Default Ink (Subtype: Ink)
          annotObj = pdfDoc.context.obj({
            Type: "Annot",
            Subtype: "Ink",
            F: 4, // Print
            Rect: rect,
            InkList: [pdfPoints], // Single stroke (array of arrays)
            C: [r, g, b],
            Border: [0, 0, thickness],
            CA: annot.opacity,
            IT: annot.intent ? PDFName.of(annot.intent) : undefined,
            P: page.ref,
            T: annot.author
              ? PDFHexString.fromText(annot.author)
              : metadata?.author
                ? PDFHexString.fromText(metadata.author)
                : undefined,
            Contents: annot.text
              ? PDFHexString.fromText(annot.text)
              : undefined,
            M: annot.updatedAt
              ? PDFString.fromDate(new Date(annot.updatedAt))
              : PDFString.fromDate(new Date()),
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
          res.arrayBuffer(),
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
        if (field.isMultiSelect) {
          let ol;
          try {
            ol = form.getOptionList(field.name);
          } catch (e) {
            ol = form.createOptionList(field.name);
          }

          ol.addToPage(page, { ...commonOpts, font: fieldFont });
          if (field.options) ol.setOptions(field.options);

          ol.enableMultiselect();

          if (field.value) {
            const vals = field.value.split("\n").filter((v) => v && v !== "");
            try {
              ol.select(vals);
            } catch (e) {
              console.warn("Failed to select values for option list", e);
            }
          }

          if (field.toolTip) {
            ol.acroField.dict.set(
              PDFName.of("TU"),
              PDFString.of(field.toolTip),
            );
          }

          if (field.style?.fontSize) ol.setFontSize(field.style.fontSize);
          ol.updateAppearances(fieldFont);
        } else {
          let dd;
          try {
            dd = form.getDropdown(field.name);
          } catch (e) {
            dd = form.createDropdown(field.name);
          }

          dd.addToPage(page, { ...commonOpts, font: fieldFont });
          if (field.options) dd.setOptions(field.options);

          if (field.value) {
            try {
              dd.select(field.value);
            } catch (e) {
              console.warn("Failed to select value for dropdown", e);
            }
          }

          if (field.toolTip) {
            dd.acroField.dict.set(
              PDFName.of("TU"),
              PDFString.of(field.toolTip),
            );
          }

          if (field.style?.fontSize) dd.setFontSize(field.style.fontSize);

          // Also update appearances for dropdowns to ensure font consistency
          dd.updateAppearances(fieldFont);
        }
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
