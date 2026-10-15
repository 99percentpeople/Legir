import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFForm,
  type PDFObject,
} from "@legir/pdfium/authoring";

/** Check the saved widgets, including orphans and inherited field attributes.
 * Never decode appearance streams or open another document for this decision. */
export async function finalizeFormAppearances(
  document: PDFDocument,
  options: {
    form?: PDFForm;
    flatten?: boolean;
    regenerated?: ReadonlySet<PDFRef>;
    checkpoint: () => Promise<void>;
  },
) {
  const acroForm = document.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return;
  const key = PDFName.of("NeedAppearances");
  const originallyRequired = acroForm.lookup(key) === PDFBool.True;
  const xfa = acroForm.get(PDFName.of("XFA"));
  // PDFium does not process XFA. Preserve its source policy for editable output.
  if (!options.flatten && xfa && xfa !== PDFNull) return;

  let required = false;
  if (!options.flatten) {
    pages: for (const page of document.getPages()) {
      await options.checkpoint();
      const annots = page.node.lookup(PDFName.of("Annots"));
      if (!(annots instanceof PDFArray)) continue;
      for (let i = 0; i < annots.size(); i++) {
        await options.checkpoint();
        try {
          const ref = annots.get(i);
          const widget = document.context.lookup(ref);
          if (
            !(widget instanceof PDFDict) ||
            widget.lookup(PDFName.of("Subtype")) !== PDFName.of("Widget")
          )
            continue;
          const flags = widget.lookup(PDFName.of("F"));
          if (flags instanceof PDFNumber && (flags.asNumber() & 2) !== 0)
            continue; // Hidden widgets do not need a visible appearance.

          let current: PDFObject | undefined = ref;
          let type: PDFObject | undefined;
          let regenerated = false;
          let dirty = false;
          const seen = new Set<PDFDict>();
          while (current) {
            await options.checkpoint();
            const dict = document.context.lookup(current);
            if (!(dict instanceof PDFDict) || seen.has(dict)) break;
            seen.add(dict);
            if (current instanceof PDFRef) {
              regenerated ||= options.regenerated?.has(current) ?? false;
              dirty ||= options.form?.fieldIsDirty(current) ?? false;
            }
            type ??= dict.lookup(PDFName.of("FT"));
            current = dict.get(PDFName.of("Parent"));
          }
          // Signature appearances cannot be reconstructed from their value.
          if (type === PDFName.of("Sig")) continue;

          const ap = widget.lookup(PDFName.of("AP"));
          let normal =
            ap instanceof PDFDict ? ap.lookup(PDFName.of("N")) : undefined;
          if (normal instanceof PDFDict) {
            const state = widget.lookup(PDFName.of("AS"));
            normal =
              state instanceof PDFName ? normal.lookup(state) : undefined;
          }
          if (
            !(normal instanceof PDFStream) ||
            dirty ||
            // An input requesting regeneration may have a stale /AP despite
            // its presence. Clear that request only after we regenerated it.
            (originallyRequired && !regenerated)
          ) {
            required = true;
            break pages;
          }
        } catch {
          // Retain the viewer fallback for malformed or unresolved widgets.
          required = true;
          break pages;
        }
      }
    }
  }
  await options.checkpoint();
  // Missing means false. Avoid a new write on an unchanged metadata-only save.
  if (required !== originallyRequired)
    acroForm.set(key, required ? PDFBool.True : PDFBool.False);
}
