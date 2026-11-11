# @legir/pdf-model

Portable data contracts and geometry/editing policies shared by Legir, the PDF
core and future consumers. No runtime package dependencies, UI framework, AI
configuration, desktop API or PDF engine.

Install with `bun add @legir/pdf-model` or `npm install @legir/pdf-model`.

```ts
import { FieldType, type FormField, type Annotation } from "@legir/pdf-model";
import { normalizeRotationDeg } from "@legir/pdf-model/controlRotation";
import { getEffectivePdfPermissions } from "@legir/pdf-model/pdfPermissions";
```

The root exports document, page, form, annotation, history and stamp types.
Text `FormField`s and FreeText `Annotation`s share `TextAlignmentOptions`:
`horizontalAlignment: "left" | "center" | "right"` and
`verticalAlignment: "top" | "middle" | "bottom"`. The root also exports
`HorizontalAlignment` and `VerticalAlignment` types. Omission retains the
existing defaults (single-line fields center vertically; multiline/FreeText top).
Use `horizontalAlignment` and `verticalAlignment` for both input and parsed
output. There are no alias properties or values: horizontal centering is
`center`, vertical centering is `middle`.
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

This package is typechecked without DOM libraries. Stamp resource creation,
data-URL decoding and geometry stay portable; browser `FileReader`/`Image`
loading and drag/drop adapters are intentionally not exported. Only the helper
subpaths explicitly listed in `package.json` are public.

## Tests

After `bun run build:packages` at the repository root, run
`bun run --cwd packages/pdf-model test` (or `bun run test` inside this package).
Functional tests live in `tests/` and run under Node without application aliases.
The root `bun run test` also includes this Vitest project.

License: [MIT](LICENSE). Closed-source commercial use is permitted, provided
that the copyright and license notice are retained. The Legir application
remains AGPL-3.0-or-later.
