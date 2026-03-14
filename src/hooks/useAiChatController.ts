import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appEventBus } from "@/lib/eventBus";
import {
  getPdfSearchRangeClientRects,
  getPdfSearchSelectionOffsets,
} from "@/components/workspace/lib/pdfSearchHighlights";
import { getPdfSearchRangeGeometry } from "@/lib/pdfSearch";
import { ANNOTATION_STYLES } from "@/constants";
import {
  ANNOTATION_LIST_TYPES,
  filterAnnotationsForList,
  getAnnotationListType,
  sortAnnotationsForList,
  type AnnotationListType,
} from "@/lib/annotationList";
import {
  getChatModelGroups,
  subscribeLLMModelRegistry,
  summarizeText,
} from "@/services/LLMService";
import type { LLMChatMessage } from "@/services/LLMService/types";
import { useEditorStore } from "@/store/useEditorStore";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import {
  FieldType,
  type Annotation,
  type EditorState,
  type FormField,
  type PDFSearchResult,
} from "@/types";
import {
  aiChatService,
  type AiChatAssistantUpdate,
  type AiChatToolUpdate,
} from "@/services/aiChat/aiChatService";
import { createAiToolRegistry } from "@/services/aiChat/aiToolRegistry";
import { createDocumentContextService } from "@/services/aiChat/documentContextService";
import { buildDocumentDigestSummaryPrompt } from "@/services/aiChat/prompts";
import {
  normalizeAiToolArgsDeep,
  toSnakeCaseKeysDeep,
} from "@/services/aiChat/toolCase";
import type {
  AiAnnotationKind,
  AiAnnotationListResult,
  AiChatMessageAttachment,
  AiChatSelectionAttachment,
  AiChatSessionSummary,
  AiChatTimelineItem,
  AiChatUserMessageInput,
  AiFormFieldFillRequest,
  AiFormFieldFillResult,
  AiFormFieldFillResultItem,
  AiFormFieldKind,
  AiFormFieldListResult,
  AiHighlightAnnotationCreateResult,
  AiFormFieldSummary,
  AiStoredSearchResult,
  AiTextSelectionContext,
  AiToolName,
} from "@/services/aiChat/types";
import type { ModelSelectGroup } from "@/components/ModelSelect";

type AiChatRunStatus = "idle" | "running" | "cancelling" | "error";

const AI_CHAT_PERSIST_VERSION = 1;
const AI_CHAT_PERSIST_KEY_PREFIX = "ff-ai-chat:";
const AI_CHAT_SELECTED_MODEL_KEY = "ff-ai-chat:selected-model";
const MAX_PERSIST_SESSIONS = 20;
const MAX_PERSIST_TIMELINE_ITEMS = 300;
const MAX_PERSIST_SEARCH_RESULTS = 800;
const MAX_PERSIST_MESSAGE_CHARS = 60_000;
const MAX_PERSIST_TOOL_ARGS_CHARS = 20_000;
const MAX_PERSIST_TOOL_RESULT_CHARS = 80_000;
const MAX_PERSIST_TOOL_SUMMARY_CHARS = 8_000;

type PersistedAiChatSession = {
  id: string;
  title: string;
  updatedAt: string;
  timeline: AiChatTimelineItem[];
  searchResults: AiStoredSearchResult[];
  highlightedResultIds: string[];
};

type PersistedAiChatState = {
  version: number;
  activeSessionId: string;
  sessions: PersistedAiChatSession[];
};

type AiChatSessionData = {
  id: string;
  title: string;
  updatedAt: string;
  timeline: AiChatTimelineItem[];
  conversation: LLMChatMessage[];
  searchResultsById: Map<string, AiStoredSearchResult>;
  highlightedResultIds: string[];
  runStatus: AiChatRunStatus;
  lastError: string | null;
};

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

const summarizeFormField = (field: FormField): AiFormFieldSummary => {
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

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

const getErrorConversation = (error: unknown): LLMChatMessage[] | null => {
  if (!error || typeof error !== "object") return null;
  const raw = (error as { conversation?: unknown }).conversation;
  if (!Array.isArray(raw)) return null;
  const messages = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      if (
        role !== "system" &&
        role !== "user" &&
        role !== "assistant" &&
        role !== "tool"
      ) {
        return null;
      }
      if (typeof content !== "string") return null;
      const toolCallId = (item as { toolCallId?: unknown }).toolCallId;
      const toolName = (item as { toolName?: unknown }).toolName;
      return {
        role,
        content,
        ...(typeof toolCallId === "string" ? { toolCallId } : null),
        ...(typeof toolName === "string" ? { toolName } : null),
      } satisfies LLMChatMessage;
    })
    .filter(Boolean) as LLMChatMessage[];
  return messages;
};

const createSessionId = () =>
  `ai_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getThinkingItemId = (turnId: string) => `${turnId}:thinking`;

const resolveFinalThinkingText = (currentText: string, finalText: string) => {
  const current = currentText.trim();
  const final = finalText.trim();

  if (!current) return finalText;
  if (!final) return currentText;
  if (final.startsWith(current)) return finalText;
  if (current.startsWith(final)) return currentText;

  return currentText;
};

const calculateDurationMs = (createdAt: string, endedAtIso?: string) => {
  const started = Date.parse(createdAt);
  const ended = Date.parse(endedAtIso ?? new Date().toISOString());
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return undefined;
  return Math.max(0, ended - started);
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

        if (foundAnyForVariant) {
          break;
        }
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

const normalizeMessageAttachments = (
  attachments: AiChatMessageAttachment[] | undefined,
) => attachments?.map((attachment) => ({ ...attachment }));

const canUseLocalStorage = () => {
  try {
    if (typeof window === "undefined") return false;
    if (!window.localStorage) return false;
    return true;
  } catch {
    return false;
  }
};

const buildPersistKey = (documentIdentity: string) =>
  `${AI_CHAT_PERSIST_KEY_PREFIX}${documentIdentity}`;

const loadPersistedSelectedModelKey = () => {
  if (!canUseLocalStorage()) return undefined;
  try {
    const raw = window.localStorage.getItem(AI_CHAT_SELECTED_MODEL_KEY);
    return raw?.trim() || undefined;
  } catch {
    return undefined;
  }
};

const truncateText = (value: string, maxChars: number) => {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14))}…(truncated)`;
};

