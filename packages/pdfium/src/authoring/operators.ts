// Copyright (c) 2026 Legir contributors. BSD-3-Clause.
import { PDFHexString, PDFName, PDFOperator } from "./objects.js";
import type { PDFFont } from "./fonts.js";
export type Color =
  | { type: "RGB"; red: number; green: number; blue: number }
  | { type: "Grayscale"; gray: number }
  | {
      type: "CMYK";
      cyan: number;
      magenta: number;
      yellow: number;
      key: number;
    };
export const rgb = (
  red: number,
  green: number,
  blue: number,
): Color & { red: number; green: number; blue: number } => ({
  type: "RGB",
  red,
  green,
  blue,
});
export const grayscale = (gray: number): Color => ({ type: "Grayscale", gray });
export const cmyk = (
  cyan: number,
  magenta: number,
  yellow: number,
  key: number,
): Color => ({ type: "CMYK", cyan, magenta, yellow, key });
export const componentsToColor = (v?: number[]) =>
  !v?.length
    ? undefined
    : v.length === 1
      ? grayscale(v[0])
      : v.length === 3
        ? rgb(v[0], v[1], v[2])
        : cmyk(v[0], v[1], v[2], v[3]);
export const colorComponents = (c: Color) =>
  c.type === "RGB"
    ? [c.red, c.green, c.blue]
    : c.type === "Grayscale"
      ? [c.gray]
      : [c.cyan, c.magenta, c.yellow, c.key];
export type Rotation = { type: "degrees" | "radians"; angle: number };
export const degrees = (angle: number): Rotation => ({
  type: "degrees",
  angle,
});
export const radians = (angle: number): Rotation => ({
  type: "radians",
  angle,
});
const rad = (value?: Rotation) =>
  !value
    ? 0
    : value.type === "radians"
      ? value.angle
      : (value.angle * Math.PI) / 180;
export const reduceRotation = (angle = 0) => ((angle % 360) + 360) % 360;
export enum LineJoinStyle {
  Miter = 0,
  Round = 1,
  Bevel = 2,
}
export enum LineCapStyle {
  Butt = 0,
  Round = 1,
  Projecting = 2,
}
export enum TextAlignment {
  Left = 0,
  Center = 1,
  Right = 2,
}
export const op = (
  name: string,
  ...args: (number | string | PDFName | PDFHexString)[]
) => PDFOperator.of(name, args);
export const pushGraphicsState = () => op("q");
export const popGraphicsState = () => op("Q");
export const concatTransformationMatrix = (
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
) => op("cm", a, b, c, d, e, f);
export const setLineJoin = (style: LineJoinStyle) => op("j", style);
export const setFillingColor = (color: Color) =>
  op(
    color.type === "RGB" ? "rg" : color.type === "CMYK" ? "k" : "g",
    ...colorComponents(color),
  );
export const setStrokingColor = (color: Color) =>
  op(
    color.type === "RGB" ? "RG" : color.type === "CMYK" ? "K" : "G",
    ...colorComponents(color),
  );
export const setFontAndSize = (name: string | PDFName, size: number) =>
  op("Tf", typeof name === "string" ? PDFName.of(name) : name, size);
export type DrawOptions = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  xScale?: number;
  yScale?: number;
  rotate?: Rotation;
  xSkew?: Rotation;
  ySkew?: Rotation;
  scale?: number;
  color?: Color;
  borderColor?: Color;
  borderWidth?: number;
  borderDashArray?: number[];
  borderDashPhase?: number;
  borderLineCap?: LineCapStyle;
  borderLineJoin?: LineJoinStyle;
  opacity?: number;
  borderOpacity?: number;
  graphicsState?: PDFName | string;
  rx?: number;
  ry?: number;
};
function style(options: DrawOptions) {
  const out: PDFOperator[] = [];
  if (options.graphicsState)
    out.push(
      op(
        "gs",
        typeof options.graphicsState === "string"
          ? PDFName.of(options.graphicsState)
          : options.graphicsState,
      ),
    );
  if (options.color) out.push(setFillingColor(options.color));
  if (options.borderColor) out.push(setStrokingColor(options.borderColor));
  out.push(op("w", options.borderWidth ?? 0));
  if (options.borderDashArray)
    out.push(
      op(
        "d",
        `[${options.borderDashArray.join(" ")}]`,
        options.borderDashPhase ?? 0,
      ),
    );
  if (options.borderLineCap !== undefined)
    out.push(op("J", options.borderLineCap));
  if (options.borderLineJoin !== undefined)
    out.push(op("j", options.borderLineJoin));
  return out;
}
const paint = (options: DrawOptions) =>
  op(
    options.color
      ? options.borderColor && (options.borderWidth ?? 0) > 0
        ? "B"
        : "f"
      : options.borderColor && (options.borderWidth ?? 0) > 0
        ? "S"
        : "n",
  );
