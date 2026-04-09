import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from "@cantoo/pdf-lib";
import {
  applyPdfMatrixToPoint,
  getAppearanceStreamMetadata,
  type PdfRectTuple,
  type PdfTransformMatrix,
} from "./appearanceRotation";
import {
  decodePdfStreamToText,
  extractPdfStreamFilters,
} from "./pdf-import-utils";

type DirectColorMode = "gray" | "rgb" | "cmyk";

type ResolvedColorSpace =
  | { mode: DirectColorMode }
  | {
      mode: "indexed";
      baseMode: DirectColorMode;
      highValue: number;
      lookup: Uint8Array;
    };

type PredictorConfig = {
  predictor: number;
  colors: number;
  bitsPerComponent: number;
  columns: number;
};

export type StampImageBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExtractedStampAppearance = {
  dataUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  imageBox?: StampImageBox;
  imageFrame: "plain";
};

const MAX_XOBJECT_DEPTH = 8;
const MATRIX_EPSILON = 1e-6;

const decodePdfNameToken = (value: string) =>
  value.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

const clampByte = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)));

const normalizeUnitToByte = (value: number) =>
  clampByte(Math.max(0, Math.min(1, value)) * 255);

const bytesToBase64 = (bytes: Uint8Array) => {
  if (typeof btoa !== "function") return undefined;

  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const bytesToDataUrl = (bytes: Uint8Array, mimeType: string) => {
  const payload = bytesToBase64(bytes);
  return payload ? `data:${mimeType};base64,${payload}` : undefined;
};

const identityMatrix = (): PdfTransformMatrix => [1, 0, 0, 1, 0, 0];

const multiplyMatrix = (
  left: PdfTransformMatrix,
  right: PdfTransformMatrix,
): PdfTransformMatrix => {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

const normalizedImageBoxFromRect = (
  rect: PdfRectTuple,
  bbox: PdfRectTuple | undefined,
): StampImageBox | undefined => {
  if (!bbox) return undefined;

  const [bboxX1, bboxY1, bboxX2, bboxY2] = bbox;
  const bboxWidth = bboxX2 - bboxX1;
  const bboxHeight = bboxY2 - bboxY1;
  if (
    Math.abs(bboxWidth) < MATRIX_EPSILON ||
    Math.abs(bboxHeight) < MATRIX_EPSILON
  ) {
    return undefined;
  }

  const [x1, y1, x2, y2] = rect;
  const x = (x1 - bboxX1) / bboxWidth;
  const y = (y1 - bboxY1) / bboxHeight;
  const width = (x2 - x1) / bboxWidth;
  const height = (y2 - y1) / bboxHeight;

  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(width) ? width : 1,
    height: Number.isFinite(height) ? height : 1,
  };
};

const getUnitSquareRectFromMatrix = (
  matrix: PdfTransformMatrix,
): PdfRectTuple => {
  const corners = [
    applyPdfMatrixToPoint(matrix, { x: 0, y: 0 }),
    applyPdfMatrixToPoint(matrix, { x: 1, y: 0 }),
    applyPdfMatrixToPoint(matrix, { x: 0, y: 1 }),
    applyPdfMatrixToPoint(matrix, { x: 1, y: 1 }),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of corners) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return [minX, minY, maxX, maxY];
};

const createRasterSurface = (width: number, height: number) => {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return { canvas, context: canvas.getContext("2d") };
  }

  return null;
};

const canvasToPngDataUrl = async (
  canvas: OffscreenCanvas | HTMLCanvasElement,
) => {
  const blob =
    typeof OffscreenCanvas === "function" && canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob((value) => {
            if (value) {
              resolve(value);
              return;
            }
            reject(new Error("Failed to encode extracted stamp image."));
          }, "image/png");
        });

  return bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), "image/png");
};

const rgbaToPngDataUrl = async (
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
) => {
  const surface = createRasterSurface(width, height);
  if (!surface?.context) return undefined;

  const { canvas, context } = surface;
  const imageData = context.createImageData(width, height);
  imageData.data.set(rgba);
  context.putImageData(imageData, 0, 0);
  return canvasToPngDataUrl(canvas);
};

