# Sample document

`reading-notes.pdf` is a generated, three-page sample for checking the real Legir editor. It contains reading notes, an example annotation, and fillable review fields. It contains no user documents or credentials.

The desktop landing page uses the interactive HTML counterpart in
`www/src/components/workspace-demo/`. It does not load this PDF, a PDF worker,
or the real editor runtime.

`previews/` contains 1200 × 900 WebP captures of that HTML demo for mobile
screens. Each of the six presets has light/dark variants for all seven site
languages. The mobile page loads only the selected image and does not import
or mount the interactive demo. Images contain only the authored sample data.
