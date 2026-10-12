import { Matrix } from "./matrix.js";
import { PDFObject } from "./object.js";
import { PDFBuffer, decoder } from "./runtime.js";
import type { PDFDocument } from "./document.js";
import type {
  Glyph,
  Matrix as MatrixType,
  PageText,
  Quad,
  Rect,
  RenderOptions,
} from "./types.js";

export class PDFPage {
  constructor(
    readonly document: PDFDocument,
    public pointer: number,
    readonly index: number,
  ) {
    if (!pointer) throw new Error("PDFium could not load the page.");
    document.pages.add(this);
  }
  assertOpen() {
    this.document.assertOpen();
    if (!this.pointer) throw new Error("PDF page is closed.");
  }
  getObject() {
    this.assertOpen();
    const rt = this.document.runtime;
    const pointer = rt.call("LPDF_PageDictionary", this.pointer);
    try {
      return this.document.newIndirect(rt.call("LPDF_ObjectNumber", pointer));
    } finally {
      rt.call("LPDF_Drop", pointer);
    }
  }
  geometry() {
    const object = this.getObject();
    const read = (key: string) => {
      const value = object.getInheritable(key);
      try {
        if (value.isNumber()) return value.asNumber();
        if (value.isArray() && value.length === 4)
          return Array.from({ length: 4 }, (_, i) => {
            const item = value.get(i);
            try {
              return item.asNumber();
            } finally {
              item.destroy();
            }
          }) as Rect;
      } finally {
        value.destroy();
      }
    };
    try {
      const media = (read("MediaBox") as Rect | undefined) ?? [0, 0, 612, 792];
      const crop = (read("CropBox") as Rect | undefined) ?? media;
      let box: Rect = [
        Math.max(media[0], crop[0]),
        Math.max(media[1], crop[1]),
        Math.min(media[2], crop[2]),
        Math.min(media[3], crop[3]),
      ];
      if (box[2] <= box[0] || box[3] <= box[1]) box = media;
      const rotation = ((Number(read("Rotate") ?? 0) % 360) + 360) % 360;
      const unit = Number(read("UserUnit") ?? 1);
      return {
        box,
        rotation,
        unit: unit > 0 && Number.isFinite(unit) ? unit : 1,
      };
    } finally {
      object.destroy();
    }
  }
  getTransform(): MatrixType {
    const {
      box: [x0, y0, x1, y1],
      rotation,
      unit: u,
    } = this.geometry();
    if (rotation === 90) return [0, u, u, 0, -y0 * u, -x0 * u];
    if (rotation === 180) return [-u, 0, 0, u, x1 * u, -y0 * u];
    if (rotation === 270) return [0, -u, -u, 0, y1 * u, x1 * u];
    return [u, 0, 0, -u, -x0 * u, y1 * u];
  }
  getBounds(): Rect {
    const { box, rotation, unit } = this.geometry();
    const w = (box[2] - box[0]) * unit,
      h = (box[3] - box[1]) * unit;
    return [0, 0, rotation % 180 ? h : w, rotation % 180 ? w : h];
  }
  render(matrix: MatrixType, bounds: Rect, options: RenderOptions = {}) {
    this.assertOpen();
    const rt = this.document.runtime;
    const width = Math.ceil(bounds[2]) - Math.floor(bounds[0]),
      height = Math.ceil(bounds[3]) - Math.floor(bounds[1]);
    if (
      ![...matrix, ...bounds].every(Number.isFinite) ||
      width < 1 ||
      height < 1 ||
      width * height > 64_000_000
    )
      throw new Error("Invalid PDF raster dimensions.");
    const m = new Float64Array(matrix);
    m[4] -= Math.floor(bounds[0]);
    m[5] -= Math.floor(bounds[1]);
    const refs = options.keepAnnotations
      ? new Uint32Array([...options.keepAnnotations])
      : undefined;
    const call = (mp: number, rp = 0) =>
      rt.call(
        "LPDF_Render",
        this.document.pointer,
        this.pointer,
        width,
        height,
        mp,
        options.contents === false ? 0 : 1,
        options.annotations ? 1 : 0,
        rp,
        refs?.length ?? 0,
        options.transparent ? 1 : 0,
        options.imageCache === "reuse" ? 0 : 1,
      );
    const pointer = rt.withBytes(new Uint8Array(m.buffer), (mp) =>
      refs
        ? rt.withBytes(new Uint8Array(refs.buffer), (rp) => call(mp, rp))
        : call(mp),
    );
    if (!pointer) throw new Error("PDFium could not render the page.");
    return new PDFPixmap(
      rt,
      pointer,
      width,
      height,
      Math.floor(bounds[0]),
      Math.floor(bounds[1]),
    );
  }
  toPixmap(
    matrix: MatrixType,
    _colorspace?: unknown,
    alpha = false,
    annotations = true,
  ) {
    const transform = Matrix.concat(this.getTransform(), matrix);
    const bounds = this.getBounds();
    const corners = [
      [0, 0],
      [bounds[2], 0],
      [0, bounds[3]],
      [bounds[2], bounds[3]],
    ].map(([x, y]) => [
      x * matrix[0] + y * matrix[2] + matrix[4],
      x * matrix[1] + y * matrix[3] + matrix[5],
    ]);
    return this.render(
      transform,
      [
        Math.min(...corners.map((p) => p[0])),
        Math.min(...corners.map((p) => p[1])),
        Math.max(...corners.map((p) => p[0])),
        Math.max(...corners.map((p) => p[1])),
      ],
      { transparent: alpha, annotations },
    );
  }
  extractText(): PageText {
    this.assertOpen();
    const rt = this.document.runtime;
    const text = rt.call("FPDFText_LoadPage", this.pointer);
    if (!text) throw new Error("PDFium could not read page text.");
    const scratch = rt.call("malloc", 128);
    const lines: PageText["lines"] = [];
    let line: PageText["lines"][number] | undefined;
    const fonts = new Map<number, string>();
    try {
      const count = rt.call("FPDFText_CountChars", text);
      for (let i = 0; i < count; i++) {
        const code = rt.call("FPDFText_GetUnicode", text, i);
        if (!code) continue;
        const char = String.fromCodePoint(code);
        if (char === "\r" || char === "\n") {
          line = undefined;
          continue;
        }
        const object = rt.call("LPDF_GlyphGeometry", text, i, scratch);
        const data = rt.native.HEAPF64.slice(scratch / 8, scratch / 8 + 12);
        const quad = [...data.slice(0, 8)] as Quad;
        const origin: [number, number] = [data[8], data[9]];
        const writingMode = data[10],
          size = data[11];
        let fontName = fonts.get(object);
        if (!fontName) {
          const needed = rt.call(
            "FPDFText_GetFontInfo",
            text,
            i,
            0,
            0,
            scratch + 96,
          );
          fontName = "sans-serif";
          if (needed) {
            const font = rt.call("malloc", needed);
            try {
              rt.call(
                "FPDFText_GetFontInfo",
                text,
                i,
                font,
                needed,
                scratch + 96,
              );
              fontName = decoder.decode(
                rt.native.HEAPU8.subarray(font, font + needed - 1),
              );
            } finally {
              rt.call("free", font);
            }
          }
          fonts.set(object, fontName);
        }
        const color = rt.call(
          "FPDFText_GetFillColor",
          text,
          i,
          scratch,
          scratch + 4,
          scratch + 8,
          scratch + 12,
        )
          ? [...rt.native.HEAPU32.subarray(scratch / 4, scratch / 4 + 3)].map(
              (v) => v / 255,
            )
          : [0, 0, 0];
        const glyph: Glyph = {
          text: char,
          origin,
          quad,
          fontName,
          fontSize: size,
          color,
        };
        if (!line || line.writingMode !== writingMode) {
          line = { writingMode, glyphs: [] };
          lines.push(line);
        }
        line.glyphs.push(glyph);
      }
      return {
        text: lines
          .map((item) => item.glyphs.map((glyph) => glyph.text).join(""))
          .join("\n"),
        lines,
      };
    } finally {
      rt.call("free", scratch);
      rt.call("FPDFText_ClosePage", text);
    }
  }
  redactText(quads: Quad[]) {
    this.assertOpen();
    if (
      !quads.every((quad) => quad.length === 8 && quad.every(Number.isFinite))
    )
      throw new Error("Invalid PDF text region.");
    if (!quads.length) return;
    const data = new Float64Array(quads.flat());
    const rt = this.document.runtime;
    const result = rt.withBytes(new Uint8Array(data.buffer), (p) =>
      rt.call(
        "LPDF_RedactText",
        this.document.pointer,
        this.pointer,
        p,
        quads.length,
      ),
    );
    if (result < 0)
      throw new Error("PDFium could not safely rewrite this text operator.");
    // Parsed content no longer matches the page dictionary after the edit.
    rt.call("LPDF_ClosePage", this.pointer);
    this.pointer = rt.call("LPDF_LoadPage", this.document.pointer, this.index);
  }
  private annotations(widgets: boolean) {
    const page = this.getObject(),
      array = page.get("Annots");
    const result: PDFAnnotation[] = [];
    try {
      for (let i = 0; i < array.length; i++) {
        const object = array.get(i),
          subtype = object.get("Subtype");
        try {
          if ((subtype.asName() === "Widget") === widgets)
            result.push(new PDFAnnotation(this, object));
          else object.destroy();
        } finally {
          subtype.destroy();
        }
      }
      return result;
    } finally {
      array.destroy();
      page.destroy();
    }
  }
  getAnnotations() {
    return this.annotations(false);
  }
  getWidgets() {
    return this.annotations(true);
  }
  destroy() {
    if (!this.pointer) return;
    this.document.runtime.call("LPDF_ClosePage", this.pointer);
    this.pointer = 0;
    this.document.pages.delete(this);
  }
}

