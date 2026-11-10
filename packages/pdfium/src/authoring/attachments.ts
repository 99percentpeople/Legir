// Copyright (c) 2026 Legir contributors. MIT; see ../../LICENSE.
import type { PDFDocument } from "./document.js";
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFStream,
  PDFString,
} from "./objects.js";

export interface PDFAttachmentInfo {
  /** Opaque name-tree key. Stable across renames and saves within this document. */
  id: string;
  name: string;
  description?: string;
  mimeType?: string;
  /** Declared uncompressed size, when present. Listing does not decode streams. */
  size?: number;
  embedded: boolean;
}
export interface PDFAttachmentOptions {
  name: string;
  description?: string;
  mimeType?: string;
}
export interface PDFAttachmentUpdate {
  name?: string;
  bytes?: Uint8Array;
  /** null removes the corresponding metadata. */
  description?: string | null;
  mimeType?: string | null;
}
interface Entry {
  key: PDFString;
  value: PDFObject;
  spec: PDFDict;
}
const name = PDFName.of;
const idOf = (entry: Entry) =>
  Array.from(entry.key.asBytes(), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
const text = (dict: PDFDict, key: string) =>
  dict.lookupMaybe(name(key), PDFString)?.decodeText();
const streamOf = (entry: Entry) => {
  const ef = entry.spec.lookupMaybe(name("EF"), PDFDict);
  const value = ef?.lookup(name("UF")) ?? ef?.lookup(name("F"));
  return value instanceof PDFStream ? value : undefined;
};
const infoOf = (entry: Entry): PDFAttachmentInfo => {
  const stream = streamOf(entry);
  const size = stream?.dict
    .lookupMaybe(name("Params"), PDFDict)
    ?.lookupMaybe(name("Size"), PDFNumber)
    ?.asNumber();
  return {
    id: idOf(entry),
    name:
      text(entry.spec, "UF") ?? text(entry.spec, "F") ?? entry.key.decodeText(),
    description: text(entry.spec, "Desc"),
    mimeType: stream?.dict.lookupMaybe(name("Subtype"), PDFName)?.decodeText(),
    size:
      size !== undefined && Number.isSafeInteger(size) && size >= 0
        ? size
        : undefined,
    embedded: !!stream,
  };
};
const compareKeys = (a: Entry, b: Entry) => {
  const left = a.key.asBytes(),
    right = b.key.asBytes();
  for (let i = 0; i < Math.min(left.length, right.length); i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
};

/** Document-level EmbeddedFiles only; no network, filesystem or PDF actions. */
export class PDFAttachments {
  constructor(private readonly doc: PDFDocument) {}

  private entries() {
    const root = this.doc.catalog
      .lookupMaybe(name("Names"), PDFDict)
      ?.lookupMaybe(name("EmbeddedFiles"), PDFDict);
    const entries: Entry[] = [],
      seen = new Set<PDFDict>(),
      keys = new Set<string>();
    const visit = (node: PDFDict, depth: number) => {
      if (depth > 64 || seen.has(node) || seen.size >= 10000)
        throw new Error("Invalid or oversized embedded-file name tree");
      seen.add(node);
      const names = node.lookupMaybe(name("Names"), PDFArray);
      const kids = node.lookupMaybe(name("Kids"), PDFArray);
      if (names && kids)
        throw new Error("Embedded-file node has both Names and Kids");
      if (names) {
        if (names.size() % 2 || entries.length + names.size() / 2 > 10000)
          throw new Error("Invalid or oversized embedded-file entries");
        for (let i = 0; i < names.size(); i += 2) {
          const entry = {
            key: names.lookup(i, PDFString),
            value: names.get(i + 1),
            spec: names.lookup(i + 1, PDFDict),
          };
          const id = idOf(entry);
          if (keys.has(id))
            throw new Error("Duplicate embedded-file name-tree key");
          keys.add(id);
          entries.push(entry);
        }
      }
      if (kids) {
        if (kids.size() > 10000)
          throw new Error("Oversized embedded-file name tree");
        for (let i = 0; i < kids.size(); i++)
          visit(kids.lookup(i, PDFDict), depth + 1);
      }
    };
    if (root) visit(root, 0);
    return entries.sort(compareKeys);
  }

  private writeTree(entries: Entry[]) {
    const { context, catalog } = this.doc;
    let names = catalog.lookupMaybe(name("Names"), PDFDict);
    if (!entries.length) {
      names?.delete(name("EmbeddedFiles"));
      return;
    }
    entries.sort(compareKeys);
    // Bounded leaves and branch nodes; never replace unrelated /Names trees.
    let nodes: { ref: PDFObject; first: PDFString; last: PDFString }[] = [];
    for (let i = 0; i < entries.length; i += 64) {
      const batch = entries.slice(i, i + 64),
        first = batch[0].key,
        last = batch[batch.length - 1].key;
      nodes.push({
        first,
        last,
        ref: context.register(
          context.obj({
            Names: batch.flatMap((entry) => [entry.key, entry.value]),
            Limits: [first, last],
          }),
        ),
      });
    }
    while (nodes.length > 1) {
      const parents: typeof nodes = [];
      for (let i = 0; i < nodes.length; i += 64) {
        const batch = nodes.slice(i, i + 64),
          first = batch[0].first,
          last = batch[batch.length - 1].last;
        parents.push({
          first,
          last,
          ref: context.register(
            context.obj({
              Kids: batch.map((n) => n.ref),
              Limits: [first, last],
            }),
          ),
        });
      }
      nodes = parents;
    }
    if (!names) {
      names = context.obj({});
      catalog.set(name("Names"), context.register(names));
    }
    names.set(name("EmbeddedFiles"), nodes[0].ref);
  }

  private validate(options: PDFAttachmentUpdate) {
    if (
      options.name !== undefined &&
      (typeof options.name !== "string" ||
        !options.name.trim() ||
        options.name === "." ||
        options.name === ".." ||
        options.name.length > 1024 ||
        Array.from(options.name).some(
          (character) =>
            character === "/" ||
            character === "\\" ||
            character.charCodeAt(0) < 32 ||
            character.charCodeAt(0) === 127,
        ) ||
        new TextDecoder().decode(new TextEncoder().encode(options.name)) !==
          options.name)
    )
      throw new Error(
        "Attachment name must be a nonempty filename without paths or control characters",
      );
    if (
      options.mimeType !== undefined &&
      options.mimeType !== null &&
      !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(options.mimeType)
    )
      throw new Error("Invalid attachment MIME type");
    if (
      options.description !== undefined &&
      options.description !== null &&
      typeof options.description !== "string"
    )
      throw new Error("Invalid attachment description");
    if (options.bytes !== undefined && !(options.bytes instanceof Uint8Array))
      throw new Error("Attachment contents must be Uint8Array");
  }

  list(): PDFAttachmentInfo[] {
    return this.entries().map(infoOf);
  }

  /** Returns an owned copy. A host must apply resource limits to untrusted PDFs. */
  read(id: string): Uint8Array {
    const entry = this.entries().find((entry) => idOf(entry) === id);
    if (!entry) throw new Error("Attachment not found");
    const stream = streamOf(entry);
    if (!stream) throw new Error("Attachment has no embedded file stream");
    return stream.getUnencodedContents().slice();
  }

  add(bytes: Uint8Array, options: PDFAttachmentOptions): PDFAttachmentInfo {
    if (!(bytes instanceof Uint8Array))
      throw new Error("Attachment contents must be Uint8Array");
    this.validate({ ...options, bytes });
    if (options.name === undefined)
      throw new Error("Attachment name is required");
    const entries = this.entries();
    if (entries.length >= 10000) throw new Error("Too many attachments");
    if (entries.some((entry) => infoOf(entry).name === options.name))
      throw new Error("Attachment filename already exists");
    const keys = new Set(entries.map(idOf));
    const spec = this.doc.context.obj({ Type: "Filespec" });
    const entry: Entry = {
      key: PDFHexString.fromText(options.name),
      spec,
      value: spec,
    };
    for (let suffix = 2; keys.has(idOf(entry)); suffix++)
      entry.key = PDFHexString.fromText(`${options.name} (${suffix})`);
    this.apply(entry, { ...options, bytes });
    entry.value = this.doc.context.register(spec);
    this.writeTree([...entries, entry]);
    return infoOf(entry);
  }

  update(id: string, changes: PDFAttachmentUpdate): PDFAttachmentInfo {
    this.validate(changes);
    const entries = this.entries(),
      entry = entries.find((entry) => idOf(entry) === id);
    if (!entry) throw new Error("Attachment not found");
    if (
      changes.name !== undefined &&
      entries.some(
        (other) => other !== entry && infoOf(other).name === changes.name,
      )
    )
      throw new Error("Attachment filename already exists");
    this.apply(entry, changes);
    return infoOf(entry);
  }

  private apply(entry: Entry, changes: PDFAttachmentUpdate) {
    const { context } = this.doc;
    // Prepare stream before mutating the file specification; metadata-only changes
    // never decode file contents. Replacement streams do not affect shared donors.
    let replacement: PDFStream | undefined;
    if (changes.bytes !== undefined) {
      const mimeType =
        changes.mimeType === undefined
          ? infoOf(entry).mimeType
          : changes.mimeType;
      replacement = context.flateStream(changes.bytes.slice(), {
        Type: "EmbeddedFile",
        Params: { Size: changes.bytes.length },
        ...(mimeType ? { Subtype: PDFName.of(mimeType) } : {}),
      });
    } else if (changes.mimeType !== undefined) {
      const old = streamOf(entry);
      if (!old) throw new Error("Attachment has no embedded file stream");
      replacement = PDFRawStream.of(
        old.dict.clone(context),
        old.getContents().slice(),
      );
      if (changes.mimeType === null) replacement.dict.delete(name("Subtype"));
      else replacement.dict.set(name("Subtype"), name(changes.mimeType));
    }
    if (replacement) {
      const ref = context.register(replacement);
      entry.spec.set(name("EF"), context.obj({ F: ref, UF: ref }));
    }
    if (changes.name !== undefined) {
      entry.spec.set(name("F"), PDFString.of(changes.name));
      entry.spec.set(name("UF"), PDFHexString.fromText(changes.name));
    }
    if (changes.description === null) entry.spec.delete(name("Desc"));
    else if (changes.description !== undefined)
      entry.spec.set(name("Desc"), PDFHexString.fromText(changes.description));
  }

  /** Unlists the file. Other references and incremental-save history can retain it. */
  remove(id: string): boolean {
    const entries = this.entries(),
      remaining = entries.filter((entry) => idOf(entry) !== id);
    if (remaining.length === entries.length) return false;
    this.writeTree(remaining);
    return true;
  }
}
