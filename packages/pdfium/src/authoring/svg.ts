// Copyright (c) 2026 Legir contributors. BSD-3-Clause.
import { DOMParser, type Element } from "@xmldom/xmldom";
import type { PDFFont } from "./fonts.js";
import { StandardFonts } from "./fonts.js";
import type { PDFDocument, PDFPage } from "./document.js";
import type { PDFImage } from "./images.js";
import {
  type Color,
  type DrawOptions,
  concatTransformationMatrix,
  op,
  rgb,
  setFillingColor,
  setStrokingColor,
  svgPathOperators,
} from "./operators.js";
const elements = (node: Element) =>
  Array.from(node.childNodes).filter(
    (child): child is Element => child.nodeType === 1,
  );
const numbers = (text: string) =>
  text.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)?.map(Number) ??
  [];
const named: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  gray: "#808080",
  grey: "#808080",
  orange: "#ffa500",
  purple: "#800080",
  transparent: "none",
  navy: "#000080",
  maroon: "#800000",
  teal: "#008080",
  lime: "#00ff00",
  silver: "#c0c0c0",
};
function color(value: string | undefined): Color | undefined {
  if (!value || value === "none") return undefined;
  value = named[value.toLowerCase()] ?? value;
  if (/^#[\da-f]{3}$/i.test(value))
    value = "#" + Array.from(value.slice(1), (c) => c + c).join("");
  if (/^#[\da-f]{6}/i.test(value))
    return rgb(
      parseInt(value.slice(1, 3), 16) / 255,
      parseInt(value.slice(3, 5), 16) / 255,
      parseInt(value.slice(5, 7), 16) / 255,
    );
  if (/^rgba?\(/i.test(value)) {
    const a = numbers(value);
    return rgb(
      a[0] / (value.includes("%") ? 100 : 255),
      a[1] / (value.includes("%") ? 100 : 255),
      a[2] / (value.includes("%") ? 100 : 255),
    );
  }
  throw new Error(`Unsupported SVG color ${value}`);
}
function transforms(text: string) {
  const output = [];
  for (const m of text.matchAll(
    /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g,
  )) {
    const v = numbers(m[2]);
    if (m[1] === "matrix" && v.length === 6)
      output.push(
        concatTransformationMatrix(v[0], v[1], v[2], v[3], v[4], v[5]),
      );
    else if (m[1] === "translate")
      output.push(concatTransformationMatrix(1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0));
    else if (m[1] === "scale")
      output.push(concatTransformationMatrix(v[0], 0, 0, v[1] ?? v[0], 0, 0));
    else if (m[1] === "rotate") {
      const angle = (v[0] * Math.PI) / 180,
        c = Math.cos(angle),
        s = Math.sin(angle),
        x = v[1] ?? 0,
        y = v[2] ?? 0;
      output.push(
        concatTransformationMatrix(
          c,
          s,
          -s,
          c,
          x - c * x + s * y,
          y - s * x - c * y,
        ),
      );
    } else if (m[1] === "skewX")
      output.push(
        concatTransformationMatrix(
          1,
          0,
          Math.tan((v[0] * Math.PI) / 180),
          1,
          0,
          0,
        ),
      );
    else if (m[1] === "skewY")
      output.push(
        concatTransformationMatrix(
          1,
          Math.tan((v[0] * Math.PI) / 180),
          0,
          1,
          0,
          0,
        ),
      );
  }
  return output;
}
export class PDFSvg {
  readonly root: Element;
  readonly width: number;
  readonly height: number;
  readonly images = new Map<Element, PDFImage>();
  constructor(source: string) {
    const document = new DOMParser({
      onError: (level) => {
        if (level === "fatalError") throw new Error("Invalid SVG XML");
      },
    }).parseFromString(source, "image/svg+xml");
    const root = document.documentElement;
    if (!root || root.localName !== "svg") throw new Error("Invalid SVG root");
    this.root = root;
    const box = numbers(root.getAttribute("viewBox") ?? "");
    this.width = parseFloat(root.getAttribute("width") ?? "") || box[2] || 300;
    this.height =
      parseFloat(root.getAttribute("height") ?? "") || box[3] || 150;
  }
  async prepareImages(doc: PDFDocument) {
    for (const node of Array.from(this.root.getElementsByTagName("image"))) {
      const href = node.getAttribute("href") ?? node.getAttribute("xlink:href");
      if (!href?.startsWith("data:image/"))
        throw new Error("SVG images must be embedded data URLs");
      this.images.set(
        node,
        href.startsWith("data:image/jpeg")
          ? await doc.embedJpg(href)
          : await doc.embedPng(href),
      );
    }
    return this;
  }
}
type Style = Record<string, string>;
function attributes(node: Element, parent: Style) {
  const out: Style = {};
  // Geometry, opacity and clipping are local; paint/font properties inherit.
  for (const key of [
    "fill",
    "stroke",
    "color",
    "fill-rule",
    "fill-opacity",
    "stroke-opacity",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "dominant-baseline",
    "visibility",
  ])
    if (parent[key] !== undefined) out[key] = parent[key];
  for (const attr of Array.from(node.attributes)) out[attr.name] = attr.value;
  for (const declaration of (node.getAttribute("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon >= 0)
      out[declaration.slice(0, colon).trim()] = declaration
        .slice(colon + 1)
        .trim();
  }
  out.__opacity = String(
    Number(parent.__opacity ?? 1) * Number(out.opacity ?? 1),
  );
  return out;
}
function shape(node: Element) {
  const a = (name: string, fallback = 0) =>
    parseFloat(node.getAttribute(name) ?? "") || fallback;
  const tag = node.localName ?? node.tagName;
  if (tag === "path") return svgPathOperators(node.getAttribute("d") ?? "");
  if (tag === "rect") {
    const x = a("x"),
      y = a("y"),
      w = a("width"),
      h = a("height"),
      rx = Math.min(a("rx", a("ry")), w / 2),
      ry = Math.min(a("ry", rx), h / 2);
    if (!rx && !ry) return [op("re", x, y, w, h)];
    return svgPathOperators(
      `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`,
    );
  }
  if (tag === "line")
    return [op("m", a("x1"), a("y1")), op("l", a("x2"), a("y2"))];
  if (tag === "polyline" || tag === "polygon") {
    const coords = numbers(node.getAttribute("points") ?? ""),
      out = [];
    for (let i = 0; i + 1 < coords.length; i += 2)
      out.push(op(i ? "l" : "m", coords[i], coords[i + 1]));
    if (tag === "polygon") out.push(op("h"));
    return out;
  }
  if (tag === "circle" || tag === "ellipse") {
    const x = a("cx"),
      y = a("cy"),
      rx = a("rx", a("r")),
      ry = a("ry", a("r")),
      k = 0.5522847498307936;
    return [
      op("m", x + rx, y),
      op("c", x + rx, y + k * ry, x + k * rx, y + ry, x, y + ry),
      op("c", x - k * rx, y + ry, x - rx, y + k * ry, x - rx, y),
      op("c", x - rx, y - k * ry, x - k * rx, y - ry, x, y - ry),
      op("c", x + k * rx, y - ry, x + rx, y - k * ry, x + rx, y),
      op("h"),
    ];
  }
  return undefined;
}
function baselineOffset(
  value: string | undefined,
  font: PDFFont,
  size: number,
) {
  const ascent = font.heightAtSize(size, { descender: false }),
    height = font.heightAtSize(size);
  if (value === "middle" || value === "central") return ascent - height / 2;
  if (value === "hanging") return ascent;
  if (value === "text-before-edge") return size;
  if (value === "mathematical") return size * 0.6;
  if (value === "text-after-edge" || value === "ideographic")
    return ascent - height;
  return 0;
}
export function drawSvg(
  page: PDFPage,
  svg: PDFSvg,
  options: DrawOptions & { fonts?: Record<string, PDFFont> } = {},
) {
  const context = page.doc.context,
    box = numbers(svg.root.getAttribute("viewBox") ?? "");
  const view = box.length === 4 ? box : [0, 0, svg.width, svg.height],
    width = options.width ?? svg.width,
    height = options.height ?? svg.height;
  let sx = width / view[2],
    sy = height / view[3],
    dx = 0,
    dy = 0;
  const aspect =
    svg.root.getAttribute("preserveAspectRatio") ?? "xMidYMid meet";
  if (!aspect.includes("none")) {
    sx = sy = aspect.includes("slice") ? Math.max(sx, sy) : Math.min(sx, sy);
    dx =
      (width - view[2] * sx) *
      (aspect.includes("xMin") ? 0 : aspect.includes("xMax") ? 1 : 0.5);
    dy =
      (height - view[3] * sy) *
      (aspect.includes("YMin") ? 0 : aspect.includes("YMax") ? 1 : 0.5);
  }
  const ids = new Map<string, Element>();
  const collect = (node: Element) => {
    const id = node.getAttribute("id");
    if (id) ids.set(id, node);
    elements(node).forEach(collect);
  };
  collect(svg.root);
  const fontCache = new Map<string, PDFFont>(),
    fontFor = (style: Style) => {
      const family = (style["font-family"] ?? "Helvetica")
        .split(",")[0]
        .replace(/["']/g, "")
        .trim();
      const bold =
          style["font-weight"] === "bold" ||
          Number(style["font-weight"]) >= 600,
        italic = style["font-style"] === "italic",
        serif = /times|serif/i.test(family) && !/sans/i.test(family),
        mono = /courier|mono/i.test(family);
      const mapped = [
        family + (bold ? "_bold" : "") + (italic ? "_italic" : ""),
        family + (bold ? "_bold" : ""),
        family + (italic ? "_italic" : ""),
        family,
      ]
        .map((name) => options.fonts?.[name])
        .find(Boolean);
      if (mapped) return mapped;
      const name = mono
        ? bold
          ? italic
            ? StandardFonts.CourierBoldOblique
            : StandardFonts.CourierBold
          : italic
            ? StandardFonts.CourierOblique
            : StandardFonts.Courier
        : serif
          ? bold
            ? italic
              ? StandardFonts.TimesRomanBoldItalic
              : StandardFonts.TimesRomanBold
            : italic
              ? StandardFonts.TimesRomanItalic
              : StandardFonts.TimesRoman
          : bold
            ? italic
              ? StandardFonts.HelveticaBoldOblique
              : StandardFonts.HelveticaBold
            : italic
              ? StandardFonts.HelveticaOblique
              : StandardFonts.Helvetica;
      let font = fontCache.get(name);
      if (!font) {
        font = page.doc.embedStandardFont(name);
        fontCache.set(name, font);
      }
      return font;
    };
  const active = new Set<Element>();
  const visit = (node: Element, parent: Style, depth: number) => {
    if (depth > 64 || active.has(node))
      throw new Error("Cyclic or excessively nested SVG");
    active.add(node);
    try {
      const style = attributes(node, parent),
        tag = node.localName ?? node.tagName;
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        [
          "defs",
          "style",
          "title",
          "desc",
          "metadata",
          "clipPath",
          "linearGradient",
          "radialGradient",
        ].includes(tag)
      )
        return;
      if (style.filter || style.mask)
        throw new Error("SVG filters and masks require a raster appearance");
      page.pushOperators(
        op("q"),
        ...transforms(node.getAttribute("transform") ?? ""),
      );
      const opacity = Number(style.__opacity ?? 1),
        fillOpacity = Number(style["fill-opacity"] ?? 1) * opacity,
        strokeOpacity = Number(style["stroke-opacity"] ?? 1) * opacity;
      if (fillOpacity !== 1 || strokeOpacity !== 1) {
        const ref = context.register(
          context.obj({
            Type: "ExtGState",
            ca: fillOpacity,
            CA: strokeOpacity,
          }),
        );
        page.pushOperators(op("gs", page.node.newExtGState("SvgAlpha", ref)));
      }
      const clipId = /url\(#([^)]*)\)/.exec(style["clip-path"] ?? "")?.[1];
      if (clipId) {
        const clip = ids.get(clipId);
        if (!clip) throw new Error("Missing SVG clip path");
        for (const child of elements(clip)) {
          const path = shape(child);
          if (path)
            page.pushOperators(
              ...transforms(child.getAttribute("transform") ?? ""),
              ...path,
            );
        }
        page.pushOperators(
          op(style["clip-rule"] === "evenodd" ? "W*" : "W"),
          op("n"),
        );
      }
      const path = shape(node);
      if (path) {
        const fillValue = style.fill ?? "black",
          stroke = color(
            style.stroke === "currentColor"
              ? (style.color ?? "black")
              : style.stroke,
          ),
          fill = fillValue.startsWith("url(")
            ? undefined
            : color(
                fillValue === "currentColor"
                  ? (style.color ?? "black")
                  : fillValue,
              );
        if (fillValue.startsWith("url("))
          throw new Error(
            "SVG gradient appearance requires a shading resource",
          );
        if (fill) page.pushOperators(setFillingColor(fill));
        if (stroke) page.pushOperators(setStrokingColor(stroke));
        page.pushOperators(
          op("w", parseFloat(style["stroke-width"] ?? "1")),
          op(
            "j",
            style["stroke-linejoin"] === "round"
              ? 1
              : style["stroke-linejoin"] === "bevel"
                ? 2
                : 0,
          ),
          op(
            "J",
            style["stroke-linecap"] === "round"
              ? 1
              : style["stroke-linecap"] === "square"
                ? 2
                : 0,
          ),
        );
        if (style["stroke-dasharray"] && style["stroke-dasharray"] !== "none")
          page.pushOperators(
            op(
              "d",
              `[${numbers(style["stroke-dasharray"]).join(" ")}]`,
              parseFloat(style["stroke-dashoffset"] ?? "0"),
            ),
          );
        page.pushOperators(
          ...path,
          op(
            fill
              ? stroke
                ? style["fill-rule"] === "evenodd"
                  ? "B*"
                  : "B"
                : style["fill-rule"] === "evenodd"
                  ? "f*"
                  : "f"
              : stroke
                ? "S"
                : "n",
          ),
        );
      } else if (tag === "text" || tag === "tspan") {
        const font = fontFor(style),
          size = parseFloat(style["font-size"] ?? "16"),
          text = Array.from(node.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.nodeValue ?? "")
            .join(""),
          x =
            parseFloat(node.getAttribute("x") ?? "0") +
            parseFloat(node.getAttribute("dx") ?? "0"),
          y =
            parseFloat(node.getAttribute("y") ?? "0") +
            parseFloat(node.getAttribute("dy") ?? "0"),
          advance = font.widthOfTextAtSize(text, size),
          anchor =
            style["text-anchor"] === "middle"
              ? 0.5
              : style["text-anchor"] === "end"
                ? 1
                : 0;
        page.pushOperators(
          op("q"),
          concatTransformationMatrix(
            1,
            0,
            0,
            -1,
            x - advance * anchor,
            y + baselineOffset(style["dominant-baseline"], font, size),
          ),
        );
        page.drawText(text, {
          x: 0,
          y: 0,
          size,
          font,
          color:
            color(
              style.fill === "currentColor"
                ? (style.color ?? "black")
                : (style.fill ?? "black"),
            ) ?? rgb(0, 0, 0),
        });
        page.pushOperators(op("Q"));
        for (const child of elements(node)) visit(child, style, depth + 1);
      } else if (tag === "image") {
        const image = svg.images.get(node);
        if (!image) throw new Error("SVG image was not prepared");
        const x = parseFloat(node.getAttribute("x") ?? "0"),
          y = parseFloat(node.getAttribute("y") ?? "0"),
          w = parseFloat(node.getAttribute("width") ?? "") || image.width,
          h = parseFloat(node.getAttribute("height") ?? "") || image.height;
        page.pushOperators(
          op("q"),
          concatTransformationMatrix(1, 0, 0, -1, x, y + h),
        );
        page.drawImage(image, { x: 0, y: 0, width: w, height: h });
        page.pushOperators(op("Q"));
      } else if (tag === "use") {
        const id = (
            node.getAttribute("href") ??
            node.getAttribute("xlink:href") ??
            ""
          ).replace(/^#/, ""),
          target = ids.get(id);
        if (!target) throw new Error("Missing SVG use target");
        page.pushOperators(
          concatTransformationMatrix(
            1,
            0,
            0,
            1,
            parseFloat(node.getAttribute("x") ?? "0"),
            parseFloat(node.getAttribute("y") ?? "0"),
          ),
        );
        visit(target, style, depth + 1);
      } else if (["svg", "g", "a", "symbol"].includes(tag)) {
        for (const child of elements(node)) visit(child, style, depth + 1);
      } else throw new Error(`Unsupported SVG element ${tag}`);
      page.pushOperators(op("Q"));
    } finally {
      active.delete(node);
    }
  };
  page.pushOperators(
    op("q"),
    concatTransformationMatrix(
      sx,
      0,
      0,
      -sy,
      (options.x ?? 0) + dx - view[0] * sx,
      (options.y ?? 0) - dy + view[1] * sy,
    ),
  );
  visit(svg.root, { fill: "black", stroke: "none" }, 0);
  page.pushOperators(op("Q"));
}
