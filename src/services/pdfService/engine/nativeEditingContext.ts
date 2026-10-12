import {
  PDFArray,
  PDFBool,
  PDFCatalog,
  PDFContext,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFHeader,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObject,
  PDFPageLeaf,
  PDFPageTree,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  UnexpectedObjectTypeError,
} from "@cantoo/pdf-lib";
import type {
  PDFDocument as NativeDocument,
  PDFObject as NativeObject,
} from "@legir/pdfium";
import type { PDFiumModule } from "./pdfium";
import { dictionaryKeyNames, NativeNames } from "./objectNames";

const spelling = (name: PDFName) => name.asString().slice(1);
const nameOf = (name: string) =>
  PDFName.of(name.replace(/#[\da-f]{2}/gi, (part) => part.toUpperCase()));

/** A view over the native xref, NOT a second parsed PDF object graph. Dictionaries
 * and arrays read/write PDFium on demand; original stream bytes are never retained
 * by the view. Existing layout/appearance helpers can use their object vocabulary
 * while the only document data lives in the worker's PDFium instance. */
export class NativeEditingContext {
  readonly context = PDFContext.create();
  readonly document: PDFDocument;
  readonly names: NativeNames;
  private readonly handles = new Set<NativeObject>();
  private readonly wrappers = new Map<number, PDFObject>();
  private readonly bindings = new WeakMap<PDFObject, NativeObject>();
  private readonly references = new WeakMap<PDFObject, PDFRef>();
  private readonly pendingStreams = new Map<number, PDFStream>();
  private readonly reverseRefs = new Map<number, number>();
  private disposed = false;
  private nextVirtualRef = 1;

  constructor(
    readonly pdfium: PDFiumModule,
    readonly native: NativeDocument,
    readonly options: {
      refs?: Map<number, number>;
      trailer?: NativeObject;
    } = {},
  ) {
    this.names = new NativeNames(pdfium, native);
    for (const [virtual, actual] of options.refs ?? []) {
      this.reverseRefs.set(actual, virtual);
      this.nextVirtualRef = Math.max(this.nextVirtualRef, virtual + 1);
    }
    const context = this.context;
    const trailer = options.trailer ?? native.getTrailer();
    this.handles.add(trailer);
    context.header = PDFHeader.forVersion(
      Math.floor(native.getVersion() / 10),
      native.getVersion() % 10,
    );
    context.trailerInfo = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "Encrypt" || typeof key !== "string") return undefined;
          return this.read(trailer.get(key));
        },
        set: (_target, key, value) => {
          if (typeof key !== "string" || key === "Encrypt") return true;
          if (value === undefined) trailer.delete(key);
          else this.withNative(value, (obj) => trailer.put(key, obj));
          return true;
        },
        ownKeys: () => ["Root", "Info", "ID"],
        getOwnPropertyDescriptor: () => ({
          configurable: true,
          enumerable: true,
        }),
      },
    );
    context.nextRef = () => {
      const nativeRef = native.createObject();
      try {
        const actual = nativeRef.asIndirect();
        const virtual = this.virtual(actual);
        context.largestObjectNumber = virtual;
        return PDFRef.of(virtual);
      } finally {
        nativeRef.destroy();
      }
    };
    context.assign = (ref, object) => {
      const nativeRef = native.newIndirect(this.actual(ref.objectNumber));
      try {
        this.withNative(
          object instanceof PDFStream ? object.dict : object,
          (value) => nativeRef.writeObject(value),
        );
        if (object instanceof PDFStream) {
          // Content streams cache compression on first read. Authors can still
          // append drawing operators after registration, so defer that read.
          nativeRef.writeRawStream(new Uint8Array());
          this.pendingStreams.set(ref.objectNumber, object);
          if (object instanceof PDFContentStream) {
            const push = object.push.bind(object);
            object.push = (...operators) => {
              push(...operators);
              this.pendingStreams.set(ref.objectNumber, object);
            };
          }
        }
        const resolved = nativeRef.resolve();
        if (object instanceof PDFStream)
          this.bind(object.dict, resolved.getDictionary());
        this.bind(object, resolved);
        this.references.set(object, ref);
      } finally {
        nativeRef.destroy();
      }
    };
    context.delete = (ref) => {
      native.deleteObject(this.actual(ref.objectNumber));
      this.pendingStreams.delete(ref.objectNumber);
      return true;
    };
    const lookup = (value: PDFObject | undefined) => {
      if (!(value instanceof PDFRef)) return value;
      if (value.objectNumber <= 0) return undefined;
      const pending = this.pendingStreams.get(value.objectNumber);
      if (pending) return pending;
      const ref = native.newIndirect(this.actual(value.objectNumber));
      try {
        const object = ref.resolve();
        if (object.isNull()) {
          object.destroy();
          return undefined;
        }
        const result = this.read(object, ref.isStream() ? ref : undefined);
        if (result) this.references.set(result, value);
        return result;
      } finally {
        ref.destroy();
      }
    };
    const checked = (
      value: PDFObject | undefined,
      types: unknown[],
      optional: boolean,
    ) => {
      const result = lookup(value);
      if (
        optional &&
        (!result || (result === PDFNull && !types.includes(PDFNull)))
      )
        return undefined;
      if (
        !types.length ||
        types.some((type) =>
          type === PDFNull
            ? result === PDFNull
            : typeof type === "function" && result instanceof type,
        )
      )
        return result;
      throw new UnexpectedObjectTypeError(types as never, result);
    };
    context.lookup = ((value, ...types) =>
      checked(value, types, false)) as PDFContext["lookup"];
    context.lookupMaybe = ((value, ...types) =>
      checked(value, types, true)) as PDFContext["lookupMaybe"];
    context.getObjectRef = (object) => this.references.get(object);
    context.enumerateIndirectObjects = () => {
      const entries: [PDFRef, PDFObject][] = [];
      const numbers = options.refs
        ? [...options.refs.keys()]
        : Array.from({ length: native.countObjects() - 1 }, (_, i) => i + 1);
      for (const number of numbers) {
        const ref = PDFRef.of(number);
        const object = lookup(ref);
        if (object) entries.push([ref, object]);
      }
      return entries;
    };
    // The pinned helper's constructor only installs layout/font/form caches. It
    // receives our live context; no parser, writer or duplicate xref is created.
    this.document = Reflect.construct(PDFDocument, [
      context,
      true,
      false,
    ]) as PDFDocument;
  }

  actual(ref: number) {
    return this.options.refs?.get(ref) ?? ref;
  }
  virtual(ref: number) {
    if (!this.options.refs) return ref;
    const previous = this.reverseRefs.get(ref);
    if (previous !== undefined) return previous;
    const virtual = this.nextVirtualRef++;
    this.options.refs.set(virtual, ref);
    this.reverseRefs.set(ref, virtual);
    return virtual;
  }

  private read(
    object: NativeObject,
    streamRef?: NativeObject,
  ): PDFObject | undefined {
    if (object.isIndirect()) {
      const result = PDFRef.of(this.virtual(object.asIndirect()));
      object.destroy();
      return result;
    }
    if (!object.isDictionary() && !object.isArray()) {
      try {
        if (object.isNull()) return PDFNull;
        if (object.isBoolean())
          return object.asBoolean() ? PDFBool.True : PDFBool.False;
        if (object.isNumber()) {
          const value = Number(object.toString(true, true));
          this.names.rememberInteger(value, object);
          return PDFNumber.of(value);
        }
        if (object.isName())
          return nameOf(object.toString(true, true).slice(1));
        if (object.isString())
          return PDFHexString.fromBytes(object.asByteString());
        throw new Error("Unsupported native PDF object.");
      } finally {
        object.destroy();
      }
    }
    const cached = this.wrappers.get(object.pointer);
    if (cached) {
      object.destroy();
      return cached;
    }
    let result: PDFObject;
    if (object.isArray()) result = PDFArray.withContext(this.context);
    else {
      const type = object.get("Type");
      let kind: string;
      try {
        kind = type.isName() ? type.asName() : "";
      } finally {
        type.destroy();
      }
      const map = new Map<PDFName, PDFObject>();
      const dict =
        kind === "Catalog"
          ? PDFCatalog.fromMapWithContext(map, this.context)
          : kind === "Pages"
            ? PDFPageTree.fromMapWithContext(map, this.context)
            : kind === "Page"
              ? PDFPageLeaf.fromMapWithContext(map, this.context)
              : PDFDict.fromMapWithContext(map, this.context);
      result = streamRef ? PDFRawStream.of(dict, new Uint8Array()) : dict;
    }
    this.bind(result, object, streamRef?.asIndirect());
    return result;
  }

  private bind(value: PDFObject, object: NativeObject, streamNumber?: number) {
    const existing = this.bindings.get(value);
    if (existing?.pointer === object.pointer) {
      object.destroy();
      return;
    }
    if (existing && this.wrappers.get(existing.pointer) === value)
      this.wrappers.delete(existing.pointer);
    this.handles.add(object);
    this.bindings.set(value, object);
    this.wrappers.set(object.pointer, value);
    if (value instanceof PDFStream) {
      this.bindDictionary(value.dict, object);
      if (streamNumber !== undefined && value instanceof PDFRawStream) {
        Object.defineProperty(value, "contents", {
          configurable: true,
          get: () => {
            const ref = this.native.newIndirect(streamNumber);
            try {
              const buffer = ref.readRawStream();
              try {
                return buffer.asUint8Array().slice();
              } finally {
                buffer.destroy();
              }
            } finally {
              ref.destroy();
            }
          },
          set: (bytes: Uint8Array) => {
            const ref = this.native.newIndirect(streamNumber);
            try {
              ref.writeRawStream(bytes);
            } finally {
              ref.destroy();
            }
          },
        });
      }
    } else if (value instanceof PDFDict) this.bindDictionary(value, object);
    else if (value instanceof PDFArray) {
      value.size = () => object.length;
      value.get = (index) => this.read(object.get(index))!;
      value.set = (index, child) =>
        this.withNative(child, (native) => object.put(index, native));
      value.push = (child) =>
        this.withNative(child, (native) => object.push(native));
      value.remove = (index) => object.delete(index);
      value.insert = (index, child) => {
        const tail = value.asArray().slice(index);
        while (object.length > index) object.delete(object.length - 1);
        value.push(child);
        for (const item of tail) value.push(item);
      };
      value.asArray = () =>
        Array.from({ length: object.length }, (_, i) => value.get(i));
      value.indexOf = (child) => {
        const index = value
          .asArray()
          .findIndex(
            (item) => item === child || item.toString() === child.toString(),
          );
        return index < 0 ? undefined : index;
      };
      value.clone = (context) => {
        const clone = PDFArray.withContext(context ?? this.context);
        for (const item of value.asArray()) clone.push(item);
        return clone;
      };
    }
  }

  private bindDictionary(dict: PDFDict, object: NativeObject) {
    // PDFDict subclasses share these operations, including page/form helpers.
    dict.keys = () => dictionaryKeyNames(object).map(nameOf);
    dict.get = (key, preserveNull = false) => {
      const child = this.read(object.get(this.names.get(spelling(key))));
      return child === PDFNull && !preserveNull ? undefined : child;
    };
    dict.has = (key) => dict.get(key) !== undefined;
    dict.set = (key, value) =>
      this.withNative(value, (child) =>
        object.put(this.names.get(spelling(key)), child),
      );
    dict.delete = (key) => {
      const present = dict.has(key);
      object.delete(this.names.get(spelling(key)));
      return present;
    };
    dict.entries = () => dict.keys().map((key) => [key, dict.get(key, true)!]);
    dict.values = () => dict.entries().map(([, value]) => value);
    dict.asMap = () => new Map(dict.entries());
  }

  private withNative<T>(value: PDFObject, use: (object: NativeObject) => T): T {
    const bound = this.bindings.get(value);
    if (bound) return use(bound);
    const object = this.toNative(value);
    try {
      return use(object);
    } finally {
      object.destroy();
    }
  }

  private toNative(value: PDFObject): NativeObject {
    if (value === PDFNull) return this.native.newNull();
    if (value instanceof PDFRef)
      // The layout helper uses -1 as an unattached page's temporary Parent.
      return value.objectNumber > 0
        ? this.native.newIndirect(this.actual(value.objectNumber))
        : this.native.newNull();
    if (value instanceof PDFName)
      return this.native.graftObject(this.names.get(spelling(value)));
    if (value instanceof PDFBool)
      return this.native.newBoolean(value.asBoolean());
    if (value instanceof PDFNumber)
      return Number.isInteger(value.asNumber())
        ? this.names.integer(value.asNumber())
        : this.native.newReal(value.asNumber());
    if (value instanceof PDFString || value instanceof PDFHexString)
      return this.native.newByteString(value.asBytes());
    if (!(value instanceof PDFArray || value instanceof PDFDict))
      throw new Error(
        `Unsupported PDF layout object: ${value.constructor.name}`,
      );
    const object =
      value instanceof PDFArray
        ? this.native.newArray()
        : this.native.newDictionary();
    try {
      if (value instanceof PDFArray)
        for (const child of value.asArray())
          this.withNative(child, (native) => object.push(native));
      else
        for (const [key, child] of value.entries())
          this.withNative(child, (native) =>
            object.put(this.names.get(spelling(key)), native),
          );
      // Direct children may be changed after attachment (AcroForm, Resources,
      // Kids, appearances). Keep the original helper object a live native view.
      this.bind(value, this.native._fromPDFObjectKeep(object.pointer));
      return object;
    } catch (error) {
      object.destroy();
      throw error;
    }
  }

  async flush() {
    await this.document.flush();
    for (const [number, stream] of this.pendingStreams) {
      const ref = this.native.newIndirect(this.actual(number));
      try {
        // Compression in the layout helper is cached. A stream may receive
        // more operators after an earlier flush in the same transaction.
        ref.writeRawStream(
          stream instanceof PDFContentStream
            ? stream.clone().getContents()
            : stream.getContents(),
        );
      } finally {
        ref.destroy();
      }
    }
    this.pendingStreams.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingStreams.clear();
    this.wrappers.clear();
    for (const object of this.handles) object.destroy();
    this.handles.clear();
    this.names.destroy();
  }
}
