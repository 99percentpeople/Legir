import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFStream,
} from "@cantoo/pdf-lib";

import {
  applyPdfMatrixToPoint,
  getAppearanceStreamMetadata,
  type PdfTransformMatrix,
} from "./appearanceRotation";
import { decodePdfStreamToText } from "./pdf-import-utils";

const MAX_FORM_DEPTH = 8;

type Operand = number | string | Operand[] | typeof ARRAY_MARKER;
type ParsedToken = Operand | "]";

type GraphicsState = {
  transform: PdfTransformMatrix;
  stroke: string;
  fill: string;
  lineWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  miterLimit: number;
  dashArray: number[];
};

const ARRAY_MARKER = Symbol("pdf-array");

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

const cloneGraphicsState = (state: GraphicsState): GraphicsState => ({
  transform: [...state.transform] as PdfTransformMatrix,
  stroke: state.stroke,
  fill: state.fill,
  lineWidth: state.lineWidth,
  lineCap: state.lineCap,
  lineJoin: state.lineJoin,
  miterLimit: state.miterLimit,
  dashArray: [...state.dashArray],
});

const defaultGraphicsState = (
  transform: PdfTransformMatrix = identityMatrix(),
): GraphicsState => ({
  transform,
  stroke: "#000000",
  fill: "#000000",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  dashArray: [],
});

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.abs(value) < 1e-6 ? 0 : value;
  return Number.parseFloat(rounded.toFixed(4)).toString();
};

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const rgbByte = (value: number) =>
  Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(1, value)) * 255)));

