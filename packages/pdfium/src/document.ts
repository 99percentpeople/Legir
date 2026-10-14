import { decodeName, PDFObject, type ObjectInput } from "./object.js";
import { PDFPage } from "./page.js";
import { Runtime } from "./runtime.js";
import type { GraftOptions, OutlineItem, Rect, SaveOptions } from "./types.js";

const encoder = new TextEncoder();

export class PDFDocument {
  readonly objects = new Set<PDFObject>();
  readonly pages = new Set<PDFPage>();
  readonly grafts = new Set<PDFGraftMap>();
  readonly saves = new Set<PDFSaveTask>();
  pointer: number;
  constructor(
    readonly runtime: Runtime,
    bytes?: Uint8Array,
    password = "",
  ) {
    if (bytes && !bytes.length) throw new Error("PDF buffer is empty.");
    const length = bytes?.length ?? 0;
    const input = runtime.copyBytes(bytes ?? new Uint8Array());
    let transferred = false;
    try {
      this.pointer = runtime.withString(password, (pass) => {
        transferred = true;
        return runtime.call("LPDF_Open", input, length, pass);
      });
    } finally {
      if (!transferred) runtime.call("free", input);
    }
    if (!this.pointer) throw new Error("PDFium could not open the PDF.");
  }
  assertOpen() {
    if (!this.pointer) throw new Error("PDF document is closed.");
  }
  private call(name: string, ...args: number[]) {
    this.assertOpen();
    return this.runtime.call(name, this.pointer, ...args);
  }
  needsPassword() {
    return this.call("LPDF_Error") === 4;
  }
  authenticatePassword(password: string) {
    return this.runtime.withString(password, (p) =>
      this.call("LPDF_Authenticate", p),
    );
  }
  getVersion() {
    return this.call("LPDF_Version");
  }
  countPages() {
    return this.call("LPDF_PageCount");
  }
  countObjects() {
    return this.call("LPDF_ObjectCount");
  }
  getTrailer() {
    if (this.needsPassword())
      throw new Error("The PDF password is missing or incorrect.");
    return new PDFObject(this, this.call("LPDF_Trailer"));
  }
  findPage(index: number) {
    this.checkPage(index);
    return new PDFObject(this, this.call("LPDF_PageObject", index));
  }
  loadPage(index: number) {
    this.checkPage(index);
    return new PDFPage(this, this.call("LPDF_LoadPage", index), index);
  }
  private checkPage(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.countPages())
      throw new Error("PDF page index is out of range.");
  }
  private create(
    type: number,
    bytes: Uint8Array = new Uint8Array(),
    number = 0,
  ) {
    return this.runtime.withBytes(
      bytes,
      (p, n) => new PDFObject(this, this.call("LPDF_New", type, p, n, number)),
    );
  }
  newNull() {
    return this.create(8);
  }
  newBoolean(value: boolean) {
    return this.create(1, undefined, +value);
  }
  newInteger(value: number) {
    return this.newReal(value);
  }
  newReal(value: number) {
    if (!Number.isFinite(value)) throw new Error("PDF numbers must be finite.");
    let spelling = String(value);
    if (/e/i.test(spelling)) {
      const [coefficient, exponent] = spelling.toLowerCase().split("e");
      const negative = coefficient.startsWith("-");
      const unsigned = negative ? coefficient.slice(1) : coefficient;
      const [integer, fraction = ""] = unsigned.split(".");
      const digits = integer + fraction,
        point = integer.length + Number(exponent);
      spelling =
        (negative ? "-" : "") +
        (point <= 0
          ? "0." + "0".repeat(-point) + digits
          : point >= digits.length
            ? digits + "0".repeat(point - digits.length)
            : digits.slice(0, point) + "." + digits.slice(point));
    }
    return this.create(2, encoder.encode(spelling));
  }
  newName(value: string) {
    return this.newNameBytes(encoder.encode(value));
  }
  newNameBytes(value: Uint8Array) {
    return this.create(4, value);
  }
  newByteString(value: Uint8Array) {
    return this.create(3, value);
  }
  newString(value: string) {
    const bytes = new Uint8Array(2 + value.length * 2);
    bytes.set([254, 255]);
    for (let i = 0; i < value.length; i++) {
      bytes[2 + i * 2] = value.charCodeAt(i) >> 8;
      bytes[3 + i * 2] = value.charCodeAt(i) & 255;
    }
    return this.newByteString(bytes);
  }
  newArray() {
    return this.create(5);
  }
  newDictionary() {
    return this.create(6);
  }
  newIndirect(number: number) {
    return this.create(9, undefined, number);
  }
  createObject() {
    return this.newIndirect(this.call("LPDF_CreateObject"));
  }
  deleteObject(number: number) {
    this.call("LPDF_DeleteObject", number);
  }
  _fromPDFObjectKeep(pointer: number) {
    return new PDFObject(this, this.runtime.call("LPDF_Keep", pointer));
  }
  withObject<T>(value: ObjectInput, use: (object: PDFObject) => T): T {
    if (value instanceof PDFObject) {
      if (value.document !== this)
        throw new Error("Use a graft map to copy objects between documents.");
      return use(value);
    }
    const object = this.from(value);
    try {
      return use(object);
    } finally {
      object.destroy();
    }
  }
  from(value: ObjectInput): PDFObject {
    if (value instanceof PDFObject) return value.copy();
    if (value === null) return this.newNull();
    if (typeof value === "boolean") return this.newBoolean(value);
    if (typeof value === "number") return this.newReal(value);
    if (typeof value === "string") return this.newName(value);
    if (value instanceof Uint8Array) return this.newByteString(value);
    const object = Array.isArray(value)
      ? this.newArray()
      : this.newDictionary();
    try {
      if (Array.isArray(value)) for (const item of value) object.push(item);
      else
        for (const [key, item] of Object.entries(value)) object.put(key, item);
      return object;
    } catch (error) {
      object.destroy();
      throw error;
    }
  }
  addObject(value: ObjectInput) {
    const ref = this.createObject();
    try {
      ref.writeObject(value);
      return ref;
    } catch (error) {
      ref.destroy();
      throw error;
    }
  }
  addStream(bytes: Uint8Array | string, dictionary: ObjectInput = {}) {
    const ref = this.addObject(dictionary);
    try {
      ref.writeStream(
        typeof bytes === "string" ? encoder.encode(bytes) : bytes,
      );
      return ref;
    } catch (error) {
      ref.destroy();
      throw error;
    }
  }
  enableJournal() {
    /* Transactions are enabled by the native bridge. */
  }
  beginOperation(_label?: string) {
    if (!this.call("LPDF_Begin"))
      throw new Error("Nested PDF transactions are not supported.");
  }
  endOperation() {
    this.call("LPDF_End", 0);
  }
  /** Conservative: includes journaled writes and newly allocated objects. */
  operationHasChanges() {
    return !!this.call("LPDF_OperationHasChanges");
  }
  /** Conservative invalidation; only existing Info text/date writes are exempt. */
  operationAffectsRendering() {
    return !!this.call("LPDF_OperationAffectsRendering");
  }
  abandonOperation() {
    this.call("LPDF_End", 1);
  }
  setPageTreeCache(_enabled: boolean) {
    this.call("LPDF_Sync");
  }
  saveToBuffer(config: SaveOptions = {}) {
    return this.runtime.withString(config["user-password"] ?? "", (user) =>
      this.runtime.withString(config["owner-password"] ?? "", (owner) =>
        this.runtime.buffer(
          this.call(
            "LPDF_Save",
            user,
            owner,
            config.permissions ?? -4,
            config.encrypt === "aes-256" ? 1 : 0,
          ),
        ),
      ),
    );
  }
  /** Serialize cooperatively. Do not mutate or render this document until the
   * task is closed. Each chunk ends at an object boundary, so a single large
   * stream can exceed the usual 4 MiB / 8 ms slice. */
  startSave(config: SaveOptions = {}) {
    if (this.saves.size) throw new Error("A PDF save is already running.");
    const pointer = this.runtime.withString(
      config["user-password"] ?? "",
      (user) =>
        this.runtime.withString(config["owner-password"] ?? "", (owner) =>
          this.call(
            "LPDF_SaveStart",
            user,
            owner,
            config.permissions ?? -4,
            config.encrypt === "aes-256" ? 1 : 0,
          ),
        ),
    );
    if (!pointer) throw new Error("PDF save could not start.");
    const task = new PDFSaveTask(this, pointer);
    this.saves.add(task);
    return task;
  }
  newGraftMap(options?: GraftOptions) {
    return new PDFGraftMap(this, options);
  }
  graftObject(object: PDFObject) {
    const graft = this.newGraftMap();
    try {
      return graft.graftObject(object);
    } finally {
      graft.destroy();
    }
  }
  addPage(
    box: Rect,
    rotation: number,
    resources: ObjectInput,
    contents: string | Uint8Array,
  ) {
    const stream = this.addStream(contents);
    try {
      return this.addObject({
        Type: "Page",
        MediaBox: box,
        Rotate: rotation,
        Resources: resources,
        Contents: stream,
      });
    } finally {
      stream.destroy();
    }
  }
  private rewritePages(pages: PDFObject[]) {
    const pointers = new Uint32Array(pages.map((page) => page.pointer));
    this.runtime.withBytes(new Uint8Array(pointers.buffer), (pointer) => {
      if (!this.call("LPDF_SetPages", pointer, pages.length))
        throw new Error("Invalid PDF page tree.");
    });
  }
  /** Replace the page order in one pass, retaining inherited page attributes. */
  setPages(pages: readonly PDFObject[]) {
    for (const page of pages) {
      if (page.document !== this)
        throw new Error("Use a graft map to copy pages between documents.");
      page.getType();
    }
    this.rewritePages([...pages]);
  }
  insertPage(index: number, page: PDFObject) {
    this.insertPages(index, [page]);
  }
  insertPages(index: number, inserted: readonly PDFObject[]) {
    if (!Number.isInteger(index) || index > this.countPages())
      throw new Error("PDF page index is out of range.");
    for (const page of inserted) {
      if (page.document !== this)
        throw new Error("Use a graft map to copy pages between documents.");
      page.getType();
    }
    if (!inserted.length) return;
    const pages = Array.from({ length: this.countPages() }, (_, i) =>
      this.findPage(i),
    );
    try {
      if (index < 0) index = pages.length;
      const additions = inserted.map((page) => page.copy());
      pages.splice(index, 0, ...additions);
      this.rewritePages(pages);
    } finally {
      for (const item of pages) item.destroy();
    }
  }
  deletePage(index: number) {
    this.deletePages([index]);
  }
  deletePages(indexes: readonly number[]) {
    for (const index of indexes) this.checkPage(index);
    if (!indexes.length) return;
    const removed = [...new Set(indexes)].sort((a, b) => b - a);
    const pages = Array.from({ length: this.countPages() }, (_, i) =>
      this.findPage(i),
    );
    try {
      for (const index of removed) pages.splice(index, 1)[0].destroy();
      this.rewritePages(pages);
    } finally {
      for (const item of pages) item.destroy();
    }
  }
  getMetaData(key: string): string | undefined {
    const trailer = this.getTrailer();
    const value = trailer.get("Info", key.replace(/^info:/, ""));
    try {
      return value.isString() ? value.asString() : undefined;
    } finally {
      value.destroy();
      trailer.destroy();
    }
  }
  getLanguage() {
    const trailer = this.getTrailer();
    const value = trailer.get("Root", "Lang");
    try {
      return value.isString() ? value.asString() : undefined;
    } finally {
      value.destroy();
      trailer.destroy();
    }
  }
  resolveDestination(value: PDFObject): number {
    if (value.isDictionary()) {
      const dest = value.get("D");
      try {
        return this.resolveDestination(dest);
      } finally {
        dest.destroy();
      }
    }
    if (value.isString() || value.isName())
      return this.resolveLink(
        `#nameddest=${encodeURIComponent(value.isString() ? value.asString() : value.asName())}`,
      );
    if (!value.isArray()) return -1;
    const first = value.get(0);
    try {
      if (first.isIndirect())
        for (let i = 0; i < this.countPages(); i++) {
          const page = this.findPage(i);
          try {
            if (page.asIndirect() === first.asIndirect()) return i;
          } finally {
            page.destroy();
          }
        }
      return first.isNumber() ? first.asNumber() : -1;
    } finally {
      first.destroy();
    }
  }
  resolveLink(uri: string): number {
    const page = /^#page=(\d+)/.exec(uri);
    if (page) return Number(page[1]) - 1;
    const name = decodeURIComponent(uri.replace(/^#nameddest=/, ""));
    const trailer = this.getTrailer();
    const catalog = trailer.get("Root");
    try {
      const direct = catalog.get("Dests", name);
      try {
        if (!direct.isNull()) return this.resolveDestination(direct);
      } finally {
        direct.destroy();
      }
      const walk = (node: PDFObject, depth: number): number => {
        if (depth > 64 || node.isNull()) return -1;
        const names = node.get("Names"),
          kids = node.get("Kids");
        try {
          for (let i = 0; i + 1 < names.length; i += 2) {
            const key = names.get(i),
              dest = names.get(i + 1);
            try {
              if (key.asString() === name) return this.resolveDestination(dest);
            } finally {
              key.destroy();
              dest.destroy();
            }
          }
          for (let i = 0; i < kids.length; i++) {
            const child = kids.get(i);
            try {
              const found = walk(child, depth + 1);
              if (found >= 0) return found;
            } finally {
              child.destroy();
            }
          }
          return -1;
        } finally {
          names.destroy();
          kids.destroy();
        }
      };
      const tree = catalog.get("Names", "Dests");
      try {
        return walk(tree, 0);
      } finally {
        tree.destroy();
      }
    } finally {
      catalog.destroy();
      trailer.destroy();
    }
  }
  loadOutline(): OutlineItem[] {
    const trailer = this.getTrailer();
    const first = trailer.get("Root", "Outlines", "First");
    const seen = new Set<number>();
    const walk = (head: PDFObject, depth: number): OutlineItem[] => {
      const result: OutlineItem[] = [];
      let node = head.copy();
      try {
        while (!node.isNull() && depth < 64) {
          const id = node.asIndirect();
          if (id && seen.has(id)) break;
          if (id) seen.add(id);
          const title = node.get("Title"),
            dest = node.get("Dest"),
            action = node.get("A", "D"),
            child = node.get("First");
          try {
            const index = this.resolveDestination(
              dest.isNull() ? action : dest,
            );
            result.push({
              title: title.asString(),
              page: index < 0 ? undefined : index,
              down: walk(child, depth + 1),
            });
          } finally {
            title.destroy();
            dest.destroy();
            action.destroy();
            child.destroy();
          }
          const next = node.get("Next");
          node.destroy();
          node = next;
        }
      } finally {
        node.destroy();
      }
      return result;
    };
    try {
      return walk(first, 0);
    } finally {
      first.destroy();
      trailer.destroy();
    }
  }
  destroy() {
    if (!this.pointer) return;
    for (const save of this.saves) save.destroy();
    for (const graft of this.grafts) graft.destroy();
    for (const page of this.pages) page.destroy();
    for (const object of this.objects) object.destroy();
    this.runtime.call("LPDF_Close", this.pointer);
    this.pointer = 0;
  }
}

export class PDFSaveTask {
  constructor(
    readonly document: PDFDocument,
    private pointer: number,
  ) {}
  next(): { done: boolean; bytes: Uint8Array } {
    const { done, value } = this.readChunk((bytes) => bytes.slice());
    return { done, bytes: value };
  }
  /** Copy directly from the working WASM span into immutable Blob storage,
   * avoiding an intermediate JS byte array for file-oriented consumers. */
  nextBlob(): { done: boolean; blob: Blob } {
    const { done, value } = this.readChunk(
      (bytes) => new Blob([bytes as BlobPart]),
    );
    return { done, blob: value };
  }
  private readChunk<T>(copy: (bytes: Uint8Array) => T): {
    done: boolean;
    value: T;
  } {
    if (!this.pointer) throw new Error("PDF save task is closed.");
    this.document.assertOpen();
    const runtime = this.document.runtime;
    const status = runtime.call("LPDF_SaveContinue", this.pointer);
    if (!status) {
      this.destroy();
      throw new Error("PDF save failed.");
    }
    const start = runtime.call("LPDF_SaveChunkData", this.pointer);
    const size = runtime.call("LPDF_SaveChunkSize", this.pointer);
    try {
      return {
        done: status === 1,
        value: copy(runtime.native.HEAPU8.subarray(start, start + size)),
      };
    } finally {
      runtime.call("LPDF_SaveConsumeChunk", this.pointer);
      if (status === 1) this.destroy();
    }
  }
  destroy() {
    if (this.pointer) this.document.runtime.call("LPDF_SaveDrop", this.pointer);
    this.pointer = 0;
    this.document.saves.delete(this);
  }
}

export class PDFGraftMap {
  private refs = new Map<PDFDocument, Map<number, number>>();
  private nativeMaps = new Map<PDFDocument, number>();
  private closed = false;
  constructor(
    readonly document: PDFDocument,
    readonly options: GraftOptions = {},
  ) {
    document.assertOpen();
    document.grafts.add(this);
  }
  getReferences(source: PDFDocument): Map<number, number> {
    if (this.closed) throw new Error("PDF graft map is closed.");
    const pointer = this.nativeMaps.get(source);
    if (!pointer) return new Map(this.refs.get(source));
    const buffer = this.document.runtime.buffer(
      this.document.runtime.call("LPDF_GraftReferences", pointer),
    );
    try {
      const bytes = buffer.asUint8Array();
      const values = new Uint32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.length / 4,
      );
      const result = new Map<number, number>();
      for (let i = 0; i < values.length; i += 2)
        result.set(values[i], values[i + 1]);
      return result;
    } finally {
      buffer.destroy();
    }
  }
  graftObject(source: PDFObject, depth = 0): PDFObject {
    if (this.closed) throw new Error("PDF graft map is closed.");
    this.document.assertOpen();
    source.getType(); // Validate the source handle before passing its pointer.
    if (depth > 100) throw new Error("PDF object nesting limit exceeded.");
    if (source.document === this.document && !this.options.copyWithinDocument)
      return source.copy();
    const doc = this.document;
    if (source.document.runtime === doc.runtime) {
      let map = this.nativeMaps.get(source.document);
      if (!map) {
        map = doc.runtime.call(
          "LPDF_NewGraftMap",
          doc.pointer,
          source.document.pointer,
          +!!this.options.copyPages,
        );
        this.nativeMaps.set(source.document, map);
        if (this.options.selectedPageNumbers) {
          const pages = new Uint32Array(this.options.selectedPageNumbers);
          doc.runtime.withBytes(new Uint8Array(pages.buffer), (pointer) =>
            doc.runtime.call(
              "LPDF_GraftSelectedPages",
              map!,
              pointer,
              pages.length,
            ),
          );
        }
      }
      const pointer = doc.runtime.call("LPDF_GraftObject", map, source.pointer);
      if (!pointer)
        throw new Error("PDF object graft failed (nesting limit exceeded).");
      return new PDFObject(doc, pointer);
    }
    if (source.isIndirect()) {
      if (
        this.options.selectedPageNumbers &&
        !this.options.selectedPageNumbers.includes(source.asIndirect())
      ) {
        const type = source.get("Type");
        try {
          if (type.asName() === "Page") return doc.newNull();
        } finally {
          type.destroy();
        }
      }
      let refs = this.refs.get(source.document);
      if (!refs) this.refs.set(source.document, (refs = new Map()));
      const number = source.asIndirect(),
        previous = refs.get(number);
      if (previous !== undefined) return doc.newIndirect(previous);
      const target = doc.createObject();
      refs.set(number, target.asIndirect());
      const resolved = source.resolve();
      try {
        const body = this.graftObject(resolved, depth + 1);
        try {
          target.writeObject(body);
        } finally {
          body.destroy();
        }
        if (source.isStream()) {
          const data = source.readRawStream();
          try {
            target.writeRawStream(data.asUint8Array());
          } finally {
            data.destroy();
          }
        }
        return target;
      } catch (error) {
        target.destroy();
        throw error;
      } finally {
        resolved.destroy();
      }
    }
    if (source.isNull()) return doc.newNull();
    if (source.isBoolean()) return doc.newBoolean(source.asBoolean());
    if (source.isNumber()) return doc.newReal(source.asNumber());
    if (source.isName()) return doc.newNameBytes(source.asNameBytes());
    if (source.isString()) return doc.newByteString(source.asByteString());
    const target = source.isArray() ? doc.newArray() : doc.newDictionary();
    try {
      source.forEach((value, key) => {
        let cloned: PDFObject | undefined, name: PDFObject | undefined;
        try {
          if (key === "Parent" && this.options.copyPages) {
            const type = source.get("Type");
            try {
              if (type.asName() === "Page") return;
            } finally {
              type.destroy();
            }
          }
          cloned = this.graftObject(value, depth + 1);
          if (typeof key === "number") target.push(cloned);
          else {
            name = doc.newNameBytes(decodeName(key));
            target.put(name, cloned);
          }
        } finally {
          value.destroy();
          cloned?.destroy();
          name?.destroy();
        }
      });
      if (this.options.copyPages && source.isDictionary()) {
        const type = source.get("Type");
        try {
          if (type.asName() === "Page")
            for (const key of [
              "Resources",
              "MediaBox",
              "CropBox",
              "Rotate",
              "UserUnit",
            ]) {
              const inherited = source.getInheritable(key);
              try {
                if (!inherited.isNull()) {
                  const copy = this.graftObject(inherited, depth + 1);
                  try {
                    target.put(key, copy);
                  } finally {
                    copy.destroy();
                  }
                }
              } finally {
                inherited.destroy();
              }
            }
        } finally {
          type.destroy();
        }
      }
      return target;
    } catch (error) {
      target.destroy();
      throw error;
    }
  }
  destroy() {
    if (this.closed) return;
    this.closed = true;
    for (const pointer of this.nativeMaps.values())
      this.document.runtime.call("LPDF_DropGraftMap", pointer);
    this.nativeMaps.clear();
    this.refs.clear();
    this.document.grafts.delete(this);
  }
}