const truncateAnnotationText = (value: string, maxChars = 600) => {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

const truncateMessageAttachments = (
  attachments: AiChatMessageAttachment[] | undefined,
) =>
  normalizeMessageAttachments(attachments)?.map((attachment) => {
    if (attachment.kind !== "workspace_selection") return attachment;
    return {
      ...attachment,
      text: truncateText(attachment.text, 4_000),
    };
  });

const formatMessageAttachmentForConversation = (
  attachment: AiChatMessageAttachment,
  attachmentIndex: number,
) => {
  if (attachment.kind !== "workspace_selection") return "";

  return [
    "SELECTION_ATTACHMENT",
    `attachment_index: ${attachmentIndex + 1}`,
    `page_number: ${attachment.pageIndex + 1}`,
    `start_offset: ${attachment.startOffset}`,
    `end_offset: ${attachment.endOffset}`,
    "text:",
    attachment.text,
  ].join("\n");
};

const buildConversationMessageContent = (
  text: string,
  attachments?: AiChatMessageAttachment[],
) => {
  const blocks = (normalizeMessageAttachments(attachments) ?? [])
    .map((attachment, index) =>
      formatMessageAttachmentForConversation(attachment, index),
    )
    .filter(Boolean);

  return [text.trim(), ...blocks].filter(Boolean).join("\n\n");
};

const normalizeUserMessageInput = (input: AiChatUserMessageInput) => {
  if (typeof input === "string") {
    return {
      text: input,
      displayText: input,
      attachments: undefined,
    };
  }

  return {
    text: input.text,
    displayText: input.displayText ?? input.text,
    attachments: normalizeMessageAttachments(input.attachments),
  };
};

const normalizeTimelineForPersist = (items: AiChatTimelineItem[]) => {
  const tail = items.slice(
    Math.max(0, items.length - MAX_PERSIST_TIMELINE_ITEMS),
  );
  return tail.map((item) => {
    if (item.kind === "message") {
      return {
        ...item,
        text: truncateText(item.text, MAX_PERSIST_MESSAGE_CHARS),
        conversationText:
          typeof item.conversationText === "string"
            ? truncateText(item.conversationText, MAX_PERSIST_MESSAGE_CHARS)
            : undefined,
        attachments: truncateMessageAttachments(item.attachments),
      };
    }
    return {
      ...item,
      argsText: truncateText(item.argsText, MAX_PERSIST_TOOL_ARGS_CHARS),
      resultSummary:
        typeof item.resultSummary === "string"
          ? truncateText(item.resultSummary, MAX_PERSIST_TOOL_SUMMARY_CHARS)
          : undefined,
      resultText:
        typeof item.resultText === "string"
          ? truncateText(item.resultText, MAX_PERSIST_TOOL_RESULT_CHARS)
          : undefined,
      error:
        typeof item.error === "string"
          ? truncateText(item.error, 8_000)
          : undefined,
    };
  });
};

const restoreConversationFromTimeline = (items: AiChatTimelineItem[]) => {
  const conversation: LLMChatMessage[] = [];
  for (const item of items) {
    if (item.kind === "message") {
      if (item.role === "thinking") continue;
      conversation.push({
        role: item.role,
        content:
          item.role === "user"
            ? (item.conversationText ??
              buildConversationMessageContent(item.text, item.attachments))
            : item.text,
      });
      continue;
    }

    if (
      item.resultText &&
      (item.status === "done" || item.status === "error")
    ) {
      conversation.push({
        role: "tool",
        content: [
          "TOOL_RESULT",
          `name: ${item.toolName}`,
          `arguments: ${item.argsText}`,
          `result: ${item.resultText}`,
        ].join("\n"),
        toolCallId: item.toolCallId,
        toolName: item.toolName,
      });
    }
  }
  return conversation;
};

const getLatestUserSelectionAttachmentsFromTimeline = (
  items: AiChatTimelineItem[],
) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind !== "message" || item.role !== "user") continue;
    return (normalizeMessageAttachments(item.attachments) ?? []).flatMap(
      (attachment) =>
        attachment.kind === "workspace_selection" ? [attachment] : [],
    );
  }
  return [] as AiChatSelectionAttachment[];
};

const toTitleSnippet = (text: string) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 36 ? `${normalized.slice(0, 36)}…` : normalized;
};

const stringifyToolPayload = (payload: unknown) => {
  try {
    const json = JSON.stringify(toSnakeCaseKeysDeep(payload ?? null), null, 2);
    if (typeof json === "string") return json;
  } catch {
    // ignore
  }
  try {
    return String(payload);
  } catch {
    return "";
  }
};

const stringifyToolArgs = (args: Record<string, unknown>) => {
  try {
    const json = JSON.stringify(normalizeAiToolArgsDeep(args ?? {}), null, 2);
    if (typeof json === "string") return json;
  } catch {
    // ignore
  }
  return "{}";
};

const createSessionData = (id: string, nowIso: string): AiChatSessionData => ({
  id,
  title: "",
  updatedAt: nowIso,
  timeline: [],
  conversation: [],
  searchResultsById: new Map(),
  highlightedResultIds: [],
  runStatus: "idle",
  lastError: null,
});

