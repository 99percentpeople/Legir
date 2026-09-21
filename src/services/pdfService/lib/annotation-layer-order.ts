import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  type PDFPage,
} from "@cantoo/pdf-lib";
import type { Annotation, FormField } from "@/types";
import {
  getOrderedPageControls,
  type OrderedControlEntry,
} from "@/lib/controlLayerOrder";
import type { FormExportContext } from "../types";

const refKey = (ref: { objectNumber: number; generationNumber: number }) =>
  `${ref.objectNumber}:${ref.generationNumber}`;

export const canPreserveSourceAnnotation = (annotation: Annotation) =>
  !!annotation.sourcePdfRef &&
  !annotation.isEdited &&
  !(annotation.type === "freetext" && annotation.flatten);

/** Restore the raw /Annots order after parsers have filtered by subtype. */
export const applyImportedControlLayerOrders = (
  page: PDFPage,
  fields: FormField[],
  annotations: Annotation[],
) => {
  const ranks = new Map<string, number>();
  try {
    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) return;
    for (let index = 0; index < annots.size(); index++) {
      const ref = annots.get(index);
      if (ref instanceof PDFRef && !ranks.has(refKey(ref)))
        ranks.set(refKey(ref), index);
    }
  } catch {
    // Leave parser-provided ordering intact for malformed annotation arrays.
    return;
  }
  for (const control of [...fields, ...annotations]) {
    if (!control.sourcePdfRef) continue;
    const rank = ranks.get(refKey(control.sourcePdfRef));
    if (rank !== undefined) control.layerOrder = rank;
  }
};

/** Bucket once instead of filtering every control again for each PDF page. */
export const getOrderedExportControlsByPage = (
  fields: FormField[],
  annotations: Annotation[],
): Map<number, OrderedControlEntry[]> => {
  const buckets = new Map<
    number,
    { fields: FormField[]; annotations: Annotation[] }
  >();
  const bucketFor = (pageIndex: number) => {
    let bucket = buckets.get(pageIndex);
    if (!bucket) {
      bucket = { fields: [], annotations: [] };
      buckets.set(pageIndex, bucket);
    }
    return bucket;
  };
  for (const field of fields) bucketFor(field.pageIndex).fields.push(field);
  for (const annotation of annotations)
    bucketFor(annotation.pageIndex).annotations.push(annotation);
  return new Map(
    Array.from(buckets, ([pageIndex, bucket]) => [
      pageIndex,
      getOrderedPageControls(bucket.fields, bucket.annotations, pageIndex),
    ]),
  );
};

/**
 * Reorder only managed /Annots slots. Appearance streams, replies, popups,
 * unsupported annotations and the AcroForm field tree are not recreated.
 * Run after widgets have reached their final pages and before form flattening.
 */
export const reorderExportedPageAnnotations = (
  page: PDFPage,
  controls: OrderedControlEntry[],
  annotationRefs: Map<string, PDFRef>,
  formContext?: FormExportContext,
): number => {
  // Without fields or any explicit layer orders, a low-level export caller
  // has not requested reordering. Preserve the source annotation order.
  if (
    !controls.some(
      (entry) =>
        entry.kind === "field" || Number.isFinite(entry.control.layerOrder),
    )
  )
    return 0;
  const annots = page.node.Annots();
  if (!(annots instanceof PDFArray) || annots.size() < 2) return 0;

  const widgetKeys = new Set<string>();
  const widgetsByField = new Map<string, PDFRef[]>();
  for (let index = 0; index < annots.size(); index++) {
    const ref = annots.get(index);
    if (!(ref instanceof PDFRef)) continue;
    const dict = annots.lookup(index);
    if (
      !(dict instanceof PDFDict) ||
      dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Widget")
    )
      continue;
    widgetKeys.add(refKey(ref));
    const parent = dict.get(PDFName.of("Parent"));
    const fieldKey = refKey(parent instanceof PDFRef ? parent : ref);
    const widgets = widgetsByField.get(fieldKey) ?? [];
    widgets.push(ref);
    widgetsByField.set(fieldKey, widgets);
  }

  const ranks = new Map<string, number>();
  const addRef = (ref: PDFRef) => {
    const key = refKey(ref);
    if (!ranks.has(key)) ranks.set(key, ranks.size);
  };
  const visitedFields = new Set<string>();
  for (const entry of controls) {
    if (entry.kind === "annotation") {
      const ref = annotationRefs.get(entry.control.id);
      if (ref) addRef(ref);
      continue;
    }
    const field = entry.control;
    const sourceKey = field.sourcePdfRef && refKey(field.sourcePdfRef);
    // Imported controls usually point to their individual widget, not its parent.
    if (sourceKey && widgetKeys.has(sourceKey)) {
      addRef(
        PDFRef.of(
          field.sourcePdfRef!.objectNumber,
          field.sourcePdfRef!.generationNumber,
        ),
      );
      continue;
    }
    const parentRef = formContext?.findField(field)?.ref;
    const parentKey =
      sourceKey && widgetsByField.has(sourceKey)
        ? sourceKey
        : parentRef && refKey(parentRef);
    if (!parentKey || visitedFields.has(parentKey)) continue;
    visitedFields.add(parentKey);
    for (const ref of widgetsByField.get(parentKey) ?? []) addRef(ref);
  }

  const slots: Array<{ index: number; ref: PDFRef; rank: number }> = [];
  for (let index = 0; index < annots.size(); index++) {
    const ref = annots.get(index);
    if (!(ref instanceof PDFRef)) continue;
    const rank = ranks.get(refKey(ref));
    if (rank !== undefined) slots.push({ index, ref, rank });
  }
  // Sorting slots rather than deduplicating /Annots preserves multiplicity even
  // in malformed documents that contain the same reference more than once.
  const ordered = [...slots].sort((left, right) => left.rank - right.rank);
  let changed = 0;
  for (let index = 0; index < slots.length; index++) {
    if (slots[index].ref === ordered[index].ref) continue;
    annots.set(slots[index].index, ordered[index].ref);
    changed += 1;
  }
  return changed;
};
