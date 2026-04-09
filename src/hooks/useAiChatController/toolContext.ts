import type { MutableRefObject } from "react";

import { appEventBus } from "@/lib/eventBus";
import { ANNOTATION_STYLES, DEFAULT_FIELD_STYLE } from "@/constants";
import { getNextLayerOrderForPage } from "@/lib/controlLayerOrder";
import { getMovedAnnotationUpdates } from "@/lib/controlMovement";
import {
  ANNOTATION_LIST_TYPES,
  filterAnnotationsForList,
  getAnnotationListType,
  sortAnnotationsForList,
  type AnnotationListType,
} from "@/lib/annotationList";
import { getPdfSearchRangeGeometry } from "@/lib/pdfSearch";
import {
  getDefaultArrowSize,
  getRectAndNormalizedShapePoints,
  getShapeArrowStyles,
  getShapeArrowStyleUpdates,
  getShapeTypeWithoutArrow,
  isOpenLineShapeType,
  shapeSupportsFill,
} from "@/lib/shapeGeometry";
import { useEditorStore } from "@/store/useEditorStore";
import {
  analyzePageForFields,
  isAiSdkProviderConfigured,
  parseAiSdkModelSpecifier,
} from "@/services/ai";
import {
  pdfWorkerService,
  type PDFWorkerService,
} from "@/services/pdfService/pdfWorkerService";
import { roundAiRect } from "@/services/ai/utils/geometry";
import { pruneUndefinedKeys } from "@/services/ai/utils/object";
import {
  mapReadableRangeToFlatRange,
  serializePageTextContent,
} from "@/services/ai/utils/pageTextSerialization";
import { getPdfSearchRangeClientRects } from "@/components/workspace/lib/pdfSearchHighlights";
import {
  FieldType,
  type Annotation,
  type FormField,
  type PDFSearchResult,
} from "@/types";
import type {
  AiAnnotationKind,
  AiAnnotationDeleteBatchResult,
  AiAnnotationSummary,
  AiAnnotationUpdateResult,
  AiAnnotationUpdateResultItem,
  AiCreateAnnotationsResult,
  AiCreateAnnotationResultItem,
  AiCreateFreetextAnnotationInput,
  AiAnnotationTextBatchUpdateResult,
  AiAnnotationListResult,
  AiAnnotationTextUpdateResult,
  AiChatSelectionAttachment,
  AiCreateFormFieldInput,
  AiCreateFormFieldsResult,
  AiCreateFormFieldsResultItem,
  AiCreateShapeAnnotationInput,
  AiDetectedFormFieldBatch,
  AiDetectedFormFieldDraft,
  AiDocumentPageAssetSummary,
  AiFormFieldFillRequest,
  AiFormFieldFillResult,
  AiFormFieldFillResultItem,
  AiFormFieldKind,
  AiFormFieldListResult,
  AiFormFieldSummary,
  AiFormFieldUpdateResult,
  AiFormFieldUpdateResultItem,
  AiHighlightAnnotationCreateResult,
  AiSearchResultSummary,
  AiStoredSearchResult,
  AiToolExecutionProgress,
  AiTypeCount,
  AiUpdateAnnotationInput,
  AiUpdateFormFieldInput,
} from "@/services/ai/chat/types";
import type {
  AiChatSessionData,
  AiDetectedFormFieldBatchState,
  AiDetectedFormFieldDraftState,
} from "@/hooks/useAiChatController/sessionPersistence";

type SelectedChatModelMeta =
  | {
      providerId: string;
      providerLabel: string;
      modelId: string;
      modelLabel: string;
    }
  | undefined;

const splitMultiselectValue = (value: string | undefined) =>
  (value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

const allowsCustomDropdownValue = (field: FormField) => {
  if (field.type !== FieldType.DROPDOWN || field.isMultiSelect) return false;
  if (field.allowCustomValue) return true;

  const hint = `${field.toolTip || ""}\n${field.name || ""}`.toLowerCase();
  return (
    hint.includes("write ") ||
    hint.includes("type ") ||
    hint.includes("enter ") ||
    hint.includes("custom") ||
    hint.includes("free text")
  );
};

const getAiFormFieldKind = (type: FieldType): AiFormFieldKind => {
  switch (type) {
    case FieldType.CHECKBOX:
      return "checkbox";
    case FieldType.RADIO:
      return "radio";
    case FieldType.DROPDOWN:
      return "dropdown";
    case FieldType.SIGNATURE:
      return "signature";
    case FieldType.TEXT:
    default:
      return "text";
  }
};

const getFieldTypeFromAiFormFieldKind = (type: AiFormFieldKind): FieldType => {
  switch (type) {
    case "checkbox":
      return FieldType.CHECKBOX;
    case "radio":
      return FieldType.RADIO;
    case "dropdown":
      return FieldType.DROPDOWN;
    case "signature":
      return FieldType.SIGNATURE;
    case "text":
    default:
      return FieldType.TEXT;
  }
};

const getAiFormFieldCurrentValue = (field: FormField) => {
  switch (field.type) {
    case FieldType.CHECKBOX:
    case FieldType.RADIO:
      return !!field.isChecked;
    case FieldType.DROPDOWN:
      return field.isMultiSelect
        ? splitMultiselectValue(field.value)
        : (field.value ?? "");
    case FieldType.SIGNATURE:
      return field.signatureData ? true : false;
    case FieldType.TEXT:
    default:
      return field.value ?? "";
  }
};

const getAiFormFieldDefaultValue = (field: FormField) => {
  switch (field.type) {
    case FieldType.CHECKBOX:
    case FieldType.RADIO:
      return !!field.isDefaultChecked;
    case FieldType.DROPDOWN:
      return field.isMultiSelect
        ? splitMultiselectValue(field.defaultValue)
        : (field.defaultValue ?? "");
    case FieldType.SIGNATURE:
      return null;
    case FieldType.TEXT:
    default:
      return field.defaultValue ?? "";
  }
};

const isAiFormFieldEmpty = (field: FormField) => {
  switch (field.type) {
    case FieldType.CHECKBOX:
    case FieldType.RADIO:
      return !field.isChecked;
    case FieldType.DROPDOWN:
      return field.isMultiSelect
        ? splitMultiselectValue(field.value).length === 0
        : !(field.value || "").trim();
    case FieldType.SIGNATURE:
      return !field.signatureData;
    case FieldType.TEXT:
    default:
      return !(field.value || "").trim();
  }
};

const getAiAnnotationKind = (
  annotation: Annotation,
): AiAnnotationKind | null => {
  const type = getAnnotationListType(annotation);
  return type ? (type as AiAnnotationKind) : null;
};

const summarizeAnnotation = (
  annotation: Annotation,
): AiAnnotationSummary | null => {
  const type = getAiAnnotationKind(annotation);
  if (!type) return null;

  return {
    id: annotation.id,
    pageNumber: annotation.pageIndex + 1,
    type,
    subType: annotation.type === "shape" ? annotation.shapeType : undefined,
    text: (annotation.text || "").trim() || undefined,
    highlightedText: (annotation.highlightedText || "").trim() || undefined,
    author: (annotation.author || "").trim() || undefined,
    color: annotation.color,
    updatedAt: annotation.updatedAt,
    rect: annotation.rect ? roundAiRect(annotation.rect) : undefined,
    linkUrl: (annotation.linkUrl || "").trim() || undefined,
    linkDestPageNumber:
      typeof annotation.linkDestPageIndex === "number"
        ? annotation.linkDestPageIndex + 1
        : undefined,
    metaKind:
      typeof annotation.meta?.kind === "string"
        ? annotation.meta.kind
        : undefined,
  };
};

const incrementTypeCount = <TType extends string>(
  counts: Map<TType, number>,
  type: TType,
) => {
  counts.set(type, (counts.get(type) ?? 0) + 1);
};

const serializeTypeCounts = <TType extends string>(
  counts: Map<TType, number>,
): AiTypeCount<TType>[] =>
  Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => ({ type, count }));

const summarizeDocumentPageAssets = (): {
  pageAssetSummary: AiDocumentPageAssetSummary[];
} => {
  const store = useEditorStore.getState();
  const pageAssetSummary = Array.from(
    { length: store.pages.length },
    (_, index) => ({
      pageNumber: index + 1,
      formFieldTypes: [] as AiTypeCount<AiFormFieldKind>[],
      annotationTypes: [] as AiTypeCount<AiAnnotationKind>[],
    }),
  );
  const pageFormFieldTypeCounts = pageAssetSummary.map(
    () => new Map<AiFormFieldKind, number>(),
  );
  const pageAnnotationTypeCounts = pageAssetSummary.map(
    () => new Map<AiAnnotationKind, number>(),
  );

  for (const field of store.fields) {
    const pageTypeCounts = pageFormFieldTypeCounts[field.pageIndex];
    if (!pageTypeCounts) continue;

    const type = getAiFormFieldKind(field.type);
    incrementTypeCount(pageTypeCounts, type);
  }

  for (const annotation of store.annotations) {
    const pageTypeCounts = pageAnnotationTypeCounts[annotation.pageIndex];
    if (!pageTypeCounts) continue;

    const type = getAiAnnotationKind(annotation);
    if (!type) continue;

    incrementTypeCount(pageTypeCounts, type);
  }

  for (const [index, pageSummary] of pageAssetSummary.entries()) {
    pageSummary.formFieldTypes = serializeTypeCounts(
      pageFormFieldTypeCounts[index]!,
    );
    pageSummary.annotationTypes = serializeTypeCounts(
      pageAnnotationTypeCounts[index]!,
    );
  }

  const nonEmptyPageAssetSummary = pageAssetSummary.filter(
    (pageSummary) =>
      pageSummary.formFieldTypes.length > 0 ||
      pageSummary.annotationTypes.length > 0,
  );

  return {
    pageAssetSummary: nonEmptyPageAssetSummary,
  };
};

export const summarizeFormField = (
  field: FormField,
  options?: { includeLayout?: boolean },
): AiFormFieldSummary => {
  const type = getAiFormFieldKind(field.type);
  const editable = !field.readOnly && field.type !== FieldType.SIGNATURE;
  const optionValue =
    field.type === FieldType.CHECKBOX || field.type === FieldType.RADIO
      ? (field.radioValue || field.exportValue || "").trim() || undefined
      : undefined;

  return {
    id: field.id,
    pageNumber: field.pageIndex + 1,
    name: field.name || "",
    type,
    required: !!field.required,
    readOnly: !!field.readOnly,
    editable,
    isEmpty: isAiFormFieldEmpty(field),
    toolTip: (field.toolTip || "").trim() || undefined,
    currentValue: getAiFormFieldCurrentValue(field),
    defaultValue: getAiFormFieldDefaultValue(field),
    options: field.options?.length ? [...field.options] : undefined,
    isMultiSelect:
      field.type === FieldType.DROPDOWN ? !!field.isMultiSelect : undefined,
    allowCustomValue:
      field.type === FieldType.DROPDOWN
        ? allowsCustomDropdownValue(field)
        : undefined,
    optionValue,
    ...(options?.includeLayout
      ? {
          rect: roundAiRect(field.rect),
        }
      : null),
    unsupportedReason:
      field.type === FieldType.SIGNATURE
        ? "AI signature filling is not supported."
        : undefined,
  };
};

