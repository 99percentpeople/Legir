// Copyright (c) 2026 Legir contributors. BSD-3-Clause.
// Small authoring values and live views; parsing and serialization belong to PDFium.
const encoder = new TextEncoder();
export const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const hexToBytes = (text: string) => {
  const hex = text.replace(/\s/g, "");
  return Uint8Array.from({ length: Math.ceil(hex.length / 2) }, (_, i) =>
    parseInt((hex.slice(i * 2, i * 2 + 2) + "0").slice(0, 2), 16),
  );
};
export function utf16(text: string) {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set([254, 255]);
  for (let i = 0; i < text.length; i++) {
    bytes[i * 2 + 2] = text.charCodeAt(i) >> 8;
    bytes[i * 2 + 3] = text.charCodeAt(i) & 255;
  }
  return bytes;
}
const pdfDocSpecial = [
  0x2022, 0x2020, 0x2021, 0x2026, 0x2014, 0x2013, 0x0192, 0x2044, 0x2039,
  0x203a, 0x2212, 0x2030, 0x201e, 0x201c, 0x201d, 0x2018, 0x2019, 0x201a,
  0x2122, 0xfb01, 0xfb02, 0x0141, 0x0152, 0x0160, 0x0178, 0x017d, 0x0131,
  0x0142, 0x0153, 0x0161, 0x017e, 0xfffd,
];
export function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 254 && bytes[1] === 255)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 255 && bytes[1] === 254)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)
    return new TextDecoder().decode(bytes.subarray(3));
  return Array.from(bytes, (b) =>
    String.fromCodePoint(
      b >= 128 && b <= 159 ? pdfDocSpecial[b - 128] : b === 160 ? 0x20ac : b,
    ),
  ).join("");
}
export function numberText(value: number) {
  if (!Number.isFinite(value)) throw new Error("PDF number must be finite");
  if (Math.abs(value) < 1e-10) return "0";
  return value.toFixed(10).replace(/\.?0+$/, "") || "0";
}
export abstract class PDFObject {
  abstract toString(): string;
  clone(_context?: PDFContext): PDFObject {
    return this;
  }
  sizeInBytes() {
    return encoder.encode(this.toString()).length;
  }
  copyBytesInto(buffer: Uint8Array, offset: number) {
    const bytes = encoder.encode(this.toString());
    buffer.set(bytes, offset);
    return bytes.length;
  }
}
class NullObject extends PDFObject {
  toString() {
    return "null";
  }
}
export const PDFNull = new NullObject();
export class PDFBool extends PDFObject {
  static readonly True = new PDFBool(true);
  static readonly False = new PDFBool(false);
  constructor(private readonly value: boolean) {
    super();
  }
  asBoolean() {
    return this.value;
  }
  toString() {
    return String(this.value);
  }
}
export class PDFNumber extends PDFObject {
  static of(value: number) {
    return new PDFNumber(value);
  }
  constructor(private readonly value: number) {
    super();
  }
  asNumber() {
    return this.value;
  }
  toString() {
    return numberText(this.value);
  }
}
export class PDFName extends PDFObject {
  private static readonly cache = new Map<string, PDFName>();
  static of(name: string) {
    const raw = name.replace(/#([\da-f]{2})/gi, (_, byte: string) =>
      String.fromCharCode(parseInt(byte, 16)),
    );
    let value = PDFName.cache.get(raw);
    if (!value) {
      value = new PDFName(raw);
      PDFName.cache.set(raw, value);
    }
    return value;
  }
  private constructor(private readonly value: string) {
    super();
  }
  decodeText() {
    return this.value;
  }
  asString() {
    return this.toString();
  }
  toString() {
    return (
      "/" +
      this.value.replace(/[^\x21-\x7e]|[#%()/<>[\]{}]/g, (c) =>
        c.charCodeAt(0) <= 255
          ? "#" + c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()
          : Array.from(
              encoder.encode(c),
              (b) => "#" + b.toString(16).toUpperCase(),
            ).join(""),
      )
    );
  }
}
export class PDFRef extends PDFObject {
  private static readonly cache = new Map<string, PDFRef>();
  static of(number: number, generation = 0) {
    const key = `${number}:${generation}`;
    let value = this.cache.get(key);
    if (!value) {
      value = new PDFRef(number, generation);
      this.cache.set(key, value);
    }
    return value;
  }
  constructor(
    readonly objectNumber: number,
    readonly generationNumber = 0,
  ) {
    super();
  }
  toString() {
    return `${this.objectNumber} ${this.generationNumber} R`;
  }
}
export class PDFString extends PDFObject {
  static of(value: string) {
    return new PDFString(
      /[\u0080-\uffff]/.test(value) ? utf16(value) : encoder.encode(value),
    );
  }
  static fromDate(value: Date) {
    return PDFString.of(
      "D:" + value.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z",
    );
  }
  constructor(protected readonly bytes: Uint8Array) {
    super();
  }
  asBytes() {
    return this.bytes;
  }
  decodeText() {
    return decodeText(this.bytes);
  }
  asString() {
    return this.decodeText();
  }
  decodeDate() {
    const m =
      /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?'?/.exec(
        this.decodeText(),
      );
    if (!m) throw new Error("Invalid PDF date");
    return new Date(
      Date.UTC(
        +m[1],
        +(m[2] || 1) - 1,
        +(m[3] || 1),
        +(m[4] || 0),
        +(m[5] || 0),
        +(m[6] || 0),
      ) -
        (m[7] === "+" ? 1 : m[7] === "-" ? -1 : 0) *
          (Number(m[8] ?? 0) * 60 + Number(m[9] ?? 0)) *
          60000,
    );
  }
  toString() {
    return "<" + bytesToHex(this.bytes) + ">";
  }
}
export class PDFHexString extends PDFString {
  static of(value: string) {
    return new PDFHexString(hexToBytes(value));
  }
  static fromText(value: string) {
    return new PDFHexString(utf16(value));
  }
  static fromBytes(value: Uint8Array) {
    return new PDFHexString(value.slice());
  }
  asString() {
    return bytesToHex(this.bytes);
  }
}
type Class<T = PDFObject> = { prototype: T };
type ObjectKind = Class | typeof PDFNull;
type KindValue<K> = K extends Class<infer V> ? V : typeof PDFNull;
export class UnexpectedObjectTypeError extends Error {
  constructor(_types: unknown[], object: unknown) {
    super(
      `Unexpected PDF object type: ${object?.constructor?.name ?? "missing"}`,
    );
  }
}
export class PDFArray extends PDFObject {
  static withContext(context: PDFContext) {
    return new PDFArray(context);
  }
  private readonly items: PDFObject[] = [];
  constructor(readonly context: PDFContext) {
    super();
  }
  size() {
    return this.items.length;
  }
  get(index: number) {
    return this.items[index];
  }
  set(index: number, value: PDFObject) {
    this.items[index] = value;
  }
  push(value: PDFObject) {
    this.items.push(value);
  }
  insert(index: number, value: PDFObject) {
    this.items.splice(index, 0, value);
  }
  remove(index: number) {
    this.items.splice(index, 1);
  }
  asArray() {
    return this.items.slice();
  }
  indexOf(value: PDFObject) {
    const index = this.asArray().indexOf(value);
    return index < 0 ? undefined : index;
  }
  lookup(index: number): PDFObject | undefined;
  lookup<K extends ObjectKind[]>(
    index: number,
    ...types: K
  ): KindValue<K[number]>;
  lookup(index: number, ...types: ObjectKind[]) {
    return this.context.lookup(this.get(index), ...types);
  }
  lookupMaybe<K extends ObjectKind[]>(
    index: number,
    ...types: K
  ): KindValue<K[number]> | undefined {
    return this.context.lookupMaybe(this.get(index), ...types);
  }
  asRectangle() {
    if (this.size() !== 4) throw new Error("Invalid PDF rectangle");
    const values = this.asArray().map((x) =>
      this.context.lookup(x, PDFNumber).asNumber(),
    );
    return {
      x: values[0],
      y: values[1],
      width: values[2] - values[0],
      height: values[3] - values[1],
    };
  }
  clone(context = this.context) {
    const array = new PDFArray(context);
    for (const value of this.asArray()) array.push(value);
    return array;
  }
  toString() {
    return "[ " + this.asArray().map(String).join(" ") + " ]";
  }
}
export class PDFDict extends PDFObject {
  static withContext(context: PDFContext) {
    return new PDFDict(new Map(), context);
  }
  static fromMapWithContext(map: Map<PDFName, PDFObject>, context: PDFContext) {
    return new this(map, context);
  }
  constructor(
    private readonly map: Map<PDFName, PDFObject>,
    readonly context: PDFContext,
  ) {
    super();
  }
  get(key: PDFName, preserveNull = false): PDFObject | undefined {
    const value = this.map.get(key);
    return value === PDFNull && !preserveNull ? undefined : value;
  }
  set(key: PDFName, value: PDFObject) {
    this.map.set(key, value);
  }
  delete(key: PDFName) {
    return this.map.delete(key);
  }
  has(key: PDFName) {
    return this.get(key) !== undefined;
  }
  keys() {
    return Array.from(this.map.keys());
  }
  values() {
    return this.keys().map((key) => this.get(key, true)!);
  }
  entries(): [PDFName, PDFObject][] {
    return this.keys().map((key) => [key, this.get(key, true)!]);
  }
  asMap() {
    return new Map(this.entries());
  }
  lookup(key: PDFName): PDFObject | undefined;
  lookup<K extends ObjectKind[]>(
    key: PDFName,
    ...types: K
  ): KindValue<K[number]>;
  lookup(key: PDFName, ...types: ObjectKind[]) {
    return this.context.lookup(
      this.get(key, types.includes(PDFNull)),
      ...types,
    );
  }
  lookupMaybe<K extends ObjectKind[]>(
    key: PDFName,
    ...types: K
  ): KindValue<K[number]> | undefined {
    return this.context.lookupMaybe(
      this.get(key, types.includes(PDFNull)),
      ...types,
    );
  }
  uniqueKey(tag = "Resource") {
    let n = 0;
    let key = PDFName.of(tag);
    while (this.has(key)) key = PDFName.of(`${tag}-${++n}`);
    return key;
  }
  clone(context = this.context): PDFDict {
    return PDFDict.fromMapWithContext(this.asMap(), context);
  }
  toString() {
    return (
      "<<\n" +
      this.entries()
        .map(([key, value]) => `${key} ${value}`)
        .join("\n") +
      "\n>>"
    );
  }
}
export class PDFHeader {
  static forVersion(major: number, minor: number) {
    return new PDFHeader(major, minor);
  }
  constructor(
    readonly major: number,
    readonly minor: number,
  ) {}
  getVersionString() {
    return `${this.major}.${this.minor}`;
  }
}
export class PDFStream extends PDFObject {
  constructor(readonly dict: PDFDict) {
    super();
  }
  getContents(): Uint8Array {
    throw new Error("Missing stream body");
  }
  getUnencodedContents(): Uint8Array {
    return this.dict.context.decodeStream(this);
  }
  getContentsSize() {
    return this.getContents().length;
  }
  toString() {
    return `${this.dict}\nstream\n${new TextDecoder().decode(this.getContents())}\nendstream`;
  }
  clone(context = this.dict.context): PDFStream {
    return PDFRawStream.of(
      this.dict.clone(context),
      this.getContents().slice(),
    );
  }
}
export class PDFRawStream extends PDFStream {
  static of(dict: PDFDict, bytes: Uint8Array) {
    return new PDFRawStream(dict, bytes);
  }
  constructor(
    dict: PDFDict,
    public contents: Uint8Array,
  ) {
    super(dict);
  }
  getContents() {
    return this.contents;
  }
}
export class PDFOperator {
  static of(name: string, args: (PDFObject | number | string)[] = []) {
    return new PDFOperator(name, args);
  }
  constructor(
    readonly name: string,
    readonly args: (PDFObject | number | string)[] = [],
  ) {}
  toString() {
    return [
      ...this.args.map((a) =>
        typeof a === "number" ? numberText(a) : String(a),
      ),
      this.name,
    ].join(" ");
  }
}
export class PDFContentStream extends PDFStream {
  static of(dict: PDFDict, operators: PDFOperator[], _encode = true) {
    return new PDFContentStream(dict, operators);
  }
  constructor(
    dict: PDFDict,
    private readonly operators: PDFOperator[],
  ) {
    super(dict);
  }
  push(...operators: PDFOperator[]) {
    this.operators.push(...operators);
  }
  getUnencodedContents() {
    return encoder.encode(this.operators.map(String).join("\n") + "\n");
  }
  getContents() {
    return this.getUnencodedContents();
  }
  clone(context = this.dict.context) {
    return PDFContentStream.of(
      this.dict.clone(context),
      this.operators.slice(),
    );
  }
}
export type ObjectInput =
  | PDFObject
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly ObjectInput[]
  | { [key: string]: ObjectInput };
