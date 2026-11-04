# @legir/pdf-model

Portable data contracts and geometry/editing policies shared by Legir, the PDF
core and future consumers. No runtime package dependencies, UI framework, AI
configuration, desktop API or PDF engine.

```ts
import { FieldType, type FormField, type Annotation } from "@legir/pdf-model";
import { normalizeRotationDeg } from "@legir/pdf-model/controlRotation";
import { getEffectivePdfPermissions } from "@legir/pdf-model/pdfPermissions";
```

The root exports document, page, form, annotation, history and stamp types.
Subpath exports contain rotation, shape/ink geometry, layer ordering, stamp
layout, font naming and permission helpers. Existing coordinate conventions,
field names and serialized values are preserved; this extraction is not a data
migration or a new template schema.

Application settings, AI provider types, browser file handles, window state and
Zustand stores stay in `src/types.ts` and the application. That file re-exports
the shared document contracts for compatibility. The application constants also
re-export the portable PDF defaults from `@legir/pdf-model/constants`.

The permission-policy provider is realm-scoped, as before. Configure it at host
initialization; do not mutate it to switch concurrent users or server tenants.

License: AGPL-3.0-or-later, retained from the extracted application code.
