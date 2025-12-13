import type { PDFOutlineItem } from "@/types";

export const resolveDest = async (
  pdf: any,
  dest: any,
): Promise<number | null> => {
  if (typeof dest === "string") {
    try {
      dest = await pdf.getDestination(dest);
    } catch (e) {
      return null;
    }
  }
  if (!dest || !Array.isArray(dest) || dest.length < 1) return null;
  const ref = dest[0];
  if (!ref) return null;
  try {
    if (typeof ref === "number") return ref;
    const index = await pdf.getPageIndex(ref);
    return index;
  } catch (e) {
    return null;
  }
};

export const mapOutline = async (
  pdf: any,
  items: any[],
): Promise<PDFOutlineItem[]> => {
  const mapped: PDFOutlineItem[] = [];
  for (const item of items) {
    let pageIndex: number | undefined = undefined;
    let destination = item.dest;
    if (!destination && item.action && typeof item.action === "object") {
      if (item.action.dest) destination = item.action.dest;
    }
    if (destination) {
      const idx = await resolveDest(pdf, destination);
      if (idx !== null) pageIndex = idx;
    }
    const children =
      item.items && item.items.length > 0
        ? await mapOutline(pdf, item.items)
        : [];
    mapped.push({ title: item.title, items: children, pageIndex });
  }
  return mapped;
};
