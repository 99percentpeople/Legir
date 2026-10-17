import { PDFDict, PDFName, PDFStream } from "@legir/pdfium/authoring";
import {
  getRotationDegFromPdfMatrix,
  getTransformedPdfRect,
  pdfRectTupleFromObj,
  pdfTransformMatrixFromObj,
  type PdfRectTuple,
  type PdfTransformMatrix,
} from "./appearanceRotation";
import { tokenizePdfContent } from "./pdfContentTokens";

const identity: PdfTransformMatrix = [1, 0, 0, 1, 0, 0];
type TextGraphicsState = {
  matrix: PdfTransformMatrix;
  fontSize: number;
  horizontalScale: number;
  renderMode: number;
};
const multiply = (
  a: PdfTransformMatrix,
  b: PdfTransformMatrix,
): PdfTransformMatrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const numberToken = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const matrixOperands = (operands: string[]): PdfTransformMatrix | undefined => {
  if (
    operands.length !== 6 ||
    !operands.every((value) => numberToken.test(value))
  )
    return;
  const values = operands.map(Number);
  return values.every(Number.isFinite)
    ? (values as PdfTransformMatrix)
    : undefined;
};

/** The painted baseline is authoritative for imported FreeText. /Rotate and
 * /MK/R can be stale (or use the producer's editing convention). Resolve the
 * AP matrix, scoped cm operators and Tm at the first visible text-show operator,
 * rather than guessing from the last rotation-looking matrix in the stream.
 * This only reads the owning document's objects; it never renders or opens a PDF.
 */
export async function getFreeTextAppearanceRotation(
  stream: PDFStream,
  readStreamText: (stream: PDFStream) => Promise<string>,
  annotationRect?: PdfRectTuple,
): Promise<number | undefined> {
  const read = async (
    current: PDFStream,
    parentState: TextGraphicsState,
    parentResources?: PDFDict,
    depth = 0,
  ): Promise<number | undefined> => {
    if (depth > 8) return;
    const matrix =
      pdfTransformMatrixFromObj(current.dict.lookup(PDFName.of("Matrix"))) ??
      identity;
    const ownResources = current.dict.lookup(PDFName.of("Resources"));
    const resources =
      ownResources instanceof PDFDict ? ownResources : parentResources;
    let state = {
      ...parentState,
      matrix: multiply(parentState.matrix, matrix),
    };
    const stack: (typeof state)[] = [];
    let textMatrix = identity;
    let inText = false;
    let operands: string[] = [];
    let dictionaryDepth = 0;
    for (const token of tokenizePdfContent(await readStreamText(current))) {
      // Marked-content property dictionaries may themselves contain operator-like names.
      if (token === "<<") dictionaryDepth++;
      if (dictionaryDepth) {
        if (token === ">>") dictionaryDepth--;
        continue;
      }
      if (numberToken.test(token) || "/(<[]".includes(token[0])) {
        operands.push(token);
        continue;
      }
      switch (token) {
        case "q":
          if (stack.length >= 256) return;
          stack.push({ ...state });
          break;
        case "Q":
          state = stack.pop() ?? state;
          break;
        case "cm": {
          const next = matrixOperands(operands);
          if (next) state.matrix = multiply(state.matrix, next);
          break;
        }
        case "BT":
          inText = true;
          textMatrix = identity;
          break;
        case "ET":
          inText = false;
          break;
        case "Tm":
          textMatrix = matrixOperands(operands) ?? textMatrix;
          break;
        case "Tf":
          if (operands.length === 2 && Number.isFinite(Number(operands[1])))
            state.fontSize = Number(operands[1]);
          break;
        case "Tz":
          if (operands.length === 1 && Number.isFinite(Number(operands[0])))
            state.horizontalScale = Number(operands[0]);
          break;
        case "Tr":
          if (operands.length === 1) state.renderMode = Number(operands[0]);
          break;
        case "Tj":
        case "TJ":
        case "'":
        case '"': {
          const hasText = operands.some(
            (value) =>
              (value.startsWith("(") || value.startsWith("<")) &&
              value.slice(1, -1).trim().length > 0,
          );
          if (
            !inText ||
            !hasText ||
            state.renderMode === 3 ||
            state.renderMode === 7 ||
            !state.fontSize ||
            !state.horizontalScale
          )
            break;
          const baseline = multiply(state.matrix, textMatrix);
          const sign = Math.sign(state.fontSize * state.horizontalScale);
          baseline[0] *= sign;
          baseline[1] *= sign;
          const rotation = getRotationDegFromPdfMatrix(baseline);
          if (rotation !== undefined) return rotation;
          break;
        }
        case "Do": {
          const name = operands.at(-1);
          const xobjects = resources?.lookup(PDFName.of("XObject"));
          if (!name?.startsWith("/") || !(xobjects instanceof PDFDict)) break;
          const decodedName = name
            .slice(1)
            .replace(/#([a-f\d]{2})/gi, (_, hex: string) =>
              String.fromCharCode(parseInt(hex, 16)),
            );
          const form = xobjects.lookup(PDFName.of(decodedName));
          if (
            !(form instanceof PDFStream) ||
            form.dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Form")
          )
            break;
          const rotation = await read(form, state, resources, depth + 1);
          if (rotation !== undefined) return rotation;
          break;
        }
        // Inline image data is binary, not content tokens. Keep the existing
        // metadata fallback rather than interpret image bytes as text operators.
        case "BI":
          return;
      }
      operands = [];
    }
  };

  let fit = identity;
  const bbox = pdfRectTupleFromObj(stream.dict.lookup(PDFName.of("BBox")));
  if (bbox && annotationRect) {
    const matrix =
      pdfTransformMatrixFromObj(stream.dict.lookup(PDFName.of("Matrix"))) ??
      identity;
    const [left, bottom, right, top] = getTransformedPdfRect(bbox, matrix);
    const sx = Math.abs(annotationRect[2] - annotationRect[0]) / (right - left);
    const sy = Math.abs(annotationRect[3] - annotationRect[1]) / (top - bottom);
    if (Number.isFinite(sx) && Number.isFinite(sy) && sx > 0 && sy > 0)
      fit = [sx, 0, 0, sy, 0, 0];
  }
  return read(stream, {
    matrix: fit,
    fontSize: 1,
    horizontalScale: 100,
    renderMode: 0,
  });
}
