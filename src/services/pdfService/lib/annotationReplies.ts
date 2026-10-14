import {
  PDFDict,
  PDFName,
  PDFRef,
  type PDFPage,
} from "@legir/pdfium/authoring";
import type { Annotation, PreservedSourceAnnotationRef } from "@/types";
import type { PdfJsAnnotation } from "../types";
import { readPdfJsAnnotationCommentMeta } from "./annotationCommentMeta";

const sourceKey = (ref: PdfJsAnnotation["sourcePdfRef"]) =>
  ref && `${ref.objectNumber}R${ref.generationNumber || ""}`;

/** Resolve /IRT chains independently of /Annots order, without recursive walks. */
export const attachAnnotationReplies = (
  annotations: Annotation[],
  pageAnnotations: PdfJsAnnotation[],
  preserved: PreservedSourceAnnotationRef[],
  pageIndex: number,
) => {
  if (!pageAnnotations.some((annotation) => annotation.inReplyTo)) return;
  const roots = new Map<string, Annotation | null>();
  for (const annotation of annotations) {
    const key = sourceKey(annotation.sourcePdfRef);
    if (key) roots.set(key, annotation);
  }
  const representedRefs = new Set(roots.keys());
  const rawByRef = new Map<string, PdfJsAnnotation>();
  const ids = new Map<PdfJsAnnotation, string>();
  pageAnnotations.forEach((annotation, index) => {
    const key = sourceKey(annotation.sourcePdfRef);
    if (key) rawByRef.set(key, annotation);
    ids.set(annotation, `imported_reply_${key ?? `${pageIndex + 1}_${index}`}`);
  });
  const preservedRefs = new Set(
    preserved.map((item) => sourceKey(item.sourcePdfRef)),
  );
  const preserveChain = (first: PdfJsAnnotation) => {
    let current: PdfJsAnnotation | undefined = first;
    while (current) {
      const key = sourceKey(current.sourcePdfRef);
      if (!key || preservedRefs.has(key) || representedRefs.has(key)) break;
      preservedRefs.add(key);
      preserved.push({ pageIndex, sourcePdfRef: current.sourcePdfRef! });
      current = current.inReplyTo ? rawByRef.get(current.inReplyTo) : undefined;
    }
  };
  const findRoot = (key: string): Annotation | null => {
    const path = new Set<string>();
    let current: string | null | undefined = key;
    while (current && !roots.has(current) && !path.has(current)) {
      path.add(current);
      const raw = rawByRef.get(current);
      current = raw?.replyType === "Group" ? null : raw?.inReplyTo;
    }
    const root = (current && roots.get(current)) || null;
    for (const visited of path) roots.set(visited, root);
    return root;
  };
  for (const annotation of pageAnnotations) {
    if (!annotation.inReplyTo) continue;
    const root =
      annotation.replyType !== "Group" ? findRoot(annotation.inReplyTo) : null;
    if (!root) {
      // Malformed/orphan/cyclic replies and uneditable groups must still round-trip.
      preserveChain(annotation);
      continue;
    }
    // Non-Text grouped markup may already be represented by a normal parser.
    const key = sourceKey(annotation.sourcePdfRef);
    if (key && representedRefs.has(key)) continue;
    const parent = rawByRef.get(annotation.inReplyTo);
    const inReplyToReplyId =
      annotation.inReplyTo === sourceKey(root.sourcePdfRef)
        ? undefined
        : parent && ids.get(parent);
    (root.replies ??= []).push({
      id: ids.get(annotation)!,
      parentAnnotationId: root.id,
      inReplyToReplyId,
      ...readPdfJsAnnotationCommentMeta(annotation),
      sourcePdfRef: annotation.sourcePdfRef,
      isEdited: false,
    });
  }
};

/** Keep popup ownership valid when a managed annotation is rebuilt or deleted. */
export const reconcileAnnotationPopups = (
  page: PDFPage,
  replacements: Map<string, PDFRef>,
  removed: Set<string>,
) => {
  const annots = page.node.Annots();
  if (!annots) return;
  for (let index = annots.size() - 1; index >= 0; index--) {
    const popup = annots.lookup(index);
    if (
      !(popup instanceof PDFDict) ||
      popup.get(PDFName.of("Subtype")) !== PDFName.of("Popup")
    )
      continue;
    const parent = popup.get(PDFName.of("Parent"));
    if (!(parent instanceof PDFRef)) continue;
    const replacement = replacements.get(parent.toString());
    if (replacement) {
      popup.set(PDFName.of("Parent"), replacement);
    } else if (removed.has(parent.toString())) {
      annots.remove(index);
    }
  }
};
