// Copied into an isolated consumer by check-package-consumer.mjs.
// This file deliberately imports only published package entry points.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPDFium } from "@legir/pdfium";
import {
  NativeEditingContext,
  fromPdfTextAlignment,
  toPdfTextAlignment,
} from "@legir/pdfium/authoring";
import { DocumentSession } from "@legir/pdf-core";
import { FieldType } from "@legir/pdf-model";
import { PDFWorkerService } from "@legir/pdf-renderer";

for (const [code, alignment] of ["left", "center", "right"].entries()) {
  assert.equal(fromPdfTextAlignment(code), alignment);
  assert.equal(toPdfTextAlignment(alignment), code);
}
for (const invalid of [undefined, -1, 3, 0.5, NaN]) {
  assert.equal(fromPdfTextAlignment(invalid), undefined);
}
assert.throws(() => toPdfTextAlignment("middle"), /alignment/);
assert.equal(typeof globalThis.window, "undefined");
assert.equal(typeof globalThis.Worker, "undefined");
for (const specifier of [
  "@legir/pdf-core/engine/documentSession",
  "@legir/pdf-core/parsers/AnnotationParsers",
  "@legir/pdf-core/workerProtocol",
  "@legir/pdf-renderer/documentOwners",
]) {
  await assert.rejects(import(specifier), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
}
assert.equal("loadPDFInternal" in (await import("@legir/pdf-core")), false);
const stamp = await import("@legir/pdf-model/stampImage");
assert.equal("loadStampImageFile" in stamp, false);
assert.equal("hasStampImageTransfer" in stamp, false);
assert.deepEqual(
  stamp.getStampSvgIntrinsicSize(
    "data:image/svg+xml," +
      encodeURIComponent(
        '<svg viewBox="0 0 200 100"><rect width="10" height="20"/></svg>',
      ),
  ),
  { width: 200, height: 100 },
  "SVG stamp sizing must use the root, not child element dimensions",
);
let workerCreations = 0;
const client = new PDFWorkerService({
  lazy: true,
  createWorker: () => {
    workerCreations++;
    throw new Error("No browser worker in this test");
  },
});
client.destroy();
assert.equal(
  workerCreations,
  0,
  "importing the renderer must not start a worker",
);

const engine = await createPDFium();
const views = new Set();
const open = (bytes) => {
  const view = new NativeEditingContext(engine, new engine.PDFDocument(bytes));
  views.add(view);
  return view;
};
const close = (view) => {
  view.dispose();
  view.native.destroy();
  views.delete(view);
};
const rasterHash = (native) => {
  const page = native.loadPage(0);
  try {
    const pixels = page.toPixmap(engine.Matrix.scale(1, 1));
    try {
      return createHash("sha256").update(pixels.getPixels()).digest("hex");
    } finally {
      pixels.destroy();
    }
  } finally {
    page.destroy();
  }
};
let session;
try {
  const source = open();
  const attachmentBytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const attachment = source.document.getAttachments().add(attachmentBytes, {
    name: "原始数据.bin",
    mimeType: "application/octet-stream",
    description: "Consumer fixture",
  });
  const page = source.document.addPage([360, 240]);
  const form = source.document.getForm();
  form
    .createTextField("project_name")
    .addToPage(page, { x: 35, y: 150, width: 260, height: 28 });
  form
    .createCheckBox("completed")
    .addToPage(page, { x: 35, y: 95, width: 18, height: 18 });
  const photo = form.createButton("site_photo");
  photo.addToPage("", page, {
    x: 80,
    y: 20,
    width: 100,
    height: 90,
    borderWidth: 0,
  });
  photo.setLayout(1);
  const icon = await source.document.embedPng(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAGUlEQVR4nD3BMQEAAAjAILR/5/kJJIi28Q5Y5gT/nBWRrgAAAABJRU5ErkJggg==",
  );
  photo.setImage(icon);
  form
    .createSignature("approval")
    .addToPage(page, { x: 205, y: 20, width: 120, height: 50 });
  const template = await source.document.save();
  close(source);
  session = new DocumentSession(engine, template);
  const originalRaster = rasterHash(session.document);
  const parsed = await session.parse({}, async () => undefined);
  assert.equal(parsed.fields.length, 4);
  assert.equal(
    parsed.fields.find((field) => field.name === "site_photo")?.type,
    FieldType.BUTTON,
  );
  assert.equal(
    parsed.fields.find((field) => field.name === "approval")?.type,
    FieldType.SIGNATURE,
  );
  assert.equal(
    parsed.fields.find((field) => field.name === "project_name")?.type,
    FieldType.TEXT,
  );
  const fields = parsed.fields.map((field) =>
    field.name === "project_name"
      ? {
          ...field,
          value: "Independent package consumer",
          horizontalAlignment: "center",
          verticalAlignment: "middle",
        }
      : field.type === FieldType.CHECKBOX
        ? { ...field, isChecked: true }
        : field,
  );
  const request = {
    fields,
    annotations: parsed.annotations,
    metadata: parsed.metadata,
    options: { preservedSourceAnnotations: parsed.preservedSourceAnnotations },
  };
  const completed = await session.export(request);
  assert.equal(session.stats().nativeDocuments, 1);
  assert.equal(
    rasterHash(session.document),
    originalRaster,
    "export must roll back the source document",
  );
  const filled = open(completed);
  assert.deepEqual(filled.document.getAttachments().list(), [attachment]);
  assert.deepEqual(
    filled.document.getAttachments().read(attachment.id),
    attachmentBytes,
  );
  assert.equal(
    filled.document.getForm().getTextField("project_name").getText(),
    "Independent package consumer",
  );
  assert.equal(
    filled.document
      .getForm()
      .getTextField("project_name")
      .getVerticalAlignment(),
    "middle",
  );
  assert.equal(
    filled.document
      .getForm()
      .getTextField("project_name")
      .getHorizontalAlignment(),
    "center",
  );
  const reopened = new DocumentSession(engine, completed);
  try {
    const aligned = (
      await reopened.parse({}, async () => undefined)
    ).fields.find((field) => field.name === "project_name");
    assert.equal(aligned.horizontalAlignment, "center");
    assert.equal(
      (await reopened.parse({}, async () => undefined)).fields.find(
        (field) => field.name === "project_name",
      ).verticalAlignment,
      "middle",
    );
  } finally {
    reopened.dispose();
  }
  assert.equal(
    filled.document.getForm().getCheckBox("completed").isChecked(),
    true,
  );
  assert.ok(filled.document.getForm().getButton("site_photo").getIcon());
  assert.equal(
    filled.document.getForm().getSignature("approval").getSignatureInfo(),
    undefined,
  );
  const filledRaster = rasterHash(filled.native);
  assert.notEqual(filledRaster, originalRaster);
  close(filled);
  const flattened = await session.export({
    ...request,
    options: { ...request.options, flattenFormFields: true },
  });
  const flat = open(flattened);
  assert.deepEqual(flat.document.getAttachments().list(), [attachment]);
  assert.deepEqual(
    flat.document.getAttachments().read(attachment.id),
    attachmentBytes,
  );
  flat.document
    .getAttachments()
    .update(attachment.id, { name: "更新.bin", bytes: Uint8Array.of(0, 255) });
  const edited = open(await flat.document.save());
  assert.equal(edited.document.getAttachments().list()[0].name, "更新.bin");
  assert.deepEqual(
    edited.document.getAttachments().read(attachment.id),
    Uint8Array.of(0, 255),
  );
  assert.equal(edited.document.getAttachments().remove(attachment.id), true);
  close(edited);
  assert.equal(flat.document.getForm().getFields().length, 0);
  assert.equal(
    rasterHash(flat.native),
    filledRaster,
    "flattening must preserve the rendered page",
  );
  close(flat);
  session.dispose();
  session = undefined;
  assert.equal(engine.liveDocuments(), 0);
  console.log(
    JSON.stringify({
      standalone: true,
      fields: 4,
      buttonImageAndNativeSignature: true,
      editableAndFlattened: true,
      identicalFlattenedPixels: true,
      verticalAlignmentRoundTrip: true,
      sourceUnchanged: true,
      attachmentReadEditAndPreservation: true,
      liveDocuments: engine.liveDocuments(),
    }),
  );
} finally {
  session?.dispose();
  for (const view of views) close(view);
}