export class PDFPixmap extends PDFBuffer {
  constructor(
    runtime: PDFBuffer["runtime"],
    pointer: number,
    readonly width: number,
    readonly height: number,
    readonly x = 0,
    readonly y = 0,
  ) {
    super(runtime, pointer);
  }
  getWidth() {
    return this.width;
  }
  getHeight() {
    return this.height;
  }
  getX() {
    return this.x;
  }
  getY() {
    return this.y;
  }
  getPixels() {
    return this.asUint8Array();
  }
  asPNG() {
    const buffer = this.runtime.buffer(
      this.runtime.call(
        "LPDF_EncodePng",
        this.pointer,
        this.width,
        this.height,
      ),
    );
    try {
      return buffer.asUint8Array().slice();
    } finally {
      buffer.destroy();
    }
  }
}

export class PDFAnnotation {
  constructor(
    readonly page: PDFPage,
    private readonly object: PDFObject,
  ) {}
  getObject() {
    return this.object.copy();
  }
  getContents() {
    const value = this.object.get("Contents");
    try {
      return value.asString();
    } finally {
      value.destroy();
    }
  }
  getValue() {
    const value = this.object.getInheritable("V");
    try {
      return value.isName() ? value.asName() : value.asString();
    } finally {
      value.destroy();
    }
  }
  destroy() {
    this.object.destroy();
  }
}