const getPdfNumber = (dict: PDFDict, key: string) => {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
};

const getPdfBool = (dict: PDFDict, key: string) => {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFBool ? value.asBoolean() : undefined;
};

const getResourcesColorSpace = (
  resources: PDFDict | undefined,
  name: string,
) => {
  if (!resources) return undefined;
  const colorSpaces = resources.lookup(PDFName.of("ColorSpace"));
  if (!(colorSpaces instanceof PDFDict)) return undefined;
  return colorSpaces.lookup(PDFName.of(name));
};

const getDecodedStreamBytes = (stream: PDFStream) => {
  if (stream instanceof PDFRawStream) {
    try {
      return new Uint8Array(decodePDFRawStream(stream).decode());
    } catch {
      return new Uint8Array(stream.getContents());
    }
  }
  return new Uint8Array(stream.getContents());
};

const getPdfObjectBytes = (obj: unknown): Uint8Array | undefined => {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return obj.asBytes();
  }
  if (obj instanceof PDFStream) {
    return getDecodedStreamBytes(obj);
  }
  return undefined;
};

const resolveColorSpace = (
  raw: unknown,
  resources: PDFDict | undefined,
  depth = 0,
): ResolvedColorSpace | undefined => {
  if (depth > 5) return undefined;

  if (raw instanceof PDFName) {
    const name = raw.decodeText().replace(/^\//, "");
    if (name === "DeviceGray" || name === "G") return { mode: "gray" };
    if (name === "DeviceRGB" || name === "RGB") return { mode: "rgb" };
    if (name === "DeviceCMYK" || name === "CMYK") return { mode: "cmyk" };
    if (name === "CalGray") return { mode: "gray" };
    if (name === "CalRGB" || name === "Lab") return { mode: "rgb" };
    return resolveColorSpace(
      getResourcesColorSpace(resources, name),
      resources,
      depth + 1,
    );
  }

  if (!(raw instanceof PDFArray) || raw.size() === 0) return undefined;

  const head = raw.lookup(0);
  if (!(head instanceof PDFName)) return undefined;
  const kind = head.decodeText().replace(/^\//, "");

  if (kind === "ICCBased") {
    const profile = raw.lookup(1);
    if (profile instanceof PDFStream) {
      const componentCount = getPdfNumber(profile.dict, "N");
      if (componentCount === 1) return { mode: "gray" };
      if (componentCount === 3) return { mode: "rgb" };
      if (componentCount === 4) return { mode: "cmyk" };
    }
    return undefined;
  }

  if (kind === "Indexed" || kind === "I") {
    const base = resolveColorSpace(raw.lookup(1), resources, depth + 1);
    const highValueObj = raw.lookup(2);
    const lookupBytes = getPdfObjectBytes(raw.lookup(3));
    if (
      !base ||
      base.mode === "indexed" ||
      !(highValueObj instanceof PDFNumber) ||
      !lookupBytes
    ) {
      return undefined;
    }
    return {
      mode: "indexed",
      baseMode: base.mode,
      highValue: Math.max(0, Math.floor(highValueObj.asNumber())),
      lookup: lookupBytes,
    };
  }

  if (kind === "DeviceGray") return { mode: "gray" };
  if (kind === "DeviceRGB") return { mode: "rgb" };
  if (kind === "DeviceCMYK") return { mode: "cmyk" };

  return undefined;
};

const getComponentCount = (colorSpace: ResolvedColorSpace) => {
  if (colorSpace.mode === "gray") return 1;
  if (colorSpace.mode === "rgb") return 3;
  if (colorSpace.mode === "cmyk") return 4;
  if (colorSpace.mode !== "indexed") return 4;
  if (colorSpace.baseMode === "gray") return 1;
  if (colorSpace.baseMode === "rgb") return 3;
  return 4;
};

const readDecodeArray = (stream: PDFStream, componentCount: number) => {
  const raw = stream.dict.lookup(PDFName.of("Decode"));
  if (!(raw instanceof PDFArray) || raw.size() < componentCount * 2) {
    return undefined;
  }

  const values: Array<[number, number]> = [];
  for (let index = 0; index < componentCount; index += 1) {
    const min = raw.lookup(index * 2);
    const max = raw.lookup(index * 2 + 1);
    if (!(min instanceof PDFNumber) || !(max instanceof PDFNumber)) {
      return undefined;
    }
    values.push([min.asNumber(), max.asNumber()]);
  }
  return values;
};

const readPackedSample = (
  bytes: Uint8Array,
  sampleIndex: number,
  bitsPerComponent: number,
) => {
  if (bitsPerComponent === 8) {
    return bytes[sampleIndex] ?? 0;
  }

  if (bitsPerComponent === 16) {
    const offset = sampleIndex * 2;
    return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
  }

  if (
    bitsPerComponent !== 1 &&
    bitsPerComponent !== 2 &&
    bitsPerComponent !== 4
  ) {
    return 0;
  }

  const bitOffset = sampleIndex * bitsPerComponent;
  const byteIndex = Math.floor(bitOffset / 8);
  const shift = 8 - (bitOffset % 8) - bitsPerComponent;
  const mask = (1 << bitsPerComponent) - 1;
  return ((bytes[byteIndex] ?? 0) >> shift) & mask;
};

const sampleToUnit = (
  sample: number,
  bitsPerComponent: number,
  decodePair?: [number, number],
) => {
  const maxValue =
    bitsPerComponent === 16 ? 0xffff : (1 << bitsPerComponent) - 1;
  if (maxValue <= 0) return 0;

  const normalized = sample / maxValue;
  if (!decodePair) return normalized;

  const [min, max] = decodePair;
  return min + normalized * (max - min);
};

const resolvePredictorConfig = (
  stream: PDFStream,
  componentCount: number,
  width: number,
  bitsPerComponent: number,
): PredictorConfig | undefined => {
  const raw = stream.dict.lookup(PDFName.of("DecodeParms"));
  const decodeParams =
    raw instanceof PDFDict
      ? raw
      : raw instanceof PDFArray
        ? (() => {
            for (let index = raw.size() - 1; index >= 0; index -= 1) {
              const entry = raw.lookup(index);
              if (entry instanceof PDFDict) return entry;
            }
            return undefined;
          })()
        : undefined;

  if (!decodeParams) return undefined;

  const predictor = getPdfNumber(decodeParams, "Predictor") ?? 1;
  const colors = Math.max(
    1,
    Math.round(getPdfNumber(decodeParams, "Colors") ?? componentCount),
  );
  const columns = Math.max(
    1,
    Math.round(getPdfNumber(decodeParams, "Columns") ?? width),
  );
  const bpc = Math.max(
    1,
    Math.round(
      getPdfNumber(decodeParams, "BitsPerComponent") ?? bitsPerComponent,
    ),
  );

  return {
    predictor,
    colors,
    bitsPerComponent: bpc,
    columns,
  };
};

const applyTiffPredictor = (
  bytes: Uint8Array,
  rowLength: number,
  bytesPerPixel: number,
) => {
  const out = new Uint8Array(bytes);

  for (let rowStart = 0; rowStart < out.length; rowStart += rowLength) {
    for (
      let index = rowStart + bytesPerPixel;
      index < Math.min(rowStart + rowLength, out.length);
      index += 1
    ) {
      out[index] = (out[index] + out[index - bytesPerPixel]) & 0xff;
    }
  }

  return out;
};

const paethPredictor = (left: number, up: number, upLeft: number) => {
  const p = left + up - upLeft;
  const pLeft = Math.abs(p - left);
  const pUp = Math.abs(p - up);
  const pUpLeft = Math.abs(p - upLeft);

  if (pLeft <= pUp && pLeft <= pUpLeft) return left;
  if (pUp <= pUpLeft) return up;
  return upLeft;
};

const applyPngPredictor = (
  bytes: Uint8Array,
  rowLength: number,
  bytesPerPixel: number,
  height: number,
) => {
  const rowStride = rowLength + 1;
  if (rowStride <= 1 || bytes.length < rowStride) return bytes;

  const rowCount = Math.min(height, Math.floor(bytes.length / rowStride));
  if (rowCount <= 0) return bytes;

  const out = new Uint8Array(rowCount * rowLength);

  for (let row = 0; row < rowCount; row += 1) {
    const srcOffset = row * rowStride;
    const dstOffset = row * rowLength;
    const filter = bytes[srcOffset] ?? 0;

    for (let column = 0; column < rowLength; column += 1) {
      const raw = bytes[srcOffset + 1 + column] ?? 0;
      const left =
        column >= bytesPerPixel ? out[dstOffset + column - bytesPerPixel] : 0;
      const up = row > 0 ? out[dstOffset + column - rowLength] : 0;
      const upLeft =
        row > 0 && column >= bytesPerPixel
          ? out[dstOffset + column - rowLength - bytesPerPixel]
          : 0;

      if (filter === 0) out[dstOffset + column] = raw;
      else if (filter === 1) out[dstOffset + column] = (raw + left) & 0xff;
      else if (filter === 2) out[dstOffset + column] = (raw + up) & 0xff;
      else if (filter === 3) {
        out[dstOffset + column] = (raw + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        out[dstOffset + column] =
          (raw + paethPredictor(left, up, upLeft)) & 0xff;
      } else {
        out[dstOffset + column] = raw;
      }
    }
  }

  return out;
};

const applyPredictor = (
  bytes: Uint8Array,
  predictor: PredictorConfig | undefined,
  height: number,
) => {
  if (!predictor || predictor.predictor <= 1) return bytes;

  const rowLength = Math.ceil(
    (predictor.columns * predictor.colors * predictor.bitsPerComponent) / 8,
  );
  const bytesPerPixel = Math.max(
    1,
    Math.ceil((predictor.colors * predictor.bitsPerComponent) / 8),
  );

  if (predictor.predictor === 2) {
    return applyTiffPredictor(bytes, rowLength, bytesPerPixel);
  }

  if (predictor.predictor >= 10 && predictor.predictor <= 15) {
    return applyPngPredictor(bytes, rowLength, bytesPerPixel, height);
  }

  return bytes;
};

const decodeSoftMaskAlpha = (
  maskStream: PDFStream,
  resources: PDFDict | undefined,
  width: number,
  height: number,
) => {
  const bitsPerComponent = Math.max(
    1,
    Math.round(getPdfNumber(maskStream.dict, "BitsPerComponent") ?? 8),
  );
  const colorSpace =
    resolveColorSpace(
      maskStream.dict.lookup(PDFName.of("ColorSpace")),
      resources,
    ) ?? ({ mode: "gray" } satisfies ResolvedColorSpace);
  const componentCount =
    colorSpace.mode === "indexed" ? 1 : getComponentCount(colorSpace);
  const raw = applyPredictor(
    getDecodedStreamBytes(maskStream),
    resolvePredictorConfig(maskStream, componentCount, width, bitsPerComponent),
    height,
  );
  const decodePairs = readDecodeArray(maskStream, componentCount);

  const alpha = new Uint8ClampedArray(width * height);
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const sample = readPackedSample(raw, pixelIndex, bitsPerComponent);
    const unit = sampleToUnit(sample, bitsPerComponent, decodePairs?.[0]);
    alpha[pixelIndex] = normalizeUnitToByte(unit);
  }
  return alpha;
};

const fillRgbFromBaseComponents = (
  target: Uint8ClampedArray,
  offset: number,
  mode: DirectColorMode,
  units: number[],
) => {
  if (mode === "gray") {
    const gray = normalizeUnitToByte(units[0] ?? 0);
    target[offset] = gray;
    target[offset + 1] = gray;
    target[offset + 2] = gray;
    return;
  }

  if (mode === "rgb") {
    target[offset] = normalizeUnitToByte(units[0] ?? 0);
    target[offset + 1] = normalizeUnitToByte(units[1] ?? 0);
    target[offset + 2] = normalizeUnitToByte(units[2] ?? 0);
    return;
  }

  const c = Math.max(0, Math.min(1, units[0] ?? 0));
  const m = Math.max(0, Math.min(1, units[1] ?? 0));
  const y = Math.max(0, Math.min(1, units[2] ?? 0));
  const k = Math.max(0, Math.min(1, units[3] ?? 0));
  target[offset] = clampByte(255 * (1 - c) * (1 - k));
  target[offset + 1] = clampByte(255 * (1 - m) * (1 - k));
  target[offset + 2] = clampByte(255 * (1 - y) * (1 - k));
};

const decodeImageToRgba = (options: {
  stream: PDFStream;
  resources: PDFDict | undefined;
  width: number;
  height: number;
  bitsPerComponent: number;
  colorSpace: ResolvedColorSpace;
}) => {
  const { stream, resources, width, height, bitsPerComponent, colorSpace } =
    options;
  const componentCount =
    colorSpace.mode === "indexed" ? 1 : getComponentCount(colorSpace);
  const decodePairs =
    colorSpace.mode === "indexed"
      ? undefined
      : readDecodeArray(stream, componentCount);
  const raw = applyPredictor(
    getDecodedStreamBytes(stream),
    resolvePredictorConfig(stream, componentCount, width, bitsPerComponent),
    height,
  );

  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const rgbaOffset = pixelIndex * 4;

    if (colorSpace.mode === "indexed") {
      const paletteIndex = Math.max(
        0,
        Math.min(
          colorSpace.highValue,
          readPackedSample(raw, pixelIndex, bitsPerComponent),
        ),
      );
      const baseComponentCount =
        colorSpace.baseMode === "gray"
          ? 1
          : colorSpace.baseMode === "rgb"
            ? 3
            : 4;
      const paletteOffset = paletteIndex * baseComponentCount;
      const units = Array.from(
        colorSpace.lookup.slice(
          paletteOffset,
          paletteOffset + baseComponentCount,
        ),
        (value) => value / 255,
      );
      fillRgbFromBaseComponents(rgba, rgbaOffset, colorSpace.baseMode, units);
    } else {
      const units: number[] = [];
      for (
        let componentIndex = 0;
        componentIndex < componentCount;
        componentIndex += 1
      ) {
        const sample = readPackedSample(
          raw,
          pixelIndex * componentCount + componentIndex,
          bitsPerComponent,
        );
        units.push(
          sampleToUnit(sample, bitsPerComponent, decodePairs?.[componentIndex]),
        );
      }
      fillRgbFromBaseComponents(rgba, rgbaOffset, colorSpace.mode, units);
    }

    rgba[rgbaOffset + 3] = 255;
  }

  const softMask = stream.dict.lookup(PDFName.of("SMask"));
  if (softMask instanceof PDFStream) {
    const maskWidth = Math.round(getPdfNumber(softMask.dict, "Width") ?? width);
    const maskHeight = Math.round(
      getPdfNumber(softMask.dict, "Height") ?? height,
    );

    if (maskWidth === width && maskHeight === height) {
      const alpha = decodeSoftMaskAlpha(softMask, resources, width, height);
      for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
        rgba[pixelIndex * 4 + 3] = alpha[pixelIndex] ?? 255;
      }
    }
  }

  return rgba;
};

