// Copied into an isolated consumer by check-package-consumer.mjs.
// This file deliberately imports only published package entry points.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPDFium } from "@legir/pdfium";
import { NativeEditingContext } from "@legir/pdfium/authoring";
import { DocumentSession } from "@legir/pdf-core";
import { FieldType } from "@legir/pdf-model";
import { PDFWorkerService } from "@legir/pdf-renderer";

assert.equal(typeof globalThis.window, "undefined");
assert.equal(typeof globalThis.Worker, "undefined");
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
  const page = source.document.addPage([360, 240]);
  const form = source.document.getForm();
  form
    .createTextField("project_name")
    .addToPage(page, { x: 35, y: 150, width: 260, height: 28 });
  form
    .createCheckBox("completed")
    .addToPage(page, { x: 35, y: 95, width: 18, height: 18 });
  const template = await source.document.save();
  close(source);
  session = new DocumentSession(engine, template);
  const originalRaster = rasterHash(session.document);
  const parsed = await session.parse({}, async () => undefined);
  assert.equal(parsed.fields.length, 2);
  assert.equal(
    parsed.fields.find((field) => field.name === "project_name")?.type,
    FieldType.TEXT,
  );
  const fields = parsed.fields.map((field) =>
    field.name === "project_name"
      ? { ...field, value: "Independent package consumer" }
      : { ...field, isChecked: true },
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
  assert.equal(
    filled.document.getForm().getTextField("project_name").getText(),
    "Independent package consumer",
  );
  assert.equal(
    filled.document.getForm().getCheckBox("completed").isChecked(),
    true,
  );
  const filledRaster = rasterHash(filled.native);
  assert.notEqual(filledRaster, originalRaster);
  close(filled);
  const flattened = await session.export({
    ...request,
    options: { ...request.options, flattenFormFields: true },
  });
  const flat = open(flattened);
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
      fields: 2,
      editableAndFlattened: true,
      identicalFlattenedPixels: true,
      sourceUnchanged: true,
      liveDocuments: engine.liveDocuments(),
    }),
  );
} finally {
  session?.dispose();
  for (const view of views) close(view);
}
