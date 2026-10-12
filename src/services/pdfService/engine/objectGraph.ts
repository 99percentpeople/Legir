import type { PDFDocument, PDFObject } from "mupdf";
import type { MuPdfModule } from "./mupdf";
import type { PdfEncryption, PdfObjectGraph, PdfObjectValue } from "./types";
import { dictionaryKeyNames, NativeNames } from "./objectNames";

const readValue = (
  object: PDFObject,
  names: NativeNames,
  depth = 0,
): PdfObjectValue => {
  if (depth > 100) throw new Error("PDF object nesting limit exceeded.");
  if (object.isIndirect()) {
    const generation = Number(
      object.toString().match(/^\d+\s+(\d+)\s+R$/)?.[1] ?? 0,
    );
    return { ref: object.asIndirect(), generation };
  }
  if (object.isNull()) return null;
  if (object.isBoolean()) return object.asBoolean();
  if (object.isNumber()) return Number(object.toString(true, true));
  if (object.isName()) return { name: object.toString(true, true).slice(1) };
  if (object.isString()) return { string: object.asByteString().slice() };
  if (object.isArray()) {
    const array: PdfObjectValue[] = [];
    object.forEach((child) => {
      try {
        array.push(readValue(child, names, depth + 1));
      } finally {
        child.destroy();
      }
    });
    return { array };
  }
  if (object.isDictionary()) {
    const dict: [string, PdfObjectValue][] = [];
    const keys = dictionaryKeyNames(object);
    for (const key of keys) {
      const child = object.get(names.get(key));
      try {
        dict.push([key, readValue(child, names, depth + 1)]);
      } finally {
        child.destroy();
      }
    }
    return { dict };
  }
  throw new Error("Unsupported PDF object.");
};

export function readObjectGraph(
  mupdf: MuPdfModule,
  doc: PDFDocument,
): PdfObjectGraph {
  const names = new NativeNames(mupdf, doc);
  const trailer = doc.getTrailer();
  const graph: PdfObjectGraph = {
    version: doc.getVersion(),
    objects: [],
    trailer: [],
  };
  const generations = new Map<number, number>();
  const rememberRefs = (value: PdfObjectValue) => {
    if (!value || typeof value !== "object") return;
    if ("ref" in value) generations.set(value.ref, value.generation);
    if ("array" in value) value.array.forEach(rememberRefs);
    if ("dict" in value) value.dict.forEach(([, v]) => rememberRefs(v));
  };
  try {
    // The xref, object streams and encryption envelope belong to the native
    // reader/writer. Their resolved, decrypted objects form the editing graph.
    for (const key of ["Root", "Info", "ID"]) {
      const object = trailer.get(key);
      try {
        if (!object.isNull()) {
          const value = readValue(object, names);
          graph.trailer.push([key, value]);
          rememberRefs(value);
        }
      } finally {
        object.destroy();
      }
    }
    for (let number = 1; number < doc.countObjects(); number++) {
      const ref = doc.newIndirect(number);
      const object = ref.resolve();
      try {
        if (object.isNull()) continue;
        const type = object.isDictionary() ? object.get("Type") : undefined;
        try {
          if (type?.isName() && ["ObjStm", "XRef"].includes(type.asName()))
            continue;
        } finally {
          type?.destroy();
        }
        const value = readValue(object, names);
        if (
          ref.isStream() &&
          value &&
          typeof value === "object" &&
          "dict" in value
        ) {
          const buffer = ref.readRawStream();
          try {
            value.stream = buffer.asUint8Array().slice();
          } finally {
            buffer.destroy();
          }
        }
        rememberRefs(value);
        graph.objects.push({ number, generation: 0, value });
      } finally {
        object.destroy();
        ref.destroy();
      }
    }
    for (const object of graph.objects)
      object.generation = generations.get(object.number) ?? 0;
    return graph;
  } finally {
    names.destroy();
    trailer.destroy();
  }
}

function writeValue(
  doc: PDFDocument,
  names: NativeNames,
  value: PdfObjectValue,
): PDFObject {
  if (value === null) return doc.newNull();
  if (typeof value === "boolean") return doc.newBoolean(value);
  if (typeof value === "number")
    return Number.isInteger(value) ? names.integer(value) : doc.newReal(value);
  if ("name" in value) return doc.graftObject(names.get(value.name));
  if ("string" in value) return doc.newByteString(value.string);
  if ("ref" in value) return doc.newIndirect(value.ref);
  const object = "array" in value ? doc.newArray() : doc.newDictionary();
  try {
    if ("array" in value) {
      for (const child of value.array) {
        const item = writeValue(doc, names, child);
        try {
          object.push(item);
        } finally {
          item.destroy();
        }
      }
    } else {
      for (const [key, child] of value.dict) {
        const item = writeValue(doc, names, child);
        try {
          object.put(names.get(key), item);
        } finally {
          item.destroy();
        }
      }
    }
    return object;
  } catch (error) {
    object.destroy();
    throw error;
  }
}

export function writeObjectGraph(
  mupdf: MuPdfModule,
  graph: PdfObjectGraph,
  security?: PdfEncryption,
): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const names = new NativeNames(mupdf, doc);
  try {
    const largest = graph.objects.reduce(
      (max, item) => Math.max(max, item.number),
      0,
    );
    while (doc.countObjects() <= largest) doc.createObject().destroy();
    for (const { number, value } of graph.objects) {
      const ref = doc.newIndirect(number);
      const object = writeValue(doc, names, value);
      try {
        ref.writeObject(object);
        if (
          value &&
          typeof value === "object" &&
          "dict" in value &&
          value.stream
        )
          ref.writeRawStream(value.stream);
      } finally {
        object.destroy();
        ref.destroy();
      }
    }
    const trailer = doc.getTrailer();
    try {
      for (const [key, value] of graph.trailer) {
        if (!["Root", "Info", "ID"].includes(key)) continue;
        const object = writeValue(doc, names, value);
        try {
          trailer.put(key, object);
        } finally {
          object.destroy();
        }
      }
    } finally {
      trailer.destroy();
    }
    if (graph.version > doc.getVersion()) {
      // A new native document starts at 1.7. Preserve later source versions
      // using the catalog override instead of silently downgrading semantics.
      const trailer = doc.getTrailer();
      const catalog = trailer.get("Root");
      const version = doc.newName(
        `${Math.floor(graph.version / 10)}.${graph.version % 10}`,
      );
      try {
        catalog.put("Version", version);
      } finally {
        version.destroy();
        catalog.destroy();
        trailer.destroy();
      }
    }
    // Use JSON options, so commas/equal signs in passwords stay literal.
    const buffer = doc.saveToBuffer({
      garbage: 1,
      compress: true,
      "regenerate-id": false,
      encrypt: security ? "aes-256" : "none",
      ...(security
        ? {
            "user-password": security.userPassword,
            "owner-password": security.ownerPassword,
            permissions: security.permissions ?? -4,
          }
        : {}),
    });
    try {
      return buffer.asUint8Array().slice();
    } finally {
      buffer.destroy();
    }
  } finally {
    names.destroy();
    doc.destroy();
  }
}
