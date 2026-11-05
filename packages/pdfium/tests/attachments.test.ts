import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPDFium, type PDFium } from "../src/index.js";
import {
  NativeEditingContext,
  PDFArray,
  PDFDict,
  PDFName,
  PDFString,
} from "../src/authoring/index.js";

let engine: PDFium;
const views: NativeEditingContext[] = [];
beforeAll(async () => {
  engine = await createPDFium();
});
afterEach(() => {
  for (const view of views.splice(0)) {
    view.dispose();
    view.native.destroy();
  }
  expect(engine.liveDocuments()).toBe(0);
});
function open(bytes?: Uint8Array) {
  const view = new NativeEditingContext(engine, new engine.PDFDocument(bytes));
  views.push(view);
  return view.document;
}
const binary = Uint8Array.from({ length: 1024 }, (_, i) => i % 256);
const N = PDFName.of;

describe("document attachments", () => {
  it("roundtrips binary data, empty files, Unicode names and metadata", async () => {
    const doc = open(),
      files = doc.getAttachments();
    expect(files.list()).toEqual([]);
    const added = files.add(binary, {
      name: "项目📎.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      description: "原始数据",
    });
    files.add(new Uint8Array(), { name: "empty.txt" });
    const read = files.read(added.id);
    read[0] = 99;
    expect(files.read(added.id)).toEqual(binary);
    expect(added).toMatchObject({
      name: "项目📎.xlsx",
      size: binary.length,
      embedded: true,
    });
    const loaded = open(await doc.save()).getAttachments();
    expect(loaded.list()).toContainEqual(added);
    expect(loaded.read(added.id)).toEqual(binary);
    expect(
      loaded.read(loaded.list().find((f) => f.name === "empty.txt")!.id),
    ).toHaveLength(0);
  });

  it("renames with a stable id, replaces content, clears metadata and removes files", async () => {
    const doc = open(),
      files = doc.getAttachments();
    const original = files.add(binary, {
      name: "before.bin",
      mimeType: "application/octet-stream",
      description: "old",
    });
    expect(
      files.update(original.id, {
        name: "after.txt",
        bytes: new TextEncoder().encode("new"),
        mimeType: "text/plain",
        description: "说明",
      }),
    ).toMatchObject({
      id: original.id,
      name: "after.txt",
      size: 3,
      mimeType: "text/plain",
    });
    // Reusing the old display name must not collide with its retained opaque id.
    const second = files.add(binary, { name: "before.bin" });
    expect(second.id).not.toBe(original.id);
    files.update(original.id, { mimeType: null, description: null });
    const loaded = open(await doc.save()).getAttachments();
    expect(loaded.read(original.id)).toEqual(new TextEncoder().encode("new"));
    expect(loaded.list().find((f) => f.id === original.id)).toMatchObject({
      mimeType: undefined,
      description: undefined,
    });
    expect(loaded.remove(original.id)).toBe(true);
    expect(loaded.remove(original.id)).toBe(false);
    expect(() => loaded.read(original.id)).toThrow(/not found/);
    expect(loaded.list()).toEqual([second]);
  });

  it("rejects duplicate names and invalid changes without modifying existing files", () => {
    const files = open().getAttachments();
    const a = files.add(binary, { name: "a.bin" }),
      b = files.add(binary, { name: "b.bin" });
    expect(() => files.add(binary, { name: "a.bin" })).toThrow(
      /already exists/,
    );
    expect(() =>
      files.update(a.id, { name: "b.bin", bytes: new Uint8Array() }),
    ).toThrow(/already exists/);
    for (const name of [
      "",
      " ",
      "../file",
      "dir\\file",
      "a\0b",
      "\ud800",
      ".",
      "..",
    ])
      expect(() => files.add(binary, { name })).toThrow();
    expect(() =>
      files.update(a.id, { mimeType: "text/plain\r\nx-header: x" }),
    ).toThrow(/MIME/);
    expect(() => files.update("missing", { name: "x" })).toThrow(/not found/);
    expect(files.list()).toEqual([a, b]);
    expect(files.read(a.id)).toEqual(binary);
  });

  it("reads existing nested trees and preserves other Names entries and file-spec metadata", async () => {
    const doc = open(),
      context = doc.context;
    const data = context.register(
      context.flateStream(binary, {
        Type: "EmbeddedFile",
        Params: { Size: binary.length },
      }),
    );
    const spec = context.register(
      context.obj({
        Type: "Filespec",
        F: PDFString.of("legacy.bin"),
        EF: { F: data },
        AFRelationship: "Data",
        Desc: PDFString.of("legacy"),
      }),
    );
    const leaf = context.register(
      context.obj({ Names: [PDFString.of("unrelated-key"), spec] }),
    );
    const dests = context.register(context.obj({ Names: [] }));
    doc.catalog.set(
      N("Names"),
      context.obj({ Dests: dests, EmbeddedFiles: { Kids: [leaf] } }),
    );
    const loadedDoc = open(await doc.save()),
      files = loadedDoc.getAttachments();
    const original = files.list()[0];
    expect(original.name).toBe("legacy.bin");
    expect(files.read(original.id)).toEqual(binary);
    files.update(original.id, { name: "renamed.bin" });
    files.add(binary, { name: "new.bin" });
    const names = loadedDoc.catalog.lookup(N("Names"), PDFDict);
    expect(
      names.lookup(N("Dests"), PDFDict).lookup(N("Names"), PDFArray).size(),
    ).toBe(0);
    const entries = names
      .lookup(N("EmbeddedFiles"), PDFDict)
      .lookup(N("Names"), PDFArray);
    const preserved = entries.lookup(1, PDFDict);
    expect(preserved.lookup(N("AFRelationship"), PDFName).decodeText()).toBe(
      "Data",
    );
    for (const file of files.list()) files.remove(file.id);
    expect(names.has(N("EmbeddedFiles"))).toBe(false);
    expect(names.has(N("Dests"))).toBe(true);
  });

  it("maintains a sorted bounded name tree with more than one leaf", async () => {
    const doc = open(),
      files = doc.getAttachments();
    for (let i = 69; i >= 0; i--)
      files.add(Uint8Array.of(i), {
        name: `file-${String(i).padStart(3, "0")}`,
      });
    const tree = doc.catalog
      .lookup(N("Names"), PDFDict)
      .lookup(N("EmbeddedFiles"), PDFDict);
    expect(tree.lookup(N("Kids"), PDFArray).size()).toBe(2);
    const loaded = open(await doc.save()).getAttachments();
    expect(loaded.list()).toHaveLength(70);
    for (const [i, file] of loaded.list().entries()) {
      expect(file.name).toBe(`file-${String(i).padStart(3, "0")}`);
      expect(loaded.read(file.id)).toEqual(Uint8Array.of(i));
    }
  });

  it("does not decode attachments when listing and rejects missing or corrupt content on read", async () => {
    const doc = open(),
      ctx = doc.context;
    const broken = ctx.register(
      ctx.stream("broken", {
        Type: "EmbeddedFile",
        Filter: "FlateDecode",
        Params: { Size: 8 },
      }),
    );
    doc.catalog.set(
      N("Names"),
      ctx.obj({
        EmbeddedFiles: {
          Names: [
            PDFString.of("a"),
            { F: PDFString.of("broken.bin"), EF: { F: broken } },
            PDFString.of("b"),
            { F: PDFString.of("external.bin") },
          ],
        },
      }),
    );
    const files = open(await doc.save()).getAttachments(),
      entries = files.list();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ size: 8, embedded: true });
    expect(entries[1].embedded).toBe(false);
    expect(() => files.read(entries[0].id)).toThrow();
    expect(() => files.read(entries[1].id)).toThrow(/no embedded/);
  });

  it("copies shared stream data before changing MIME type or contents", async () => {
    const doc = open(),
      files = doc.getAttachments();
    const a = files.add(binary, {
      name: "a.bin",
      mimeType: "application/octet-stream",
    });
    const b = files.add(binary, { name: "b.bin" });
    const names = doc.catalog
      .lookup(N("Names"), PDFDict)
      .lookup(N("EmbeddedFiles"), PDFDict)
      .lookup(N("Names"), PDFArray);
    const first = names.lookup(1, PDFDict),
      second = names.lookup(3, PDFDict);
    second.set(N("EF"), first.lookup(N("EF"), PDFDict));
    files.update(a.id, { mimeType: "text/plain" });
    expect(files.list().find((file) => file.id === b.id)?.mimeType).toBe(
      "application/octet-stream",
    );
    expect(files.read(a.id)).toEqual(binary);
    files.update(a.id, { bytes: Uint8Array.of(5) });
    expect(files.read(b.id)).toEqual(binary);
    expect(
      open(await doc.save())
        .getAttachments()
        .read(a.id),
    ).toEqual(Uint8Array.of(5));
  });

  it("fails closed on cyclic, duplicate or malformed name trees", () => {
    const doc = open(),
      ctx = doc.context;
    const tree = ctx.obj({}),
      ref = ctx.register(tree);
    tree.set(N("Kids"), ctx.obj([ref]));
    doc.catalog.set(N("Names"), ctx.obj({ EmbeddedFiles: ref }));
    expect(() => doc.getAttachments().add(binary, { name: "x" })).toThrow(
      /name tree/,
    );
    tree.delete(N("Kids"));
    tree.set(
      N("Names"),
      ctx.obj([PDFString.of("a"), {}, PDFString.of("a"), {}]),
    );
    expect(() => doc.getAttachments().list()).toThrow(/Duplicate/);
    tree.set(N("Names"), ctx.obj([PDFString.of("a")]));
    expect(() => doc.getAttachments().list()).toThrow(/entries/);
  });

  it("rolls back attachment edits with the native transaction", async () => {
    const source = open();
    const a = source.getAttachments().add(binary, { name: "original.bin" });
    const doc = open(await source.save()),
      native = doc.nativeView!.native;
    native.enableJournal();
    native.beginOperation("Edit attachments");
    doc
      .getAttachments()
      .update(a.id, { name: "changed.bin", bytes: Uint8Array.of(1) });
    doc.getAttachments().add(binary, { name: "added.bin" });
    await doc.flush();
    native.abandonOperation();
    // A fresh view is required after rollback, just like other authoring edits.
    const restored = new NativeEditingContext(engine, native);
    try {
      expect(restored.document.getAttachments().list()).toEqual([a]);
      expect(restored.document.getAttachments().read(a.id)).toEqual(binary);
    } finally {
      restored.dispose();
    }
  });
});
