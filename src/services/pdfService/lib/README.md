# `src/services/pdfService/lib`

Internal helper modules for the PDF pipeline.

Put code here when it is:

- Specific to PDF parsing, rendering, text geometry, annotations, export, or coordinate conversion
- Shared by multiple PDF pipeline modules
- Allowed to depend on lazy native editing views, the PDFium engine service, viewport math, or PDF-specific data structures

Do not put code here when it is:

- A top-level PDF orchestration flow; that belongs in `src/services/pdfService/*`
- Pure generic utility code with no PDF concepts
- Workspace-only UI behavior
- AI-chat-specific prompting or tool runtime logic

Rule of thumb:

- PDF-domain primitive/helper: `src/services/pdfService/lib`
- Parser/exporter contract: `src/services/pdfService/types.ts`
- Full document workflow/orchestration: `src/services/pdfService/*.ts`

Live PDF parsing, mutation and serialization run inside the owning worker's
`DocumentSession`. Helpers receive a lazy `engine/editingDocument` view over
that same native xref; never load another document for a live edit. Do not call
`PDFDocument.load` or `PDFDocument.save` in application code.

PDFium/WASM calls belong in `src/services/pdfService/engine/`. The
`textRedaction` helper edits the live native transaction directly. Its
`contentResourceBridge` fallback is for standalone authoring; both paths must
preserve unrelated document structures and source resource identity.