const matchesFormFieldQuery = (
  field: AiFormFieldSummary,
  rawQuery?: string,
) => {
  const query = (rawQuery || "").trim().toLowerCase();
  if (!query) return true;

  const currentValue = Array.isArray(field.currentValue)
    ? field.currentValue.join(" ")
    : String(field.currentValue ?? "");
  const defaultValue = Array.isArray(field.defaultValue)
    ? field.defaultValue.join(" ")
    : String(field.defaultValue ?? "");
  const haystack = [
    field.id,
    field.name,
    field.type,
    field.toolTip,
    field.optionValue,
    currentValue,
    defaultValue,
    ...(field.options ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
};

const getSafeSyncFieldIds = (fields: FormField[], target: FormField) => {
  const name = target.name.trim();
  if (!name) return [target.id];
  return fields
    .filter(
      (field) =>
        field.type === target.type &&
        field.name === target.name &&
        !field.readOnly,
    )
    .map((field) => field.id);
};

const getPropertySyncFieldIds = (fields: FormField[], target: FormField) => {
  const name = target.name.trim();
  if (!name) return [target.id];
  return fields
    .filter((field) => field.type === target.type && field.name === target.name)
    .map((field) => field.id);
};

const areStringArraysEqual = (left: string[] | undefined, right: string[]) => {
  const normalizedLeft = (left ?? []).map((item) => item.trim());
  const normalizedRight = right.map((item) => item.trim());
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((item, index) => item === normalizedRight[index]);
};

const getSelectionAttachmentKey = (attachment: AiChatSelectionAttachment) =>
  `${attachment.pageIndex}:${attachment.startOffset}:${attachment.endOffset}`;

const HYPHEN_LIKE_CHARS = new Set([
  "-",
  "‐",
  "‑",
  "‒",
  "–",
  "—",
  "﹘",
  "﹣",
  "－",
]);

const isWhitespaceChar = (char: string) => /\s/u.test(char);
const isWordLikeChar = (char: string) => /[\p{L}\p{N}]/u.test(char);

const findAllSubstringIndices = (text: string, query: string) => {
  const matches: number[] = [];
  if (!query) return matches;

  let cursor = 0;
  while (cursor <= text.length - query.length) {
    const index = text.indexOf(query, cursor);
    if (index < 0) break;
    matches.push(index);
    cursor = index + 1;
  }

  return matches;
};

const buildNormalizedAnchorSearchText = (
  text: string,
  whitespaceMode: "collapse" | "remove" = "collapse",
) => {
  let normalizedText = "";
  const normalizedIndexToOriginalIndex: number[] = [];

  for (let index = 0; index < text.length; ) {
    const char = text[index]!;
    const previousChar = index > 0 ? text[index - 1] : "";

    if (HYPHEN_LIKE_CHARS.has(char) && isWordLikeChar(previousChar)) {
      let cursor = index + 1;
      let consumedWhitespace = false;
      while (cursor < text.length && isWhitespaceChar(text[cursor]!)) {
        consumedWhitespace = true;
        cursor += 1;
      }
      if (consumedWhitespace && isWordLikeChar(text[cursor] ?? "")) {
        index = cursor;
        continue;
      }
    }

    if (isWhitespaceChar(char)) {
      let cursor = index + 1;
      while (cursor < text.length && isWhitespaceChar(text[cursor]!)) {
        cursor += 1;
      }
      if (
        whitespaceMode === "collapse" &&
        normalizedText.length > 0 &&
        cursor < text.length &&
        normalizedText[normalizedText.length - 1] !== " "
      ) {
        normalizedText += " ";
        normalizedIndexToOriginalIndex.push(index);
      }
      index = cursor;
      continue;
    }

    normalizedText += char.toLowerCase();
    normalizedIndexToOriginalIndex.push(index);
    index += 1;
  }

  while (whitespaceMode === "collapse" && normalizedText.endsWith(" ")) {
    normalizedText = normalizedText.slice(0, -1);
    normalizedIndexToOriginalIndex.pop();
  }

  return {
    text: normalizedText,
    normalizedIndexToOriginalIndex,
  };
};

const normalizeAnchorSearchQuery = (
  text: string,
  whitespaceMode: "collapse" | "remove" = "collapse",
) => buildNormalizedAnchorSearchText(text, whitespaceMode).text;

const getAnchorVariants = (
  anchorRaw: string,
  kind: "start" | "end",
): string[] => {
  const anchor = anchorRaw.trim();
  if (!anchor) return [];

  const variants: string[] = [];
  const seen = new Set<string>();
  const addVariant = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const normalized = normalizeAnchorSearchQuery(trimmed);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    variants.push(trimmed);
  };

  addVariant(anchor);

  const words = anchor.split(/\s+/).filter(Boolean);
  const windowSizes = [16, 12, 10, 8, 6, 4];
  for (const windowSize of windowSizes) {
    if (words.length <= windowSize) continue;
    addVariant(
      kind === "start"
        ? words.slice(0, windowSize).join(" ")
        : words.slice(-windowSize).join(" "),
    );
  }

  return variants;
};

const resolveTextAnchorOffsets = (
  text: string,
  startAnchorRaw: string,
  endInclusiveAnchorRaw: string,
) => {
  const startAnchor = startAnchorRaw.trim();
  const endInclusiveAnchor = endInclusiveAnchorRaw.trim();
  if (!startAnchor || !endInclusiveAnchor) return null;

  const normalizedTextModes = [
    {
      rank: 0,
      mode: "collapse" as const,
      normalized: buildNormalizedAnchorSearchText(text, "collapse"),
    },
    {
      rank: 1,
      mode: "remove" as const,
      normalized: buildNormalizedAnchorSearchText(text, "remove"),
    },
  ];

  const resolveVariantMatches = (
    variants: string[],
  ): Array<{
    localStart: number;
    localEnd: number;
    matchedAnchor: string;
    matchLength: number;
    variantRank: number;
    whitespaceModeRank: number;
  }> => {
    const matches: Array<{
      localStart: number;
      localEnd: number;
      matchedAnchor: string;
      matchLength: number;
      variantRank: number;
      whitespaceModeRank: number;
    }> = [];

    variants.forEach((variant, variantRank) => {
      let foundAnyForVariant = false;

      for (const normalizedTextMode of normalizedTextModes) {
        const normalizedVariant = normalizeAnchorSearchQuery(
          variant,
          normalizedTextMode.mode,
        );
        if (!normalizedVariant) continue;

        const matchIndexes = findAllSubstringIndices(
          normalizedTextMode.normalized.text,
          normalizedVariant,
        );
        if (matchIndexes.length === 0) continue;

        foundAnyForVariant = true;
        for (const normalizedStart of matchIndexes) {
          const normalizedEnd = normalizedStart + normalizedVariant.length;
          const originalStart =
            normalizedTextMode.normalized.normalizedIndexToOriginalIndex[
              normalizedStart
            ];
          const originalLast =
            normalizedTextMode.normalized.normalizedIndexToOriginalIndex[
              normalizedEnd - 1
            ];
          if (
            typeof originalStart !== "number" ||
            typeof originalLast !== "number"
          ) {
            continue;
          }
          matches.push({
            localStart: originalStart,
            localEnd: originalLast + 1,
            matchedAnchor: variant,
            matchLength: normalizedVariant.length,
            variantRank,
            whitespaceModeRank: normalizedTextMode.rank,
          });
        }

        if (foundAnyForVariant) break;
      }
    });

    return matches;
  };

  const startMatches = resolveVariantMatches(
    getAnchorVariants(startAnchor, "start"),
  );
  const endMatches = resolveVariantMatches(
    getAnchorVariants(endInclusiveAnchor, "end"),
  );
  if (startMatches.length === 0 || endMatches.length === 0) return null;

  let best: {
    localStart: number;
    localEnd: number;
    spanLength: number;
    specificity: number;
    startAnchor: string;
    endInclusiveAnchor: string;
    startVariantRank: number;
    endVariantRank: number;
    startWhitespaceModeRank: number;
    endWhitespaceModeRank: number;
  } | null = null;

  for (const startIndex of startMatches) {
    for (const endIndex of endMatches) {
      if (endIndex.localStart < startIndex.localStart) continue;

      const localStart = startIndex.localStart;
      const localEnd = endIndex.localEnd;
      if (localEnd <= localStart) continue;

      const spanLength = localEnd - localStart;
      const specificity = startIndex.matchLength + endIndex.matchLength;
      if (
        !best ||
        specificity > best.specificity ||
        (specificity === best.specificity &&
          (spanLength < best.spanLength ||
            (spanLength === best.spanLength &&
              (startIndex.variantRank + endIndex.variantRank <
                best.startVariantRank + best.endVariantRank ||
                (startIndex.variantRank + endIndex.variantRank ===
                  best.startVariantRank + best.endVariantRank &&
                  (startIndex.whitespaceModeRank + endIndex.whitespaceModeRank <
                    best.startWhitespaceModeRank + best.endWhitespaceModeRank ||
                    (startIndex.whitespaceModeRank +
                      endIndex.whitespaceModeRank ===
                      best.startWhitespaceModeRank +
                        best.endWhitespaceModeRank &&
                      localStart < best.localStart)))))))
      ) {
        best = {
          localStart,
          localEnd,
          spanLength,
          specificity,
          startAnchor: startIndex.matchedAnchor,
          endInclusiveAnchor: endIndex.matchedAnchor,
          startVariantRank: startIndex.variantRank,
          endVariantRank: endIndex.variantRank,
          startWhitespaceModeRank: startIndex.whitespaceModeRank,
          endWhitespaceModeRank: endIndex.whitespaceModeRank,
        };
      }
    }
  }

  return best
    ? {
        startAnchor: best.startAnchor,
        endInclusiveAnchor: best.endInclusiveAnchor,
        localStart: best.localStart,
        localEnd: best.localEnd,
        specificity: best.specificity,
        variantRankSum: best.startVariantRank + best.endVariantRank,
      }
    : null;
};

const resolveSelectionAttachmentAnchorOffsets = (
  attachment: AiChatSelectionAttachment,
  startAnchorRaw: string,
  endInclusiveAnchorRaw: string,
) =>
  resolveTextAnchorOffsets(
    attachment.text,
    startAnchorRaw,
    endInclusiveAnchorRaw,
  );

const buildDocumentAnchorCandidatePageIndexes = (
  totalPages: number,
  pageHint?: number,
) => {
  const pageIndexes = Array.from({ length: totalPages }, (_, index) => index);
  if (
    typeof pageHint !== "number" ||
    !Number.isFinite(pageHint) ||
    pageHint < 1 ||
    pageHint > totalPages
  ) {
    return pageIndexes;
  }

  const hintedPageIndex = Math.trunc(pageHint) - 1;
  return pageIndexes.sort((left, right) => {
    const leftDistance = Math.abs(left - hintedPageIndex);
    const rightDistance = Math.abs(right - hintedPageIndex);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return left - right;
  });
};

const normalizeAnnotationText = (value: string) =>
  value.replace(/\s+/g, " ").trim();

const MAX_PENDING_DETECTED_FIELD_BATCHES = 8;

const cloneFieldRect = (rect: FormField["rect"]) => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
});

const clampPointToPage = (
  page: { width: number; height: number },
  point: { x: number; y: number },
) => ({
  x: Math.max(0, Math.min(page.width, point.x)),
  y: Math.max(0, Math.min(page.height, point.y)),
});

const clampFieldRectToPage = (
  page: { width: number; height: number },
  rect: FormField["rect"],
): FormField["rect"] => {
  const clampedX = Math.max(0, Math.min(page.width, rect.x));
  const clampedY = Math.max(0, Math.min(page.height, rect.y));
  const maxWidth = Math.max(1, page.width - clampedX);
  const maxHeight = Math.max(1, page.height - clampedY);

  return {
    x: clampedX,
    y: clampedY,
    width: Math.max(1, Math.min(rect.width, maxWidth)),
    height: Math.max(1, Math.min(rect.height, maxHeight)),
  };
};

const clampAnnotationRectToPage = (
  page: { width: number; height: number },
  rect: NonNullable<Annotation["rect"]>,
) => clampFieldRectToPage(page, rect);

const normalizeAnnotationRectInput = (
  rect:
    | {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }
    | undefined,
) => {
  if (!rect) return null;
  const { x, y, width, height } = rect;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
};

const normalizeAnnotationPointInputs = (
  points: Array<{ x?: number; y?: number }> | undefined,
) =>
  (points ?? []).flatMap((point) =>
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
      ? [{ x: point.x, y: point.y }]
      : [],
  );

const normalizeTransparentFillColor = (value: string | undefined) => {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.toLowerCase() === "transparent" ||
    normalized.toLowerCase() === "none"
    ? undefined
    : normalized;
};

const buildSelectedChatModelMeta = (
  selectedChatModel: SelectedChatModelMeta,
) =>
  selectedChatModel
    ? {
        providerId: selectedChatModel.providerId,
        providerLabel: selectedChatModel.providerLabel,
        modelId: selectedChatModel.modelId,
        modelLabel: selectedChatModel.modelLabel,
      }
    : undefined;

const summarizeDetectedFormFieldDraft = (
  draftId: string,
  field: FormField,
): AiDetectedFormFieldDraft => ({
  draftId,
  pageNumber: field.pageIndex + 1,
  name: field.name || "",
  type: getAiFormFieldKind(field.type),
  rect: roundAiRect(field.rect),
  options: field.options?.length ? [...field.options] : undefined,
  multiline:
    field.type === FieldType.TEXT ? field.multiline === true : undefined,
  alignment: field.type === FieldType.TEXT ? field.alignment : undefined,
});

const cloneDetectedDraftState = (
  draft: AiDetectedFormFieldDraftState,
): AiDetectedFormFieldDraftState => ({
  draftId: draft.draftId,
  field: {
    ...draft.field,
    rect: cloneFieldRect(draft.field.rect),
    style: draft.field.style ? { ...draft.field.style } : undefined,
    options: draft.field.options ? [...draft.field.options] : undefined,
  },
  summary: {
    ...draft.summary,
    rect: { ...draft.summary.rect },
    options: draft.summary.options ? [...draft.summary.options] : undefined,
  },
});

const buildDetectedFieldBatchOutput = (
  batch: AiDetectedFormFieldBatchState,
): AiDetectedFormFieldBatch => ({
  batchId: batch.batchId,
  status: batch.status,
  createdAt: batch.createdAt,
  pageNumbers: [...batch.pageNumbers],
  requestedPageCount: batch.pageNumbers.length,
  detectedCount: batch.drafts.length,
  userIntent: batch.userIntent,
  allowedTypes: batch.allowedTypes?.length
    ? [...batch.allowedTypes]
    : undefined,
  extraPrompt: batch.extraPrompt,
  fields: batch.drafts.map((draft) => ({
    ...draft.summary,
    rect: { ...draft.summary.rect },
    options: draft.summary.options ? [...draft.summary.options] : undefined,
  })),
});

const getRectArea = (rect: FormField["rect"]) =>
  Math.max(0, rect.width) * Math.max(0, rect.height);

const getRectOverlapRatio = (
  left: FormField["rect"],
  right: FormField["rect"],
) => {
  const overlapWidth =
    Math.min(left.x + left.width, right.x + right.width) -
    Math.max(left.x, right.x);
  const overlapHeight =
    Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y);
  if (overlapWidth <= 0 || overlapHeight <= 0) return 0;

  const overlapArea = overlapWidth * overlapHeight;
  const minArea = Math.min(getRectArea(left), getRectArea(right));
  if (minArea <= 0) return 0;
  return overlapArea / minArea;
};

const isPotentialDuplicateField = (left: FormField, right: FormField) =>
  left.pageIndex === right.pageIndex &&
  left.type === right.type &&
  getRectOverlapRatio(left.rect, right.rect) >= 0.8;

const areRectanglesNearlyIdentical = (
  left: NonNullable<Annotation["rect"]>,
  right: NonNullable<Annotation["rect"]>,
) =>
  getRectOverlapRatio(left, right) >= 0.98 &&
  Math.abs(left.x - right.x) <= 1 &&
  Math.abs(left.y - right.y) <= 1 &&
  Math.abs(left.width - right.width) <= 1 &&
  Math.abs(left.height - right.height) <= 1;

const areNormalizedShapePointsNearlyIdentical = (
  left: Annotation["shapePoints"],
  right: Annotation["shapePoints"],
) => {
  if (!left?.length && !right?.length) return true;
  if (!left?.length || !right?.length) return false;
  if (left.length !== right.length) return false;

  return left.every((point, index) => {
    const other = right[index];
    return (
      !!other &&
      Math.abs(point.x - other.x) <= 0.01 &&
      Math.abs(point.y - other.y) <= 0.01
    );
  });
};

const isPotentialDuplicateAiShapeAnnotation = (
  left: Annotation,
  right: Annotation,
  sessionId: string,
) =>
  left.type === "shape" &&
  right.type === "shape" &&
  left.pageIndex === right.pageIndex &&
  left.shapeType === right.shapeType &&
  left.meta?.kind === "ai_chat_shape" &&
  left.meta?.sessionId === sessionId &&
  !!left.rect &&
  !!right.rect &&
  areRectanglesNearlyIdentical(left.rect, right.rect) &&
  areNormalizedShapePointsNearlyIdentical(left.shapePoints, right.shapePoints);