const grayToHex = (gray: number) => {
  const byte = rgbByte(gray);
  const token = byte.toString(16).padStart(2, "0");
  return `#${token}${token}${token}`;
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${rgbByte(r).toString(16).padStart(2, "0")}${rgbByte(g)
    .toString(16)
    .padStart(2, "0")}${rgbByte(b).toString(16).padStart(2, "0")}`;

const cmykToHex = (c: number, m: number, y: number, k: number) => {
  const red =
    (1 - Math.max(0, Math.min(1, c))) * (1 - Math.max(0, Math.min(1, k)));
  const green =
    (1 - Math.max(0, Math.min(1, m))) * (1 - Math.max(0, Math.min(1, k)));
  const blue =
    (1 - Math.max(0, Math.min(1, y))) * (1 - Math.max(0, Math.min(1, k)));
  return rgbToHex(red, green, blue);
};

const encodeSvgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const isWhitespace = (char: string) => /\s/.test(char);

const isDelimiter = (char: string) =>
  ["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"].includes(char);

const tokenizePdfContent = (content: string) => {
  const tokens: string[] = [];
  let index = 0;

  while (index < content.length) {
    const char = content[index];
    if (!char) break;

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === "%") {
      while (index < content.length && content[index] !== "\n") index += 1;
      continue;
    }

    if (char === "[") {
      tokens.push("[");
      index += 1;
      continue;
    }

    if (char === "]") {
      tokens.push("]");
      index += 1;
      continue;
    }

    if (char === "/") {
      let nextIndex = index + 1;
      while (
        nextIndex < content.length &&
        !isWhitespace(content[nextIndex] || "") &&
        !isDelimiter(content[nextIndex] || "")
      ) {
        nextIndex += 1;
      }
      tokens.push(content.slice(index, nextIndex));
      index = nextIndex;
      continue;
    }

    if (char === "(") {
      let depth = 1;
      let nextIndex = index + 1;
      let token = "";
      while (nextIndex < content.length && depth > 0) {
        const nextChar = content[nextIndex];
        if (nextChar === "\\") {
          token += nextChar;
          nextIndex += 1;
          if (nextIndex < content.length) {
            token += content[nextIndex];
            nextIndex += 1;
          }
          continue;
        }
        if (nextChar === "(") depth += 1;
        if (nextChar === ")") {
          depth -= 1;
          if (depth === 0) {
            nextIndex += 1;
            break;
          }
        }
        token += nextChar;
        nextIndex += 1;
      }
      tokens.push(`(${token})`);
      index = nextIndex;
      continue;
    }

    if (char === "<" && content[index + 1] !== "<") {
      let nextIndex = index + 1;
      while (nextIndex < content.length && content[nextIndex] !== ">") {
        nextIndex += 1;
      }
      if (nextIndex < content.length) nextIndex += 1;
      tokens.push(content.slice(index, nextIndex));
      index = nextIndex;
      continue;
    }

    let nextIndex = index + 1;
    while (
      nextIndex < content.length &&
      !isWhitespace(content[nextIndex] || "") &&
      !isDelimiter(content[nextIndex] || "")
    ) {
      nextIndex += 1;
    }
    tokens.push(content.slice(index, nextIndex));
    index = nextIndex;
  }

  return tokens;
};

const decodeLiteralString = (token: string) => {
  let text = "";
  for (let index = 1; index < token.length - 1; index += 1) {
    const char = token[index];
    if (char !== "\\") {
      text += char;
      continue;
    }
    index += 1;
    const escaped = token[index];
    if (escaped === "n") text += "\n";
    else if (escaped === "r") text += "\r";
    else if (escaped === "t") text += "\t";
    else if (escaped === "b") text += "\b";
    else if (escaped === "f") text += "\f";
    else if (escaped === "(" || escaped === ")" || escaped === "\\") {
      text += escaped;
    } else if (escaped && /[0-7]/.test(escaped)) {
      let octal = escaped;
      for (let count = 0; count < 2; count += 1) {
        const next = token[index + 1];
        if (!next || !/[0-7]/.test(next)) break;
        octal += next;
        index += 1;
      }
      text += String.fromCharCode(Number.parseInt(octal, 8));
    } else if (escaped) {
      text += escaped;
    }
  }
  return text;
};

const decodeHexString = (token: string) => {
  const hex = token.slice(1, -1).replace(/\s+/g, "");
  const normalized = hex.length % 2 === 0 ? hex : `${hex}0`;
  let text = "";
  for (let index = 0; index < normalized.length; index += 2) {
    const byte = Number.parseInt(normalized.slice(index, index + 2), 16);
    if (Number.isFinite(byte)) text += String.fromCharCode(byte);
  }
  return text;
};

const parseOperand = (token: string): ParsedToken => {
  if (token === "[") return ARRAY_MARKER;
  if (token === "]") return "]";
  if (token.startsWith("/")) return token.slice(1);
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(token)) {
    return Number.parseFloat(token);
  }
  if (token.startsWith("(") && token.endsWith(")")) {
    return decodeLiteralString(token);
  }
  if (token.startsWith("<") && token.endsWith(">")) {
    return decodeHexString(token);
  }
  return token;
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

const lookupXObject = (xobjDict: PDFDict, name: string) => {
  const stream = xobjDict.lookup(PDFName.of(name));
  return stream instanceof PDFStream ? stream : undefined;
};

const applyCurrentMatrix = (
  matrix: PdfTransformMatrix,
  x: number,
  y: number,
) => {
  const point = applyPdfMatrixToPoint(matrix, { x, y });
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
};

const lineCapFromPdf = (value: number) =>
  value === 1 ? "round" : value === 2 ? "square" : "butt";

const lineJoinFromPdf = (value: number) =>
  value === 1 ? "round" : value === 2 ? "bevel" : "miter";

const extractPaintStyle = (options: {
  state: GraphicsState;
  fill: boolean;
  stroke: boolean;
  evenOdd?: boolean;
}) => {
  const { state, fill, stroke, evenOdd = false } = options;
  const parts = [
    `fill:${fill ? state.fill : "none"}`,
    `stroke:${stroke ? state.stroke : "none"}`,
  ];

  if (stroke) {
    parts.push(`stroke-width:${formatNumber(state.lineWidth)}`);
    parts.push(`stroke-linecap:${state.lineCap}`);
    parts.push(`stroke-linejoin:${state.lineJoin}`);
    parts.push(`stroke-miterlimit:${formatNumber(state.miterLimit)}`);
    if (state.dashArray.length > 0) {
      parts.push(
        `stroke-dasharray:${state.dashArray.map((value) => formatNumber(value)).join(" ")}`,
      );
    }
  }

  if (fill && evenOdd) {
    parts.push("fill-rule:evenodd");
  }

  return parts.join(";");
};

const scaleFromMatrix = (matrix: PdfTransformMatrix) => {
  const [a, b, c, d] = matrix;
  const sx = Math.hypot(a, b);
  const sy = Math.hypot(c, d);
  return Math.max(0.0001, (sx + sy) / 2);
};

const renderStreamToSvg = async (options: {
  stream: PDFStream;
  resources?: PDFDict;
  initialMatrix?: PdfTransformMatrix;
  depth?: number;
}): Promise<string[]> => {
  const depth = options.depth ?? 0;
  if (depth > MAX_FORM_DEPTH) return [];

  const content = await decodePdfStreamToText(options.stream);
  if (!content) return [];

  const tokens = tokenizePdfContent(content);
  const resources = getStreamResources(options.stream, options.resources);
  const xobjDict = getXObjectDict(resources);
  const elements: string[] = [];
  const stateStack: GraphicsState[] = [];
  let state = defaultGraphicsState(options.initialMatrix ?? identityMatrix());
  let operands: Operand[] = [];
  let currentPath = "";

  const clearOperands = () => {
    operands = [];
  };

  const emitPath = (paint: {
    fill: boolean;
    stroke: boolean;
    evenOdd?: boolean;
    close?: boolean;
  }) => {
    if (!currentPath.trim()) {
      currentPath = "";
      return;
    }
    const d = paint.close ? `${currentPath} Z` : currentPath;
    elements.push(
      `<path d="${escapeXml(d.trim())}" style="${extractPaintStyle({
        state,
        fill: paint.fill,
        stroke: paint.stroke,
        evenOdd: paint.evenOdd,
      })}" />`,
    );
    currentPath = "";
  };

  for (const rawToken of tokens) {
    const operand = parseOperand(rawToken);

    if (operand === ARRAY_MARKER) {
      operands.push(operand);
      continue;
    }

    if (operand === "]") {
      const items: Operand[] = [];
      while (operands.length > 0) {
        const next = operands.pop();
        if (next === ARRAY_MARKER) break;
        if (next !== undefined) items.unshift(next);
      }
      operands.push(items);
      continue;
    }

    if (
      typeof operand !== "string" ||
      rawToken.startsWith("/") ||
      rawToken.startsWith("(") ||
      rawToken.startsWith("<") ||
      typeof operand === "number"
    ) {
      operands.push(operand);
      continue;
    }

    switch (operand) {
      case "q":
        stateStack.push(cloneGraphicsState(state));
        clearOperands();
        break;
      case "Q":
        state = stateStack.pop() ?? defaultGraphicsState();
        clearOperands();
        break;
      case "cm": {
        const values = operands.slice(-6).map((item) => Number(item));
        if (
          values.length === 6 &&
          values.every((value) => Number.isFinite(value))
        ) {
          state.transform = multiplyMatrix(
            state.transform,
            values as PdfTransformMatrix,
          );
        }
        clearOperands();
        break;
      }
      case "w":
        if (typeof operands.at(-1) === "number") {
          state.lineWidth =
            Number(operands.at(-1)) * scaleFromMatrix(state.transform);
        }
        clearOperands();
        break;
      case "J":
        if (typeof operands.at(-1) === "number") {
          state.lineCap = lineCapFromPdf(Number(operands.at(-1)));
        }
        clearOperands();
        break;
      case "j":
        if (typeof operands.at(-1) === "number") {
          state.lineJoin = lineJoinFromPdf(Number(operands.at(-1)));
        }
        clearOperands();
        break;
      case "M":
        if (typeof operands.at(-1) === "number") {
          state.miterLimit = Number(operands.at(-1));
        }
        clearOperands();
        break;
      case "d": {
        const dash = operands.at(-2);
        state.dashArray = Array.isArray(dash)
          ? dash
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
          : [];
        clearOperands();
        break;
      }
      case "g":
        if (typeof operands.at(-1) === "number") {
          state.fill = grayToHex(Number(operands.at(-1)));
        }
        clearOperands();
        break;
      case "G":
        if (typeof operands.at(-1) === "number") {
          state.stroke = grayToHex(Number(operands.at(-1)));
        }
        clearOperands();
        break;
      case "rg":
      case "sc":
      case "scn": {
        const values = operands.slice(-4).map((item) => Number(item));
        if (
          operands.length >= 4 &&
          values.every((value) => Number.isFinite(value))
        ) {
          state.fill = cmykToHex(values[0], values[1], values[2], values[3]);
        } else {
          const rgb = operands.slice(-3).map((item) => Number(item));
          if (rgb.length >= 3 && rgb.every((value) => Number.isFinite(value))) {
            state.fill = rgbToHex(rgb[0], rgb[1], rgb[2]);
          } else if (typeof operands.at(-1) === "number") {
            state.fill = grayToHex(Number(operands.at(-1)));
          }
        }
        clearOperands();
        break;
      }
      case "RG":
      case "SC":
      case "SCN": {
        const values = operands.slice(-4).map((item) => Number(item));
        if (
          operands.length >= 4 &&
          values.every((value) => Number.isFinite(value))
        ) {
          state.stroke = cmykToHex(values[0], values[1], values[2], values[3]);
        } else {
          const rgb = operands.slice(-3).map((item) => Number(item));
          if (rgb.length >= 3 && rgb.every((value) => Number.isFinite(value))) {
            state.stroke = rgbToHex(rgb[0], rgb[1], rgb[2]);
          } else if (typeof operands.at(-1) === "number") {
            state.stroke = grayToHex(Number(operands.at(-1)));
          }
        }
        clearOperands();
        break;
      }
      case "k":
        if (operands.length >= 4) {
          const values = operands.slice(-4).map((item) => Number(item));
          if (values.every((value) => Number.isFinite(value))) {
            state.fill = cmykToHex(values[0], values[1], values[2], values[3]);
          }
        }
        clearOperands();
        break;
      case "K":
        if (operands.length >= 4) {
          const values = operands.slice(-4).map((item) => Number(item));
          if (values.every((value) => Number.isFinite(value))) {
            state.stroke = cmykToHex(
              values[0],
              values[1],
              values[2],
              values[3],
            );
          }
        }
        clearOperands();
        break;
      case "m":
        if (operands.length >= 2) {
          const y = Number(operands.pop());
          const x = Number(operands.pop());
          currentPath += ` M ${applyCurrentMatrix(state.transform, x, y)}`;
        }
        clearOperands();
        break;
      case "l":
        if (operands.length >= 2) {
          const y = Number(operands.pop());
          const x = Number(operands.pop());
          currentPath += ` L ${applyCurrentMatrix(state.transform, x, y)}`;
        }
        clearOperands();
        break;
      case "c":
        if (operands.length >= 6) {
          const values = operands.slice(-6).map((item) => Number(item));
          currentPath += ` C ${applyCurrentMatrix(
            state.transform,
            values[0],
            values[1],
          )} ${applyCurrentMatrix(state.transform, values[2], values[3])} ${applyCurrentMatrix(state.transform, values[4], values[5])}`;
        }
        clearOperands();
        break;
      case "v":
        if (operands.length >= 4) {
          const values = operands.slice(-4).map((item) => Number(item));
          currentPath += ` C ${applyCurrentMatrix(
            state.transform,
            values[0],
            values[1],
          )} ${applyCurrentMatrix(state.transform, values[0], values[1])} ${applyCurrentMatrix(state.transform, values[2], values[3])}`;
        }
        clearOperands();
        break;
      case "y":
        if (operands.length >= 4) {
          const values = operands.slice(-4).map((item) => Number(item));
          currentPath += ` C ${applyCurrentMatrix(
            state.transform,
            values[0],
            values[1],
          )} ${applyCurrentMatrix(state.transform, values[2], values[3])} ${applyCurrentMatrix(state.transform, values[2], values[3])}`;
        }
        clearOperands();
        break;
      case "h":
        currentPath += " Z";
        clearOperands();
        break;
      case "re":
        if (operands.length >= 4) {
          const values = operands.slice(-4).map((item) => Number(item));
          const [x, y, width, height] = values;
          currentPath += ` M ${applyCurrentMatrix(state.transform, x, y)} L ${applyCurrentMatrix(
            state.transform,
            x + width,
            y,
          )} L ${applyCurrentMatrix(state.transform, x + width, y + height)} L ${applyCurrentMatrix(
            state.transform,
            x,
            y + height,
          )} Z`;
        }
        clearOperands();
        break;
      case "S":
        emitPath({ fill: false, stroke: true });
        clearOperands();
        break;
      case "s":
        emitPath({ fill: false, stroke: true, close: true });
        clearOperands();
        break;
      case "f":
      case "F":
        emitPath({ fill: true, stroke: false });
        clearOperands();
        break;
      case "f*":
        emitPath({ fill: true, stroke: false, evenOdd: true });
        clearOperands();
        break;
      case "B":
        emitPath({ fill: true, stroke: true });
        clearOperands();
        break;
      case "B*":
        emitPath({ fill: true, stroke: true, evenOdd: true });
        clearOperands();
        break;
      case "b":
        emitPath({ fill: true, stroke: true, close: true });
        clearOperands();
        break;
      case "b*":
        emitPath({ fill: true, stroke: true, close: true, evenOdd: true });
        clearOperands();
        break;
      case "n":
        currentPath = "";
        clearOperands();
        break;
      case "Do": {
        const name = operands.at(-1);
        if (typeof name === "string" && xobjDict) {
          const xobj = lookupXObject(xobjDict, name);
          const subtype = xobj?.dict.lookup(PDFName.of("Subtype"));
          if (xobj instanceof PDFStream && subtype === PDFName.of("Form")) {
            const matrixObj = xobj.dict.lookup(PDFName.of("Matrix"));
            const formMatrix =
              matrixObj instanceof PDFArray && matrixObj.size() >= 6
                ? (() => {
                    const values: number[] = [];
                    for (let index = 0; index < 6; index += 1) {
                      const entry = matrixObj.lookup(index);
                      if (!(entry instanceof PDFNumber)) return undefined;
                      values.push(entry.asNumber());
                    }
                    return values as PdfTransformMatrix;
                  })()
                : undefined;
            const nested = await renderStreamToSvg({
              stream: xobj,
              resources,
              initialMatrix: multiplyMatrix(
                state.transform,
                formMatrix ?? identityMatrix(),
              ),
              depth: depth + 1,
            });
            elements.push(...nested);
          }
        }
        clearOperands();
        break;
      }
      default:
        clearOperands();
        break;
    }
  }

  return elements;
};

export const extractStampSvgDataFromAppearance = async (annot: PDFDict) => {
  const appearance = getAppearanceStreamMetadata(annot);
  const stream = appearance.stream;
  const bbox = appearance.bbox;
  if (!stream || !bbox) return undefined;

  const [x1, y1, x2, y2] = bbox;
  const width = Math.max(1, x2 - x1);
  const height = Math.max(1, y2 - y1);
  const elements = await renderStreamToSvg({
    stream,
    resources: undefined,
  });
  if (elements.length === 0) return undefined;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNumber(x1)} ${formatNumber(y1)} ${formatNumber(width)} ${formatNumber(height)}" width="${formatNumber(width)}" height="${formatNumber(height)}">`,
    `<g transform="translate(0 ${formatNumber(y1 + y2)}) scale(1 -1)">`,
    ...elements,
    "</g>",
    "</svg>",
  ].join("");

  return {
    dataUrl: encodeSvgDataUrl(svg),
    width,
    height,
  };
};
