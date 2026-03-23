import type { PDFOutlineItem } from "@/types";
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfJsOutlineItem = {
  title?: string;
  dest?: unknown;
  action?: unknown;
  items?: unknown;
};

const isRefProxy = (v: unknown): v is { num: number; gen: number } => {
  if (!v || typeof v !== "object") return false;
  const r = v as { num?: unknown; gen?: unknown };
  return typeof r.num === "number" && typeof r.gen === "number";
};

export const resolveDest = async (
  pdf: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> => {
  if (typeof dest === "string") {
    try {
      dest = await pdf.getDestination(dest);
    } catch {
      return null;
    }
  }
  if (!dest || !Array.isArray(dest) || dest.length < 1) return null;
  const ref = dest[0];
  if (!ref) return null;
  try {
    if (typeof ref === "number") return ref;
    if (isRefProxy(ref)) {
      const index = await pdf.getPageIndex(ref);
      return index;
    }
    return null;
  } catch {
    return null;
  }
};

export const mapOutline = async (
  pdf: PDFDocumentProxy,
  items: PdfJsOutlineItem[],
): Promise<PDFOutlineItem[]> => {
  const mapped: PDFOutlineItem[] = [];
  for (const item of items) {
    let pageIndex: number | undefined = undefined;
    let destination = item.dest;
    if (!destination && item.action && typeof item.action === "object") {
      const action = item.action as { dest?: unknown };
      if (action.dest) destination = action.dest;
    }
    if (destination) {
      const idx = await resolveDest(pdf, destination);
      if (idx !== null) pageIndex = idx;
    }
    const children =
      Array.isArray(item.items) && item.items.length > 0
        ? await mapOutline(pdf, item.items as PdfJsOutlineItem[])
        : [];
    mapped.push({ title: item.title, items: children, pageIndex });
  }
  return mapped;
};
