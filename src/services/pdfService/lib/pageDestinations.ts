import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFRef,
  PDFString,
} from "@legir/pdfium/authoring";

/** Resolve both the legacy /Dests dictionary and a /Names/Dests name tree. */
export function readNamedPageDestinations(doc: PDFDocument) {
  const destinations = new Map<string, PDFObject>();
  const legacy = doc.catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);
  for (const [name, value] of legacy?.entries() ?? [])
    destinations.set(name.decodeText(), value);
  const visited = new Set<PDFDict>();
  const visit = (node: PDFDict | undefined) => {
    if (!node || visited.has(node)) return;
    visited.add(node);
    const names = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (names)
      for (let i = 0; i + 1 < names.size(); i += 2) {
        const key = names.lookup(i);
        if (
          key instanceof PDFString ||
          key instanceof PDFHexString ||
          key instanceof PDFName
        )
          destinations.set(key.decodeText(), names.get(i + 1));
      }
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids)
      for (let i = 0; i < kids.size(); i++) {
        const child = kids.lookup(i);
        if (child instanceof PDFDict) visit(child);
      }
  };
  visit(
    doc.catalog
      .lookupMaybe(PDFName.of("Names"), PDFDict)
      ?.lookupMaybe(PDFName.of("Dests"), PDFDict),
  );
  return destinations;
}

export function resolvePageDestination(
  doc: PDFDocument,
  value: PDFObject | undefined,
  names: Map<string, PDFObject>,
): PDFArray | undefined {
  const seen = new Set<PDFObject>();
  while (value && !seen.has(value)) {
    seen.add(value);
    if (value instanceof PDFArray) return value;
    if (value instanceof PDFRef) value = doc.context.lookup(value);
    else if (value instanceof PDFDict) value = value.get(PDFName.of("D"));
    else if (
      value instanceof PDFString ||
      value instanceof PDFHexString ||
      value instanceof PDFName
    )
      value = names.get(value.decodeText());
    else return;
  }
}
