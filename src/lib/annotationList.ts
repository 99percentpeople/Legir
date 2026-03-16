import type { Annotation } from "@/types";

export const ANNOTATION_LIST_TYPES = [
  "comment",
  "highlight",
  "ink",
  "freetext",
  "link",
] as const;

export type AnnotationListType = (typeof ANNOTATION_LIST_TYPES)[number];

export const getAnnotationListType = (
  annotation: Annotation,
): AnnotationListType | null => {
  if (annotation.type === "ink" && annotation.intent === "InkHighlight") {
    return "highlight";
  }
  if (
    annotation.type === "comment" ||
    annotation.type === "highlight" ||
    annotation.type === "ink" ||
    annotation.type === "freetext" ||
    annotation.type === "link"
  ) {
    return annotation.type;
  }
  return null;
};

export const filterAnnotationsForList = (
  annotations: Annotation[],
  options?: {
    query?: string;
    selectedTypes?: AnnotationListType[];
    pageNumbers?: number[];
  },
) => {
  const query = (options?.query || "").trim().toLowerCase();
  const selectedTypes = new Set(
    options?.selectedTypes?.length
      ? options.selectedTypes
      : ANNOTATION_LIST_TYPES,
  );
  const pageNumbers =
    options?.pageNumbers && options.pageNumbers.length > 0
      ? new Set(options.pageNumbers)
      : null;

  return annotations.filter((annotation) => {
    const effectiveType = getAnnotationListType(annotation);
    if (!effectiveType) return false;
    if (!selectedTypes.has(effectiveType)) return false;
    if (pageNumbers && !pageNumbers.has(annotation.pageIndex + 1)) return false;
    if (!query) return true;

    const textContent = (annotation.text || "").toLowerCase();
    const highlightedTextContent = (
      annotation.highlightedText || ""
    ).toLowerCase();
    const authorContent = (annotation.author || "").toLowerCase();
    const linkUrlContent = (annotation.linkUrl || "").toLowerCase();
    const linkDestPageContent =
      typeof annotation.linkDestPageIndex === "number"
        ? String(annotation.linkDestPageIndex + 1)
        : "";

    return (
      textContent.includes(query) ||
      highlightedTextContent.includes(query) ||
      authorContent.includes(query) ||
      linkUrlContent.includes(query) ||
      linkDestPageContent.includes(query)
    );
  });
};

export const sortAnnotationsForList = (annotations: Annotation[]) => {
  return annotations.slice().sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;

    const ay = a.rect?.y ?? 0;
    const by = b.rect?.y ?? 0;
    const ax = a.rect?.x ?? 0;
    const bx = b.rect?.x ?? 0;

    if (Math.abs(ay - by) > 10) return ay - by;
    return ax - bx;
  });
};
