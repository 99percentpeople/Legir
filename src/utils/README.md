# `src/utils`

Pure, low-level utility functions.

Put code here when it is:

- Stateless and side-effect-free, or very close to it
- Generic enough that it does not need feature or service context
- Mostly about transforming values, parsing, formatting, or small calculations

Do not put code here when it needs:

- Access to editor state, services, or event buses
- PDF-specific concepts or third-party PDF internals
- Workspace DOM/rendering context
- Feature-level policy or business rules

Rule of thumb:

- If the function still makes sense outside Legir's feature model, `src/utils` is usually correct.
- If it depends on project concepts such as fields, annotations, viewport state, or AI workflow, it probably belongs elsewhere.
