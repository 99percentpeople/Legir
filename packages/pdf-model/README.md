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
Text `FormField`s expose optional `verticalAlignment` (`top`, `middle`, `bottom`)
alongside horizontal `alignment`. Omission retains legacy layout; consumers
must not rewrite existing records just to add a default.
Subpath exports contain rotation, shape/ink geometry, layer ordering, stamp
layout, font naming and permission helpers. Existing coordinate conventions,
field names and serialized values are preserved; this extraction is not a data
migration or a new template schema.

Choice fields keep presentation separate from selection: `FormField.isListBox`
identifies a list box, while `isMultiSelect` controls how many values it accepts.
`isListBoxField` from `@legir/pdf-model/choiceFields` also recognizes legacy
multi-select records without the new property. A single-select list box must not
be inferred to be a dropdown merely because `isMultiSelect` is false.

Application settings, AI provider types, browser file handles, window state and
Zustand stores stay in `src/types.ts` and the application. That file re-exports
the shared document contracts for compatibility. The application constants also
re-export the portable PDF defaults from `@legir/pdf-model/constants`.

The permission-policy provider is realm-scoped, as before. Configure it at host
initialization; do not mutate it to switch concurrent users or server tenants.

License: AGPL-3.0-or-later, retained from the extracted application code.
