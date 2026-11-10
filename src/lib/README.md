# `src/lib`

Shared application helpers that are reused across multiple features.

Put code here when it is:

- Reusable across pages, services, or workspace modules
- Not tied to a single domain service such as AI chat or PDF import/export
- More than a one-off utility, but still small enough that a full service module would be excessive

Do not put code here when it is:

- PDF-pipeline-specific
- Workspace-rendering-specific
- A pure formatting/math/string helper with no app-level semantics
- A shared data contract; those belong in a nearby `types.ts`

Rule of thumb:

- Cross-feature behavior or integration helper: `src/lib`
- Pure stateless helper: `src/utils`
- PDF-domain helper: `src/services/pdfService/lib`
- Workspace-only rendering/interaction helper: `src/components/workspace/lib`

Portable PDF models, geometry, font naming, stamp helpers and permission policies now live in `@legir/pdf-model`. Import their package subpaths rather than reintroducing copies here.

`stampImageBrowser.ts` owns browser file/image decoding and drag/drop integration
shared by the application and the website's reused controls. It is deliberately
outside the portable model and PDF engine/pipeline services.
