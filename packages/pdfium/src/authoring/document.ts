// Copyright (c) 2026 Legir contributors. BSD-3-Clause.
import {
  PDFArray,
  PDFCatalog,
  PDFContentStream,
  PDFContext,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPageLeaf,
  PDFRef,
  PDFStream,
  PDFString,
  PDFOperator,
} from "./objects.js";
import { PDFFont, StandardFonts, type Fontkit } from "./fonts.js";
import { PDFForm } from "./forms.js";
import {
  type Bounds,
  type Color,
  type DrawOptions,
  type Rotation,
  concatTransformationMatrix,
  degrees,
  drawEllipse,
  drawImage,
  drawRectangle,
  drawSvgPath,
  op,
  rgb,
  setFillingColor,
  setFontAndSize,
} from "./operators.js";
import { PDFImage, embedJpeg, embedPng, decodeImageInput } from "./images.js";
import { PDFSvg, drawSvg } from "./svg.js";
import type { NativeEditingContext } from "./nativeContext.js";
import type { SaveOptions } from "../types.js";
import { createPDFium, type PDFium } from "../index.js";
let defaultEngine: Promise<PDFium> | undefined;
const ownedDocuments = new FinalizationRegistry<
  InstanceType<PDFium["PDFDocument"]>
>((native) => native.destroy());
export class EncryptedPDFError extends Error {
  constructor() {
    super("The PDF password is missing or incorrect.");
    this.name = "EncryptedPDFError";
  }
}
export class PDFDocument {
  readonly catalog: PDFCatalog;
  nativeView?: NativeEditingContext;
  ownsNative = false;
  private pages?: PDFPage[];
  private form?: PDFForm;
  private readonly fonts: PDFFont[] = [];
  private fontkit?: Fontkit;
  private encryption?: SaveOptions;
  get isEncrypted() {
    const trailer = this.nativeView?.native.getTrailer();
    if (!trailer) return false;
    const encryption = trailer.get("Encrypt");
    try {
      return !encryption.isNull();
    } finally {
      encryption.destroy();
      trailer.destroy();
    }
  }
  constructor(readonly context: PDFContext) {
    this.catalog = context.lookup(context.trailerInfo.Root, PDFCatalog);
  }
  static async create() {
    const engine = await (defaultEngine ??= createPDFium());
    return this.fromNative(engine, new engine.PDFDocument());
  }
  static async load(
    input: Uint8Array | ArrayBuffer | string,
    options: {
      password?: string;
    } = {},
  ) {
    const engine = await (defaultEngine ??= createPDFium()),
      bytes = decodeImageInput(input),
      native = new engine.PDFDocument(bytes);
    try {
      if (
        native.needsPassword() &&
        !native.authenticatePassword(options.password ?? "")
      )
        throw new EncryptedPDFError();
      return await this.fromNative(engine, native);
    } catch (error) {
      native.destroy();
      throw error;
    }
  }
  private static async fromNative(
    engine: PDFium,
    native: InstanceType<PDFium["PDFDocument"]>,
  ) {
    const { NativeEditingContext } = await import("./nativeContext.js");
    const view = new NativeEditingContext(engine, native);
    view.document.ownsNative = true;
    ownedDocuments.register(view.document, native, view.document);
    return view.document;
  }
  destroy() {
    ownedDocuments.unregister(this);
    const view = this.nativeView;
    if (view) {
      view.dispose();
      if (this.ownsNative) view.native.destroy();
      this.nativeView = undefined;
    }
    this.pages = undefined;
    this.fonts.length = 0;
    this.form = undefined;
  }
  getPages() {
    if (this.pages) return this.pages;
    const result: PDFPage[] = [],
      seen = new Set<PDFDict>();
    const visit = (value: PDFObject | undefined) => {
      const node = this.context.lookup(value);
      if (!(node instanceof PDFDict) || seen.has(node)) return;
      seen.add(node);
      if (node instanceof PDFPageLeaf) {
        const ref =
          value instanceof PDFRef ? value : this.context.getObjectRef(node);
        if (ref) result.push(PDFPage.of(node, ref, this));
        return;
      }
      const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
      for (const child of kids?.asArray() ?? []) visit(child);
    };
    visit(this.catalog.get(PDFName.of("Pages")));
    this.pages = result;
    return result;
  }
  invalidatePages(pages?: readonly PDFPage[]) {
    this.pages = pages ? [...pages] : undefined;
  }
  getPageCount() {
    return this.getPages().length;
  }
  getPage(index: number) {
    const page = this.getPages()[index];
    if (!page) throw new Error("PDF page index is out of range");
    return page;
  }
  getPageIndices() {
    return this.getPages().map((_, i) => i);
  }
  addPage(page?: PDFPage | [number, number]) {
    return this.insertPage(this.getPageCount(), page);
  }
  insertPage(index: number, page?: PDFPage | [number, number]) {
    const created = page instanceof PDFPage ? page : PDFPage.create(this);
    if (Array.isArray(page)) created.setSize(...page);
    if (created.doc !== this)
      throw new Error("Cannot attach a foreign PDF page");
    const pages = this.getPages().slice();
    pages.splice(index, 0, created);
    this.replacePages(pages);
    return created;
  }
  removePage(index: number) {
    const pages = this.getPages().slice();
    if (index < 0 || index >= pages.length)
      throw new Error("PDF page index is out of range");
    pages.splice(index, 1);
    this.replacePages(pages);
  }
  private replacePages(pages: PDFPage[]) {
    if (!this.nativeView) throw new Error("Page assembly requires PDFium");
    this.nativeView.replacePages(pages);
  }
  async copyPages(source: PDFDocument, indexes: number[]) {
    if (!source.nativeView || !this.nativeView)
      throw new Error("Page copy requires native documents");
    const copier = await source.nativeView.createCopier(this.nativeView);
    try {
      return indexes.map((index) => {
        const ref = copier.copy(source.getPage(index).ref),
          node = this.context.lookup(ref, PDFPageLeaf);
        return PDFPage.of(node, ref, this);
      });
    } finally {
      copier.destroy();
    }
  }
  invalidateFieldNames() {
    this.form?.invalidateNames();
  }
  getForm() {
    return (this.form ??= new PDFForm(this));
  }
  registerFontkit(fontkit: unknown) {
    if (!fontkit || typeof (fontkit as Fontkit).create !== "function")
      throw new Error("Invalid font shaper");
    this.fontkit = fontkit as Fontkit;
  }
  embedStandardFont(name: StandardFonts | string) {
    const font = new PDFFont(this.context, name, undefined, true, this);
    this.fonts.push(font);
    return font;
  }
  async embedFont(
    source: StandardFonts | string | Uint8Array | ArrayBuffer,
    options: { subset?: boolean; customName?: string } = {},
  ) {
    if (
      typeof source === "string" &&
      Object.values(StandardFonts).includes(source as StandardFonts)
    )
      return this.embedStandardFont(source);
    const bytes = decodeImageInput(source);
    if (!this.fontkit)
      throw new Error(
        "Register a font shaper before embedding custom font bytes",
      );
    const font = new PDFFont(
      this.context,
      bytes,
      this.fontkit.create(bytes),
      options.subset ?? true,
      this,
    );
    this.fonts.push(font);
    return font;
  }
  async embedJpg(input: Uint8Array | ArrayBuffer | string) {
    return embedJpeg(this.context, decodeImageInput(input));
  }
  async embedPng(input: Uint8Array | ArrayBuffer | string) {
    return embedPng(this.context, decodeImageInput(input));
  }
  async embedSvg(source: string) {
    return new PDFSvg(source).prepareImages(this);
  }
  async flush() {
    if (this.nativeView) await this.nativeView.flush();
    else await this.flushFonts();
  }
  /** @internal The context flushes streams after finalizing font subsets. */
  async flushFonts() {
    for (const font of this.fonts) await font.embed();
  }
  encrypt(options: {
    userPassword?: string;
    ownerPassword?: string;
    permissions?: {
      printing?: boolean | string;
      modifying?: boolean;
      copying?: boolean;
      annotating?: boolean;
      fillingForms?: boolean;
      contentAccessibility?: boolean;
      documentAssembly?: boolean;
    };
  }) {
    const p = options.permissions ?? {};
    let flags = 0xfffff0c0;
    for (const [name, bit] of [
      ["modifying", 3],
      ["copying", 4],
      ["annotating", 5],
      ["fillingForms", 8],
      ["contentAccessibility", 9],
      ["documentAssembly", 10],
    ] as const)
      if (p[name]) flags |= 1 << bit;
    if (p.printing) {
      flags |= 1 << 2;
      if (p.printing !== "lowResolution") flags |= 1 << 11;
    }
    this.encryption = {
      encrypt: "aes-256",
      "user-password": options.userPassword ?? "",
      "owner-password": options.ownerPassword ?? "",
      permissions: flags,
    };
  }
  async save(
    options: {
      updateFieldAppearances?: boolean;
      addDefaultPage?: boolean;
    } = {},
  ) {
    if (!this.nativeView) throw new Error("Saving requires a PDFium document");
    if (!this.getPageCount() && options.addDefaultPage !== false)
      this.addPage();
    if (
      options.updateFieldAppearances !== false &&
      this.catalog.has(PDFName.of("AcroForm"))
    )
      this.getForm().updateFieldAppearances();
    await this.nativeView.flush();
    const buffer = this.nativeView.native.saveToBuffer(this.encryption);
    try {
      return buffer.asUint8Array().slice();
    } finally {
      buffer.destroy();
    }
  }
  private info() {
    let info = this.context.lookupMaybe(this.context.trailerInfo.Info, PDFDict);
    if (!info) {
      info = this.context.obj({});
      this.context.trailerInfo.Info = this.context.register(info);
    }
    return info;
  }
  private setInfo(name: string, value: string) {
    this.info().set(PDFName.of(name), PDFHexString.fromText(value));
  }
  private getInfo(name: string) {
    return this.context
      .lookupMaybe(this.context.trailerInfo.Info, PDFDict)
      ?.lookupMaybe(PDFName.of(name), PDFString)
      ?.decodeText();
  }
  setTitle(value: string, _options?: { showInWindowTitleBar?: boolean }) {
    this.setInfo("Title", value);
  }
  getTitle() {
    return this.getInfo("Title");
  }
  setAuthor(value: string) {
    this.setInfo("Author", value);
  }
  getAuthor() {
    return this.getInfo("Author");
  }
  setSubject(value: string) {
    this.setInfo("Subject", value);
  }
  getSubject() {
    return this.getInfo("Subject");
  }
  setCreator(value: string) {
    this.setInfo("Creator", value);
  }
  getCreator() {
    return this.getInfo("Creator");
  }
  setProducer(value: string) {
    this.setInfo("Producer", value);
  }
  getProducer() {
    return this.getInfo("Producer");
  }
  setKeywords(value: string[]) {
    this.setInfo("Keywords", value.join(" "));
  }
  getKeywords() {
    return this.getInfo("Keywords");
  }
  setCreationDate(date: Date) {
    this.info().set(PDFName.of("CreationDate"), PDFString.fromDate(date));
  }
  setModificationDate(date: Date) {
    this.info().set(PDFName.of("ModDate"), PDFString.fromDate(date));
  }
  getCreationDate() {
    return this.context
      .lookupMaybe(this.context.trailerInfo.Info, PDFDict)
      ?.lookupMaybe(PDFName.of("CreationDate"), PDFString)
      ?.decodeDate();
  }
  getModificationDate() {
    return this.context
      .lookupMaybe(this.context.trailerInfo.Info, PDFDict)
      ?.lookupMaybe(PDFName.of("ModDate"), PDFString)
      ?.decodeDate();
  }
  setLanguage(value: string) {
    this.catalog.set(PDFName.of("Lang"), PDFHexString.fromText(value));
  }
}
export class PDFPage {
  static of(node: PDFPageLeaf, ref: PDFRef, doc: PDFDocument) {
    return new PDFPage(node, ref, doc);
  }
  static create(doc: PDFDocument) {
    const node = PDFPageLeaf.fromMapWithContext(
      new Map(
        doc.context
          .obj({
            Type: "Page",
            Parent: PDFRef.of(-1),
            MediaBox: [0, 0, 595.28, 841.89],
            Resources: {},
            Annots: [],
          })
          .entries(),
      ),
      doc.context,
    ) as PDFPageLeaf;
    return new PDFPage(node, doc.context.register(node), doc);
  }
  private content?: PDFContentStream;
  private font?: PDFFont;
  private fontSize = 24;
  private fontColor: Color = rgb(0, 0, 0);
  private x = 0;
  private y = 0;
  constructor(
    readonly node: PDFPageLeaf,
    readonly ref: PDFRef,
    readonly doc: PDFDocument,
  ) {}
  getMediaBox() {
    return this.node.MediaBox().asRectangle();
  }
  getCropBox() {
    return this.node.CropBox()?.asRectangle() ?? this.getMediaBox();
  }
  getSize() {
    const { width, height } = this.getMediaBox();
    return { width, height };
  }
  getWidth() {
    return this.getSize().width;
  }
  getHeight() {
    return this.getSize().height;
  }
  setMediaBox(x: number, y: number, width: number, height: number) {
    this.node.set(
      PDFName.of("MediaBox"),
      this.doc.context.obj([x, y, x + width, y + height]),
    );
  }
  setCropBox(x: number, y: number, width: number, height: number) {
    this.node.set(
      PDFName.of("CropBox"),
      this.doc.context.obj([x, y, x + width, y + height]),
    );
  }
  setTrimBox(x: number, y: number, width: number, height: number) {
    this.node.set(
      PDFName.of("TrimBox"),
      this.doc.context.obj([x, y, x + width, y + height]),
    );
  }
  setBleedBox(x: number, y: number, width: number, height: number) {
    this.node.set(
      PDFName.of("BleedBox"),
      this.doc.context.obj([x, y, x + width, y + height]),
    );
  }
  setArtBox(x: number, y: number, width: number, height: number) {
    this.node.set(
      PDFName.of("ArtBox"),
      this.doc.context.obj([x, y, x + width, y + height]),
    );
  }
  setSize(width: number, height: number) {
    const box = this.getMediaBox();
    this.setMediaBox(box.x, box.y, width, height);
  }
  getRotation() {
    return degrees(this.node.Rotate()?.asNumber() ?? 0);
  }
  setRotation(rotation: Rotation) {
    this.node.set(
      PDFName.of("Rotate"),
      PDFNumber.of(
        rotation.type === "degrees"
          ? rotation.angle
          : (rotation.angle * 180) / Math.PI,
      ),
    );
  }
  setFont(font: PDFFont) {
    this.font = font;
  }
  setFontSize(size: number) {
    this.fontSize = size;
  }
  setFontColor(color: Color) {
    this.fontColor = color;
  }
  moveTo(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  getPosition() {
    return { x: this.x, y: this.y };
  }
  pushOperators(...operators: PDFOperator[]) {
    if (!this.content) {
      this.content = PDFContentStream.of(this.doc.context.obj({}), []);
      const ref = this.doc.context.register(this.content);
      this.node.addContentStream(ref);
    }
    this.content.push(...operators);
  }
  private style(options: DrawOptions) {
    if (options.opacity === undefined && options.borderOpacity === undefined)
      return options;
    const ref = this.doc.context.register(
      this.doc.context.obj({
        Type: "ExtGState",
        ca: options.opacity ?? 1,
        CA: options.borderOpacity ?? options.opacity ?? 1,
      }),
    );
    return { ...options, graphicsState: this.node.newExtGState("GS", ref) };
  }
  drawRectangle(options: DrawOptions = {}) {
    this.pushOperators(...drawRectangle(this.style(options)));
  }
  drawEllipse(options: DrawOptions = {}) {
    this.pushOperators(...drawEllipse(this.style(options)));
  }
  drawSvgPath(path: string, options: DrawOptions = {}) {
    this.pushOperators(...drawSvgPath(path, this.style(options)));
  }
  drawLine(options: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    thickness?: number;
    color?: Color;
    opacity?: number;
    dashArray?: number[];
    dashPhase?: number;
  }) {
    const style = this.style({ opacity: options.opacity });
    this.pushOperators(
      op("q"),
      ...(style.graphicsState ? [op("gs", style.graphicsState)] : []),
      op("w", options.thickness ?? 1),
      op(
        "RG",
        ...(options.color && options.color.type === "RGB"
          ? [options.color.red, options.color.green, options.color.blue]
          : [0, 0, 0]),
      ),
      op("m", options.start.x, options.start.y),
      op("l", options.end.x, options.end.y),
      op("S"),
      op("Q"),
    );
  }
  drawText(
    text: string,
    options: {
      font?: PDFFont;
      size?: number;
      x?: number;
      y?: number;
      color?: Color;
      rotate?: Rotation;
      lineHeight?: number;
      maxWidth?: number;
      opacity?: number;
      xSkew?: Rotation;
      ySkew?: Rotation;
    } = {},
  ) {
    const font =
        options.font ??
        (this.font ??= this.doc.embedStandardFont(StandardFonts.Helvetica)),
      name = this.node.newFontDictionary(font.name, font.ref),
      size = options.size ?? this.fontSize,
      angle = options.rotate
        ? options.rotate.type === "degrees"
          ? (options.rotate.angle * Math.PI) / 180
          : options.rotate.angle
        : 0,
      c = Math.cos(angle),
      s = Math.sin(angle),
      style = this.style(options);
    const lines: string[] = [];
    for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
      let line = "";
      for (const ch of Array.from(paragraph)) {
        if (
          options.maxWidth &&
          line &&
          font.widthOfTextAtSize(line + ch, size) > options.maxWidth
        ) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
      lines.push(line);
    }
    this.pushOperators(
      op("q"),
      ...(style.graphicsState ? [op("gs", style.graphicsState)] : []),
      op("BT"),
      setFillingColor(options.color ?? this.fontColor),
      setFontAndSize(name, size),
    );
    lines.forEach((line, i) => {
      const dy = -i * (options.lineHeight ?? size * 1.2);
      this.pushOperators(
        op(
          "Tm",
          c,
          s,
          -s,
          c,
          (options.x ?? this.x) - s * dy,
          (options.y ?? this.y) + c * dy,
        ),
        op("Tj", font.encodeText(line)),
      );
    });
    this.pushOperators(op("ET"), op("Q"));
  }
  drawImage(image: PDFImage, options: DrawOptions = {}) {
    const name = this.node.newXObject("Image", image.ref);
    this.pushOperators(
      ...drawImage(
        name,
        this.style({ width: image.width, height: image.height, ...options }),
      ),
    );
  }
  drawSvg(
    svg: PDFSvg,
    options: DrawOptions & { fonts?: Record<string, PDFFont> } = {},
  ) {
    drawSvg(this, svg, options);
  }
  drawAppearance(stream: PDFStream, rect: Bounds) {
    const bbox = stream.dict
        .lookupMaybe(PDFName.of("BBox"), PDFArray)
        ?.asRectangle() ?? { x: 0, y: 0, width: 1, height: 1 },
      matrix = stream.dict
        .lookupMaybe(PDFName.of("Matrix"), PDFArray)
        ?.asArray()
        .map((v) => (v as PDFNumber).asNumber()) ?? [1, 0, 0, 1, 0, 0];
    const pts = [
        [bbox.x, bbox.y],
        [bbox.x + bbox.width, bbox.y],
        [bbox.x, bbox.y + bbox.height],
        [bbox.x + bbox.width, bbox.y + bbox.height],
      ].map(([x, y]) => [
        matrix[0] * x + matrix[2] * y + matrix[4],
        matrix[1] * x + matrix[3] * y + matrix[5],
      ]),
      left = Math.min(...pts.map((p) => p[0])),
      bottom = Math.min(...pts.map((p) => p[1])),
      width = Math.max(...pts.map((p) => p[0])) - left,
      height = Math.max(...pts.map((p) => p[1])) - bottom,
      sx = rect.width / (width || 1),
      sy = rect.height / (height || 1),
      ref =
        this.doc.context.getObjectRef(stream) ??
        this.doc.context.register(stream),
      name = this.node.newXObject("Field", ref);
    this.pushOperators(
      op("q"),
      concatTransformationMatrix(
        sx,
        0,
        0,
        sy,
        rect.x - left * sx,
        rect.y - bottom * sy,
      ),
      op("Do", name),
      op("Q"),
    );
  }
}
/** Used only for detached authored graphs. Native views use the C++ graft map. */
export class PDFObjectCopier {
  static for(source: PDFContext, target: PDFContext) {
    return new PDFObjectCopier(source, target);
  }
  private readonly refs = new Map<PDFRef, PDFRef>();
  private readonly objects = new Map<PDFObject, PDFObject>();
  constructor(
    private readonly source: PDFContext,
    private readonly target: PDFContext,
  ) {}
  copy<T extends PDFObject>(object: T): T {
    if (object instanceof PDFRef) {
      let ref = this.refs.get(object);
      if (!ref) {
        ref = this.target.nextRef();
        this.refs.set(object, ref);
        const value = this.source.lookup(object);
        if (!value) throw new Error("Missing copied resource");
        this.target.assign(ref, this.copy(value));
      }
      return ref as unknown as T;
    }
    const cached = this.objects.get(object);
    if (cached) return cached as T;
    const clone = object.clone(this.target);
    this.objects.set(object, clone);
    if (object instanceof PDFDict && clone instanceof PDFDict)
      for (const [key, value] of object.entries())
        clone.set(key, this.copy(value));
    else if (object instanceof PDFArray && clone instanceof PDFArray)
      object.asArray().forEach((value, i) => clone.set(i, this.copy(value)));
    else if (object instanceof PDFStream && clone instanceof PDFStream)
      for (const [key, value] of object.dict.entries())
        clone.dict.set(key, this.copy(value));
    return clone as T;
  }
}
