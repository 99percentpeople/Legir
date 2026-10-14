import type { PDFDocument, PDFObject } from "@legir/pdfium";
import { yieldPdfTask } from "./yieldTask";

/** Build a source catalog containing only selected pages. The caller holds a
 * donor transaction and rolls these temporary field/link edits back afterward.
 * Encoded page streams stay in WASM throughout the graft. */
export async function prepareImportSource(
  doc: PDFDocument,
  indexes: readonly number[],
  signal?: AbortSignal,
) {
  const pages = indexes.map((index) => doc.findPage(index));
  const selected = new Set(pages.map((page) => page.asIndirect()));
  const widgets = new Set<number>();
  const names = new Map<string, PDFObject>();
  const trailer = doc.getTrailer();
  const root = trailer.get("Root");
  const form = root.get("AcroForm");
  const owned: PDFObject[] = [];
  const keep = <T extends PDFObject>(object: T): T => {
    owned.push(object);
    return object;
  };
  let lastYield = performance.now();
  const checkpoint = async () => {
    if (performance.now() - lastYield > 8) {
      await yieldPdfTask();
      lastYield = performance.now();
    }
    signal?.throwIfAborted();
  };
  try {
    const direct = keep(root.get("Dests"));
    direct.forEach((value, name) => {
      names.set(String(name), keep(value));
    });
    const readNames = (node: PDFObject, depth = 0) => {
      if (depth > 64) return;
      const entries = keep(node.get("Names"));
      for (let i = 0; i + 1 < entries.length; i += 2) {
        const key = keep(entries.get(i));
        names.set(key.asString(), keep(entries.get(i + 1)));
      }
      const kids = keep(node.get("Kids"));
      for (let i = 0; i < kids.length; i++)
        readNames(keep(kids.get(i)), depth + 1);
    };
    readNames(keep(root.get("Names", "Dests")));
    const destination = (
      value: PDFObject,
      depth = 0,
    ): PDFObject | undefined => {
      if (depth > 64) return;
      if (value.isName() || value.isString()) {
        const named = names.get(
          value.isName() ? value.asName() : value.asString(),
        );
        return named ? destination(named, depth + 1) : undefined;
      }
      if (value.isDictionary())
        return destination(keep(value.get("D")), depth + 1);
      if (!value.isArray()) return;
      const target = keep(value.get(0));
      const page = target.isIndirect()
        ? target
        : target.isNumber() &&
            target.asNumber() >= 0 &&
            target.asNumber() < doc.countPages()
          ? keep(doc.findPage(target.asNumber()))
          : undefined;
      if (!page || !selected.has(page.asIndirect())) return;
      const output = keep(doc.newArray());
      output.push(page);
      for (let i = 1; i < value.length; i++) output.push(keep(value.get(i)));
      return output;
    };
    for (const page of pages) {
      await checkpoint();
      const annots = page.get("Annots");
      try {
        for (let i = 0; i < annots.length; i++) {
          const annot = annots.get(i);
          try {
            const subtype = annot.get("Subtype");
            if (subtype.asName() === "Widget") widgets.add(annot.asIndirect());
            subtype.destroy();
            // An annotation's /P must not pull in a page outside the selection.
            annot.put("P", page);
            const dest = annot.get("Dest");
            if (!dest.isNull()) {
              const resolved = destination(dest);
              if (resolved) annot.put("Dest", resolved);
              else annot.delete("Dest");
            }
            dest.destroy();
            const action = annot.get("A"),
              kind = action.get("S");
            try {
              if (kind.asName() === "GoTo") {
                const resolved = destination(keep(action.get("D")));
                if (resolved) action.put("D", resolved);
                else annot.delete("A");
              }
            } finally {
              kind.destroy();
              action.destroy();
            }
          } finally {
            annot.destroy();
          }
        }
      } finally {
        annots.destroy();
      }
    }
    const retainedFields = new Set<number>();
    const visiting = new Set<number>();
    const pruneField = (field: PDFObject, depth = 0): boolean => {
      const number = field.asIndirect();
      if (depth > 64 || (number && visiting.has(number))) return false;
      if (number) visiting.add(number);
      const kids = field.get("Kids");
      try {
        let retained = widgets.has(number);
        if (kids.isArray()) {
          const next = keep(doc.newArray());
          const opt = keep(field.get("Opt"));
          const nextOpt = keep(doc.newArray());
          for (let i = 0; i < kids.length; i++) {
            const child = kids.get(i);
            try {
              if (pruneField(child, depth + 1)) {
                next.push(child);
                if (i < opt.length) nextOpt.push(keep(opt.get(i)));
              }
            } finally {
              child.destroy();
            }
          }
          retained ||= next.length > 0;
          field.put("Kids", next);
          // Radio export values correspond positionally to widget kids.
          const ft = keep(field.get("FT")),
            flags = keep(field.get("Ff"));
          if (
            ft.asName() === "Btn" &&
            flags.asNumber() & (1 << 15) &&
            opt.isArray()
          )
            field.put("Opt", nextOpt);
        }
        if (retained && number) retainedFields.add(number);
        return retained;
      } finally {
        kids.destroy();
        if (number) visiting.delete(number);
      }
    };
    if (form.isDictionary()) {
      const fields = keep(form.get("Fields"));
      const next = keep(doc.newArray());
      for (let i = 0; i < fields.length; i++) {
        await checkpoint();
        const field = fields.get(i);
        try {
          if (pruneField(field)) next.push(field);
        } finally {
          field.destroy();
        }
      }
      form.put("Fields", next);
      const order = keep(form.get("CO")),
        retainedOrder = keep(doc.newArray());
      for (let i = 0; i < order.length; i++) {
        const field = keep(order.get(i));
        if (retainedFields.has(field.asIndirect())) retainedOrder.push(field);
      }
      if (order.isArray()) form.put("CO", retainedOrder);
      // XFA belongs to the full source document; imported widgets use AcroForm.
      form.delete("XFA");
    }
    const tree = keep(
      doc.addObject({ Type: "Pages", Count: pages.length, Kids: pages }),
    );
    const catalog = keep(doc.addObject({ Type: "Catalog", Pages: tree }));
    if (form.isDictionary()) catalog.put("AcroForm", form);
    return doc.from({ Root: catalog });
  } finally {
    for (const object of owned) object.destroy();
    for (const page of pages) page.destroy();
    form.destroy();
    root.destroy();
    trailer.destroy();
  }
}