function transform(options: DrawOptions, scaleX = 1, scaleY = 1) {
  const angle = rad(options.rotate),
    c = Math.cos(angle),
    s = Math.sin(angle),
    tx = Math.tan(rad(options.xSkew)),
    ty = Math.tan(rad(options.ySkew));
  return concatTransformationMatrix(
    c * scaleX - s * scaleY * ty,
    s * scaleX + c * scaleY * ty,
    c * scaleX * tx - s * scaleY,
    s * scaleX * tx + c * scaleY,
    options.x ?? 0,
    options.y ?? 0,
  );
}
function rectanglePath(options: DrawOptions) {
  const w = options.width ?? 0,
    h = options.height ?? 0,
    rx = Math.min(options.rx ?? 0, w / 2),
    ry = Math.min(options.ry ?? rx, h / 2);
  if (!rx || !ry) return [op("re", 0, 0, w, h)];
  return svgPathOperators(
    `M ${rx} 0 H ${w - rx} A ${rx} ${ry} 0 0 1 ${w} ${ry} V ${h - ry} A ${rx} ${ry} 0 0 1 ${w - rx} ${h} H ${rx} A ${rx} ${ry} 0 0 1 0 ${h - ry} V ${ry} A ${rx} ${ry} 0 0 1 ${rx} 0 Z`,
  );
}
export function drawRectangle(options: DrawOptions) {
  return [
    pushGraphicsState(),
    transform(options),
    ...style(options),
    ...rectanglePath(options),
    paint(options),
    popGraphicsState(),
  ];
}
export function drawEllipse(options: DrawOptions) {
  const x = options.xScale ?? (options.width ?? 0) / 2,
    y = options.yScale ?? (options.height ?? 0) / 2,
    k = 0.5522847498307936;
  return [
    pushGraphicsState(),
    transform(options),
    ...style(options),
    op("m", -x, 0),
    op("c", -x, k * y, -k * x, y, 0, y),
    op("c", k * x, y, x, k * y, x, 0),
    op("c", x, -k * y, k * x, -y, 0, -y),
    op("c", -k * x, -y, -x, -k * y, -x, 0),
    op("h"),
    paint(options),
    popGraphicsState(),
  ];
}
export function drawImage(name: PDFName | string, options: DrawOptions) {
  return [
    pushGraphicsState(),
    ...(options.graphicsState
      ? [
          op(
            "gs",
            typeof options.graphicsState === "string"
              ? PDFName.of(options.graphicsState)
              : options.graphicsState,
          ),
        ]
      : []),
    transform(options),
    concatTransformationMatrix(
      options.width ?? 1,
      0,
      0,
      options.height ?? 1,
      0,
      0,
    ),
    op("Do", typeof name === "string" ? PDFName.of(name) : name),
    popGraphicsState(),
  ];
}
export function rotateInPlace(options: {
  width: number;
  height: number;
  rotation: number;
  x?: number;
  y?: number;
}) {
  switch (reduceRotation(options.rotation)) {
    case 90:
      return [concatTransformationMatrix(0, 1, -1, 0, options.width, 0)];
    case 180:
      return [
        concatTransformationMatrix(-1, 0, 0, -1, options.width, options.height),
      ];
    case 270:
      return [concatTransformationMatrix(0, -1, 1, 0, 0, options.height)];
    default:
      return [];
  }
}
/** SVG endpoint arcs become cubic Beziers, with at most a quarter turn per curve. */
function arc(
  x0: number,
  y0: number,
  rx0: number,
  ry0: number,
  angle: number,
  large: number,
  sweep: number,
  x1: number,
  y1: number,
) {
  let rx = Math.abs(rx0),
    ry = Math.abs(ry0);
  if (!rx || !ry) return [op("l", x1, y1)];
  if (x0 === x1 && y0 === y1) return [];
  const phi = (angle * Math.PI) / 180,
    c = Math.cos(phi),
    s = Math.sin(phi),
    dx = (x0 - x1) / 2,
    dy = (y0 - y1) / 2;
  const xp = c * dx + s * dy,
    yp = -s * dx + c * dy,
    lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const factor =
    (large === sweep ? -1 : 1) *
    Math.sqrt(
      Math.max(
        0,
        (rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp) /
          (rx * rx * yp * yp + ry * ry * xp * xp),
      ),
    );
  const cxp = (factor * rx * yp) / ry,
    cyp = (-factor * ry * xp) / rx,
    cx = c * cxp - s * cyp + (x0 + x1) / 2,
    cy = s * cxp + c * cyp + (y0 + y1) / 2;
  let theta = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx),
    delta = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - theta;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  const count = Math.ceil(Math.abs(delta) / (Math.PI / 2)),
    step = delta / count,
    out: PDFOperator[] = [];
  const point = (u: number, v: number) => [
    cx + c * rx * u - s * ry * v,
    cy + s * rx * u + c * ry * v,
  ];
  for (let i = 0; i < count; i++) {
    const end = theta + step,
      k = (4 / 3) * Math.tan(step / 4),
      a = point(
        Math.cos(theta) - k * Math.sin(theta),
        Math.sin(theta) + k * Math.cos(theta),
      ),
      b = point(
        Math.cos(end) + k * Math.sin(end),
        Math.sin(end) - k * Math.cos(end),
      ),
      p = point(Math.cos(end), Math.sin(end));
    out.push(op("c", ...a, ...b, ...p));
    theta = end;
  }
  return out;
}
export function svgPathOperators(path: string): PDFOperator[] {
  const tokens =
    path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const count: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0,
  };
  let i = 0,
    cmd = "",
    previous = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    cx = 0,
    cy = 0,
    qx = 0,
    qy = 0;
  const out: PDFOperator[] = [];
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    const upper = cmd.toUpperCase(),
      relative = cmd !== upper,
      n = count[upper];
    if (n === undefined) throw new Error(`Unsupported SVG path command ${cmd}`);
    if (upper === "Z") {
      out.push(op("h"));
      x = sx;
      y = sy;
      previous = upper;
      cmd = "";
      continue;
    }
    if (i + n > tokens.length || /^[a-z]$/i.test(tokens[i]))
      throw new Error("Incomplete SVG path");
    const a = tokens.slice(i, i + n).map(Number);
    if (a.some((v) => !Number.isFinite(v)))
      throw new Error("Invalid SVG coordinate");
    i += n;
    const px = (v: number) => v + (relative ? x : 0),
      py = (v: number) => v + (relative ? y : 0);
    if (upper === "M" || upper === "L") {
      x = px(a[0]);
      y = py(a[1]);
      out.push(op(upper === "M" ? "m" : "l", x, y));
      if (upper === "M") {
        sx = x;
        sy = y;
        cmd = relative ? "l" : "L";
      }
    } else if (upper === "H") {
      x = px(a[0]);
      out.push(op("l", x, y));
    } else if (upper === "V") {
      y = py(a[0]);
      out.push(op("l", x, y));
    } else if (upper === "C" || upper === "S") {
      const c1x =
          upper === "C" ? px(a[0]) : /[CS]/.test(previous) ? 2 * x - cx : x,
        c1y = upper === "C" ? py(a[1]) : /[CS]/.test(previous) ? 2 * y - cy : y,
        offset = upper === "C" ? 2 : 0;
      cx = px(a[offset]);
      cy = py(a[offset + 1]);
      x = px(a[offset + 2]);
      y = py(a[offset + 3]);
      out.push(op("c", c1x, c1y, cx, cy, x, y));
    } else if (upper === "Q" || upper === "T") {
      const controlX =
          upper === "Q" ? px(a[0]) : /[QT]/.test(previous) ? 2 * x - qx : x,
        controlY =
          upper === "Q" ? py(a[1]) : /[QT]/.test(previous) ? 2 * y - qy : y,
        offset = upper === "Q" ? 2 : 0,
        nx = px(a[offset]),
        ny = py(a[offset + 1]);
      out.push(
        op(
          "c",
          x + ((controlX - x) * 2) / 3,
          y + ((controlY - y) * 2) / 3,
          nx + ((controlX - nx) * 2) / 3,
          ny + ((controlY - ny) * 2) / 3,
          nx,
          ny,
        ),
      );
      qx = controlX;
      qy = controlY;
      x = nx;
      y = ny;
    } else if (upper === "A") {
      const nx = px(a[5]),
        ny = py(a[6]);
      out.push(...arc(x, y, a[0], a[1], a[2], a[3], a[4], nx, ny));
      x = nx;
      y = ny;
    }
    previous = upper;
  }
  return out;
}
export function drawSvgPath(path: string, options: DrawOptions = {}) {
  return [
    pushGraphicsState(),
    transform(options, options.scale ?? 1, -(options.scale ?? 1)),
    ...style(options),
    ...svgPathOperators(path),
    paint(options),
    popGraphicsState(),
  ];
}
export type Bounds = { x: number; y: number; width: number; height: number };
export type TextLine = {
  text: string;
  encoded: PDFHexString;
  x: number;
  y: number;
  width: number;
  height: number;
};
type LayoutOptions = {
  font: PDFFont;
  fontSize?: number;
  bounds: Bounds;
  alignment?: TextAlignment;
  cellCount?: number;
};
const lineAt = (
  text: string,
  size: number,
  y: number,
  options: LayoutOptions,
): TextLine => {
  const width = options.font.widthOfTextAtSize(text, size),
    bounds = options.bounds;
  return {
    text,
    encoded: options.font.encodeText(text),
    x:
      bounds.x +
      (options.alignment === TextAlignment.Center
        ? (bounds.width - width) / 2
        : options.alignment === TextAlignment.Right
          ? bounds.width - width
          : 0),
    y,
    width,
    height: options.font.heightAtSize(size),
  };
};
export function layoutSinglelineText(text: string, options: LayoutOptions) {
  const clean = text.replace(/[\r\n]+/g, " "),
    size =
      options.fontSize ||
      Math.min(
        options.bounds.height / options.font.heightAtSize(1),
        options.bounds.width /
          Math.max(0.001, options.font.widthOfTextAtSize(clean, 1)),
      );
  const line = lineAt(
    clean,
    size,
    options.bounds.y +
      (options.bounds.height -
        options.font.heightAtSize(size, { descender: false })) /
        2,
    options,
  );
  return { fontSize: size, line, bounds: options.bounds };
}
export function layoutCombedText(
  text: string,
  options: LayoutOptions & { cellCount: number },
) {
  if (!options.cellCount)
    throw new Error("Combed text requires a positive cell count");
  const chars = Array.from(text);
  if (chars.length > options.cellCount)
    throw new Error("Combed text exceeds the field length");
  const size = options.fontSize || options.bounds.height * 0.8,
    cell = options.bounds.width / options.cellCount;
  return {
    fontSize: size,
    cells: chars.map((char, i) =>
      lineAt(
        char,
        size,
        options.bounds.y +
          (options.bounds.height -
            options.font.heightAtSize(size, { descender: false })) /
            2,
        {
          ...options,
          bounds: {
            ...options.bounds,
            x: options.bounds.x + cell * i,
            width: cell,
          },
          alignment: TextAlignment.Center,
        },
      ),
    ),
    bounds: options.bounds,
  };
}
export function layoutMultilineText(text: string, options: LayoutOptions) {
  const wrap = (size: number) => {
    const lines: string[] = [];
    for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
      const chars = Array.from(paragraph);
      let start = 0;
      if (!chars.length) lines.push("");
      while (start < chars.length) {
        let end = start,
          lastBreak = -1;
        for (; end < chars.length; end++) {
          if (
            options.font.widthOfTextAtSize(
              chars.slice(start, end + 1).join(""),
              size,
            ) > options.bounds.width &&
            end > start
          )
            break;
          if (/\s/.test(chars[end])) lastBreak = end;
        }
        if (end < chars.length && lastBreak >= start) end = lastBreak + 1;
        lines.push(chars.slice(start, end).join("").trimEnd());
        start = end;
      }
    }
    return lines;
  };
  let size =
    options.fontSize ||
    Math.max(
      1,
      Math.min(500, options.bounds.height / options.font.heightAtSize(1)),
    );
  if (!options.fontSize) {
    let low = 1,
      high = size;
    for (let i = 0; i < 12; i++) {
      const middle = (low + high) / 2;
      if (
        wrap(middle).length * options.font.heightAtSize(middle) * 1.2 <=
        options.bounds.height
      )
        low = middle;
      else high = middle;
    }
    size = low;
  }
  const lineHeight = options.font.heightAtSize(size) * 1.2;
  const lines = wrap(size).map((text, index) =>
    lineAt(
      text,
      size,
      options.bounds.y + options.bounds.height - (index + 1) * lineHeight,
      options,
    ),
  );
  return { fontSize: size, lineHeight, lines, bounds: options.bounds };
}
export function drawTextField(
  options: DrawOptions & {
    font: string | PDFName;
    fontSize: number;
    textColor: Color;
    textLines: Pick<TextLine, "encoded" | "x" | "y">[];
    padding: number;
  },
) {
  const out = drawRectangle(options),
    x = options.x ?? 0,
    y = options.y ?? 0,
    pad = (options.borderWidth ?? 0) / 2 + options.padding;
  out.push(
    pushGraphicsState(),
    op(
      "re",
      x + pad,
      y + pad,
      Math.max(0, (options.width ?? 0) - 2 * pad),
      Math.max(0, (options.height ?? 0) - 2 * pad),
    ),
    op("W"),
    op("n"),
    op("BT"),
    setFillingColor(options.textColor),
    setFontAndSize(options.font, options.fontSize),
  );
  for (const line of options.textLines)
    out.push(op("Tm", 1, 0, 0, 1, line.x, line.y), op("Tj", line.encoded));
  out.push(op("ET"), popGraphicsState());
  return out;
}