const isPotentialDuplicateAiFreetextAnnotation = (
  left: Annotation,
  right: Annotation,
  sessionId: string,
) =>
  left.type === "freetext" &&
  right.type === "freetext" &&
  left.pageIndex === right.pageIndex &&
  left.meta?.kind === "ai_chat_freetext" &&
  left.meta?.sessionId === sessionId &&
  (left.text || "").trim() === (right.text || "").trim() &&
  !!left.rect &&
  !!right.rect &&
  areRectanglesNearlyIdentical(left.rect, right.rect);

const annotationSupportsRectTranslation = (annotation: Annotation) =>
  !!annotation.rect;

const annotationSupportsRectResize = (annotation: Annotation) =>
  annotation.type === "comment" ||
  annotation.type === "freetext" ||
  annotation.type === "shape" ||
  annotation.type === "link";

const annotationSupportsTextUpdate = (annotation: Annotation) =>
  annotation.type !== "link";

export const createAiChatToolContext = (options: {
  searchResultsRef: MutableRefObject<Map<string, AiStoredSearchResult>>;
  searchSeqRef: MutableRefObject<number>;
  sessionsRef: MutableRefObject<Map<string, AiChatSessionData>>;
  activeSessionIdRef: MutableRefObject<string>;
  setHighlightedResultIds: (ids: string[]) => void;
  formToolsEnabled: boolean;
  detectFormFieldsEnabled: boolean;
  formToolsVisionModelKey?: string;
  selectedChatModel?: SelectedChatModelMeta;
  selectedChatModelAuthor: string;
  workerService?: PDFWorkerService;
}) => {
  const workerService = options.workerService ?? pdfWorkerService;
  const getDocumentPageAssetSummary = () => summarizeDocumentPageAssets();
  const getActiveSession = () =>
    options.sessionsRef.current.get(options.activeSessionIdRef.current) ?? null;

  const rememberSearchResults = (
    query: string,
    results: PDFSearchResult[],
  ): AiSearchResultSummary[] => {
    const batch = ++options.searchSeqRef.current;
    return results.map((result, index) => {
      const id = `ai_sr_${batch}_${result.pageIndex}_${index}`;
      options.searchResultsRef.current.set(id, {
        id,
        query,
        result,
      });
      return {
        resultId: id,
        pageNumber: result.pageIndex + 1,
        matchText: result.matchText,
        snippet: result.displaySegments.map((segment) => segment.text).join(""),
        highlightBehavior: "exact_match_only",
        snippetPurpose: "context_only",
      };
    });
  };

  const listFormFields = (optionsInput: {
    pageNumbers?: number[];
    query?: string;
    onlyEmpty?: boolean;
    includeReadOnly?: boolean;
    includeLayout?: boolean;
    maxResults?: number;
  }): AiFormFieldListResult => {
    const pageNumbers = (optionsInput.pageNumbers ?? [])
      .map((pageNumber) => Math.trunc(pageNumber))
      .filter((pageNumber) => Number.isFinite(pageNumber) && pageNumber >= 1);
    const pageNumberSet = pageNumbers.length > 0 ? new Set(pageNumbers) : null;
    const maxResults = Math.min(
      500,
      Math.max(1, Math.trunc(optionsInput.maxResults ?? 100) || 100),
    );

    const fields = [...useEditorStore.getState().fields]
      .sort((a, b) => {
        if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
        if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
        if (a.rect.x !== b.rect.x) return a.rect.x - b.rect.x;
        return a.id.localeCompare(b.id);
      })
      .map((field) =>
        summarizeFormField(field, {
          includeLayout: optionsInput.includeLayout,
        }),
      )
      .filter((field) => {
        if (pageNumberSet && !pageNumberSet.has(field.pageNumber)) return false;
        if (!optionsInput.includeReadOnly && field.readOnly) return false;
        if (optionsInput.onlyEmpty && !field.isEmpty) return false;
        return matchesFormFieldQuery(field, optionsInput.query);
      });

    return {
      total: fields.length,
      returned: Math.min(fields.length, maxResults),
      truncated: fields.length > maxResults,
      fields: fields.slice(0, maxResults),
    };
  };

  const fillFormFields = (optionsInput: {
    updates: AiFormFieldFillRequest[];
  }): AiFormFieldFillResult => {
    const store = useEditorStore.getState();
    const fields = store.fields;
    const fieldById = new Map(fields.map((field) => [field.id, field]));
    const reservedFieldIds = new Set<string>();
    const results: AiFormFieldFillResultItem[] = [];
    const pending: Array<{
      fieldId: string;
      targetType: FieldType;
      targetName: string;
      affectedFieldIds: string[];
      patch: Partial<FormField>;
      result: AiFormFieldFillResultItem;
    }> = [];

    for (const update of optionsInput.updates) {
      const target = fieldById.get(update.fieldId);
      if (!target) {
        results.push({
          fieldId: update.fieldId,
          status: "rejected",
          reason: "Field not found.",
        });
        continue;
      }

      const summary = summarizeFormField(target);
      if (target.readOnly) {
        results.push({
          fieldId: target.id,
          pageNumber: summary.pageNumber,
          name: summary.name,
          type: summary.type,
          status: "rejected",
          reason: "Field is read-only.",
        });
        continue;
      }

      if (target.type === FieldType.SIGNATURE) {
        results.push({
          fieldId: target.id,
          pageNumber: summary.pageNumber,
          name: summary.name,
          type: summary.type,
          status: "rejected",
          reason: "AI signature filling is not supported.",
        });
        continue;
      }

      let patch: Partial<FormField> | null = null;
      let currentValue = summary.currentValue;
      let affectedFieldIds = [target.id];
      let reason: string | null = null;

      switch (target.type) {
        case FieldType.TEXT: {
          if (typeof update.value !== "string") {
            reason = "Text fields require value as a string.";
            break;
          }
          patch = { value: update.value };
          currentValue = update.value;
          affectedFieldIds = getSafeSyncFieldIds(fields, target);
          break;
        }
        case FieldType.DROPDOWN: {
          if (target.isMultiSelect) {
            const nextValues = Array.isArray(update.value)
              ? update.value.map((item) => item.trim()).filter(Boolean)
              : typeof update.value === "string"
                ? update.value.trim()
                  ? [update.value.trim()]
                  : []
                : null;

            if (!nextValues) {
              reason =
                "Multi-select dropdown fields require value as an array of strings.";
              break;
            }

            const dropdownOptions = target.options ?? [];
            const invalidOptions = dropdownOptions.length
              ? nextValues.filter((item) => !dropdownOptions.includes(item))
              : [];
            if (invalidOptions.length > 0) {
              reason = `Invalid dropdown options: ${invalidOptions.join(", ")}`;
              break;
            }

            patch = { value: nextValues.join("\n") };
            currentValue = nextValues;
          } else {
            if (typeof update.value !== "string") {
              reason =
                "Single-select dropdown fields require value as a string.";
              break;
            }

            const dropdownOptions = target.options ?? [];
            if (
              !allowsCustomDropdownValue(target) &&
              dropdownOptions.length > 0 &&
              update.value !== "" &&
              !dropdownOptions.includes(update.value)
            ) {
              reason = `Invalid dropdown option: ${update.value}`;
              break;
            }

            patch = { value: update.value };
            currentValue = update.value;
          }

          affectedFieldIds = getSafeSyncFieldIds(fields, target);
          break;
        }
        case FieldType.CHECKBOX: {
          if (typeof update.checked !== "boolean") {
            reason = "Checkbox fields require checked as a boolean.";
            break;
          }
          patch = { isChecked: update.checked };
          currentValue = update.checked;
          affectedFieldIds = getSafeSyncFieldIds(fields, target);
          break;
        }
        case FieldType.RADIO: {
          if (typeof update.checked !== "boolean") {
            reason = "Radio fields require checked as a boolean.";
            break;
          }
          patch = { isChecked: update.checked };
          currentValue = update.checked;
          affectedFieldIds = update.checked
            ? getSafeSyncFieldIds(fields, target)
            : [target.id];
          break;
        }
        default: {
          reason = "Unsupported field type.";
        }
      }

      if (!patch || reason) {
        results.push({
          fieldId: target.id,
          pageNumber: summary.pageNumber,
          name: summary.name,
          type: summary.type,
          status: "rejected",
          reason: reason ?? "Invalid update.",
        });
        continue;
      }

      if (affectedFieldIds.some((fieldId) => reservedFieldIds.has(fieldId))) {
        results.push({
          fieldId: target.id,
          pageNumber: summary.pageNumber,
          name: summary.name,
          type: summary.type,
          status: "rejected",
          reason: "This batch already contains another overlapping update.",
        });
        continue;
      }

      affectedFieldIds.forEach((fieldId) => reservedFieldIds.add(fieldId));

      const result: AiFormFieldFillResultItem = {
        fieldId: target.id,
        pageNumber: summary.pageNumber,
        name: summary.name,
        type: summary.type,
        status: "updated",
        affectedFieldIds,
        currentValue,
      };
      results.push(result);
      pending.push({
        fieldId: target.id,
        targetType: target.type,
        targetName: target.name,
        affectedFieldIds,
        patch,
        result,
      });
    }

    if (pending.length > 0) {
      store.saveCheckpoint();
      store.setState((state) => {
        let nextFields = state.fields;

        for (const update of pending) {
          if (
            update.targetType === FieldType.RADIO &&
            update.patch.isChecked === true
          ) {
            const name = update.targetName.trim();
            nextFields = nextFields.map((field) => {
              if (field.type !== FieldType.RADIO) return field;
              if (!name || field.name !== update.targetName) {
                return field.id === update.fieldId
                  ? { ...field, ...update.patch }
                  : field;
              }
              return {
                ...field,
                isChecked: field.id === update.fieldId,
              };
            });
            continue;
          }

          nextFields = nextFields.map((field) =>
            update.affectedFieldIds.includes(field.id)
              ? { ...field, ...update.patch }
              : field,
          );
        }

        return {
          fields: nextFields,
          isDirty: true,
        };
      });
    }

    return {
      updatedCount: pending.length,
      rejectedCount: results.filter((item) => item.status === "rejected")
        .length,
      updates: results,
    };
  };

  const updateFormFields = (optionsInput: {
    updates: AiUpdateFormFieldInput[];
  }): AiFormFieldUpdateResult => {
    const store = useEditorStore.getState();
    const fields = store.fields;
    const fieldById = new Map(fields.map((field) => [field.id, field]));
    const reservedFieldIds = new Set<string>();
    const results: AiFormFieldUpdateResultItem[] = [];
    const pending: Array<{
      fieldId: string;
      patch: Partial<FormField>;
      affectedFieldIds: string[];
      updatedProperties: string[];
    }> = [];

    for (const update of optionsInput.updates) {
      const target = fieldById.get(update.fieldId);
      if (!target) {
        results.push({
          fieldId: update.fieldId,
          status: "rejected",
          reason: "Field not found.",
        });
        continue;
      }

      const summary = summarizeFormField(target);
      const patch: Partial<FormField> = {};
      const updatedProperties: string[] = [];
      let shouldSyncGroupProperties = false;
      let reason: string | null = null;

      if (update.rect) {
        const page = store.pages[target.pageIndex];
        if (!page) {
          reason = "Target page is out of range.";
        } else {
          const nextRect = clampFieldRectToPage(page, {
            x: update.rect.x ?? target.rect.x,
            y: update.rect.y ?? target.rect.y,
            width: update.rect.width ?? target.rect.width,
            height: update.rect.height ?? target.rect.height,
          });
          const changedRectProperties = (
            [
              ["x", nextRect.x, target.rect.x],
              ["y", nextRect.y, target.rect.y],
              ["width", nextRect.width, target.rect.width],
              ["height", nextRect.height, target.rect.height],
            ] as const
          ).flatMap(([key, nextValue, currentValue]) =>
            nextValue === currentValue ? [] : [`rect.${key}`],
          );

          if (changedRectProperties.length > 0) {
            patch.rect = nextRect;
            updatedProperties.push(...changedRectProperties);
          }
        }
      }

      if (
        update.required !== undefined &&
        update.required !== summary.required
      ) {
        patch.required = update.required;
        updatedProperties.push("required");
        shouldSyncGroupProperties = true;
      }

      if (
        update.readOnly !== undefined &&
        update.readOnly !== summary.readOnly
      ) {
        patch.readOnly = update.readOnly;
        updatedProperties.push("readOnly");
        shouldSyncGroupProperties = true;
      }

      if (update.toolTip !== undefined) {
        const nextToolTip = update.toolTip;
        if ((target.toolTip ?? "") !== nextToolTip) {
          patch.toolTip = nextToolTip;
          updatedProperties.push("toolTip");
          shouldSyncGroupProperties = true;
        }
      }

      if (update.placeholder !== undefined) {
        if (target.type !== FieldType.TEXT) {
          reason = "placeholder can only be updated on text fields.";
        } else if ((target.placeholder ?? "") !== update.placeholder) {
          patch.placeholder = update.placeholder;
          updatedProperties.push("placeholder");
          shouldSyncGroupProperties = true;
        }
      }

      if (update.multiline !== undefined) {
        if (target.type !== FieldType.TEXT) {
          reason = "multiline can only be updated on text fields.";
        } else if ((target.multiline === true) !== update.multiline) {
          patch.multiline = update.multiline;
          updatedProperties.push("multiline");
          shouldSyncGroupProperties = true;
        }
      }

      if (update.alignment !== undefined) {
        if (target.type !== FieldType.TEXT) {
          reason = "alignment can only be updated on text fields.";
        } else if (target.alignment !== update.alignment) {
          patch.alignment = update.alignment;
          updatedProperties.push("alignment");
          shouldSyncGroupProperties = true;
        }
      }

      if (update.options !== undefined) {
        if (target.type !== FieldType.DROPDOWN) {
          reason = "options can only be updated on dropdown fields.";
        } else if (!areStringArraysEqual(target.options, update.options)) {
          patch.options = [...update.options];
          updatedProperties.push("options");
          shouldSyncGroupProperties = true;
        }
      }

      if (update.isMultiSelect !== undefined) {
        if (target.type !== FieldType.DROPDOWN) {
          reason = "isMultiSelect can only be updated on dropdown fields.";
        } else if ((target.isMultiSelect === true) !== update.isMultiSelect) {
          patch.isMultiSelect = update.isMultiSelect;
          updatedProperties.push("isMultiSelect");
        }
      }

      if (update.allowCustomValue !== undefined) {
        if (target.type !== FieldType.DROPDOWN) {
          reason = "allowCustomValue can only be updated on dropdown fields.";
        } else if (
          (target.allowCustomValue === true) !==
          update.allowCustomValue
        ) {
          patch.allowCustomValue = update.allowCustomValue;
          updatedProperties.push("allowCustomValue");
        }
      }

      if (update.exportValue !== undefined) {
        if (
          target.type !== FieldType.CHECKBOX &&
          target.type !== FieldType.RADIO
        ) {
          reason =
            "exportValue can only be updated on checkbox or radio fields.";
        } else {
          const nextExportValue = update.exportValue;
          const currentExportValue =
            target.exportValue ??
            (target.type === FieldType.RADIO ? target.radioValue : undefined) ??
            "";
          if (currentExportValue !== nextExportValue) {
            patch.exportValue = nextExportValue;
            if (target.type === FieldType.RADIO) {
              patch.radioValue = nextExportValue;
            }
            updatedProperties.push("exportValue");
          }
        }
      }

      if (update.style && Object.keys(update.style).length > 0) {
        const currentStyle = target.style ?? {};
        const nextStylePatch = pruneUndefinedKeys(update.style);
        if (nextStylePatch) {
          const nextStyle = {
            ...currentStyle,
            ...nextStylePatch,
          };
          const changedStyleProperties = Object.entries(nextStylePatch).flatMap(
            ([key, value]) => {
              const currentValue =
                currentStyle[key as keyof NonNullable<FormField["style"]>];
              return currentValue === value ? [] : [`style.${key}`];
            },
          );
          if (changedStyleProperties.length > 0) {
            patch.style = nextStyle;
            updatedProperties.push(...changedStyleProperties);
          }
        }
      }

      if (reason) {
        results.push({
          fieldId: target.id,
          pageNumber: summary.pageNumber,
          name: summary.name,
          type: summary.type,
          status: "rejected",
          reason,
        });
        continue;
      }

      if (updatedProperties.length === 0) {
        results.push({
          fieldId: target.id,
          pageNumber: summary.pageNumber,
          name: summary.name,
          type: summary.type,
          status: "unchanged",
          reason: "Requested properties already match the current field.",
        });
        continue;
      }

      const affectedFieldIds = shouldSyncGroupProperties
        ? getPropertySyncFieldIds(fields, target)
        : [target.id];

      if (affectedFieldIds.some((fieldId) => reservedFieldIds.has(fieldId))) {
        results.push({
          fieldId: target.id,
          pageNumber: summary.pageNumber,
          name: summary.name,
          type: summary.type,
          status: "rejected",
          reason: "This batch already contains another overlapping update.",
        });
        continue;
      }

      affectedFieldIds.forEach((fieldId) => reservedFieldIds.add(fieldId));
      results.push({
        fieldId: target.id,
        pageNumber: summary.pageNumber,
        name: summary.name,
        type: summary.type,
        status: "updated",
        affectedFieldIds,
        updatedProperties,
      });
      pending.push({
        fieldId: target.id,
        patch,
        affectedFieldIds,
        updatedProperties,
      });
    }

    if (pending.length > 0) {
      store.saveCheckpoint();
      for (const update of pending) {
        store.updateField(update.fieldId, update.patch);
      }
    }

    return {
      updatedCount: results.filter((item) => item.status === "updated").length,
      unchangedCount: results.filter((item) => item.status === "unchanged")
        .length,
      rejectedCount: results.filter((item) => item.status === "rejected")
        .length,
      updates: results,
    };
  };

  const detectFormFields = async (optionsInput: {
    pageNumbers?: number[];
    pageImages: Array<{
      pageNumber: number;
      pageWidth: number;
      pageHeight: number;
      base64Data: string;
    }>;
    allowedTypes?: AiFormFieldKind[];
    userIntent?: string;
    extraPrompt?: string;
    signal?: AbortSignal;
    onProgress?: (progress: AiToolExecutionProgress) => void;
  }): Promise<AiDetectedFormFieldBatch> => {
    const snapshot = useEditorStore.getState();
    if (!snapshot.pdfBytes || snapshot.pages.length === 0) {
      throw new Error("No PDF is currently loaded.");
    }

    const normalizedPageNumbers = Array.from(
      new Set(
        (optionsInput.pageNumbers ?? [])
          .map((pageNumber) => Math.trunc(pageNumber))
          .filter(
            (pageNumber) =>
              Number.isFinite(pageNumber) &&
              pageNumber >= 1 &&
              pageNumber <= snapshot.pages.length,
          ),
      ),
    ).sort((left, right) => left - right);
    const pageNumbers =
      normalizedPageNumbers.length > 0
        ? normalizedPageNumbers
        : [snapshot.currentPageIndex + 1];
    const pageImagesByPageNumber = new Map(
      optionsInput.pageImages.map((pageImage) => [
        pageImage.pageNumber,
        pageImage,
      ]),
    );
    const allowedTypes = (optionsInput.allowedTypes ?? []).length
      ? Array.from(new Set(optionsInput.allowedTypes))
      : ([
          "text",
          "checkbox",
          "radio",
          "dropdown",
          "signature",
        ] satisfies AiFormFieldKind[]);
    const allowedFieldTypes = allowedTypes.map(getFieldTypeFromAiFormFieldKind);
    const userIntent = optionsInput.userIntent?.trim() || undefined;
    const extraPrompt = optionsInput.extraPrompt?.trim() || undefined;
    const combinedPrompt = [userIntent, extraPrompt]
      .filter(Boolean)
      .join("\n\n");
    const configuredVisionModelSpecifier = parseAiSdkModelSpecifier(
      options.formToolsVisionModelKey?.trim(),
    );
    if (!configuredVisionModelSpecifier) {
      throw new Error(
        "No dedicated vision model is configured for detect_form_fields. Enable the fallback detector and choose a form-tools vision model in settings.",
      );
    }
    if (
      !isAiSdkProviderConfigured(
        snapshot.options,
        configuredVisionModelSpecifier.providerId,
      )
    ) {
      throw new Error(
        "The configured detect_form_fields vision provider is disabled or missing an API key. Enable that provider in settings or choose a different vision model.",
      );
    }
    const progressItems = pageNumbers.map((pageNumber) => ({
      id: `page_${pageNumber}`,
      label: `Page ${pageNumber}`,
      status: "pending" as const,
    }));
    const drafts: AiDetectedFormFieldDraftState[] = [];

    for (const [pageIndexInBatch, pageNumber] of pageNumbers.entries()) {
      optionsInput.onProgress?.({
        summary: `Analyzing page ${pageIndexInBatch + 1} of ${pageNumbers.length}`,
        items: progressItems.map((item, index) => ({
          ...item,
          status:
            index < pageIndexInBatch
              ? "done"
              : index === pageIndexInBatch
                ? "running"
                : "pending",
        })),
        counts: {
          done: pageIndexInBatch,
          running: 1,
          pending: Math.max(0, pageNumbers.length - pageIndexInBatch - 1),
        },
      });

      const pageIndex = pageNumber - 1;
      const page = snapshot.pages[pageIndex];
      if (!page) continue;

      const providedPageImage = pageImagesByPageNumber.get(pageNumber);
      if (!providedPageImage?.base64Data) {
        throw new Error(
          `detect_form_fields requires a rendered page image for page ${pageNumber} from the current edited document state.`,
        );
      }

      const detectedFields = await analyzePageForFields(
        providedPageImage.base64Data,
        pageIndex,
        providedPageImage?.pageWidth ?? page.width,
        providedPageImage?.pageHeight ?? page.height,
        snapshot.fields.filter((field) => field.pageIndex === pageIndex),
        {
          allowedTypes: allowedFieldTypes,
          extraPrompt: combinedPrompt || undefined,
          providerId: configuredVisionModelSpecifier.providerId,
          modelId: configuredVisionModelSpecifier.modelId,
        },
      );

      detectedFields.forEach((field, index) => {
        const draftId = `detected_${pageIndex}_${index}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        drafts.push({
          draftId,
          field: {
            ...field,
            rect: cloneFieldRect(field.rect),
            style: field.style ? { ...field.style } : undefined,
            options: field.options ? [...field.options] : undefined,
          },
          summary: summarizeDetectedFormFieldDraft(draftId, field),
        });
      });
    }

    const batchState: AiDetectedFormFieldBatchState = {
      batchId: `field_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      status: "draft",
      pageNumbers,
      allowedTypes,
      userIntent,
      extraPrompt,
      confirmedAt: undefined,
      confirmedByMessageId: undefined,
      confirmedByUserText: undefined,
      drafts,
    };

    const session = getActiveSession();
    if (session) {
      session.pendingDetectedFieldBatches = [
        batchState,
        ...session.pendingDetectedFieldBatches
          .filter((batch) => batch.batchId !== batchState.batchId)
          .map((batch) => ({
            ...batch,
            pageNumbers: [...batch.pageNumbers],
            allowedTypes: batch.allowedTypes
              ? [...batch.allowedTypes]
              : undefined,
            drafts: batch.drafts.map(cloneDetectedDraftState),
          })),
      ].slice(0, MAX_PENDING_DETECTED_FIELD_BATCHES);
    }

    optionsInput.onProgress?.({
      summary:
        drafts.length > 0
          ? `Detected ${drafts.length} candidate field${drafts.length === 1 ? "" : "s"}`
          : "No candidate fields detected",
      items: progressItems.map((item) => ({
        ...item,
        status: "done",
      })),
      counts: {
        done: pageNumbers.length,
        running: 0,
        pending: 0,
      },
    });

    return buildDetectedFieldBatchOutput(batchState);
  };

  const createFormFields = (optionsInput: {
    batchId?: string;
    draftIds?: string[];
    fields?: AiCreateFormFieldInput[];
  }): AiCreateFormFieldsResult => {
    const session = getActiveSession();
    if (!session) {
      return {
        batchId: optionsInput.batchId,
        status: "not_found",
        createdCount: 0,
        skippedCount: 0,
        rejectedCount: 0,
        fields: [],
        reason: "No active AI chat session was found.",
      };
    }

    const commitFieldCreations = (commitOptions: {
      batchId?: string;
      seedResults?: AiCreateFormFieldsResultItem[];
      candidates: Array<{
        draftId?: string;
        field: FormField;
        pageNumber: number;
        name: string;
        type: AiFormFieldKind;
      }>;
      emptyStatus: "not_found" | "rejected";
      emptyReason: string;
      onApplied?: () => void;
    }): AiCreateFormFieldsResult => {
      const results = [...(commitOptions.seedResults ?? [])];
      if (commitOptions.candidates.length === 0) {
        return {
          batchId: commitOptions.batchId,
          status: commitOptions.emptyStatus,
          createdCount: 0,
          skippedCount: 0,
          rejectedCount: results.filter((item) => item.status === "rejected")
            .length,
          fields: results,
          reason: commitOptions.emptyReason,
        };
      }

      const store = useEditorStore.getState();
      const createdFields: FormField[] = [];
      const existingFields = [...store.fields];
      const pageNextLayerOrder = new Map<number, number>();

      for (const item of commitOptions.candidates) {
        const candidate: FormField = {
          ...item.field,
          id: `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          rect: cloneFieldRect(item.field.rect),
          style: item.field.style ? { ...item.field.style } : undefined,
          options: item.field.options ? [...item.field.options] : undefined,
        };

        if (
          existingFields.some((field) =>
            isPotentialDuplicateField(field, candidate),
          )
        ) {
          results.push({
            draftId: item.draftId,
            pageNumber: item.pageNumber,
            name: item.name,
            type: item.type,
            status: "skipped",
            reason: "Overlaps an existing field on the page.",
          });
          continue;
        }

        const nextLayerOrder =
          pageNextLayerOrder.get(candidate.pageIndex) ??
          getNextLayerOrderForPage(
            [...existingFields, ...createdFields],
            store.annotations,
            candidate.pageIndex,
          );
        candidate.layerOrder = nextLayerOrder;
        pageNextLayerOrder.set(candidate.pageIndex, nextLayerOrder + 1);
        createdFields.push(candidate);
        existingFields.push(candidate);
        results.push({
          draftId: item.draftId,
          fieldId: candidate.id,
          pageNumber: item.pageNumber,
          name: item.name,
          type: item.type,
          status: "created",
        });
      }

      if (createdFields.length > 0) {
        store.saveCheckpoint();
        store.setState((state) => ({
          fields: [...state.fields, ...createdFields],
          selectedId:
            createdFields[createdFields.length - 1]?.id ?? state.selectedId,
          isDirty: true,
        }));
      }

      commitOptions.onApplied?.();

      return {
        batchId: commitOptions.batchId,
        status: "created",
        createdCount: results.filter((item) => item.status === "created")
          .length,
        skippedCount: results.filter((item) => item.status === "skipped")
          .length,
        rejectedCount: results.filter((item) => item.status === "rejected")
          .length,
        fields: results,
      };
    };

    const directFields = optionsInput.fields ?? [];
    if (directFields.length > 0) {
      const store = useEditorStore.getState();
      const seedResults: AiCreateFormFieldsResultItem[] = [];
      const candidates: Array<{
        draftId?: string;
        field: FormField;
        pageNumber: number;
        name: string;
        type: AiFormFieldKind;
      }> = [];

      directFields.forEach((item, index) => {
        const pageIndex = Math.trunc(item.pageNumber) - 1;
        const page = store.pages[pageIndex];
        const normalizedName = item.name.trim() || `Field ${index + 1}`;
        if (!page) {
          seedResults.push({
            pageNumber: item.pageNumber,
            name: normalizedName,
            type: item.type,
            status: "rejected",
            reason: "Target page is out of range.",
          });
          return;
        }

        const fieldType = getFieldTypeFromAiFormFieldKind(item.type);
        const trimmedOptions = (item.options ?? [])
          .map((option) => option.trim())
          .filter(Boolean);
        const exportValue =
          item.exportValue ||
          (fieldType === FieldType.CHECKBOX
            ? "Yes"
            : fieldType === FieldType.RADIO
              ? "Choice1"
              : undefined);

        candidates.push({
          pageNumber: item.pageNumber,
          name: normalizedName,
          type: item.type,
          field: {
            id: `direct_${Date.now()}_${index}`,
            pageIndex,
            type: fieldType,
            name: normalizedName,
            rect: clampFieldRectToPage(page, item.rect),
            required: item.required === true ? true : undefined,
            readOnly: item.readOnly === true ? true : undefined,
            toolTip: item.toolTip?.trim() || undefined,
            placeholder:
              fieldType === FieldType.TEXT
                ? (item.placeholder ?? undefined)
                : undefined,
            style: {
              ...DEFAULT_FIELD_STYLE,
              ...(pruneUndefinedKeys(item.style) ?? {}),
            },
            options:
              fieldType === FieldType.DROPDOWN
                ? trimmedOptions.length > 0
                  ? trimmedOptions
                  : ["Option 1", "Option 2"]
                : undefined,
            isMultiSelect:
              fieldType === FieldType.DROPDOWN
                ? item.isMultiSelect === true
                : undefined,
            allowCustomValue:
              fieldType === FieldType.DROPDOWN
                ? item.allowCustomValue === true
                : undefined,
            multiline:
              fieldType === FieldType.TEXT
                ? item.multiline === true
                : undefined,
            alignment:
              fieldType === FieldType.TEXT ? item.alignment : undefined,
            exportValue,
            radioValue:
              fieldType === FieldType.RADIO
                ? exportValue || "Choice1"
                : undefined,
          },
        });
      });

      return {
        ...commitFieldCreations({
          batchId: optionsInput.batchId,
          seedResults,
          candidates,
          emptyStatus: seedResults.length > 0 ? "rejected" : "not_found",
          emptyReason:
            seedResults.length > 0
              ? "One or more direct field definitions were invalid."
              : "No direct field definitions were provided.",
        }),
      };
    }

    const batch =
      (optionsInput.batchId
        ? session.pendingDetectedFieldBatches.find(
            (item) => item.batchId === optionsInput.batchId,
          )
        : session.pendingDetectedFieldBatches.find(
            (item) => item.status === "draft",
          )) ?? null;
    if (!batch) {
      return {
        batchId: optionsInput.batchId,
        status: "not_found",
        createdCount: 0,
        skippedCount: 0,
        rejectedCount: 0,
        fields: [],
        reason: "No pending detected field batch is available.",
      };
    }
    if (batch.status !== "draft") {
      return {
        batchId: batch.batchId,
        status: "rejected",
        createdCount: 0,
        skippedCount: 0,
        rejectedCount: 0,
        fields: [],
        reason:
          "This detected field batch has already been applied or discarded.",
      };
    }
    const requestedDraftIds = Array.from(
      new Set(
        (optionsInput.draftIds ?? [])
          .map((draftId) => draftId.trim())
          .filter(Boolean),
      ),
    );
    const selectedDrafts =
      requestedDraftIds.length > 0
        ? batch.drafts.filter((draft) =>
            requestedDraftIds.includes(draft.draftId),
          )
        : batch.drafts;
    const draftById = new Map(
      batch.drafts.map((draft) => [draft.draftId, draft]),
    );
    const results: AiCreateFormFieldsResultItem[] = requestedDraftIds
      .filter((draftId) => !draftById.has(draftId))
      .map((draftId) => ({
        draftId,
        status: "rejected",
        reason: "Draft field not found in the selected batch.",
      }));

    if (selectedDrafts.length === 0) {
      return {
        batchId: batch.batchId,
        status: results.length > 0 ? "rejected" : "not_found",
        createdCount: 0,
        skippedCount: 0,
        rejectedCount: results.length,
        fields: results,
        reason:
          results.length > 0
            ? "One or more requested draft fields were not found."
            : "No draft fields are available to create.",
      };
    }

    return commitFieldCreations({
      batchId: batch.batchId,
      seedResults: results,
      candidates: selectedDrafts.map((draft) => ({
        draftId: draft.draftId,
        field: draft.field,
        pageNumber: draft.summary.pageNumber,
        name: draft.summary.name,
        type: draft.summary.type,
      })),
      emptyStatus: results.length > 0 ? "rejected" : "not_found",
      emptyReason:
        results.length > 0
          ? "One or more requested draft fields were not found."
          : "No draft fields are available to create.",
      onApplied: () => {
        batch.status = "applied";
      },
    });
  };

  const focusControl = (id: string, optionsInput?: { select?: boolean }) => {
    const field = useEditorStore
      .getState()
      .fields.find((item) => item.id === id);
    if (field) {
      if (optionsInput?.select) {
        useEditorStore.getState().selectControl(id);
      }
      appEventBus.emit("workspace:focusControl", {
        id,
        behavior: "smooth",
      });
      return {
        controlType: "field" as const,
        pageNumber: field.pageIndex + 1,
        field: summarizeFormField(field),
      };
    }

    const annotation = useEditorStore
      .getState()
      .annotations.find((item) => item.id === id);
    if (!annotation) return null;

    const summary = summarizeAnnotation(annotation);
    if (!summary) return null;

    if (optionsInput?.select) {
      useEditorStore.getState().selectControl(id);
    }
    appEventBus.emit("workspace:focusControl", {
      id,
      behavior: "smooth",
    });
    return {
      controlType: "annotation" as const,
      pageNumber: annotation.pageIndex + 1,
      annotation: summary,
    };
  };

  const getStoredSearchResult = (id: string) =>
    options.searchResultsRef.current.get(id) ?? null;

  const setActiveHighlightedResultIds = (ids: string[]) => {
    const unique = Array.from(new Set(ids));
    options.setHighlightedResultIds(unique);
    const session = options.sessionsRef.current.get(
      options.activeSessionIdRef.current,
    );
    if (session) session.highlightedResultIds = unique;
  };

  const clearActiveHighlightedResultIds = () => {
    options.setHighlightedResultIds([]);
    const session = options.sessionsRef.current.get(
      options.activeSessionIdRef.current,
    );
    if (session) session.highlightedResultIds = [];
  };

  const listAnnotations = (optionsInput: {
    query?: string;
    pageNumbers?: number[];
    types?: AiAnnotationKind[];
    maxResults?: number;
  }): AiAnnotationListResult => {
    const store = useEditorStore.getState();
    const selectedTypes = (optionsInput.types ?? []).filter(
      (type): type is AnnotationListType =>
        ANNOTATION_LIST_TYPES.includes(type as AnnotationListType),
    );
    const filtered = filterAnnotationsForList(store.annotations, {
      query: optionsInput.query,
      pageNumbers: optionsInput.pageNumbers,
      selectedTypes,
    });
    const sorted = sortAnnotationsForList(filtered);
    const limit = Math.max(1, Math.trunc(optionsInput.maxResults ?? 100));
    const annotations = sorted
      .slice(0, limit)
      .flatMap((annotation) => summarizeAnnotation(annotation) ?? []);

    return {
      total: sorted.length,
      returned: annotations.length,
      truncated: annotations.length < sorted.length,
      annotations,
    };
  };

  const updateAnnotationText = (optionsInput: {
    annotationId: string;
    text: string;
  }): AiAnnotationTextUpdateResult => {
    const store = useEditorStore.getState();
    const annotation = store.annotations.find(
      (item) => item.id === optionsInput.annotationId,
    );

    if (!annotation) {
      return {
        ok: false,
        annotationId: optionsInput.annotationId,
        status: "rejected",
        reason: "Annotation not found.",
      };
    }

    const type = getAiAnnotationKind(annotation);
    const nextText = optionsInput.text;
    const previousText = annotation.text ?? "";
    if (previousText === nextText) {
      return {
        ok: true,
        annotationId: annotation.id,
        pageNumber: annotation.pageIndex + 1,
        type: type ?? undefined,
        previousText,
        text: nextText,
        status: "unchanged",
      };
    }

    store.saveCheckpoint();
    store.updateAnnotation(annotation.id, { text: nextText });

    return {
      ok: true,
      annotationId: annotation.id,
      pageNumber: annotation.pageIndex + 1,
      type: type ?? undefined,
      previousText,
      text: nextText,
      status: "updated",
    };
  };

  const updateAnnotationTexts = (optionsInput: {
    updates: Array<{
      annotationId: string;
      text: string;
    }>;
  }): AiAnnotationTextBatchUpdateResult => {
    const results: AiAnnotationTextUpdateResult[] = [];
    let updatedCount = 0;
    let unchangedCount = 0;
    let rejectedCount = 0;

    const pendingUpdates = optionsInput.updates.filter(
      (item) => item.annotationId.trim().length > 0,
    );
    if (pendingUpdates.length === 0) {
      return {
        updatedCount: 0,
        unchangedCount: 0,
        rejectedCount: 0,
        updates: [],
      };
    }

    let savedCheckpoint = false;
    for (const item of pendingUpdates) {
      const currentStore = useEditorStore.getState();
      const annotation = currentStore.annotations.find(
        (candidate) => candidate.id === item.annotationId,
      );

      if (!annotation) {
        rejectedCount += 1;
        results.push({
          ok: false,
          annotationId: item.annotationId,
          status: "rejected",
          reason: "Annotation not found.",
        });
        continue;
      }

      const type = getAiAnnotationKind(annotation);
      const previousText = annotation.text ?? "";
      if (previousText === item.text) {
        unchangedCount += 1;
        results.push({
          ok: true,
          annotationId: annotation.id,
          pageNumber: annotation.pageIndex + 1,
          type: type ?? undefined,
          previousText,
          text: item.text,
          status: "unchanged",
        });
        continue;
      }

      if (!savedCheckpoint) {
        currentStore.saveCheckpoint();
        savedCheckpoint = true;
      }

      currentStore.updateAnnotation(annotation.id, { text: item.text });
      updatedCount += 1;
      results.push({
        ok: true,
        annotationId: annotation.id,
        pageNumber: annotation.pageIndex + 1,
        type: type ?? undefined,
        previousText,
        text: item.text,
        status: "updated",
      });
    }

    return {
      updatedCount,
      unchangedCount,
      rejectedCount,
      updates: results,
    };
  };

  const updateAnnotations = (optionsInput: {
    updates: AiUpdateAnnotationInput[];
  }): AiAnnotationUpdateResult => {
    const store = useEditorStore.getState();
    const annotationById = new Map(
      store.annotations.map((annotation) => [annotation.id, annotation]),
    );
    const reservedAnnotationIds = new Set<string>();
    const results: AiAnnotationUpdateResultItem[] = [];
    const pending: Array<{
      annotationId: string;
      patch: Partial<Annotation>;
    }> = [];

    for (const update of optionsInput.updates) {
      const target = annotationById.get(update.annotationId);
      if (!target) {
        results.push({
          annotationId: update.annotationId,
          status: "rejected",
          reason: "Annotation not found.",
        });
        continue;
      }

      const actualType = getAiAnnotationKind(target);
      if (!actualType || actualType !== update.annotationType) {
        results.push({
          annotationId: target.id,
          pageNumber: target.pageIndex + 1,
          type: actualType ?? undefined,
          subType: target.type === "shape" ? target.shapeType : undefined,
          status: "rejected",
          reason: `annotation_type mismatch. Expected ${actualType ?? "unknown"} for this annotation.`,
        });
        continue;
      }

      if (reservedAnnotationIds.has(target.id)) {
        results.push({
          annotationId: target.id,
          pageNumber: target.pageIndex + 1,
          type: getAiAnnotationKind(target) ?? undefined,
          subType: target.type === "shape" ? target.shapeType : undefined,
          status: "rejected",
          reason:
            "This batch already contains another update for the same annotation.",
        });
        continue;
      }

      const patch: Partial<Annotation> = {};
      const updatedProperties: string[] = [];
      let reason: string | null = null;
      const setReason = (message: string) => {
        if (!reason) {
          reason = message;
        }
      };
      const markAppearanceUpdated = () => {
        if (target.type === "shape" || target.type === "ink") {
          patch.appearanceStreamContent = undefined;
        }
      };

      if (update.text !== undefined) {
        if (
          annotationSupportsTextUpdate(target) &&
          (target.text ?? "") !== update.text
        ) {
          patch.text = update.text;
          updatedProperties.push("text");
        }
      }

      if (update.rect) {
        if (!annotationSupportsRectTranslation(target)) {
          setReason("Target annotation has no editable geometry.");
        } else if (!target.rect) {
          setReason("Target annotation has no editable rect.");
        } else {
          const page = store.pages[target.pageIndex];
          if (!page) {
            setReason("Target page is out of range.");
          } else {
            const requestedX = update.rect.x ?? target.rect.x;
            const requestedY = update.rect.y ?? target.rect.y;
            const requestedWidth = update.rect.width ?? target.rect.width;
            const requestedHeight = update.rect.height ?? target.rect.height;
            if (!annotationSupportsRectResize(target)) {
              const dx = requestedX - target.rect.x;
              const dy = requestedY - target.rect.y;
              if (dx !== 0 || dy !== 0) {
                Object.assign(patch, getMovedAnnotationUpdates(target, dx, dy));
                if (dx !== 0) updatedProperties.push("rect.x");
                if (dy !== 0) updatedProperties.push("rect.y");
              }
            } else {
              const nextRect = clampAnnotationRectToPage(page, {
                x: requestedX,
                y: requestedY,
                width: requestedWidth,
                height: requestedHeight,
              });
              const changedRectProperties = (
                [
                  ["x", nextRect.x, target.rect.x],
                  ["y", nextRect.y, target.rect.y],
                  ["width", nextRect.width, target.rect.width],
                  ["height", nextRect.height, target.rect.height],
                ] as const
              ).flatMap(([key, nextValue, currentValue]) =>
                nextValue === currentValue ? [] : [`rect.${key}`],
              );
              if (changedRectProperties.length > 0) {
                patch.rect = nextRect;
                updatedProperties.push(...changedRectProperties);
                markAppearanceUpdated();
              }
            }
          }
        }
      }

      const style = update.style;
      if (style) {
        if (style.color !== undefined) {
          if (target.type !== "link" && (target.color ?? "") !== style.color) {
            patch.color = style.color;
            updatedProperties.push("color");
            markAppearanceUpdated();
          }
        }

        if (style.opacity !== undefined) {
          if (
            target.type !== "link" &&
            (target.opacity ?? 1) !== style.opacity
          ) {
            patch.opacity = style.opacity;
            updatedProperties.push("opacity");
            markAppearanceUpdated();
          }
        }

        if (style.backgroundColor !== undefined) {
          const nextBackgroundColor = normalizeTransparentFillColor(
            style.backgroundColor,
          );
          if (target.type === "freetext") {
            if ((target.backgroundColor ?? undefined) !== nextBackgroundColor) {
              patch.backgroundColor = nextBackgroundColor;
              updatedProperties.push("backgroundColor");
            }
          } else if (
            target.type === "shape" &&
            shapeSupportsFill(target.shapeType)
          ) {
            if ((target.backgroundColor ?? undefined) !== nextBackgroundColor) {
              patch.backgroundColor = nextBackgroundColor;
              updatedProperties.push("backgroundColor");
              markAppearanceUpdated();
            }
          }
        }

        if (style.backgroundOpacity !== undefined) {
          if (
            target.type === "shape" &&
            shapeSupportsFill(target.shapeType) &&
            (target.backgroundOpacity ?? target.opacity ?? 1) !==
              style.backgroundOpacity
          ) {
            patch.backgroundOpacity = style.backgroundOpacity;
            updatedProperties.push("backgroundOpacity");
            markAppearanceUpdated();
          }
        }

        if (style.borderColor !== undefined) {
          if (
            target.type === "freetext" &&
            (target.borderColor ?? "") !== style.borderColor
          ) {
            patch.borderColor = style.borderColor;
            updatedProperties.push("borderColor");
          }
        }

        if (style.borderWidth !== undefined) {
          if (
            target.type === "freetext" &&
            (target.borderWidth ?? 0) !== style.borderWidth
          ) {
            patch.borderWidth = style.borderWidth;
            updatedProperties.push("borderWidth");
          }
        }

        if (style.fontSize !== undefined) {
          if (
            target.type === "freetext" &&
            (target.size ?? 12) !== style.fontSize
          ) {
            patch.size = style.fontSize;
            updatedProperties.push("fontSize");
          }
        }

        if (style.fontFamily !== undefined) {
          if (
            target.type === "freetext" &&
            (target.fontFamily ?? "") !== style.fontFamily
          ) {
            patch.fontFamily = style.fontFamily;
            updatedProperties.push("fontFamily");
          }
        }

        if (style.lineHeight !== undefined) {
          if (
            target.type === "freetext" &&
            (target.lineHeight ?? 1) !== style.lineHeight
          ) {
            patch.lineHeight = style.lineHeight;
            updatedProperties.push("lineHeight");
          }
        }

        if (style.alignment !== undefined) {
          if (
            target.type === "freetext" &&
            target.alignment !== style.alignment
          ) {
            patch.alignment = style.alignment;
            updatedProperties.push("alignment");
          }
        }

        if (style.flatten !== undefined) {
          if (
            target.type === "freetext" &&
            (target.flatten ?? false) !== style.flatten
          ) {
            patch.flatten = style.flatten;
            updatedProperties.push("flatten");
          }
        }

        if (style.rotationDeg !== undefined) {
          if (
            target.type === "freetext" &&
            (target.rotationDeg ?? 0) !== style.rotationDeg
          ) {
            patch.rotationDeg = style.rotationDeg;
            updatedProperties.push("rotationDeg");
          }
        }

        if (style.thickness !== undefined) {
          if (
            (target.type === "shape" || target.type === "ink") &&
            (target.thickness ?? 0) !== style.thickness
          ) {
            patch.thickness = style.thickness;
            updatedProperties.push("thickness");
            markAppearanceUpdated();
          }
        }

        if (style.arrowSize !== undefined) {
          if (
            target.type === "shape" &&
            isOpenLineShapeType(target.shapeType) &&
            (target.arrowSize ??
              getDefaultArrowSize(target.thickness ?? style.thickness ?? 2)) !==
              style.arrowSize
          ) {
            patch.arrowSize = style.arrowSize;
            updatedProperties.push("arrowSize");
            markAppearanceUpdated();
          }
        }

        if (
          style.startArrowStyle !== undefined ||
          style.endArrowStyle !== undefined
        ) {
          if (
            target.type === "shape" &&
            isOpenLineShapeType(target.shapeType)
          ) {
            const currentArrowStyles = getShapeArrowStyles(target);
            const nextArrowStyles = {
              start: style.startArrowStyle ?? currentArrowStyles.start,
              end: style.endArrowStyle ?? currentArrowStyles.end,
            };
            const arrowStylePatch = getShapeArrowStyleUpdates(nextArrowStyles);
            const nextShapeType =
              nextArrowStyles.start || nextArrowStyles.end
                ? "arrow"
                : getShapeTypeWithoutArrow(target.shapePoints?.length ?? 2);
            if (target.shapeType !== nextShapeType) {
              patch.shapeType = nextShapeType;
              updatedProperties.push("shapeType");
            }
            if (
              target.shapeStartArrowStyle !==
              arrowStylePatch.shapeStartArrowStyle
            ) {
              patch.shapeStartArrowStyle = arrowStylePatch.shapeStartArrowStyle;
              updatedProperties.push("shapeStartArrowStyle");
            }
            if (
              target.shapeEndArrowStyle !== arrowStylePatch.shapeEndArrowStyle
            ) {
              patch.shapeEndArrowStyle = arrowStylePatch.shapeEndArrowStyle;
              updatedProperties.push("shapeEndArrowStyle");
            }
            if (target.shapeStartArrow !== arrowStylePatch.shapeStartArrow) {
              patch.shapeStartArrow = arrowStylePatch.shapeStartArrow;
              updatedProperties.push("shapeStartArrow");
            }
            if (target.shapeEndArrow !== arrowStylePatch.shapeEndArrow) {
              patch.shapeEndArrow = arrowStylePatch.shapeEndArrow;
              updatedProperties.push("shapeEndArrow");
            }
            if (
              updatedProperties.some((property) => property.startsWith("shape"))
            ) {
              markAppearanceUpdated();
            }
          }
        }

        if (style.cloudIntensity !== undefined) {
          if (
            target.type === "shape" &&
            (target.shapeType === "cloud" ||
              target.shapeType === "cloud_polygon") &&
            (target.cloudIntensity ?? 2) !== style.cloudIntensity
          ) {
            patch.cloudIntensity = style.cloudIntensity;
            updatedProperties.push("cloudIntensity");
            markAppearanceUpdated();
          }
        }

        if (style.cloudSpacing !== undefined) {
          if (
            target.type === "shape" &&
            (target.shapeType === "cloud" ||
              target.shapeType === "cloud_polygon") &&
            (target.cloudSpacing ?? 28) !== style.cloudSpacing
          ) {
            patch.cloudSpacing = style.cloudSpacing;
            updatedProperties.push("cloudSpacing");
            markAppearanceUpdated();
          }
        }
      }

      if (reason) {
        results.push({
          annotationId: target.id,
          pageNumber: target.pageIndex + 1,
          type: getAiAnnotationKind(target) ?? undefined,
          subType: target.type === "shape" ? target.shapeType : undefined,
          status: "rejected",
          reason,
        });
        continue;
      }

      if (updatedProperties.length === 0) {
        results.push({
          annotationId: target.id,
          pageNumber: target.pageIndex + 1,
          type: getAiAnnotationKind(target) ?? undefined,
          subType: target.type === "shape" ? target.shapeType : undefined,
          status: "unchanged",
          reason: "Requested properties already match the current annotation.",
        });
        continue;
      }

      reservedAnnotationIds.add(target.id);
      pending.push({
        annotationId: target.id,
        patch,
      });
      results.push({
        annotationId: target.id,
        pageNumber: target.pageIndex + 1,
        type: getAiAnnotationKind(target) ?? undefined,
        subType:
          target.type === "shape"
            ? ((patch.shapeType as Annotation["shapeType"]) ?? target.shapeType)
            : undefined,
        status: "updated",
        updatedProperties,
      });
    }

    if (pending.length > 0) {
      store.saveCheckpoint();
      for (const item of pending) {
        store.updateAnnotation(item.annotationId, item.patch);
      }
    }

    return {
      updatedCount: results.filter((item) => item.status === "updated").length,
      unchangedCount: results.filter((item) => item.status === "unchanged")
        .length,
      rejectedCount: results.filter((item) => item.status === "rejected")
        .length,
      updates: results,
    };
  };

  const createFreetextAnnotations = (optionsInput: {
    annotations: AiCreateFreetextAnnotationInput[];
  }): AiCreateAnnotationsResult => {
    const store = useEditorStore.getState();
    const freetextDefaults = store.freetextStyle || ANNOTATION_STYLES.freetext;
    const modelMeta = buildSelectedChatModelMeta(options.selectedChatModel);
    const createdAt = new Date().toISOString();
    const currentSessionId = options.activeSessionIdRef.current;
    const existingAnnotations = [...store.annotations];
    const batch: Annotation[] = [];
    const results: AiCreateAnnotationResultItem[] = [];
    let createdCount = 0;
    let skippedCount = 0;
    let rejectedCount = 0;

    for (const item of optionsInput.annotations) {
      const pageNumber =
        typeof item.pageNumber === "number" && Number.isFinite(item.pageNumber)
          ? Math.trunc(item.pageNumber)
          : Number.NaN;
      const pageIndex = pageNumber - 1;
      const page = store.pages[pageIndex];
      const text = typeof item.text === "string" ? item.text.trim() : "";
      const inputRect = normalizeAnnotationRectInput(item.rect);

      if (!Number.isFinite(pageNumber) || pageNumber < 1) {
        rejectedCount += 1;
        results.push({
          type: "freetext",
          status: "rejected",
          reason: "page_number is required.",
        });
        continue;
      }

      if (!page) {
        rejectedCount += 1;
        results.push({
          pageNumber,
          type: "freetext",
          status: "rejected",
          reason: "Page not found.",
        });
        continue;
      }

      if (!inputRect) {
        rejectedCount += 1;
        results.push({
          pageNumber,
          type: "freetext",
          status: "rejected",
          reason: "rect with finite x, y, width, and height is required.",
        });
        continue;
      }

      if (!text) {
        rejectedCount += 1;
        results.push({
          pageNumber,
          type: "freetext",
          status: "rejected",
          reason: "text is required.",
        });
        continue;
      }

      const rect = clampAnnotationRectToPage(page, inputRect);
      const candidate: Annotation = {
        id: `ai_freetext_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        pageIndex,
        type: "freetext",
        rect,
        text,
        author: options.selectedChatModelAuthor,
        color: item.style?.color ?? freetextDefaults.color,
        opacity: item.style?.opacity,
        backgroundColor: normalizeTransparentFillColor(
          item.style?.backgroundColor,
        ),
        borderColor: item.style?.borderColor ?? freetextDefaults.borderColor,
        borderWidth: item.style?.borderWidth ?? freetextDefaults.borderWidth,
        size: item.style?.fontSize ?? freetextDefaults.size,
        fontFamily: item.style?.fontFamily,
        lineHeight: item.style?.lineHeight,
        alignment: item.style?.alignment,
        flatten: item.style?.flatten,
        rotationDeg: item.style?.rotationDeg,
        meta: {
          kind: "ai_chat_freetext",
          createdAt,
          sessionId: currentSessionId,
          ...modelMeta,
        },
      };

      if (
        existingAnnotations.some((annotation) =>
          isPotentialDuplicateAiFreetextAnnotation(
            annotation,
            candidate,
            currentSessionId,
          ),
        )
      ) {
        skippedCount += 1;
        results.push({
          pageNumber,
          type: "freetext",
          text,
          rect: roundAiRect(rect),
          status: "skipped",
          reason:
            "A matching AI free text annotation already exists on this page.",
        });
        continue;
      }
      batch.push(candidate);
      existingAnnotations.push(candidate);
      createdCount += 1;
      results.push({
        annotationId: candidate.id,
        pageNumber,
        type: "freetext",
        text,
        rect: roundAiRect(rect),
        status: "created",
      });
    }

    if (batch.length > 0) {
      store.addAnnotations(batch, { select: false });
    }

    return {
      createdCount,
      skippedCount,
      rejectedCount,
      annotations: results,
    };
  };

  const createShapeAnnotations = (optionsInput: {
    annotations: AiCreateShapeAnnotationInput[];
  }): AiCreateAnnotationsResult => {
    const store = useEditorStore.getState();
    const shapeDefaults = store.shapeStyle || ANNOTATION_STYLES.shape;
    const modelMeta = buildSelectedChatModelMeta(options.selectedChatModel);
    const createdAt = new Date().toISOString();
    const currentSessionId = options.activeSessionIdRef.current;
    const existingAnnotations = [...store.annotations];
    const batch: Annotation[] = [];
    const results: AiCreateAnnotationResultItem[] = [];
    let createdCount = 0;
    let skippedCount = 0;
    let rejectedCount = 0;

    for (const item of optionsInput.annotations) {
      const pageNumber =
        typeof item.pageNumber === "number" && Number.isFinite(item.pageNumber)
          ? Math.trunc(item.pageNumber)
          : Number.NaN;
      const pageIndex = pageNumber - 1;
      const page = store.pages[pageIndex];
      const shapeType = item.shapeType;
      const annotationText = item.annotationText?.trim() || undefined;
      const inputRect = normalizeAnnotationRectInput(item.rect);
      const inputPoints = normalizeAnnotationPointInputs(item.points);

      if (!Number.isFinite(pageNumber) || pageNumber < 1) {
        rejectedCount += 1;
        results.push({
          type: "shape",
          status: "rejected",
          reason: "page_number is required.",
        });
        continue;
      }

      if (!shapeType) {
        rejectedCount += 1;
        results.push({
          pageNumber,
          type: "shape",
          status: "rejected",
          reason: "shape_type is required.",
        });
        continue;
      }

      if (!page) {
        rejectedCount += 1;
        results.push({
          pageNumber,
          type: "shape",
          subType: shapeType,
          status: "rejected",
          reason: "Page not found.",
        });
        continue;
      }

      let rect: Annotation["rect"] | undefined;
      let shapePoints: Annotation["shapePoints"] | undefined;

      if (
        shapeType === "square" ||
        shapeType === "circle" ||
        shapeType === "cloud"
      ) {
        rect = inputRect
          ? clampAnnotationRectToPage(page, inputRect)
          : undefined;
      } else if (inputPoints.length > 0) {
        const normalized = getRectAndNormalizedShapePoints(
          inputPoints.map((point) => clampPointToPage(page, point)),
        );
        if (!normalized) {
          rejectedCount += 1;
          results.push({
            pageNumber,
            type: "shape",
            subType: shapeType,
            status: "rejected",
            reason: "Unable to derive shape geometry from points.",
          });
          continue;
        }
        rect = normalized.rect;
        shapePoints = normalized.shapePoints;
      } else if (inputRect) {
        rect = clampAnnotationRectToPage(page, inputRect);
      }

      if (!rect) {
        rejectedCount += 1;
        results.push({
          pageNumber,
          type: "shape",
          subType: shapeType,
          status: "rejected",
          reason: "Shape geometry is required.",
        });
        continue;
      }

      const backgroundColor = shapeSupportsFill(shapeType)
        ? normalizeTransparentFillColor(
            item.style?.backgroundColor ?? shapeDefaults.backgroundColor,
          )
        : undefined;
      const arrowStyleUpdates = getShapeArrowStyleUpdates({
        start: item.style?.startArrowStyle ?? null,
        end:
          item.style?.endArrowStyle ??
          (shapeType === "arrow" ? "closed_arrow" : null),
      });
      const candidate: Annotation = {
        id: `ai_shape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        pageIndex,
        type: "shape",
        shapeType,
        rect,
        ...(shapePoints?.length ? { shapePoints } : null),
        author: options.selectedChatModelAuthor,
        text: annotationText,
        color: item.style?.color ?? shapeDefaults.color,
        thickness: item.style?.thickness ?? shapeDefaults.thickness,
        opacity: item.style?.opacity ?? shapeDefaults.opacity,
        backgroundColor,
        backgroundOpacity:
          shapeSupportsFill(shapeType) && backgroundColor
            ? (item.style?.backgroundOpacity ??
              item.style?.opacity ??
              shapeDefaults.backgroundOpacity)
            : undefined,
        arrowSize: isOpenLineShapeType(shapeType)
          ? (item.style?.arrowSize ?? shapeDefaults.arrowSize)
          : undefined,
        cloudIntensity:
          shapeType === "cloud" || shapeType === "cloud_polygon"
            ? (item.style?.cloudIntensity ?? shapeDefaults.cloudIntensity)
            : undefined,
        cloudSpacing:
          shapeType === "cloud" || shapeType === "cloud_polygon"
            ? (item.style?.cloudSpacing ?? shapeDefaults.cloudSpacing)
            : undefined,
        ...arrowStyleUpdates,
        meta: {
          kind: "ai_chat_shape",
          createdAt,
          sessionId: currentSessionId,
          ...modelMeta,
        },
      };

      if (
        existingAnnotations.some((annotation) =>
          isPotentialDuplicateAiShapeAnnotation(
            annotation,
            candidate,
            currentSessionId,
          ),
        )
      ) {
        skippedCount += 1;
        results.push({
          pageNumber,
          type: "shape",
          subType: shapeType,
          text: annotationText,
          rect: roundAiRect(rect),
          status: "skipped",
          reason: "A matching AI shape annotation already exists on this page.",
        });
        continue;
      }

      batch.push(candidate);
      existingAnnotations.push(candidate);
      createdCount += 1;
      results.push({
        annotationId: candidate.id,
        pageNumber,
        type: "shape",
        subType: shapeType,
        text: annotationText,
        rect: roundAiRect(rect),
        status: "created",
      });
    }

    if (batch.length > 0) {
      store.addAnnotations(batch, { select: false });
    }

    return {
      createdCount,
      skippedCount,
      rejectedCount,
      annotations: results,
    };
  };

  const createSearchHighlightAnnotations = async (optionsInput: {
    resultIds?: string[];
    annotationText?: string;
    selectionAnchors?: Array<{
      attachmentIndex: number;
      startAnchor: string;
      endInclusiveAnchor: string;
      annotationText?: string;
    }>;
    documentAnchors?: Array<{
      startAnchor: string;
      endInclusiveAnchor: string;
      pageHint?: number;
      annotationText?: string;
    }>;
  }): Promise<AiHighlightAnnotationCreateResult> => {
    const store = useEditorStore.getState();
    const existingResultIds = new Set(
      store.annotations.flatMap((annotation) => {
        if (annotation.meta?.kind !== "ai_search_highlight") return [];
        const resultId = annotation.meta.resultId;
        return typeof resultId === "string" ? [resultId] : [];
      }),
    );
    const existingSelectionKeys = new Set(
      store.annotations.flatMap((annotation) => {
        if (annotation.meta?.kind !== "ai_selection_highlight") return [];
        const selectionKey = annotation.meta.selectionKey;
        return typeof selectionKey === "string" ? [selectionKey] : [];
      }),
    );
    const existingDocumentAnchorKeys = new Set(
      store.annotations.flatMap((annotation) => {
        if (annotation.meta?.kind !== "ai_document_anchor_highlight") return [];
        const documentAnchorKey = annotation.meta.documentAnchorKey;
        return typeof documentAnchorKey === "string" ? [documentAnchorKey] : [];
      }),
    );
    const createdAt = new Date().toISOString();
    const style = store.highlightStyle || {
      color: ANNOTATION_STYLES.highlight.color,
      thickness: ANNOTATION_STYLES.highlight.thickness,
      opacity: ANNOTATION_STYLES.highlight.opacity,
    };
    const requestedResultIds = optionsInput.resultIds ?? [];
    const annotationText = optionsInput.annotationText?.trim() || undefined;
    const requestedSelectionAnchors = optionsInput.selectionAnchors ?? [];
    const requestedDocumentAnchors = optionsInput.documentAnchors ?? [];

    const batch: Annotation[] = [];
    const summaries: AiHighlightAnnotationCreateResult["annotations"] = [];
    const missingResultIds: string[] = [];
    const missingSelectionAnchors: NonNullable<
      AiHighlightAnnotationCreateResult["missingSelectionAnchors"]
    > = [];
    const missingDocumentAnchors: NonNullable<
      AiHighlightAnnotationCreateResult["missingDocumentAnchors"]
    > = [];
    let missingCount = 0;
    let skippedExistingCount = 0;
    const modelMeta = options.selectedChatModel
      ? {
          providerId: options.selectedChatModel.providerId,
          providerLabel: options.selectedChatModel.providerLabel,
          modelId: options.selectedChatModel.modelId,
          modelLabel: options.selectedChatModel.modelLabel,
        }
      : undefined;
    const pageTextContentCache = new Map<
      number,
      Awaited<ReturnType<typeof workerService.getTextContent>>
    >();
    const serializedPageTextCache = new Map<
      number,
      ReturnType<typeof serializePageTextContent> | null
    >();
    const latestSelectionAttachments = (
      options.sessionsRef.current.get(options.activeSessionIdRef.current)
        ?.timeline ?? []
    )
      .flatMap((item) =>
        item.kind === "message" && item.role === "user"
          ? (item.attachments ?? [])
          : [],
      )
      .filter(
        (attachment): attachment is AiChatSelectionAttachment =>
          attachment.kind === "workspace_selection",
      );
    const selectionAttachmentByIndex = new Map(
      latestSelectionAttachments.map((attachment, index) => [
        index + 1,
        attachment,
      ]),
    );

    const loadPageTextContent = async (pageIndex: number) => {
      if (pageTextContentCache.has(pageIndex)) {
        return pageTextContentCache.get(pageIndex) ?? null;
      }
      const textContent = await workerService.getTextContent({ pageIndex });
      pageTextContentCache.set(pageIndex, textContent);
      return textContent;
    };

    const loadSerializedPageText = async (pageIndex: number) => {
      if (serializedPageTextCache.has(pageIndex)) {
        return serializedPageTextCache.get(pageIndex) ?? null;
      }

      const textContent = await loadPageTextContent(pageIndex);
      if (!textContent) {
        serializedPageTextCache.set(pageIndex, null);
        return null;
      }

      const serialized = serializePageTextContent(
        textContent,
        store.pages[pageIndex],
      );
      serializedPageTextCache.set(pageIndex, serialized);
      return serialized;
    };

    const getRenderedRangeRects = (
      pageIndex: number,
      startOffset: number,
      endOffset: number,
    ) => {
      if (typeof document === "undefined") return null;

      const pageElement = document.getElementById(
        `page-${pageIndex}`,
      ) as HTMLElement | null;
      const textLayer = pageElement?.querySelector?.(
        ".textLayer",
      ) as HTMLElement | null;
      if (!pageElement || !textLayer) return null;

      const clientRects = getPdfSearchRangeClientRects(
        textLayer,
        startOffset,
        endOffset,
      );
      if (clientRects.length === 0) return null;

      const pageRect = pageElement.getBoundingClientRect();
      const scale = Math.max(store.scale || 0, 0.0001);
      const rects = clientRects
        .map((rect) => ({
          x: (rect.left - pageRect.left) / scale,
          y: (rect.top - pageRect.top) / scale,
          width: rect.width / scale,
          height: rect.height / scale,
        }))
        .filter((rect) => rect.width > 0.5 && rect.height > 0.5);
      if (rects.length === 0) return null;

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      for (const rect of rects) {
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

      return {
        rect: {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        },
        rects,
      };
    };

    const resolveAbsoluteRangeGeometry = async (
      pageIndex: number,
      startOffset: number,
      endOffset: number,
    ) => {
      const renderedRects = getRenderedRangeRects(
        pageIndex,
        startOffset,
        endOffset,
      );
      if (renderedRects) {
        return {
          rect: { ...renderedRects.rect },
          rects: renderedRects.rects.map((item) => ({ ...item })),
        };
      }

      const page = store.pages[pageIndex];
      if (!page) return null;
      const textContent = await loadPageTextContent(pageIndex);
      if (!textContent) return null;

      const geometry = getPdfSearchRangeGeometry(
        textContent,
        page,
        startOffset,
        endOffset,
      );
      if (!geometry) return null;

      return {
        rect: { ...geometry.rect },
        rects:
          geometry.rects.length > 0
            ? geometry.rects.map((item) => ({ ...item }))
            : [{ ...geometry.rect }],
      };
    };

    for (const resultId of requestedResultIds) {
      const stored = options.searchResultsRef.current.get(resultId);
      if (!stored) {
        missingCount += 1;
        missingResultIds.push(resultId);
        continue;
      }
      if (existingResultIds.has(resultId)) {
        skippedExistingCount += 1;
        continue;
      }

      const renderedRects = getRenderedRangeRects(
        stored.result.pageIndex,
        stored.result.startOffset,
        stored.result.endOffset,
      );
      const rect = renderedRects
        ? { ...renderedRects.rect }
        : { ...stored.result.rect };
      const annotationId = `ai_highlight_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      batch.push({
        id: annotationId,
        pageIndex: stored.result.pageIndex,
        type: "highlight",
        rect,
        rects:
          renderedRects?.rects ??
          (Array.isArray(stored.result.rects) && stored.result.rects.length > 0
            ? stored.result.rects.map((item) => ({ ...item }))
            : [rect]),
        text: annotationText ?? stored.result.matchText,
        highlightedText: stored.result.matchText,
        author: options.selectedChatModelAuthor,
        color: style.color,
        opacity: style.opacity,
        meta: {
          kind: "ai_search_highlight",
          resultId,
          query: stored.query,
          createdAt,
          sessionId: options.activeSessionIdRef.current,
          ...modelMeta,
        },
      });
      summaries.push({
        id: annotationId,
        source: "result",
        resultId,
        pageNumber: stored.result.pageIndex + 1,
        matchText: stored.result.matchText,
        annotationText,
      });
      existingResultIds.add(resultId);
    }

    for (const requestedSelectionAnchor of requestedSelectionAnchors) {
      const attachment = selectionAttachmentByIndex.get(
        requestedSelectionAnchor.attachmentIndex,
      );
      const effectiveAnnotationText =
        requestedSelectionAnchor.annotationText?.trim() || annotationText;
      if (!attachment) {
        missingCount += 1;
        missingSelectionAnchors.push({
          attachmentIndex: requestedSelectionAnchor.attachmentIndex,
          startAnchor: requestedSelectionAnchor.startAnchor,
          endInclusiveAnchor: requestedSelectionAnchor.endInclusiveAnchor,
          ...(effectiveAnnotationText
            ? { annotationText: effectiveAnnotationText }
            : null),
        });
        continue;
      }

      const resolvedAnchors = resolveSelectionAttachmentAnchorOffsets(
        attachment,
        requestedSelectionAnchor.startAnchor,
        requestedSelectionAnchor.endInclusiveAnchor,
      );
      if (!resolvedAnchors) {
        missingCount += 1;
        missingSelectionAnchors.push({
          attachmentIndex: requestedSelectionAnchor.attachmentIndex,
          startAnchor: requestedSelectionAnchor.startAnchor,
          endInclusiveAnchor: requestedSelectionAnchor.endInclusiveAnchor,
          ...(effectiveAnnotationText
            ? { annotationText: effectiveAnnotationText }
            : null),
        });
        continue;
      }

      const { localStart, localEnd, startAnchor, endInclusiveAnchor } =
        resolvedAnchors;
      const absoluteStart = attachment.startOffset + localStart;
      const absoluteEnd = attachment.startOffset + localEnd;
      const selectionKey = [
        "attachment",
        getSelectionAttachmentKey(attachment),
        "anchor",
        requestedSelectionAnchor.attachmentIndex,
        startAnchor,
        endInclusiveAnchor,
        localStart,
        localEnd,
      ].join(":");
      if (existingSelectionKeys.has(selectionKey)) {
        skippedExistingCount += 1;
        continue;
      }

      const geometry = await resolveAbsoluteRangeGeometry(
        attachment.pageIndex,
        absoluteStart,
        absoluteEnd,
      );
      if (!geometry) {
        missingCount += 1;
        missingSelectionAnchors.push({
          attachmentIndex: requestedSelectionAnchor.attachmentIndex,
          startAnchor: requestedSelectionAnchor.startAnchor,
          endInclusiveAnchor: requestedSelectionAnchor.endInclusiveAnchor,
          ...(effectiveAnnotationText
            ? { annotationText: effectiveAnnotationText }
            : null),
        });
        continue;
      }

      const annotationId = `ai_highlight_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const matchText = normalizeAnnotationText(
        attachment.text.slice(localStart, localEnd),
      );

      batch.push({
        id: annotationId,
        pageIndex: attachment.pageIndex,
        type: "highlight",
        rect: geometry.rect,
        rects: geometry.rects,
        text: effectiveAnnotationText ?? matchText,
        highlightedText: matchText,
        author: options.selectedChatModelAuthor,
        color: style.color,
        opacity: style.opacity,
        meta: {
          kind: "ai_selection_highlight",
          selectionKey,
          attachmentIndex: requestedSelectionAnchor.attachmentIndex,
          startAnchor,
          endInclusiveAnchor,
          createdAt,
          sessionId: options.activeSessionIdRef.current,
          ...modelMeta,
        },
      });
      summaries.push({
        id: annotationId,
        source: "selection_attachment",
        attachmentIndex: requestedSelectionAnchor.attachmentIndex,
        pageNumber: attachment.pageIndex + 1,
        matchText,
        startAnchor,
        endInclusiveAnchor,
        annotationText: effectiveAnnotationText,
      });
      existingSelectionKeys.add(selectionKey);
    }

    for (const requestedDocumentAnchor of requestedDocumentAnchors) {
      const effectiveAnnotationText =
        requestedDocumentAnchor.annotationText?.trim() || annotationText;
      const candidatePageIndexes = buildDocumentAnchorCandidatePageIndexes(
        store.pages.length,
        requestedDocumentAnchor.pageHint,
      );
      const hintedPageIndex =
        typeof requestedDocumentAnchor.pageHint === "number" &&
        Number.isFinite(requestedDocumentAnchor.pageHint) &&
        requestedDocumentAnchor.pageHint >= 1 &&
        requestedDocumentAnchor.pageHint <= store.pages.length
          ? Math.trunc(requestedDocumentAnchor.pageHint) - 1
          : null;

      let bestCandidate: {
        pageIndex: number;
        localStart: number;
        localEnd: number;
        startAnchor: string;
        endInclusiveAnchor: string;
        specificity: number;
        variantRankSum: number;
        matchSourceRank: number;
        pageDistance: number;
      } | null = null;
      const isBetterCandidate = (
        candidate: NonNullable<typeof bestCandidate>,
        current: NonNullable<typeof bestCandidate> | null,
      ) => {
        if (!current) return true;
        if (candidate.specificity !== current.specificity) {
          return candidate.specificity > current.specificity;
        }
        if (candidate.variantRankSum !== current.variantRankSum) {
          return candidate.variantRankSum < current.variantRankSum;
        }
        if (candidate.matchSourceRank !== current.matchSourceRank) {
          return candidate.matchSourceRank < current.matchSourceRank;
        }
        if (candidate.pageDistance !== current.pageDistance) {
          return candidate.pageDistance < current.pageDistance;
        }

        const candidateSpan = candidate.localEnd - candidate.localStart;
        const currentSpan = current.localEnd - current.localStart;
        if (candidateSpan !== currentSpan) {
          return candidateSpan < currentSpan;
        }

        return candidate.pageIndex < current.pageIndex;
      };

      for (const pageIndex of candidatePageIndexes) {
        const serializedPageText = await loadSerializedPageText(pageIndex);
        if (!serializedPageText) continue;

        let resolvedAnchors = resolveTextAnchorOffsets(
          serializedPageText.readableText,
          requestedDocumentAnchor.startAnchor,
          requestedDocumentAnchor.endInclusiveAnchor,
        );
        let localStart = -1;
        let localEnd = -1;
        let matchSourceRank = 0;

        if (resolvedAnchors) {
          const mappedRange = mapReadableRangeToFlatRange(
            serializedPageText.readableIndexToFlatIndex,
            resolvedAnchors.localStart,
            resolvedAnchors.localEnd,
          );
          if (mappedRange) {
            localStart = mappedRange.flatStart;
            localEnd = mappedRange.flatEnd;
          } else {
            resolvedAnchors = null;
          }
        }

        if (!resolvedAnchors) {
          resolvedAnchors = resolveTextAnchorOffsets(
            serializedPageText.flatText,
            requestedDocumentAnchor.startAnchor,
            requestedDocumentAnchor.endInclusiveAnchor,
          );
          if (!resolvedAnchors) continue;
          localStart = resolvedAnchors.localStart;
          localEnd = resolvedAnchors.localEnd;
          matchSourceRank = 1;
        }

        const pageDistance =
          hintedPageIndex === null ? 0 : Math.abs(pageIndex - hintedPageIndex);
        const candidate = {
          pageIndex,
          localStart,
          localEnd,
          startAnchor: resolvedAnchors.startAnchor,
          endInclusiveAnchor: resolvedAnchors.endInclusiveAnchor,
          specificity: resolvedAnchors.specificity,
          variantRankSum: resolvedAnchors.variantRankSum,
          matchSourceRank,
          pageDistance,
        };

        if (isBetterCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }

        if (
          candidate.variantRankSum === 0 &&
          candidate.matchSourceRank === 0 &&
          (hintedPageIndex === null || candidate.pageIndex === hintedPageIndex)
        ) {
          break;
        }
      }

      if (!bestCandidate) {
        missingCount += 1;
        missingDocumentAnchors.push({
          startAnchor: requestedDocumentAnchor.startAnchor,
          endInclusiveAnchor: requestedDocumentAnchor.endInclusiveAnchor,
          ...(typeof requestedDocumentAnchor.pageHint === "number"
            ? { pageHint: requestedDocumentAnchor.pageHint }
            : null),
          ...(effectiveAnnotationText
            ? { annotationText: effectiveAnnotationText }
            : null),
        });
        continue;
      }

      const documentAnchorKey = [
        "document",
        bestCandidate.pageIndex,
        requestedDocumentAnchor.pageHint ?? "",
        bestCandidate.startAnchor,
        bestCandidate.endInclusiveAnchor,
        bestCandidate.localStart,
        bestCandidate.localEnd,
      ].join(":");
      if (existingDocumentAnchorKeys.has(documentAnchorKey)) {
        skippedExistingCount += 1;
        continue;
      }

      const geometry = await resolveAbsoluteRangeGeometry(
        bestCandidate.pageIndex,
        bestCandidate.localStart,
        bestCandidate.localEnd,
      );
      if (!geometry) {
        missingCount += 1;
        missingDocumentAnchors.push({
          startAnchor: requestedDocumentAnchor.startAnchor,
          endInclusiveAnchor: requestedDocumentAnchor.endInclusiveAnchor,
          ...(typeof requestedDocumentAnchor.pageHint === "number"
            ? { pageHint: requestedDocumentAnchor.pageHint }
            : null),
          ...(effectiveAnnotationText
            ? { annotationText: effectiveAnnotationText }
            : null),
        });
        continue;
      }

      const serializedPageText = await loadSerializedPageText(
        bestCandidate.pageIndex,
      );
      const pageText = serializedPageText?.flatText ?? "";
      const matchText = normalizeAnnotationText(
        pageText.slice(bestCandidate.localStart, bestCandidate.localEnd),
      );
      const annotationId = `ai_highlight_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      batch.push({
        id: annotationId,
        pageIndex: bestCandidate.pageIndex,
        type: "highlight",
        rect: geometry.rect,
        rects: geometry.rects,
        text: effectiveAnnotationText ?? matchText,
        highlightedText: matchText,
        author: options.selectedChatModelAuthor,
        color: style.color,
        opacity: style.opacity,
        meta: {
          kind: "ai_document_anchor_highlight",
          documentAnchorKey,
          startAnchor: bestCandidate.startAnchor,
          endInclusiveAnchor: bestCandidate.endInclusiveAnchor,
          pageHint: requestedDocumentAnchor.pageHint,
          createdAt,
          sessionId: options.activeSessionIdRef.current,
          ...modelMeta,
        },
      });
      summaries.push({
        id: annotationId,
        source: "document_anchor",
        pageNumber: bestCandidate.pageIndex + 1,
        matchText,
        startAnchor: bestCandidate.startAnchor,
        endInclusiveAnchor: bestCandidate.endInclusiveAnchor,
        annotationText: effectiveAnnotationText,
      });
      existingDocumentAnchorKeys.add(documentAnchorKey);
    }

    if (batch.length > 0) {
      store.addAnnotations(batch, { select: false });
    }

    clearActiveHighlightedResultIds();

    return {
      requestedCount:
        requestedResultIds.length +
        requestedSelectionAnchors.length +
        requestedDocumentAnchors.length,
      createdCount: batch.length,
      skippedExistingCount,
      missingCount,
      annotations: summaries,
      ...(missingResultIds.length > 0 ? { missingResultIds } : null),
      ...(missingSelectionAnchors.length > 0
        ? { missingSelectionAnchors }
        : null),
      ...(missingDocumentAnchors.length > 0
        ? { missingDocumentAnchors }
        : null),
    };
  };

  const deleteAnnotations = (optionsInput: {
    annotationIds: string[];
  }): AiAnnotationDeleteBatchResult => {
    const currentStore = useEditorStore.getState();
    const requestedAnnotationIds = Array.from(
      new Set(
        optionsInput.annotationIds
          .map((annotationId) => annotationId.trim())
          .filter(Boolean),
      ),
    );

    const deletions: AiAnnotationDeleteBatchResult["deletions"] = [];
    const annotationIdsToDelete = new Set<string>();
    let deletedCount = 0;
    let rejectedCount = 0;
    let deletedAiHighlightCount = 0;

    for (const annotationId of requestedAnnotationIds) {
      const annotation = currentStore.annotations.find(
        (item) => item.id === annotationId,
      );
      if (!annotation) {
        rejectedCount += 1;
        deletions.push({
          ok: false,
          annotationId,
          status: "rejected",
          reason: "Annotation not found.",
        });
        continue;
      }

      const type = getAiAnnotationKind(annotation);
      annotationIdsToDelete.add(annotation.id);
      deletedCount += 1;
      if (
        annotation.meta?.kind === "ai_search_highlight" ||
        annotation.meta?.kind === "ai_selection_highlight" ||
        annotation.meta?.kind === "ai_document_anchor_highlight"
      ) {
        deletedAiHighlightCount += 1;
      }
      deletions.push({
        ok: true,
        annotationId: annotation.id,
        pageNumber: annotation.pageIndex + 1,
        type: type ?? undefined,
        subType: annotation.type === "shape" ? annotation.shapeType : undefined,
        highlightedText: annotation.highlightedText?.trim() || undefined,
        text: annotation.text?.trim() || undefined,
        status: "deleted",
      });
    }

    if (annotationIdsToDelete.size > 0) {
      currentStore.saveCheckpoint();
      currentStore.setState((state) => ({
        annotations: state.annotations.filter(
          (annotation) => !annotationIdsToDelete.has(annotation.id),
        ),
        selectedId:
          state.selectedId && annotationIdsToDelete.has(state.selectedId)
            ? null
            : state.selectedId,
        isDirty: true,
      }));
    }

    if (deletedAiHighlightCount > 0) {
      clearActiveHighlightedResultIds();
    }

    return {
      deletedCount,
      rejectedCount,
      deletions,
    };
  };

  const clearSearchHighlights = () => {
    const store = useEditorStore.getState();
    const aiHighlightIds = store.annotations
      .filter(
        (annotation) =>
          annotation.meta?.kind === "ai_search_highlight" ||
          annotation.meta?.kind === "ai_selection_highlight" ||
          annotation.meta?.kind === "ai_document_anchor_highlight",
      )
      .map((annotation) => annotation.id);

    clearActiveHighlightedResultIds();

    if (aiHighlightIds.length === 0) {
      return { clearedCount: 0 };
    }

    const aiHighlightIdSet = new Set(aiHighlightIds);
    store.saveCheckpoint();
    store.setState((state) => ({
      annotations: state.annotations.filter(
        (annotation) => !aiHighlightIdSet.has(annotation.id),
      ),
      selectedId:
        state.selectedId && aiHighlightIdSet.has(state.selectedId)
          ? null
          : state.selectedId,
      isDirty: true,
    }));

    return { clearedCount: aiHighlightIds.length };
  };

  const navigatePage = (pageIndex: number) => {
    appEventBus.emit("workspace:navigatePage", {
      pageIndex,
      behavior: "smooth",
    });
  };

  const focusSearchResult = (result: PDFSearchResult) => {
    appEventBus.emit("workspace:focusSearchResult", {
      pageIndex: result.pageIndex,
      rect: result.rect,
      behavior: "smooth",
    });
  };

  return {
    formToolsEnabled: options.formToolsEnabled,
    detectFormFieldsEnabled: options.detectFormFieldsEnabled,
    getDocumentPageAssetSummary,
    rememberSearchResults,
    updateAnnotationText,
    updateAnnotationTexts,
    updateAnnotations,
    createFreetextAnnotations,
    createShapeAnnotations,
    listFormFields,
    fillFormFields,
    updateFormFields,
    detectFormFields,
    createFormFields,
    focusControl,
    getStoredSearchResult,
    setActiveHighlightedResultIds,
    clearActiveHighlightedResultIds,
    listAnnotations,
    createSearchHighlightAnnotations,
    deleteAnnotations,
    clearSearchHighlights,
    navigatePage,
    focusSearchResult,
  };
};

export type AiInteractionToolContext = ReturnType<
  typeof createAiChatToolContext
>;
