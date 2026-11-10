// Standalone fixture builders and native roundtrip checks own native handles.
// App sessions have their own explicit lifetime; never dispose those here.
import { afterEach } from "vitest";
import { PDFDocument } from "@legir/pdfium/authoring";
const documents = new Set<PDFDocument>();
const create = PDFDocument.create.bind(PDFDocument),
  load = PDFDocument.load.bind(PDFDocument);
PDFDocument.create = async (...args: Parameters<typeof create>) => {
  const document = await create(...args);
  documents.add(document);
  return document;
};
PDFDocument.load = async (...args: Parameters<typeof load>) => {
  const document = await load(...args);
  documents.add(document);
  return document;
};
afterEach(() => {
  for (const document of documents) document.destroy();
  documents.clear();
});
