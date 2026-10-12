import { decoder } from "./runtime.js";
import type { PDFDocument } from "./document.js";
import type { ObjectType } from "./types.js";

export type ObjectInput =
  | PDFObject
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | ObjectInput[]
  | { [key: string]: ObjectInput };
type Key = string | number | PDFObject;

export class PDFObject {
  private closed = false;
  constructor(
    readonly document: PDFDocument,
    readonly pointer: number,
  ) {
    document.objects.add(this);
  }
  private get runtime() {
    this.document.assertOpen();
    if (this.closed) throw new Error("PDF object is closed.");
    return this.document.runtime;
  }
  copy() {
    return new PDFObject(
      this.document,
      this.runtime.call("LPDF_Keep", this.pointer),
    );
  }
  destroy() {
    if (this.closed) return;
    this.document.runtime.call("LPDF_Drop", this.pointer);
    this.closed = true;
    this.document.objects.delete(this);
  }
  getType(resolve = false): ObjectType {
    return this.runtime.call("LPDF_Type", this.pointer, +resolve);
  }
  isIndirect() {
    return this.getType() === 9;
  }
  isNull() {
    return this.getType(true) === 8;
  }
  isBoolean() {
    return this.getType(true) === 1;
  }
  isNumber() {
    return this.getType(true) === 2;
  }
  isInteger() {
    return this.isNumber() && Number.isInteger(this.asNumber());
  }
  isString() {
    return this.getType(true) === 3;
  }
  isName() {
    return this.getType(true) === 4;
  }
  isArray() {
    return this.getType(true) === 5;
  }
  isDictionary() {
    return [6, 7].includes(this.getType(true));
  }
  isStream() {
    return this.getType(true) === 7;
  }
  asIndirect() {
    return this.runtime.call("LPDF_RefNumber", this.pointer);
  }
  resolve() {
    return new PDFObject(
      this.document,
      this.runtime.call("LPDF_Resolve", this.pointer),
    );
  }
  getDictionary() {
    return new PDFObject(
      this.document,
      this.runtime.call("LPDF_Dictionary", this.pointer),
    );
  }
  private stringBytes(mode: number) {
    const buffer = this.runtime.buffer(
      this.runtime.call("LPDF_String", this.pointer, mode),
    );
    try {
      return buffer.asUint8Array().slice();
    } finally {
      buffer.destroy();
    }
  }
  toString(_tight?: boolean, _ascii?: boolean) {
    return decoder.decode(this.stringBytes(0)).trim();
  }
  asName() {
    return decoder.decode(this.stringBytes(1));
  }
  asNameBytes() {
    return this.stringBytes(1);
  }
  asString() {
    return decoder.decode(this.stringBytes(2));
  }
  asByteString() {
    return this.stringBytes(1);
  }
  asNumber() {
    return Number(decoder.decode(this.stringBytes(1)));
  }
  asBoolean() {
    return decoder.decode(this.stringBytes(1)) === "true";
  }
  get length() {
    return this.runtime.call("LPDF_Length", this.pointer);
  }
  keys(): string[] {
    const buffer = this.runtime.buffer(
      this.runtime.call("LPDF_Keys", this.pointer),
    );
    try {
      return decoder
        .decode(buffer.asUint8Array())
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.slice(1));
    } finally {
      buffer.destroy();
    }
  }
  get(...keys: Key[]): PDFObject {
    if (!keys.length) return this.copy();
    let object: PDFObject | undefined;
    for (const key of keys) {
      const parent = object?.pointer ?? this.pointer;
      const pointer =
        typeof key === "number"
          ? this.runtime.call("LPDF_GetIndex", parent, key)
          : this.nativeKey(key)
            ? this.runtime.call("LPDF_GetNameKey", parent, key.pointer)
            : this.keyBytes(key, (p, n) =>
                this.runtime.call("LPDF_GetKey", parent, p, n),
              );
      object?.destroy();
      object = new PDFObject(this.document, pointer);
    }
    return object!;
  }
  getInheritable(key: string) {
    let current: PDFObject = this.copy();
    const visited = new Set<number>();
    try {
      for (let depth = 0; depth < 100 && !current.isNull(); depth++) {
        const value = current.get(key);
        if (!value.isNull()) return value;
        value.destroy();
        const parent = current.get("Parent");
        current.destroy();
        current = parent;
        const number = parent.asIndirect();
        if (number && visited.has(number)) break;
        if (number) visited.add(number);
      }
      return this.document.newNull();
    } finally {
      current.destroy();
    }
  }
  private keyBytes<T>(
    key: string | PDFObject,
    use: (p: number, n: number) => T,
  ) {
    return key instanceof PDFObject
      ? this.runtime.withBytes(key.asNameBytes(), use)
      : this.runtime.withString(key, use);
  }
  private nativeKey(key: Key): key is PDFObject {
    if (
      !(key instanceof PDFObject) ||
      key.document.runtime !== this.document.runtime
    )
      return false;
    key.getType(); // Check lifetime; names may be owned by another live document.
    return true;
  }
  put(key: Key, value: ObjectInput) {
    this.document.withObject(value, (child) => {
      if (typeof key === "number")
        this.runtime.call(
          "LPDF_SetIndex",
          this.document.pointer,
          this.pointer,
          key,
          child.pointer,
          0,
        );
      else if (this.nativeKey(key))
        this.runtime.call(
          "LPDF_SetNameKey",
          this.document.pointer,
          this.pointer,
          key.pointer,
          child.pointer,
        );
      else
        this.keyBytes(key, (p, n) =>
          this.runtime.call(
            "LPDF_SetKey",
            this.document.pointer,
            this.pointer,
            p,
            n,
            child.pointer,
          ),
        );
    });
  }
  delete(key: Key) {
    if (typeof key === "number")
      this.runtime.call(
        "LPDF_SetIndex",
        this.document.pointer,
        this.pointer,
        key,
        0,
        2,
      );
    else if (this.nativeKey(key))
      this.runtime.call(
        "LPDF_SetNameKey",
        this.document.pointer,
        this.pointer,
        key.pointer,
        0,
      );
    else
      this.keyBytes(key, (p, n) =>
        this.runtime.call(
          "LPDF_SetKey",
          this.document.pointer,
          this.pointer,
          p,
          n,
          0,
        ),
      );
  }
  push(value: ObjectInput) {
    this.insert(this.length, value);
  }
  insert(index: number, value: ObjectInput) {
    this.document.withObject(value, (child) =>
      this.runtime.call(
        "LPDF_SetIndex",
        this.document.pointer,
        this.pointer,
        index,
        child.pointer,
        1,
      ),
    );
  }
  forEach(callback: (value: PDFObject, key: number | string) => void) {
    if (this.isArray())
      for (let i = 0; i < this.length; i++) callback(this.get(i), i);
    else
      for (const key of this.keys()) {
        const name = this.document.newNameBytes(decodeName(key));
        try {
          callback(this.get(name), key);
        } finally {
          name.destroy();
        }
      }
  }
  writeObject(value: ObjectInput) {
    const number = this.asIndirect();
    if (!number) throw new Error("Only indirect objects can be replaced.");
    this.document.withObject(value, (child) =>
      this.runtime.call(
        "LPDF_WriteObject",
        this.document.pointer,
        number,
        child.pointer,
      ),
    );
  }
  readRawStream() {
    return this.runtime.buffer(
      this.runtime.call("LPDF_ReadStream", this.pointer, 1),
    );
  }
  readStream() {
    return this.runtime.buffer(
      this.runtime.call("LPDF_ReadStream", this.pointer, 0),
    );
  }
  writeRawStream(bytes: Uint8Array) {
    this.writeStream(bytes, true);
  }
  writeStream(bytes: Uint8Array, raw = false) {
    const number = this.asIndirect();
    if (!number) throw new Error("Streams must be indirect objects.");
    this.runtime.withBytes(bytes, (p, n) =>
      this.runtime.call(
        "LPDF_WriteStream",
        this.document.pointer,
        number,
        p,
        n,
        raw ? 1 : 0,
      ),
    );
  }
}

export function decodeName(name: string) {
  const bytes: number[] = [];
  for (let i = 0; i < name.length; i++) {
    if (name[i] === "#" && /^[\da-f]{2}$/i.test(name.slice(i + 1, i + 3))) {
      bytes.push(parseInt(name.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(name.charCodeAt(i));
  }
  return new Uint8Array(bytes);
}
