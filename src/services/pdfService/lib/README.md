# `src/services/pdfService/lib`

Internal helper modules for the PDF pipeline.

Put code here when it is:

- Specific to PDF parsing, rendering, text geometry, annotations, export, or coordinate conversion
- Shared by multiple PDF pipeline modules
- Allowed to depend on `pdf-lib`, `pdfjs-dist`, viewport math, or PDF-specific data structures

Do not put code here when it is:

- A top-level PDF orchestration flow; that belongs in `src/services/pdfService/*`
- Pure generic utility code with no PDF concepts
- Workspace-only UI behavior
- AI-chat-specific prompting or tool runtime logic

Rule of thumb:

- PDF-domain primitive/helper: `src/services/pdfService/lib`
- Parser/exporter contract: `src/services/pdfService/types.ts`
- Full document workflow/orchestration: `src/services/pdfService/*.ts`