type ContentOperand =
  | { type: "number"; value: number }
  | { type: "name"; value: string };

type PaintImageInvocation = {
  name: string;
  matrix: PdfTransformMatrix;
};

const isPdfNumberToken = (value: string) =>
  /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value);

const parseDoInvocations = (content: string): PaintImageInvocation[] => {
  const invocations: PaintImageInvocation[] = [];
  const tokens = content.match(
    /\/[^\s<>[\](){}%/]+|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[A-Za-z*']+/g,
  );
  if (!tokens) return invocations;

  let ctm = identityMatrix();
  const stack: PdfTransformMatrix[] = [];
  let operands: ContentOperand[] = [];

  const clearOperands = () => {
    operands = [];
  };

  for (const token of tokens) {
    if (token.startsWith("/")) {
      operands.push({
        type: "name",
        value: decodePdfNameToken(token.slice(1)),
      });
      continue;
    }

    if (isPdfNumberToken(token)) {
      operands.push({
        type: "number",
        value: Number.parseFloat(token),
      });
      continue;
    }

    if (token === "q") {
      stack.push(ctm);
      clearOperands();
      continue;
    }

    if (token === "Q") {
      ctm = stack.pop() ?? identityMatrix();
      clearOperands();
      continue;
    }

    if (token === "cm") {
      const values = operands
        .slice(-6)
        .map((operand) =>
          operand.type === "number" ? operand.value : Number.NaN,
        );
      if (
        values.length === 6 &&
        values.every((value) => Number.isFinite(value))
      ) {
        ctm = multiplyMatrix(ctm, values as PdfTransformMatrix);
      }
      clearOperands();
      continue;
    }

    if (token === "Do") {
      const nameOperand = operands[operands.length - 1];
      if (nameOperand?.type === "name") {
        invocations.push({
          name: nameOperand.value,
          matrix: ctm,
        });
      }
      clearOperands();
      continue;
    }

    clearOperands();
  }

  return invocations;
};

const getReferencedXObjectNames = async (stream: PDFStream) => {
  const content = await decodePdfStreamToText(stream);
  if (!content) return [];

  const names: string[] = [];
  const seen = new Set<string>();
  const matches = content.matchAll(/\/([^\s<>[\](){}%/]+)\s+Do\b/g);

  for (const match of matches) {
    const rawName = match[1]?.trim();
    if (!rawName) continue;
    const name = decodePdfNameToken(rawName);
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  return names;
};

const getStreamResources = (
  stream: PDFStream,
  fallbackResources: PDFDict | undefined,
) => {
  const own = stream.dict.lookup(PDFName.of("Resources"));
  return own instanceof PDFDict ? own : fallbackResources;
};

const getXObjectDict = (resources: PDFDict | undefined) => {
  const xobj = resources?.lookup(PDFName.of("XObject"));
  return xobj instanceof PDFDict ? xobj : undefined;
};

const lookupXObject = (
  xobjDict: PDFDict,
  name: string,
): { stream: PDFStream; refKey?: string } | undefined => {
  const key = PDFName.of(name);
  const rawRef = xobjDict.get(key);
  const stream = xobjDict.lookup(key);
  if (!(stream instanceof PDFStream)) return undefined;

  return {
    stream,
    refKey:
      rawRef instanceof PDFRef
        ? `${rawRef.objectNumber}:${rawRef.generationNumber}`
        : undefined,
  };
};

const decodeImageXObject = async (
  stream: PDFStream,
  resources: PDFDict | undefined,
) => {
  if (getPdfBool(stream.dict, "ImageMask")) return undefined;

  const width = Math.max(
    1,
    Math.round(getPdfNumber(stream.dict, "Width") ?? 0),
  );
  const height = Math.max(
    1,
    Math.round(getPdfNumber(stream.dict, "Height") ?? 0),
  );

  const filters = extractPdfStreamFilters(stream);
  if (filters.length === 1 && filters[0] === "DCTDecode") {
    const dataUrl = bytesToDataUrl(
      new Uint8Array(stream.getContents()),
      "image/jpeg",
    );
    return dataUrl ? { dataUrl, width, height } : undefined;
  }

  if (filters.length === 1 && filters[0] === "JPXDecode") {
    const dataUrl = bytesToDataUrl(
      new Uint8Array(stream.getContents()),
      "image/jp2",
    );
    return dataUrl ? { dataUrl, width, height } : undefined;
  }

  if (
    filters.some((filter) => ["JBIG2Decode", "CCITTFaxDecode"].includes(filter))
  ) {
    return undefined;
  }

  const bitsPerComponent = Math.max(
    1,
    Math.round(getPdfNumber(stream.dict, "BitsPerComponent") ?? 8),
  );
  const colorSpace = resolveColorSpace(
    stream.dict.lookup(PDFName.of("ColorSpace")),
    resources,
  );

  if (!colorSpace) return undefined;

  const rgba = decodeImageToRgba({
    stream,
    resources,
    width,
    height,
    bitsPerComponent,
    colorSpace,
  });
  const dataUrl = await rgbaToPngDataUrl(width, height, rgba);
  return dataUrl ? { dataUrl, width, height } : undefined;
};

const extractStampImageFromStream = async (options: {
  stream: PDFStream;
  resources: PDFDict | undefined;
  depth: number;
  seenRefs: Set<string>;
  seenStreams: WeakSet<PDFStream>;
  rootBBox: PdfRectTuple | undefined;
  initialMatrix: PdfTransformMatrix;
}): Promise<ExtractedStampAppearance | undefined> => {
  const { stream, resources, depth, seenRefs, seenStreams } = options;
  if (depth > MAX_XOBJECT_DEPTH) return undefined;

  const currentResources = getStreamResources(stream, resources);
  const xobjDict = getXObjectDict(currentResources);
  if (!xobjDict) return undefined;

  const content = await decodePdfStreamToText(stream);
  const invocations = content ? parseDoInvocations(content) : [];
  const fallbackNames =
    invocations.length > 0
      ? invocations.map((entry) => entry.name)
      : await getReferencedXObjectNames(stream);
  const orderedNames =
    fallbackNames.length > 0
      ? fallbackNames
      : Array.from(xobjDict.keys(), (key) =>
          key.decodeText().replace(/^\//, ""),
        );
  const invocationMatrixMap = new Map<string, PdfTransformMatrix>();
  for (const invocation of invocations) {
    if (!invocationMatrixMap.has(invocation.name)) {
      invocationMatrixMap.set(
        invocation.name,
        multiplyMatrix(options.initialMatrix, invocation.matrix),
      );
    }
  }

  for (const name of orderedNames) {
    const entry = lookupXObject(xobjDict, name);
    if (!entry) continue;
    if (entry.refKey) {
      if (seenRefs.has(entry.refKey)) continue;
      seenRefs.add(entry.refKey);
    } else if (seenStreams.has(entry.stream)) {
      continue;
    } else {
      seenStreams.add(entry.stream);
    }

    const subtype = entry.stream.dict.lookup(PDFName.of("Subtype"));
    if (subtype === PDFName.of("Image")) {
      const image = await decodeImageXObject(entry.stream, currentResources);
      if (image) {
        const matrix = invocationMatrixMap.get(name);
        return {
          dataUrl: image.dataUrl,
          imageWidth: image.width,
          imageHeight: image.height,
          imageBox: matrix
            ? normalizedImageBoxFromRect(
                getUnitSquareRectFromMatrix(matrix),
                options.rootBBox,
              )
            : undefined,
          imageFrame: "plain",
        };
      }
      continue;
    }

    if (subtype === PDFName.of("Form")) {
      const formMatrixObj = entry.stream.dict.lookup(PDFName.of("Matrix"));
      const formMatrix =
        formMatrixObj instanceof PDFArray && formMatrixObj.size() >= 6
          ? (() => {
              const values: number[] = [];
              for (let index = 0; index < 6; index += 1) {
                const item = formMatrixObj.lookup(index);
                if (!(item instanceof PDFNumber)) return undefined;
                values.push(item.asNumber());
              }
              return values.every((value) => Number.isFinite(value))
                ? (values as PdfTransformMatrix)
                : undefined;
            })()
          : undefined;
      const nested = await extractStampImageFromStream({
        stream: entry.stream,
        resources: currentResources,
        depth: depth + 1,
        seenRefs,
        seenStreams,
        rootBBox: options.rootBBox,
        initialMatrix: multiplyMatrix(
          invocationMatrixMap.get(name) ?? options.initialMatrix,
          formMatrix ?? identityMatrix(),
        ),
      });
      if (nested) return nested;
    }
  }

  return undefined;
};

export const extractStampImageDataFromAppearance = async (annot: PDFDict) => {
  const appearance = getAppearanceStreamMetadata(annot);
  if (!appearance.stream) return undefined;

  return extractStampImageFromStream({
    stream: appearance.stream,
    resources: undefined,
    depth: 0,
    seenRefs: new Set<string>(),
    seenStreams: new WeakSet<PDFStream>(),
    rootBBox: appearance.bbox,
    initialMatrix: identityMatrix(),
  });
};
