import type { MutableRefObject } from "react";

import { appEventBus } from "@/lib/eventBus";
import { ANNOTATION_STYLES } from "@/constants";
import {
  ANNOTATION_LIST_TYPES,
  filterAnnotationsForList,
  getAnnotationListType,
  sortAnnotationsForList,
  type AnnotationListType,
} from "@/lib/annotationList";
import { getPdfSearchRangeGeometry } from "@/lib/pdfSearch";
import { useEditorStore } from "@/store/useEditorStore";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { getPdfSearchRangeClientRects } from "@/components/workspace/lib/pdfSearchHighlights";
import {
  FieldType,
  type Annotation,
  type FormField,
  type PDFSearchResult,
} from "@/types";
import type {
  AiAnnotationKind,
  AiAnnotationListResult,
  AiChatSelectionAttachment,
  AiFormFieldFillRequest,
  AiFormFieldFillResult,
  AiFormFieldFillResultItem,
  AiFormFieldKind,
  AiFormFieldListResult,
  AiFormFieldSummary,
  AiHighlightAnnotationCreateResult,
  AiSearchResultSummary,
  AiStoredSearchResult,
} from "@/services/ai/chat/types";
import type { AiChatSessionData } from "@/hooks/useAiChatController/sessionPersistence";

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

export const summarizeFormField = (field: FormField): AiFormFieldSummary => {
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

const truncateAnnotationText = (value: string, maxChars = 600) => {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

export const createAiChatToolContext = (options: {
  searchResultsRef: MutableRefObject<Map<string, AiStoredSearchResult>>;
  searchSeqRef: MutableRefObject<number>;
  sessionsRef: MutableRefObject<Map<string, AiChatSessionData>>;
  activeSessionIdRef: MutableRefObject<string>;
  setHighlightedResultIds: (ids: string[]) => void;
  selectedChatModel?: SelectedChatModelMeta;
  selectedChatModelAuthor: string;
}) => {
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
      };
    });
  };

  const listFormFields = (optionsInput: {
    pageNumbers?: number[];
    query?: string;
    onlyEmpty?: boolean;
    includeReadOnly?: boolean;
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
      .map(summarizeFormField)
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

  const focusField = (id: string) => {
    const field = useEditorStore
      .getState()
      .fields.find((item) => item.id === id);
    if (!field) return null;

    useEditorStore.getState().selectControl(id);
    appEventBus.emit("workspace:focusControl", {
      id,
      behavior: "smooth",
    });
    return summarizeFormField(field);
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
    const annotations = sorted.slice(0, limit).flatMap((annotation) => {
      const type = getAiAnnotationKind(annotation);
      if (!type) return [];

      return [
        {
          id: annotation.id,
          pageNumber: annotation.pageIndex + 1,
          type,
          text: (annotation.text || "").trim() || undefined,
          author: (annotation.author || "").trim() || undefined,
          color: annotation.color,
          updatedAt: annotation.updatedAt,
          rect: annotation.rect,
          metaKind:
            typeof annotation.meta?.kind === "string"
              ? annotation.meta.kind
              : undefined,
        },
      ];
    });

    return {
      total: sorted.length,
      returned: annotations.length,
      truncated: annotations.length < sorted.length,
      annotations,
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
      Awaited<ReturnType<typeof pdfWorkerService.getTextContent>>
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
      const textContent = await pdfWorkerService.getTextContent({ pageIndex });
      pageTextContentCache.set(pageIndex, textContent);
      return textContent;
    };

    const getPageSearchText = (
      textContent: NonNullable<
        Awaited<ReturnType<typeof pdfWorkerService.getTextContent>>
      >,
    ) =>
      textContent.items
        .flatMap((item) =>
          "str" in item && typeof item.str === "string" ? [item.str] : [],
        )
        .join("");

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
      const matchText = truncateAnnotationText(
        attachment.text.slice(localStart, localEnd),
      );

      batch.push({
        id: annotationId,
        pageIndex: attachment.pageIndex,
        type: "highlight",
        rect: geometry.rect,
        rects: geometry.rects,
        text: effectiveAnnotationText ?? matchText,
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
        pageDistance: number;
      } | null = null;

      for (const pageIndex of candidatePageIndexes) {
        const textContent = await loadPageTextContent(pageIndex);
        if (!textContent) continue;

        const pageText = getPageSearchText(textContent);
        if (!pageText) continue;

        const resolvedAnchors = resolveTextAnchorOffsets(
          pageText,
          requestedDocumentAnchor.startAnchor,
          requestedDocumentAnchor.endInclusiveAnchor,
        );
        if (!resolvedAnchors) continue;

        const pageDistance =
          hintedPageIndex === null ? 0 : Math.abs(pageIndex - hintedPageIndex);
        const candidate = {
          pageIndex,
          localStart: resolvedAnchors.localStart,
          localEnd: resolvedAnchors.localEnd,
          startAnchor: resolvedAnchors.startAnchor,
          endInclusiveAnchor: resolvedAnchors.endInclusiveAnchor,
          specificity: resolvedAnchors.specificity,
          variantRankSum: resolvedAnchors.variantRankSum,
          pageDistance,
        };

        if (
          !bestCandidate ||
          candidate.specificity > bestCandidate.specificity ||
          (candidate.specificity === bestCandidate.specificity &&
            (candidate.variantRankSum < bestCandidate.variantRankSum ||
              (candidate.variantRankSum === bestCandidate.variantRankSum &&
                (candidate.pageDistance < bestCandidate.pageDistance ||
                  (candidate.pageDistance === bestCandidate.pageDistance &&
                    (candidate.localEnd - candidate.localStart <
                      bestCandidate.localEnd - bestCandidate.localStart ||
                      (candidate.localEnd - candidate.localStart ===
                        bestCandidate.localEnd - bestCandidate.localStart &&
                        candidate.pageIndex < bestCandidate.pageIndex)))))))
        ) {
          bestCandidate = candidate;
        }

        if (
          candidate.variantRankSum === 0 &&
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

      const textContent = await loadPageTextContent(bestCandidate.pageIndex);
      const pageText = textContent ? getPageSearchText(textContent) : "";
      const matchText = truncateAnnotationText(
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
    rememberSearchResults,
    listFormFields,
    fillFormFields,
    focusField,
    getStoredSearchResult,
    setActiveHighlightedResultIds,
    clearActiveHighlightedResultIds,
    listAnnotations,
    createSearchHighlightAnnotations,
    clearSearchHighlights,
    navigatePage,
    focusSearchResult,
  };
};