export class PDFContext {
  static create() {
    return new PDFContext();
  }
  largestObjectNumber = 0;
  header = PDFHeader.forVersion(1, 7);
  trailerInfo: Record<string, PDFObject | undefined> = {};
  private readonly objects = new Map<number, PDFObject>();
  nextRef() {
    return PDFRef.of(++this.largestObjectNumber);
  }
  assign(ref: PDFRef, object: PDFObject) {
    this.objects.set(ref.objectNumber, object);
  }
  register(object: PDFObject) {
    const ref = this.nextRef();
    this.assign(ref, object);
    return ref;
  }
  delete(ref: PDFRef) {
    return this.objects.delete(ref.objectNumber);
  }
  lookup(value: PDFObject | undefined): PDFObject | undefined;
  lookup<K extends ObjectKind[]>(
    value: PDFObject | undefined,
    ...types: K
  ): KindValue<K[number]>;
  lookup(value: PDFObject | undefined, ...types: ObjectKind[]) {
    const resolved =
      value instanceof PDFRef ? this.objects.get(value.objectNumber) : value;
    if (
      types.length &&
      !types.some((type) =>
        type === PDFNull
          ? resolved === PDFNull
          : resolved instanceof
            (type as unknown as new (...args: never[]) => PDFObject),
      )
    )
      throw new UnexpectedObjectTypeError(types, resolved);
    return resolved;
  }
  lookupMaybe<K extends ObjectKind[]>(
    value: PDFObject | undefined,
    ...types: K
  ): KindValue<K[number]> | undefined {
    const resolved = this.lookup(value);
    return !resolved || resolved === PDFNull
      ? undefined
      : this.lookup(resolved, ...types);
  }
  getObjectRef(object: PDFObject) {
    for (const [n, value] of this.objects)
      if (value === object) return PDFRef.of(n);
  }
  enumerateIndirectObjects(): [PDFRef, PDFObject][] {
    return [...this.objects]
      .sort((a, b) => a[0] - b[0])
      .map(([n, value]) => [PDFRef.of(n), value]);
  }
  obj(value: readonly ObjectInput[]): PDFArray;
  obj(value: { [key: string]: ObjectInput }): PDFDict;
  obj(value: ObjectInput): PDFObject;
  obj(value: ObjectInput): PDFObject {
    if (value instanceof PDFObject) return value;
    if (value === null || value === undefined) return PDFNull;
    if (typeof value === "string") return PDFName.of(value);
    if (typeof value === "number") return PDFNumber.of(value);
    if (typeof value === "boolean") return value ? PDFBool.True : PDFBool.False;
    if (Array.isArray(value)) {
      const array = PDFArray.withContext(this);
      for (const item of value) array.push(this.obj(item));
      return array;
    }
    const dict = PDFDict.withContext(this);
    for (const [key, item] of Object.entries(value))
      if (item !== undefined) dict.set(PDFName.of(key), this.obj(item));
    return dict;
  }
  stream(
    contents: Uint8Array | string,
    dict: { [key: string]: ObjectInput } = {},
  ) {
    return PDFRawStream.of(
      this.obj(dict),
      typeof contents === "string" ? encoder.encode(contents) : contents,
    );
  }
  flateStream(
    contents: Uint8Array | string,
    dict: { [key: string]: ObjectInput } = {},
  ) {
    return this.stream(contents, dict);
  }
  contentStream(
    operators: PDFOperator[],
    dict: { [key: string]: ObjectInput } = {},
  ) {
    return PDFContentStream.of(this.obj(dict), operators);
  }
  formXObject(
    operators: PDFOperator[],
    dict: { [key: string]: ObjectInput } = {},
  ) {
    return this.contentStream(operators, {
      Type: "XObject",
      Subtype: "Form",
      FormType: 1,
      BBox: [0, 0, 1, 1],
      ...dict,
    });
  }
  decodeStream(stream: PDFStream): Uint8Array {
    if (stream.dict.has(PDFName.of("Filter")))
      throw new Error("Attach the stream to PDFium before decoding filters");
    return stream.getContents();
  }
  fontMetrics(_ref: PDFRef, _unicode: readonly number[]): Float64Array {
    throw new Error("Font metrics require a PDFium context");
  }
  fontCharacterSet(_ref: PDFRef): number[] {
    throw new Error("Font encoding requires a PDFium context");
  }
  addRandomSuffix(prefix: string, _length = 4) {
    return `${prefix}-${this.largestObjectNumber + 1}`;
  }
}
export const decodePDFRawStream = (stream: PDFStream) => ({
  decode: () => stream.getUnencodedContents(),
});
export class PDFCatalog extends PDFDict {
  Pages() {
    return this.lookup(PDFName.of("Pages"), PDFPageTree);
  }
  AcroForm() {
    return this.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  }
}
export class PDFPageTree extends PDFDict {
  Kids() {
    return this.lookup(PDFName.of("Kids"), PDFArray);
  }
  Count() {
    return this.lookup(PDFName.of("Count"), PDFNumber);
  }
}
export class PDFPageLeaf extends PDFDict {
  getInheritableAttribute(name: PDFName): PDFObject | undefined {
    // A mutable cursor walks the field/page inheritance chain.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let dict: PDFDict | undefined = this;
    const seen = new Set<PDFDict>();
    while (dict && !seen.has(dict)) {
      seen.add(dict);
      const value = dict.get(name);
      if (value !== undefined) return value;
      dict = dict.lookupMaybe(PDFName.of("Parent"), PDFDict);
    }
  }
  inherited<K extends ObjectKind[]>(name: string, ...types: K) {
    return this.context.lookupMaybe(
      this.getInheritableAttribute(PDFName.of(name)),
      ...types,
    );
  }
  MediaBox() {
    return this.inherited("MediaBox", PDFArray)!;
  }
  CropBox() {
    return this.inherited("CropBox", PDFArray);
  }
  Rotate() {
    return this.inherited("Rotate", PDFNumber);
  }
  Resources() {
    return this.inherited("Resources", PDFDict);
  }
  Contents() {
    return this.lookup(PDFName.of("Contents")) as
      | PDFArray
      | PDFStream
      | undefined;
  }
  Annots() {
    return this.lookupMaybe(PDFName.of("Annots"), PDFArray);
  }
  setParent(ref: PDFRef) {
    this.set(PDFName.of("Parent"), ref);
  }
  addAnnot(ref: PDFRef) {
    let array = this.Annots();
    if (!array) {
      array = this.context.obj([]);
      this.set(PDFName.of("Annots"), array);
    }
    array.push(ref);
  }
  removeAnnot(ref: PDFRef) {
    const annots = this.Annots();
    const index = annots?.indexOf(ref);
    if (index !== undefined) annots!.remove(index);
  }
  normalizedEntries() {
    let resources = this.Resources();
    if (!resources) resources = this.context.obj({});
    else if (!this.has(PDFName.of("Resources"))) resources = resources.clone();
    if (!this.has(PDFName.of("Resources")))
      this.set(PDFName.of("Resources"), resources);
    const ensure = (name: string) => {
      let dict = resources.lookupMaybe(PDFName.of(name), PDFDict);
      if (!dict) {
        dict = this.context.obj({});
        resources.set(PDFName.of(name), dict);
      }
      return dict;
    };
    let contents = this.Contents();
    if (!(contents instanceof PDFArray)) {
      const raw = this.get(PDFName.of("Contents"));
      contents = this.context.obj(raw ? [raw] : []);
      this.set(PDFName.of("Contents"), contents);
    }
    let annots = this.Annots();
    if (!annots) {
      annots = this.context.obj([]);
      this.set(PDFName.of("Annots"), annots);
    }
    return {
      Resources: resources,
      Contents: contents as PDFArray,
      Annots: annots,
      Font: ensure("Font"),
      XObject: ensure("XObject"),
      ExtGState: ensure("ExtGState"),
    };
  }
  normalize() {
    this.normalizedEntries();
  }
  private isolatedContents = false;
  addContentStream(ref: PDFRef) {
    const contents = this.normalizedEntries().Contents;
    if (!this.isolatedContents && contents.size()) {
      contents.insert(
        0,
        this.context.register(
          this.context.contentStream([PDFOperator.of("q")]),
        ),
      );
      contents.push(
        this.context.register(
          this.context.contentStream([PDFOperator.of("Q")]),
        ),
      );
    }
    this.isolatedContents = true;
    contents.push(ref);
  }
  newFontDictionary(tag: string, ref: PDFRef) {
    const dict = this.normalizedEntries().Font,
      key = dict.uniqueKey(tag);
    dict.set(key, ref);
    return key;
  }
  newXObject(tag: string, ref: PDFRef) {
    const dict = this.normalizedEntries().XObject,
      key = dict.uniqueKey(tag);
    dict.set(key, ref);
    return key;
  }
  newExtGState(tag: string, ref: PDFRef) {
    const dict = this.normalizedEntries().ExtGState,
      key = dict.uniqueKey(tag);
    dict.set(key, ref);
    return key;
  }
}