export const useAiChatController = (editorState: EditorState) => {
  const [registryVersion, setRegistryVersion] = useState(0);
  const [selectedModelKey, setSelectedModelKey] = useState<string | undefined>(
    () => loadPersistedSelectedModelKey(),
  );

  const sessionsRef = useRef<Map<string, AiChatSessionData>>(new Map());
  const initialSession = useMemo(() => {
    const id = createSessionId();
    const nowIso = new Date().toISOString();
    return { id, nowIso };
  }, []);

  if (!sessionsRef.current.has(initialSession.id)) {
    sessionsRef.current.set(
      initialSession.id,
      createSessionData(initialSession.id, initialSession.nowIso),
    );
  }

  const [sessions, setSessions] = useState<AiChatSessionSummary[]>(() => [
    {
      id: initialSession.id,
      title: "",
      updatedAt: initialSession.nowIso,
    },
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>(
    initialSession.id,
  );
  const activeSessionIdRef = useRef(activeSessionId);

  const [timeline, setTimeline] = useState<AiChatTimelineItem[]>(() => []);
  const [runStatus, setRunStatus] = useState<AiChatRunStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [highlightedResultIds, setHighlightedResultIds] = useState<string[]>(
    [],
  );

  const conversationRef = useRef<LLMChatMessage[]>([]);
  const searchResultsRef = useRef<Map<string, AiStoredSearchResult>>(
    sessionsRef.current.get(initialSession.id)!.searchResultsById,
  );
  const abortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const touchSessionSummary = useCallback(
    (sessionId: string, patch: Partial<AiChatSessionSummary>) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === sessionId);
        const base =
          idx >= 0
            ? prev[idx]!
            : { id: sessionId, title: "", updatedAt: new Date().toISOString() };
        const nextItem = { ...base, ...patch };
        return [nextItem, ...prev.filter((s) => s.id !== sessionId)];
      });
    },
    [],
  );

  const loadSession = useCallback((sessionId: string) => {
    const session = sessionsRef.current.get(sessionId);
    if (!session) return;

    conversationRef.current = session.conversation;
    searchResultsRef.current = session.searchResultsById;
    setTimeline(session.timeline);
    setRunStatus(session.runStatus);
    setLastError(session.lastError);
    setHighlightedResultIds(session.highlightedResultIds);
  }, []);

  useEffect(() => {
    loadSession(activeSessionId);
  }, [activeSessionId, loadSession]);

  useEffect(() => {
    return subscribeLLMModelRegistry(() => {
      setRegistryVersion((value) => value + 1);
    });
  }, []);

  const chatModelGroups = useMemo(
    () => getChatModelGroups(),
    [registryVersion],
  );

  const modelSelectGroups = useMemo<ModelSelectGroup[]>(() => {
    return chatModelGroups.map((group) => ({
      id: group.providerId,
      label: group.label,
      options: group.models.map((model) => ({
        value: `${group.providerId}:${model.id}`,
        label: model.label,
        disabled: !group.isAvailable,
      })),
    }));
  }, [chatModelGroups]);

  const flatModels = useMemo(
    () =>
      chatModelGroups.flatMap((group) =>
        group.models.map((model) => ({
          providerId: group.providerId,
          providerLabel: group.label,
          modelId: model.id,
          modelLabel: model.label,
          isAvailable: group.isAvailable,
        })),
      ),
    [chatModelGroups],
  );

  const selectedChatModel = useMemo(
    () =>
      flatModels.find(
        (item) => `${item.providerId}:${item.modelId}` === selectedModelKey,
      ),
    [flatModels, selectedModelKey],
  );

  const selectedChatModelAuthor = useMemo(() => {
    const selectedModelLabel = selectedChatModel?.modelLabel?.trim();
    if (selectedModelLabel) return `AI · ${selectedModelLabel}`;

    const fallbackModelId = selectedModelKey
      ?.split(":")
      .slice(1)
      .join(":")
      .trim();
    return fallbackModelId ? `AI · ${fallbackModelId}` : "AI";
  }, [selectedChatModel, selectedModelKey]);

  const digestSummaryModel = useMemo(
    () =>
      flatModels.find(
        (item) =>
          item.providerId ===
            editorState.options.aiChat.digestSummaryProviderId &&
          item.modelId === editorState.options.aiChat.digestSummaryModelId,
      ),
    [
      editorState.options.aiChat.digestSummaryModelId,
      editorState.options.aiChat.digestSummaryProviderId,
      flatModels,
    ],
  );

  const summarizeDigestChunk = useCallback(
    async (options: {
      startPage: number;
      endPage: number;
      sampledText: string;
      maxChars: number;
      summaryInstructions?: string;
      signal?: AbortSignal;
    }) => {
      const providerId =
        editorState.options.aiChat.digestSummaryProviderId?.trim();
      const modelId = editorState.options.aiChat.digestSummaryModelId?.trim();
      if (!providerId || !modelId) return "";

      return await summarizeText(options.sampledText, {
        providerId,
        modelId,
        prompt: buildDocumentDigestSummaryPrompt({
          startPage: options.startPage,
          endPage: options.endPage,
          maxChars: options.maxChars,
          summaryInstructions: options.summaryInstructions,
        }),
        signal: options.signal,
      });
    },
    [
      editorState.options.aiChat.digestSummaryModelId,
      editorState.options.aiChat.digestSummaryProviderId,
    ],
  );

  const getDefaultModelKey = useCallback(() => {
    const firstAvailable = flatModels.find((item) => item.isAvailable);
    if (firstAvailable) {
      return `${firstAvailable.providerId}:${firstAvailable.modelId}`;
    }
    const firstAny = flatModels[0];
    return firstAny ? `${firstAny.providerId}:${firstAny.modelId}` : undefined;
  }, [flatModels]);

  useEffect(() => {
    const nextDefault = getDefaultModelKey();

    if (!selectedModelKey) {
      if (nextDefault) setSelectedModelKey(nextDefault);
      return;
    }

    const exists = flatModels.some(
      (item) =>
        `${item.providerId}:${item.modelId}` === selectedModelKey &&
        item.isAvailable,
    );
    if (!exists) {
      setSelectedModelKey(nextDefault);
    }
  }, [flatModels, getDefaultModelKey, selectedModelKey]);

  const getSelectedTextContext =
    useCallback((): AiTextSelectionContext | null => {
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return null;
      }

      const selectedText = selection.toString();
      if (!selectedText.trim()) return null;

      const range = selection.getRangeAt(0);
      const getClosestTextLayer = (node: Node | null) => {
        if (!node) return null;
        const element = node instanceof Element ? node : node.parentElement;
        return element?.closest?.(".textLayer") ?? null;
      };

      const startTextLayer = getClosestTextLayer(range.startContainer);
      const endTextLayer = getClosestTextLayer(range.endContainer);
      const textLayer =
        startTextLayer && endTextLayer && startTextLayer === endTextLayer
          ? (startTextLayer as HTMLElement)
          : null;
      if (!textLayer) return null;

      const pageElement = textLayer.closest?.(
        "[id^='page-']",
      ) as HTMLElement | null;
      const pageIndex = Number.parseInt(
        pageElement?.id.replace(/^page-/, "") ?? "",
        10,
      );
      const offsets = getPdfSearchSelectionOffsets(textLayer, selection);
      if (!Number.isFinite(pageIndex) || !offsets) return null;

      return {
        text: selectedText.replace(/\s+/g, " ").trim(),
        pageIndex,
        startOffset: offsets.startOffset,
        endOffset: offsets.endOffset,
      };
    }, []);

  const documentIdentity = [
    editorState.filename,
    editorState.pages.length,
    editorState.pdfBytes?.byteLength ?? 0,
  ].join(":");

  const isDocumentLoaded = editorState.pages.length > 0;

  const documentContextService = useMemo(
    () =>
      createDocumentContextService({
        getSnapshot: () => ({
          filename: editorState.filename,
          metadata: editorState.metadata,
          pages: editorState.pages,
          outline: editorState.outline,
          currentPageIndex: editorState.currentPageIndex,
        }),
        getSelectedTextContext,
        getDigestConfig: () => ({
          mode: editorState.options.aiChat.digestMode,
          charsPerChunk: editorState.options.aiChat.digestCharsPerChunk,
          sourceCharsPerChunk:
            editorState.options.aiChat.digestSourceCharsPerChunk,
        }),
        summarizeDigestChunk:
          editorState.options.aiChat.digestMode === "ai_summary" &&
          digestSummaryModel
            ? summarizeDigestChunk
            : undefined,
      }),
    [
      digestSummaryModel,
      documentIdentity,
      editorState.currentPageIndex,
      editorState.filename,
      editorState.metadata,
      editorState.options.aiChat.digestCharsPerChunk,
      editorState.options.aiChat.digestMode,
      editorState.options.aiChat.digestSourceCharsPerChunk,
      editorState.outline,
      editorState.pages,
      getSelectedTextContext,
      summarizeDigestChunk,
    ],
  );

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    searchSeqRef.current = 0;

    if (canUseLocalStorage() && isDocumentLoaded) {
      const key = buildPersistKey(documentIdentity);
      const raw = window.localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PersistedAiChatState;
          if (
            parsed &&
            typeof parsed === "object" &&
            parsed.version === AI_CHAT_PERSIST_VERSION &&
            Array.isArray(parsed.sessions) &&
            typeof parsed.activeSessionId === "string"
          ) {
            const nextMap = new Map<string, AiChatSessionData>();
            const nextSummaries: AiChatSessionSummary[] = [];

            for (const s of parsed.sessions.slice(0, MAX_PERSIST_SESSIONS)) {
              if (!s || typeof s !== "object") continue;
              if (typeof s.id !== "string") continue;
              const title = typeof s.title === "string" ? s.title : "";
              const updatedAt =
                typeof s.updatedAt === "string"
                  ? s.updatedAt
                  : new Date().toISOString();
              const timelineRaw = Array.isArray(s.timeline) ? s.timeline : [];
              const timeline = normalizeTimelineForPersist(timelineRaw);

              const searchResultsList = Array.isArray(s.searchResults)
                ? s.searchResults.slice(
                    Math.max(
                      0,
                      s.searchResults.length - MAX_PERSIST_SEARCH_RESULTS,
                    ),
                  )
                : [];
              const searchResultsById = new Map<string, AiStoredSearchResult>();
              for (const sr of searchResultsList) {
                if (!sr || typeof sr !== "object") continue;
                const id = (sr as { id?: unknown }).id;
                const query = (sr as { query?: unknown }).query;
                const result = (sr as { result?: unknown }).result;
                if (typeof id !== "string" || typeof query !== "string")
                  continue;
                if (!result || typeof result !== "object") continue;
                searchResultsById.set(id, {
                  id,
                  query,
                  result: result as PDFSearchResult,
                });
              }

              const highlighted = Array.isArray(s.highlightedResultIds)
                ? s.highlightedResultIds
                    .map((v) => (typeof v === "string" ? v : ""))
                    .filter(Boolean)
                : [];

              const session: AiChatSessionData = {
                id: s.id,
                title,
                updatedAt,
                timeline,
                conversation: restoreConversationFromTimeline(timeline),
                searchResultsById,
                highlightedResultIds: highlighted,
                runStatus: "idle",
                lastError: null,
              };

              nextMap.set(session.id, session);
              nextSummaries.push({
                id: session.id,
                title: session.title,
                updatedAt: session.updatedAt,
              });
            }

            if (nextMap.size > 0) {
              const nextActive = nextMap.has(parsed.activeSessionId)
                ? parsed.activeSessionId
                : nextSummaries[0]!.id;

              sessionsRef.current = nextMap;
              setSessions(nextSummaries);
              setActiveSessionId(nextActive);

              const active = nextMap.get(nextActive)!;
              conversationRef.current = active.conversation;
              searchResultsRef.current = active.searchResultsById;
              setTimeline(active.timeline);
              setRunStatus("idle");
              setLastError(null);
              setHighlightedResultIds(active.highlightedResultIds);
              return;
            }
          }
        } catch {
          // ignore invalid cache
        }
      }
    }

    sessionsRef.current = new Map();

    const id = createSessionId();
    const nowIso = new Date().toISOString();
    const session = createSessionData(id, nowIso);
    sessionsRef.current.set(id, session);

    setSessions([{ id, title: "", updatedAt: nowIso }]);
    setActiveSessionId(id);

    conversationRef.current = session.conversation;
    searchResultsRef.current = session.searchResultsById;

    setTimeline([]);
    setRunStatus("idle");
    setLastError(null);
    setHighlightedResultIds([]);
  }, [documentIdentity]);

  useEffect(() => {
    if (!canUseLocalStorage()) return;
    try {
      if (selectedModelKey) {
        window.localStorage.setItem(
          AI_CHAT_SELECTED_MODEL_KEY,
          selectedModelKey,
        );
      } else {
        window.localStorage.removeItem(AI_CHAT_SELECTED_MODEL_KEY);
      }
    } catch {
      // ignore
    }
  }, [selectedModelKey]);

  useEffect(() => {
    if (!canUseLocalStorage()) return;
    if (!isDocumentLoaded) return;

    const sessionId = activeSessionId;
    const session = sessionsRef.current.get(sessionId);
    if (!session) return;

    const timeout = window.setTimeout(() => {
      const key = buildPersistKey(documentIdentity);

      const persistedSessions: PersistedAiChatSession[] = sessions
        .slice(0, MAX_PERSIST_SESSIONS)
        .map((summary) => {
          const data = sessionsRef.current.get(summary.id);
          if (!data) {
            return {
              id: summary.id,
              title: summary.title ?? "",
              updatedAt: summary.updatedAt ?? new Date().toISOString(),
              timeline: [],
              searchResults: [],
              highlightedResultIds: [],
            };
          }

          const searchResultsList = Array.from(data.searchResultsById.values());
          const trimmedSearchResults = searchResultsList.slice(
            Math.max(0, searchResultsList.length - MAX_PERSIST_SEARCH_RESULTS),
          );

          return {
            id: data.id,
            title: data.title,
            updatedAt: data.updatedAt,
            timeline: normalizeTimelineForPersist(data.timeline),
            searchResults: trimmedSearchResults,
            highlightedResultIds: data.highlightedResultIds,
          };
        });

      const payload: PersistedAiChatState = {
        version: AI_CHAT_PERSIST_VERSION,
        activeSessionId,
        sessions: persistedSessions,
      };

      try {
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch {
        // Best-effort: try to persist only the active session if quota is exceeded.
        try {
          const activeData = sessionsRef.current.get(activeSessionId);
          if (!activeData) return;
          const searchResultsList = Array.from(
            activeData.searchResultsById.values(),
          );
          const trimmedSearchResults = searchResultsList.slice(
            Math.max(
              0,
              searchResultsList.length -
                Math.min(200, MAX_PERSIST_SEARCH_RESULTS),
            ),
          );
          const minimal: PersistedAiChatState = {
            version: AI_CHAT_PERSIST_VERSION,
            activeSessionId,
            sessions: [
              {
                id: activeData.id,
                title: activeData.title,
                updatedAt: activeData.updatedAt,
                timeline: normalizeTimelineForPersist(activeData.timeline),
                searchResults: trimmedSearchResults,
                highlightedResultIds: activeData.highlightedResultIds,
              },
            ],
          };
          window.localStorage.setItem(key, JSON.stringify(minimal));
        } catch {
          // ignore
        }
      }
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [
    activeSessionId,
    documentIdentity,
    highlightedResultIds,
    isDocumentLoaded,
    lastError,
    runStatus,
    sessions,
    timeline,
  ]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const rememberSearchResults = useCallback(
    (query: string, results: PDFSearchResult[]) => {
      const batch = ++searchSeqRef.current;
      const summaries = results.map((result, index) => {
        const id = `ai_sr_${batch}_${result.pageIndex}_${index}`;
        searchResultsRef.current.set(id, {
          id,
          query,
          result,
        });
        return {
          resultId: id,
          pageNumber: result.pageIndex + 1,
          matchText: result.matchText,
          snippet: result.displaySegments
            .map((segment) => segment.text)
            .join(""),
        };
      });
      return summaries;
    },
    [],
  );

  const listFormFields = useCallback(
    (options: {
      pageNumbers?: number[];
      query?: string;
      onlyEmpty?: boolean;
      includeReadOnly?: boolean;
      maxResults?: number;
    }): AiFormFieldListResult => {
      const pageNumbers = (options.pageNumbers ?? [])
        .map((pageNumber) => Math.trunc(pageNumber))
        .filter((pageNumber) => Number.isFinite(pageNumber) && pageNumber >= 1);
      const pageNumberSet =
        pageNumbers.length > 0 ? new Set(pageNumbers) : null;
      const maxResults = Math.min(
        500,
        Math.max(1, Math.trunc(options.maxResults ?? 100) || 100),
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
          if (pageNumberSet && !pageNumberSet.has(field.pageNumber))
            return false;
          if (!options.includeReadOnly && field.readOnly) return false;
          if (options.onlyEmpty && !field.isEmpty) return false;
          return matchesFormFieldQuery(field, options.query);
        });

      return {
        total: fields.length,
        returned: Math.min(fields.length, maxResults),
        truncated: fields.length > maxResults,
        fields: fields.slice(0, maxResults),
      };
    },
    [],
  );

  const fillFormFields = useCallback(
    (options: { updates: AiFormFieldFillRequest[] }): AiFormFieldFillResult => {
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

      for (const update of options.updates) {
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

              const options = target.options ?? [];
              const invalidOptions = options.length
                ? nextValues.filter((item) => !options.includes(item))
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

              const options = target.options ?? [];
              if (
                !allowsCustomDropdownValue(target) &&
                options.length > 0 &&
                update.value !== "" &&
                !options.includes(update.value)
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
    },
    [],
  );

  const focusField = useCallback((id: string) => {
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
  }, []);

  const getStoredSearchResult = useCallback((id: string) => {
    return searchResultsRef.current.get(id) ?? null;
  }, []);

  const setActiveHighlightedResultIds = useCallback((ids: string[]) => {
    const unique = Array.from(new Set(ids));
    setHighlightedResultIds(unique);
    const session = sessionsRef.current.get(activeSessionIdRef.current);
    if (session) session.highlightedResultIds = unique;
  }, []);

  const clearActiveHighlightedResultIds = useCallback(() => {
    setHighlightedResultIds([]);
    const session = sessionsRef.current.get(activeSessionIdRef.current);
    if (session) session.highlightedResultIds = [];
  }, []);

  const listAnnotations = useCallback(
    (options: {
      query?: string;
      pageNumbers?: number[];
      types?: AiAnnotationKind[];
      maxResults?: number;
    }): AiAnnotationListResult => {
      const store = useEditorStore.getState();
      const selectedTypes = (options.types ?? []).filter(
        (type): type is AnnotationListType =>
          ANNOTATION_LIST_TYPES.includes(type as AnnotationListType),
      );
      const filtered = filterAnnotationsForList(store.annotations, {
        query: options.query,
        pageNumbers: options.pageNumbers,
        selectedTypes,
      });
      const sorted = sortAnnotationsForList(filtered);
      const limit = Math.max(1, Math.trunc(options.maxResults ?? 100));
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
    },
    [],
  );

  const createSearchHighlightAnnotations = useCallback(
    async (options: {
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
          if (annotation.meta?.kind !== "ai_document_anchor_highlight")
            return [];
          const documentAnchorKey = annotation.meta.documentAnchorKey;
          return typeof documentAnchorKey === "string"
            ? [documentAnchorKey]
            : [];
        }),
      );
      const createdAt = new Date().toISOString();
      const style = store.highlightStyle || {
        color: ANNOTATION_STYLES.highlight.color,
        thickness: ANNOTATION_STYLES.highlight.thickness,
        opacity: ANNOTATION_STYLES.highlight.opacity,
      };
      const requestedResultIds = options.resultIds ?? [];
      const annotationText = options.annotationText?.trim() || undefined;
      const requestedSelectionAnchors = options.selectionAnchors ?? [];
      const requestedDocumentAnchors = options.documentAnchors ?? [];

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
      const modelMeta = selectedChatModel
        ? {
            providerId: selectedChatModel.providerId,
            providerLabel: selectedChatModel.providerLabel,
            modelId: selectedChatModel.modelId,
            modelLabel: selectedChatModel.modelLabel,
          }
        : undefined;
      const pageTextContentCache = new Map<
        number,
        Awaited<ReturnType<typeof pdfWorkerService.getTextContent>>
      >();
      const latestSelectionAttachments =
        getLatestUserSelectionAttachmentsFromTimeline(
          sessionsRef.current.get(activeSessionIdRef.current)?.timeline ?? [],
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
        const textContent = await pdfWorkerService.getTextContent({
          pageIndex,
        });
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

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
          return null;
        }

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
        const stored = searchResultsRef.current.get(resultId);
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
            (Array.isArray(stored.result.rects) &&
            stored.result.rects.length > 0
              ? stored.result.rects.map((item) => ({ ...item }))
              : [rect]),
          text: annotationText ?? stored.result.matchText,
          author: selectedChatModelAuthor,
          color: style.color,
          opacity: style.opacity,
          meta: {
            kind: "ai_search_highlight",
            resultId,
            query: stored.query,
            createdAt,
            sessionId: activeSessionIdRef.current,
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
          author: selectedChatModelAuthor,
          color: style.color,
          opacity: style.opacity,
          meta: {
            kind: "ai_selection_highlight",
            selectionKey,
            attachmentIndex: requestedSelectionAnchor.attachmentIndex,
            startAnchor,
            endInclusiveAnchor,
            createdAt,
            sessionId: activeSessionIdRef.current,
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
            hintedPageIndex === null
              ? 0
              : Math.abs(pageIndex - hintedPageIndex);
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
            (hintedPageIndex === null ||
              candidate.pageIndex === hintedPageIndex)
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
          author: selectedChatModelAuthor,
          color: style.color,
          opacity: style.opacity,
          meta: {
            kind: "ai_document_anchor_highlight",
            documentAnchorKey,
            startAnchor: bestCandidate.startAnchor,
            endInclusiveAnchor: bestCandidate.endInclusiveAnchor,
            pageHint: requestedDocumentAnchor.pageHint,
            createdAt,
            sessionId: activeSessionIdRef.current,
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
    },
    [
      clearActiveHighlightedResultIds,
      selectedChatModel,
      selectedChatModelAuthor,
    ],
  );

  const clearSearchHighlights = useCallback(() => {
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
  }, [clearActiveHighlightedResultIds]);

  const navigatePage = useCallback((pageIndex: number) => {
    appEventBus.emit("workspace:navigatePage", {
      pageIndex,
      behavior: "smooth",
    });
  }, []);

  const focusSearchResult = useCallback((result: PDFSearchResult) => {
    appEventBus.emit("workspace:focusSearchResult", {
      pageIndex: result.pageIndex,
      rect: result.rect,
      behavior: "smooth",
    });
  }, []);

  const toolRegistry = useMemo(
    () =>
      createAiToolRegistry({
        documentContextService,
        rememberSearchResults,
        listAnnotations,
        listFormFields,
        fillFormFields,
        focusField,
        getStoredSearchResult,
        createSearchHighlightAnnotations,
        clearSearchHighlights,
        setHighlightedResultIds: setActiveHighlightedResultIds,
        clearHighlightedResultIds: clearActiveHighlightedResultIds,
        navigatePage,
        focusSearchResult,
      }),
    [
      clearSearchHighlights,
      clearActiveHighlightedResultIds,
      createSearchHighlightAnnotations,
      documentContextService,
      fillFormFields,
      focusField,
      focusSearchResult,
      getStoredSearchResult,
      listAnnotations,
      listFormFields,
      navigatePage,
      rememberSearchResults,
      setActiveHighlightedResultIds,
    ],
  );

  const appendTimelineItem = useCallback(
    (item: AiChatTimelineItem) => {
      const sessionId = activeSessionIdRef.current;
      const session = sessionsRef.current.get(sessionId);
      if (!session) return;

      const updatedAt = new Date().toISOString();
      session.updatedAt = updatedAt;

      setTimeline((prev) => {
        const next = [...prev, item];
        session.timeline = next;
        return next;
      });

      touchSessionSummary(sessionId, {
        title: session.title,
        updatedAt,
      });
    },
    [touchSessionSummary],
  );

  const patchTimelineItem = useCallback(
    (id: string, patcher: (item: AiChatTimelineItem) => AiChatTimelineItem) => {
      const sessionId = activeSessionIdRef.current;
      const session = sessionsRef.current.get(sessionId);
      if (!session) return;

      setTimeline((prev) => {
        const next = prev.map((item) =>
          item.id === id ? patcher(item) : item,
        );
        session.timeline = next;
        return next;
      });
    },
    [],
  );

  const applyAssistantUpdate = useCallback(
    (update: AiChatAssistantUpdate) => {
      if (update.phase === "reasoning_delta") {
        const thinkingId = getThinkingItemId(update.turnId);
        const nowIso = new Date().toISOString();
        setTimeline((prev) => {
          const idx = prev.findIndex((item) => item.id === thinkingId);
          if (idx < 0) {
            const nextItem: AiChatTimelineItem = {
              id: thinkingId,
              kind: "message",
              role: "thinking",
              text: update.delta,
              createdAt: nowIso,
              isStreaming: true,
            };
            const assistantIdx = prev.findIndex(
              (item) => item.id === update.turnId,
            );
            const next = prev.slice();
            if (assistantIdx >= 0) next.splice(assistantIdx, 0, nextItem);
            else next.push(nextItem);
            const session = sessionsRef.current.get(activeSessionIdRef.current);
            if (session) {
              session.timeline = next;
              session.updatedAt = nowIso;
              touchSessionSummary(session.id, {
                title: session.title,
                updatedAt: nowIso,
              });
            }
            return next;
          }

          const current = prev[idx]!;
          if (current.kind !== "message") return prev;

          const nextItem: AiChatTimelineItem = {
            ...current,
            role: "thinking",
            text: `${current.text}${update.delta}`,
            isStreaming: true,
          };
          const next = prev.slice();
          next[idx] = nextItem;

          const session = sessionsRef.current.get(activeSessionIdRef.current);
          if (session) session.timeline = next;

          return next;
        });
        return;
      }

      if (update.phase === "delta") {
        const thinkingId = getThinkingItemId(update.turnId);
        const nowIso = new Date().toISOString();
        setTimeline((prev) => {
          const next = prev.slice();
          const thinkingIdx = next.findIndex((item) => item.id === thinkingId);
          if (thinkingIdx >= 0) {
            const thinkingItem = next[thinkingIdx];
            if (
              thinkingItem &&
              thinkingItem.kind === "message" &&
              thinkingItem.role === "thinking" &&
              thinkingItem.isStreaming
            ) {
              next[thinkingIdx] = {
                ...thinkingItem,
                isStreaming: false,
                durationMs: calculateDurationMs(thinkingItem.createdAt, nowIso),
              };
            }
          }

          const idx = next.findIndex((item) => item.id === update.turnId);
          if (idx < 0) {
            const nextItem: AiChatTimelineItem = {
              id: update.turnId,
              kind: "message",
              role: "assistant",
              text: update.delta,
              createdAt: nowIso,
              isStreaming: true,
            };
            next.push(nextItem);
            const session = sessionsRef.current.get(activeSessionIdRef.current);
            if (session) {
              session.timeline = next;
              session.updatedAt = nowIso;
              touchSessionSummary(session.id, {
                title: session.title,
                updatedAt: nowIso,
              });
            }
            return next;
          }

          const current = next[idx]!;
          if (current.kind !== "message") return prev;

          const nextItem: AiChatTimelineItem = {
            ...current,
            role: "assistant",
            text: `${current.text}${update.delta}`,
            isStreaming: true,
          };
          next[idx] = nextItem;

          const session = sessionsRef.current.get(activeSessionIdRef.current);
          if (session) session.timeline = next;

          return next;
        });
        return;
      }

      // end
      const thinkingId = getThinkingItemId(update.turnId);
      if (!update.assistantMessage && !update.reasoningText) {
        patchTimelineItem(update.turnId, (item) => {
          if (item.kind !== "message") return item;
          return { ...item, isStreaming: false };
        });
        patchTimelineItem(thinkingId, (item) => {
          if (item.kind !== "message") return item;
          return {
            ...item,
            isStreaming: false,
            durationMs: calculateDurationMs(item.createdAt),
          };
        });
        return;
      }

      const nowIso = new Date().toISOString();
      setTimeline((prev) => {
        const next = prev.slice();
        const assistantExistingIdx = next.findIndex(
          (item) => item.id === update.turnId,
        );

        if (update.reasoningText) {
          const thinkingIdx = next.findIndex((item) => item.id === thinkingId);
          const existingThinkingText =
            thinkingIdx >= 0 &&
            next[thinkingIdx]?.kind === "message" &&
            next[thinkingIdx]?.role === "thinking"
              ? next[thinkingIdx].text
              : "";
          const thinkingItem: AiChatTimelineItem = {
            id: thinkingId,
            kind: "message",
            role: "thinking",
            text: resolveFinalThinkingText(
              existingThinkingText,
              update.reasoningText,
            ),
            createdAt: thinkingIdx >= 0 ? next[thinkingIdx]!.createdAt : nowIso,
            durationMs:
              thinkingIdx >= 0 &&
              next[thinkingIdx]?.kind === "message" &&
              next[thinkingIdx]?.role === "thinking"
                ? calculateDurationMs(next[thinkingIdx]!.createdAt, nowIso)
                : 0,
            isStreaming: false,
          };
          if (thinkingIdx < 0) {
            if (assistantExistingIdx >= 0)
              next.splice(assistantExistingIdx, 0, thinkingItem);
            else next.push(thinkingItem);
          } else next[thinkingIdx] = thinkingItem;
        } else {
          const thinkingIdx = next.findIndex((item) => item.id === thinkingId);
          if (thinkingIdx >= 0) {
            const current = next[thinkingIdx]!;
            if (current.kind === "message") {
              next[thinkingIdx] = {
                ...current,
                isStreaming: false,
                durationMs: calculateDurationMs(current.createdAt, nowIso),
              };
            }
          }
        }

        if (!update.assistantMessage) {
          const session = sessionsRef.current.get(activeSessionIdRef.current);
          if (session) {
            session.timeline = next;
            session.updatedAt = nowIso;
            touchSessionSummary(session.id, {
              title: session.title,
              updatedAt: nowIso,
            });
          }
          return next;
        }

        const idx = next.findIndex((item) => item.id === update.turnId);
        if (idx < 0) {
          next.push({
            id: update.turnId,
            kind: "message",
            role: "assistant",
            text: update.assistantMessage,
            createdAt: nowIso,
            isStreaming: false,
          });
        } else {
          const current = next[idx]!;
          if (current.kind !== "message") return prev;
          next[idx] = {
            ...current,
            role: "assistant",
            text: update.assistantMessage,
            isStreaming: false,
          };
        }

        const session = sessionsRef.current.get(activeSessionIdRef.current);
        if (session) session.timeline = next;

        return next;
      });
    },
    [patchTimelineItem, touchSessionSummary],
  );

  const applyToolUpdate = useCallback(
    (update: AiChatToolUpdate) => {
      const nowIso = new Date().toISOString();
      if (update.phase === "start") {
        const item: AiChatTimelineItem = {
          id: update.call.id,
          kind: "tool",
          toolCallId: update.call.id,
          batchId: update.batchId,
          isParallelBatch: update.isParallelBatch,
          toolName: update.call.name as AiToolName,
          status: "running",
          argsText: stringifyToolArgs(update.call.args),
          createdAt: nowIso,
        };
        appendTimelineItem(item);
        return;
      }

      if (update.phase === "success") {
        patchTimelineItem(update.call.id, (item) => {
          if (item.kind !== "tool") return item;
          return {
            ...item,
            status: "done",
            resultSummary: update.result.summary,
            resultText: stringifyToolPayload(update.result.payload),
          };
        });
        return;
      }

      patchTimelineItem(update.call.id, (item) => {
        if (item.kind !== "tool") return item;
        return {
          ...item,
          status: "error",
          error: update.error.message,
          resultText: stringifyToolPayload({
            ok: false,
            error: update.error.message,
          }),
        };
      });
    },
    [appendTimelineItem, patchTimelineItem],
  );

  const sendMessage = useCallback(
    async (input: AiChatUserMessageInput) => {
      const normalized = normalizeUserMessageInput(input);
      const text = normalized.text.trim();
      const displayText = normalized.displayText.trim();
      const attachments = normalized.attachments?.length
        ? normalized.attachments
        : undefined;
      const conversationText = buildConversationMessageContent(
        text,
        attachments,
      );
      if (
        !conversationText ||
        runStatus === "running" ||
        runStatus === "cancelling"
      ) {
        return;
      }

      const selected = flatModels.find(
        (item) => `${item.providerId}:${item.modelId}` === selectedModelKey,
      );
      if (!selected) {
        setLastError("No available AI chat model.");
        setRunStatus("error");
        const session = sessionsRef.current.get(activeSessionIdRef.current);
        if (session) {
          session.lastError = "No available AI chat model.";
          session.runStatus = "error";
        }
        return;
      }

      const sessionId = activeSessionIdRef.current;
      const session = sessionsRef.current.get(sessionId);
      if (!session) return;

      if (!session.title) {
        const title = toTitleSnippet(
          attachments?.[0]?.text || displayText || text,
        );
        session.title = title;
        touchSessionSummary(sessionId, {
          title,
        });
      }

      const userItem: AiChatTimelineItem = {
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: "message",
        role: "user",
        text: displayText,
        conversationText,
        attachments,
        createdAt: new Date().toISOString(),
      };
      appendTimelineItem(userItem);

      setLastError(null);
      setRunStatus("running");
      session.lastError = null;
      session.runStatus = "running";

      const controller = new AbortController();
      abortRef.current = controller;

      const nextConversation: LLMChatMessage[] = [
        ...conversationRef.current,
        { role: "user", content: conversationText },
      ];
      conversationRef.current = nextConversation;
      session.conversation = nextConversation;

      try {
        const result = await aiChatService.runConversation({
          messages: conversationRef.current,
          providerId: selected.providerId,
          modelId: selected.modelId,
          toolRegistry,
          signal: controller.signal,
          onAssistantUpdate: applyAssistantUpdate,
          onToolUpdate: applyToolUpdate,
        });

        conversationRef.current = result.conversation;
        session.conversation = result.conversation;

        setRunStatus("idle");
        session.runStatus = "idle";
      } catch (error) {
        if (isAbortError(error)) {
          setRunStatus("idle");
          session.runStatus = "idle";

          setTimeline((prev) => {
            const next = prev.map((item) => {
              if (item.kind === "tool" && item.status === "running") {
                return {
                  ...item,
                  status: "error" as const,
                  error: "Cancelled",
                };
              }
              if (
                item.kind === "message" &&
                (item.role === "assistant" || item.role === "thinking") &&
                item.isStreaming
              ) {
                return item.role === "thinking"
                  ? {
                      ...item,
                      isStreaming: false,
                      durationMs: calculateDurationMs(item.createdAt),
                    }
                  : { ...item, isStreaming: false };
              }
              return item;
            });

            session.timeline = next;
            const reconciled = restoreConversationFromTimeline(
              normalizeTimelineForPersist(next),
            );
            session.conversation = reconciled;
            conversationRef.current = reconciled;
            return next;
          });
          return;
        }

        setTimeline((prev) => {
          const next = prev.map((item) => {
            if (item.kind === "tool" && item.status === "running") {
              return {
                ...item,
                status: "error" as const,
                error: "Failed",
              };
            }
            if (
              item.kind === "message" &&
              (item.role === "assistant" || item.role === "thinking") &&
              item.isStreaming
            ) {
              return item.role === "thinking"
                ? {
                    ...item,
                    isStreaming: false,
                    durationMs: calculateDurationMs(item.createdAt),
                  }
                : { ...item, isStreaming: false };
            }
            return item;
          });
          session.timeline = next;
          return next;
        });

        const carriedConversation = getErrorConversation(error);
        const nextConversation =
          carriedConversation ??
          restoreConversationFromTimeline(
            normalizeTimelineForPersist(session.timeline),
          );
        session.conversation = nextConversation;
        conversationRef.current = nextConversation;

        const message =
          error instanceof Error ? error.message : "AI chat request failed.";
        setLastError(message);
        setRunStatus("error");
        session.lastError = message;
        session.runStatus = "error";
      } finally {
        abortRef.current = null;
      }
    },
    [
      appendTimelineItem,
      applyAssistantUpdate,
      applyToolUpdate,
      flatModels,
      runStatus,
      selectedModelKey,
      toolRegistry,
      touchSessionSummary,
    ],
  );

  const stop = useCallback(() => {
    if (!abortRef.current) return;
    setRunStatus("cancelling");
    const session = sessionsRef.current.get(activeSessionIdRef.current);
    if (session) session.runStatus = "cancelling";
    abortRef.current.abort();
    abortRef.current = null;
  }, []);

  const clearConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const sessionId = activeSessionIdRef.current;
    const session = sessionsRef.current.get(sessionId);
    if (!session) return;

    const updatedAt = new Date().toISOString();
    session.updatedAt = updatedAt;
    session.title = "";
    session.timeline = [];
    session.conversation = [];
    session.searchResultsById = new Map();
    session.highlightedResultIds = [];
    session.runStatus = "idle";
    session.lastError = null;

    conversationRef.current = session.conversation;
    searchResultsRef.current = session.searchResultsById;

    setTimeline([]);
    setRunStatus("idle");
    setLastError(null);
    setHighlightedResultIds([]);

    touchSessionSummary(sessionId, {
      title: "",
      updatedAt,
    });
  }, [touchSessionSummary]);

  const newConversation = useCallback(() => {
    if (runStatus === "running" || runStatus === "cancelling") return;

    const currentSession = sessionsRef.current.get(activeSessionIdRef.current);
    if (
      currentSession &&
      currentSession.timeline.length === 0 &&
      currentSession.conversation.length === 0 &&
      !currentSession.lastError
    ) {
      // Avoid creating duplicate empty sessions.
      return;
    }

    const id = createSessionId();
    const nowIso = new Date().toISOString();
    const session = createSessionData(id, nowIso);
    sessionsRef.current.set(id, session);

    setSessions((prev) => [{ id, title: "", updatedAt: nowIso }, ...prev]);
    setActiveSessionId(id);

    conversationRef.current = session.conversation;
    searchResultsRef.current = session.searchResultsById;

    setTimeline([]);
    setRunStatus("idle");
    setLastError(null);
    setHighlightedResultIds([]);
  }, [runStatus]);

  const selectSession = useCallback(
    (id: string) => {
      if (id === activeSessionIdRef.current) return;
      if (runStatus === "running" || runStatus === "cancelling") return;
      if (!sessionsRef.current.has(id)) return;
      setActiveSessionId(id);
      touchSessionSummary(id, {}); // move to top
    },
    [runStatus, touchSessionSummary],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      if (runStatus === "running" || runStatus === "cancelling") return;
      if (!sessionsRef.current.has(id)) return;

      const deletingActive = id === activeSessionIdRef.current;

      sessionsRef.current.delete(id);

      if (!deletingActive) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        return;
      }

      const remaining = sessions.filter((s) => s.id !== id);
      if (remaining.length > 0) {
        setSessions(remaining);
        setActiveSessionId(remaining[0]!.id);
        return;
      }

      const nextId = createSessionId();
      const nowIso = new Date().toISOString();
      const nextSession = createSessionData(nextId, nowIso);
      sessionsRef.current.set(nextId, nextSession);

      setSessions([{ id: nextId, title: "", updatedAt: nowIso }]);
      setActiveSessionId(nextId);

      conversationRef.current = nextSession.conversation;
      searchResultsRef.current = nextSession.searchResultsById;

      setTimeline([]);
      setRunStatus("idle");
      setLastError(null);
      setHighlightedResultIds([]);
    },
    [runStatus, sessions],
  );

  const highlightedSearchResultsByPage = useMemo(() => {
    const map = new Map<number, PDFSearchResult[]>();

    for (const id of highlightedResultIds) {
      const stored = searchResultsRef.current.get(id);
      if (!stored) continue;
      const list = map.get(stored.result.pageIndex);
      if (list) list.push(stored.result);
      else map.set(stored.result.pageIndex, [stored.result]);
    }

    return map;
  }, [highlightedResultIds]);

  const hasAvailableModel = flatModels.some((item) => item.isAvailable);
  const disabledReason: "no_document" | "no_model" | null = !editorState.pages
    .length
    ? "no_document"
    : !hasAvailableModel
      ? "no_model"
      : null;

  return {
    sessions,
    activeSessionId,
    selectSession,
    newConversation,
    clearConversation,
    deleteConversation,

    timeline,
    runStatus,
    lastError,
    selectedModelKey,
    setSelectedModelKey,
    modelSelectGroups,
    sendMessage,
    stop,

    highlightedSearchResultsByPage,
    hasAvailableModel,
    disabledReason,
  };
};
