import type { Annotation, ControlLayerMove, FormField } from "@/types";

type LayeredControl = FormField | Annotation;
type LayeredControlKind = "field" | "annotation";

export type OrderedControlEntry =
  | { kind: "field"; control: FormField }
  | { kind: "annotation"; control: Annotation };

type LayeredEntry = OrderedControlEntry & {
  fallbackOrder: number;
};

const hasFiniteLayerOrder = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const compareLayeredEntries = (left: LayeredEntry, right: LayeredEntry) => {
  const leftOrder = left.control.layerOrder;
  const rightOrder = right.control.layerOrder;

  if (
    hasFiniteLayerOrder(leftOrder) &&
    hasFiniteLayerOrder(rightOrder) &&
    leftOrder !== rightOrder
  ) {
    return leftOrder - rightOrder;
  }

  if (hasFiniteLayerOrder(leftOrder) && !hasFiniteLayerOrder(rightOrder)) {
    return -1;
  }
  if (!hasFiniteLayerOrder(leftOrder) && hasFiniteLayerOrder(rightOrder)) {
    return 1;
  }

  return left.fallbackOrder - right.fallbackOrder;
};

const sortLayeredControls = <T extends LayeredControl>(controls: T[]) => {
  return controls
    .map((control, index) => ({
      control,
      index,
    }))
    .sort((left, right) => {
      if (left.control.pageIndex !== right.control.pageIndex) {
        return left.control.pageIndex - right.control.pageIndex;
      }

      const leftOrder = left.control.layerOrder;
      const rightOrder = right.control.layerOrder;
      if (
        hasFiniteLayerOrder(leftOrder) &&
        hasFiniteLayerOrder(rightOrder) &&
        leftOrder !== rightOrder
      ) {
        return leftOrder - rightOrder;
      }
      if (hasFiniteLayerOrder(leftOrder) && !hasFiniteLayerOrder(rightOrder)) {
        return -1;
      }
      if (!hasFiniteLayerOrder(leftOrder) && hasFiniteLayerOrder(rightOrder)) {
        return 1;
      }

      return left.index - right.index;
    })
    .map(({ control }) => control);
};

const getPageLayeredEntries = (
  fields: FormField[],
  annotations: Annotation[],
  pageIndex: number,
): LayeredEntry[] => {
  const fieldEntries = fields
    .filter((field) => field.pageIndex === pageIndex)
    .map(
      (field, index) =>
        ({
          kind: "field",
          control: field,
          fallbackOrder: index,
        }) satisfies LayeredEntry,
    );

  const annotationEntries = annotations
    .filter((annotation) => annotation.pageIndex === pageIndex)
    .map(
      (annotation, index) =>
        ({
          kind: "annotation",
          control: annotation,
          fallbackOrder: fieldEntries.length + index,
        }) satisfies LayeredEntry,
    );

  return [...fieldEntries, ...annotationEntries].sort(compareLayeredEntries);
};

const applyLayerOrderMap = (
  fields: FormField[],
  annotations: Annotation[],
  orderById: Map<string, number>,
) => {
  const nextFields = sortLayeredControls(
    fields.map((field) => {
      const nextLayerOrder = orderById.get(field.id);
      if (nextLayerOrder === undefined || field.layerOrder === nextLayerOrder) {
        return field;
      }
      return {
        ...field,
        layerOrder: nextLayerOrder,
      };
    }),
  );

  const nextAnnotations = sortLayeredControls(
    annotations.map((annotation) => {
      const nextLayerOrder = orderById.get(annotation.id);
      if (
        nextLayerOrder === undefined ||
        annotation.layerOrder === nextLayerOrder
      ) {
        return annotation;
      }
      return {
        ...annotation,
        layerOrder: nextLayerOrder,
      };
    }),
  );

  return {
    fields: nextFields,
    annotations: nextAnnotations,
  };
};

export const getOrderedPageControls = (
  fields: FormField[],
  annotations: Annotation[],
  pageIndex: number,
): OrderedControlEntry[] =>
  getPageLayeredEntries(fields, annotations, pageIndex).map(
    ({ kind, control }) => ({ kind, control }) as OrderedControlEntry,
  );

export const normalizeControlLayerOrders = (
  fields: FormField[],
  annotations: Annotation[],
) => {
  const pageIndexes = new Set<number>();
  for (const field of fields) pageIndexes.add(field.pageIndex);
  for (const annotation of annotations) pageIndexes.add(annotation.pageIndex);

  const orderById = new Map<string, number>();
  for (const pageIndex of [...pageIndexes].sort((a, b) => a - b)) {
    const pageEntries = getPageLayeredEntries(fields, annotations, pageIndex);
    pageEntries.forEach((entry, index) => {
      orderById.set(entry.control.id, index);
    });
  }

  return applyLayerOrderMap(fields, annotations, orderById);
};

export const getNextLayerOrderForPage = (
  fields: FormField[],
  annotations: Annotation[],
  pageIndex: number,
) => {
  const pageEntries = getPageLayeredEntries(fields, annotations, pageIndex);
  if (pageEntries.length === 0) return 0;
  return (
    pageEntries.reduce((maxOrder, entry, index) => {
      const layerOrder = entry.control.layerOrder;
      return Math.max(
        maxOrder,
        hasFiniteLayerOrder(layerOrder) ? layerOrder : index,
      );
    }, -1) + 1
  );
};

export const reorderControlLayer = (opts: {
  fields: FormField[];
  annotations: Annotation[];
  targetId: string;
  move: ControlLayerMove;
}) => {
  const normalized = normalizeControlLayerOrders(opts.fields, opts.annotations);

  const targetField = normalized.fields.find(
    (field) => field.id === opts.targetId,
  );
  const targetAnnotation = normalized.annotations.find(
    (annotation) => annotation.id === opts.targetId,
  );
  const target = targetField || targetAnnotation;
  if (!target) {
    return {
      ...normalized,
      changed: false,
      kind: null as LayeredControlKind | null,
    };
  }

  const pageEntries = getPageLayeredEntries(
    normalized.fields,
    normalized.annotations,
    target.pageIndex,
  );
  const currentIndex = pageEntries.findIndex(
    (entry) => entry.control.id === opts.targetId,
  );
  if (currentIndex === -1) {
    return {
      ...normalized,
      changed: false,
      kind: null as LayeredControlKind | null,
    };
  }

  let nextIndex = currentIndex;
  if (opts.move === "bring_forward") {
    nextIndex = Math.min(pageEntries.length - 1, currentIndex + 1);
  } else if (opts.move === "send_backward") {
    nextIndex = Math.max(0, currentIndex - 1);
  } else if (opts.move === "bring_to_front") {
    nextIndex = pageEntries.length - 1;
  } else if (opts.move === "send_to_back") {
    nextIndex = 0;
  }

  if (nextIndex === currentIndex) {
    return {
      ...normalized,
      changed: false,
      kind: targetField ? "field" : "annotation",
    };
  }

  const reorderedEntries = [...pageEntries];
  const [movedEntry] = reorderedEntries.splice(currentIndex, 1);
  if (!movedEntry) {
    return {
      ...normalized,
      changed: false,
      kind: null as LayeredControlKind | null,
    };
  }
  reorderedEntries.splice(nextIndex, 0, movedEntry);

  const orderById = new Map<string, number>();
  reorderedEntries.forEach((entry, index) => {
    orderById.set(entry.control.id, index);
  });

  const applied = applyLayerOrderMap(
    normalized.fields,
    normalized.annotations,
    orderById,
  );

  return {
    ...applied,
    changed: true,
    kind: targetField ? "field" : "annotation",
  };
};
