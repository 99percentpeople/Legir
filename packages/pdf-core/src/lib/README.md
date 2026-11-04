# `@legir/pdf-core/lib`

Internal helper modules for the PDF pipeline.

Put code here when it is:

- Specific to PDF parsing, rendering, text geometry, annotations, export, or coordinate conversion
- Shared by multiple PDF pipeline modules
- Allowed to depend on lazy native editing views, the PDFium engine service, viewport math, or PDF-specific data structures

Do not put code here when it is:

- A top-level PDF orchestration flow; that belongs in `packages/pdf-core/src/pipeline/*`
- Pure generic utility code with no PDF concepts
- Workspace-only UI behavior
- AI-chat-specific prompting or tool runtime logic

Rule of thumb:

- PDF-domain primitive/helper: `@legir/pdf-core/lib`
- Parser/exporter contract: `packages/pdf-core/src/types.ts`
- Full document workflow/orchestration: `src/services/pdfService/*.ts`

Live PDF parsing, mutation and serialization run inside the owning worker's
`DocumentSession`. Helpers receive a lazy `engine/editingDocument` view over
that same native xref; never load another document for a live edit. Do not call
`PDFDocument.load` or `PDFDocument.save` in application code.

PDFium/WASM calls belong in `packages/pdf-core/src/engine/`. The
`textRedaction` helper edits the live native transaction directly, preserving
unrelated document structures and source resource identity. Standalone test
fixture helpers must destroy their owned authoring documents in `finally`;
live thumbnails and stamp fallbacks reuse the owning native document.
