import type {
  AiChatAssistantUpdate,
  AiChatToolPreviewImage,
  AiChatTokenUsageSummary,
  AiChatTimelineItem,
  AiChatToolUpdate,
  AiToolName,
} from "@/services/ai/chat/types";

import {
  stringifyToolArgs,
  stringifyToolPayload,
} from "@/hooks/useAiChatController/sessionPersistence";

type MessageTimelineItem = Extract<AiChatTimelineItem, { kind: "message" }>;
export const getThinkingItemId = (turnId: string, segmentIndex = 0) =>
  segmentIndex <= 0
    ? `${turnId}:thinking`
    : `${turnId}:thinking_${segmentIndex}`;
export const getAssistantSegmentId = (turnId: string, segmentIndex: number) =>
  segmentIndex <= 0 ? turnId : `${turnId}:segment_${segmentIndex}`;

const getTurnIdFromBatchId = (batchId: string) => batchId.split(":step_")[0]!;

const getObjectRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const extractToolPreviewImages = (
  update: Extract<AiChatToolUpdate, { phase: "success" }>,
): AiChatToolPreviewImage[] | undefined => {
  const modelOutput = getObjectRecord(update.result.modelOutput);
  const payload = getObjectRecord(update.result.payload);
  const candidatePages = Array.isArray(modelOutput?.pages)
    ? modelOutput.pages
    : Array.isArray(payload?.pages)
      ? payload.pages
      : null;

  if (!candidatePages) return undefined;

  const previews: AiChatToolPreviewImage[] = [];
  for (const [index, entry] of candidatePages.entries()) {
    const page = getObjectRecord(entry);
    if (!page) continue;

    const base64Data =
      typeof page.base64Data === "string" && page.base64Data.trim()
        ? page.base64Data.trim()
        : null;
    if (!base64Data) continue;

    const mimeType =
      typeof page.mimeType === "string" && page.mimeType.trim()
        ? page.mimeType.trim()
        : "image/png";
    const pageNumber =
      typeof page.pageNumber === "number" && Number.isFinite(page.pageNumber)
        ? page.pageNumber
        : null;
    const cropRect = getObjectRecord(page.cropRect);
    const renderedWidth =
      typeof page.renderedWidth === "number" &&
      Number.isFinite(page.renderedWidth)
        ? page.renderedWidth
        : undefined;
    const renderedHeight =
      typeof page.renderedHeight === "number" &&
      Number.isFinite(page.renderedHeight)
        ? page.renderedHeight
        : undefined;
    const label = pageNumber
      ? cropRect
        ? `Page ${pageNumber} crop`
        : `Page ${pageNumber}`
      : `Image ${index + 1}`;

    previews.push({
      id: `${update.call.id}:preview:${index}`,
      src: `data:${mimeType};base64,${base64Data}`,
      alt: label,
      label,
      width: renderedWidth,
      height: renderedHeight,
    });
  }

  return previews.length > 0 ? previews : undefined;
};

const isToolTurnItem = (item: AiChatTimelineItem, turnId: string) =>
  item.kind === "tool" &&
  (item.turnId === turnId ||
    (typeof item.batchId === "string" &&
      getTurnIdFromBatchId(item.batchId) === turnId));

const isTurnItem = (item: AiChatTimelineItem, turnId: string) =>
  (item.kind === "message" &&
    (item.turnId === turnId ||
      item.id === turnId ||
      item.id === getThinkingItemId(turnId))) ||
  isToolTurnItem(item, turnId);

const markTurnCompleted = (
  items: AiChatTimelineItem[],
  update: Extract<AiChatAssistantUpdate, { phase: "end" }>,
  nowIso: string,
) => {
  const turnItems = items.filter((item) => isTurnItem(item, update.turnId));
  const last = turnItems.at(-1);
  if (!last) return items;
  const durationMs =
    update.durationMs ?? calculateDurationMs(turnItems[0]!.createdAt, nowIso);
  const isFinalAnswer =
    (update.isFinalAnswer ?? update.finishReason === "stop") &&
    !turnItems.some(
      (item) => item.kind === "tool" && item.status === "running",
    );

  return items.map((item) =>
    isTurnItem(item, update.turnId)
      ? {
          ...item,
          turnCompleted: item.id === last.id ? true : undefined,
          turnDurationMs: item.id === last.id ? durationMs : undefined,
          ...(item.kind === "message"
            ? {
                isFinalAnswer:
                  item.role === "assistant" && item.id === last.id
                    ? isFinalAnswer && !!item.text.trim()
                    : undefined,
              }
            : {}),
        }
      : item,
  );
};

const getTurnMessageSegments = (
  items: AiChatTimelineItem[],
  turnId: string,
  role: "assistant" | "thinking",
) =>
  items.flatMap((item, index) =>
    item.kind === "message" && item.role === role && isTurnItem(item, turnId)
      ? [{ item, index }]
      : [],
  );

const finishMessageSegment = (
  item: MessageTimelineItem,
  nowIso: string,
): MessageTimelineItem => ({
  ...item,
  isStreaming: false,
  ...(item.role === "thinking"
    ? { durationMs: calculateDurationMs(item.createdAt, nowIso) }
    : {}),
});

const finishTurnSegments = (
  items: AiChatTimelineItem[],
  turnId: string,
  nowIso: string,
) =>
  items.map((item) =>
    item.kind === "message" && item.isStreaming && isTurnItem(item, turnId)
      ? finishMessageSegment(item, nowIso)
      : item,
  );

export const calculateDurationMs = (createdAt: string, endedAtIso?: string) => {
  const started = Date.parse(createdAt);
  const ended = Date.parse(endedAtIso ?? new Date().toISOString());
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return undefined;
  return Math.max(0, ended - started);
};

export type TimelineMutationResult = {
  timeline: AiChatTimelineItem[];
  touchedSession: boolean;
};

export const applyAssistantUpdateToTimeline = (
  prev: AiChatTimelineItem[],
  update: AiChatAssistantUpdate,
  nowIso: string,
  documentId?: string,
): TimelineMutationResult => {
  if (update.phase === "reasoning_delta" || update.phase === "delta") {
    if (!update.delta) return { timeline: prev, touchedSession: false };
    const role = update.phase === "reasoning_delta" ? "thinking" : "assistant";
    const segments = getTurnMessageSegments(prev, update.turnId, role);
    const last = segments.at(-1);
    const canAppend =
      last?.item.isStreaming &&
      last.item.streamSegmentId === update.segmentId &&
      !prev
        .slice(last.index + 1)
        .some((item) => isTurnItem(item, update.turnId));
    if (canAppend) {
      const next = prev.slice();
      next[last.index] = {
        ...last.item,
        documentId: last.item.documentId ?? documentId,
        text: last.item.text + update.delta,
        ...(update.phase === "reasoning_delta"
          ? {
              showCollapsedPreview:
                update.showCollapsedPreview ?? last.item.showCollapsedPreview,
            }
          : {
              branchAnchorId: last.item.branchAnchorId ?? update.branchAnchorId,
            }),
      };
      return { timeline: next, touchedSession: false };
    }

    // Each SDK block (including blocks after tools) keeps its position in the stream.
    const next = finishTurnSegments(prev, update.turnId, nowIso);
    const segmentIndex = last
      ? (last.item.segmentIndex ?? segments.length - 1) + 1
      : 0;
    next.push({
      id:
        role === "thinking"
          ? getThinkingItemId(update.turnId, segmentIndex)
          : getAssistantSegmentId(update.turnId, segmentIndex),
      kind: "message",
      role,
      documentId,
      turnId: update.turnId,
      segmentIndex,
      streamSegmentId: update.segmentId,
      text: update.delta,
      ...(update.phase === "reasoning_delta"
        ? { showCollapsedPreview: update.showCollapsedPreview }
        : { branchAnchorId: update.branchAnchorId }),
      createdAt: nowIso,
      isStreaming: true,
    });
    return { timeline: next, touchedSession: true };
  }

  if (update.phase === "segment_end") {
    return {
      timeline: prev.map((item) =>
        item.kind === "message" &&
        item.role === update.role &&
        item.isStreaming &&
        isTurnItem(item, update.turnId) &&
        item.streamSegmentId === update.segmentId
          ? finishMessageSegment(item, nowIso)
          : item,
      ),
      touchedSession: false,
    };
  }

  const next = finishTurnSegments(prev, update.turnId, nowIso);
  const thinkingSegments = getTurnMessageSegments(
    next,
    update.turnId,
    "thinking",
  );
  // The final aggregate is a fallback for non-streamed output. Never merge it back
  // into the first thinking bubble after the stream has already supplied blocks.
  if (update.reasoningText.trim() && !thinkingSegments.length) {
    const assistant = getTurnMessageSegments(
      next,
      update.turnId,
      "assistant",
    ).at(-1);
    next.splice(assistant?.index ?? next.length, 0, {
      id: getThinkingItemId(update.turnId),
      kind: "message",
      role: "thinking",
      documentId,
      turnId: update.turnId,
      segmentIndex: 0,
      text: update.reasoningText,
      showCollapsedPreview: update.showCollapsedPreview,
      createdAt: nowIso,
      durationMs: 0,
      isStreaming: false,
    });
  }

  const segments = getTurnMessageSegments(next, update.turnId, "assistant");
  const last = segments.at(-1);
  if (update.assistantMessage.trim()) {
    const existingText = segments
      .map(({ item }) => item.text)
      .join("")
      .trimStart();
    const finalText = update.assistantMessage.trimStart();
    const remainder = finalText.startsWith(existingText)
      ? finalText.slice(existingText.length)
      : "";
    const hasFollowingContent =
      last &&
      next
        .slice(last.index + 1)
        .some((item) => isTurnItem(item, update.turnId));
    if (!last || (remainder && hasFollowingContent)) {
      const segmentIndex = last
        ? (last.item.segmentIndex ?? segments.length - 1) + 1
        : 0;
      next.push({
        id: getAssistantSegmentId(update.turnId, segmentIndex),
        kind: "message",
        role: "assistant",
        documentId,
        turnId: update.turnId,
        segmentIndex,
        text: last ? remainder : update.assistantMessage,
        branchAnchorId: update.branchAnchorId,
        createdAt: nowIso,
        isStreaming: false,
      });
    } else if (last) {
      const prefix = segments
        .slice(0, -1)
        .map(({ item }) => item.text)
        .join("")
        .trimStart();
      const replacement = finalText.startsWith(prefix)
        ? finalText.slice(prefix.length)
        : undefined;
      next[last.index] = {
        ...last.item,
        documentId: last.item.documentId ?? documentId,
        // Trimming the aggregate must not duplicate earlier replies into the final one.
        text:
          existingText.trimEnd() === finalText.trimEnd()
            ? last.item.text
            : remainder
              ? last.item.text + remainder
              : (replacement ?? last.item.text),
        branchAnchorId: last.item.branchAnchorId ?? update.branchAnchorId,
      };
    }
  }
  return {
    timeline: markTurnCompleted(next, update, nowIso),
    touchedSession: next.length !== prev.length,
  };
};

export const applyToolUpdateToTimeline = (
  prev: AiChatTimelineItem[],
  update: AiChatToolUpdate,
  nowIso: string,
  defaultDocumentId?: string,
  resolveDocumentId: (id: string) => string = (id) => id,
): TimelineMutationResult => {
  if (update.phase === "start") {
    const turnId = getTurnIdFromBatchId(update.batchId);
    const explicitDocumentId = getObjectRecord(update.call.args)?.document_id;
    const item: AiChatTimelineItem = {
      id: update.call.id,
      kind: "tool",
      toolCallId: update.call.id,
      documentId:
        update.call.name === "list_open_documents"
          ? undefined
          : typeof explicitDocumentId === "string"
            ? resolveDocumentId(explicitDocumentId)
            : defaultDocumentId,
      turnId,
      batchId: update.batchId,
      isParallelBatch: update.isParallelBatch,
      toolName: update.call.name as AiToolName,
      status: "running",
      argsText: stringifyToolArgs(update.call.args),
      createdAt: nowIso,
    };
    const next = finishTurnSegments(prev, turnId, nowIso);
    return {
      timeline: [...next, item],
      touchedSession: true,
    };
  }

  if (update.phase === "success") {
    const payload = getObjectRecord(update.result.payload);
    const resultDocumentId = payload?.documentLinkId ?? payload?.documentId;
    return {
      timeline: prev.map((item) =>
        item.id === update.call.id && item.kind === "tool"
          ? {
              ...item,
              status: "done",
              documentId:
                typeof resultDocumentId === "string"
                  ? resolveDocumentId(resultDocumentId)
                  : item.documentId,
              resultSummary: update.result.summary,
              progressItems: undefined,
              progressCounts: undefined,
              resultText: stringifyToolPayload(update.result.payload),
              previewImages: extractToolPreviewImages(update),
            }
          : item,
      ),
      touchedSession: false,
    };
  }

  if (update.phase === "progress") {
    return {
      timeline: prev.map((item) =>
        item.id === update.call.id && item.kind === "tool"
          ? {
              ...item,
              resultSummary: update.progress.summary,
              progressItems: update.progress.items,
              progressCounts: update.progress.counts,
            }
          : item,
      ),
      touchedSession: false,
    };
  }

  return {
    timeline: prev.map((item) =>
      item.id === update.call.id && item.kind === "tool"
        ? {
            ...item,
            status: "error",
            progressItems: undefined,
            progressCounts: undefined,
            error: update.error.message,
            resultText: stringifyToolPayload({
              ok: false,
              error: update.error.message,
            }),
          }
        : item,
    ),
    touchedSession: false,
  };
};

export const settleIncompleteTimeline = (
  prev: AiChatTimelineItem[],
  nowIso: string,
) =>
  prev.map((item) => {
    if (item.kind === "tool" && item.status === "running") {
      return {
        ...item,
        status: "incomplete" as const,
        progressItems: undefined,
        progressCounts: undefined,
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
            durationMs: calculateDurationMs(item.createdAt, nowIso),
          }
        : { ...item, isStreaming: false };
    }
    return item;
  });

export const applyUsageSnapshotToTurnTimeline = (
  prev: AiChatTimelineItem[],
  options: {
    turnId: string;
    tokenUsage: AiChatTokenUsageSummary;
    contextTokens: number;
  },
) =>
  prev.map((item) => {
    const belongsToTurn =
      (item.kind === "message" &&
        item.role === "assistant" &&
        (item.turnId === options.turnId || item.id === options.turnId)) ||
      (item.kind === "tool" && item.turnId === options.turnId);
    if (!belongsToTurn) return item;

    return {
      ...item,
      tokenUsageSnapshot: { ...options.tokenUsage },
      contextTokensSnapshot: options.contextTokens,
    };
  });

export const getLatestTimelineUsageSnapshot = (
  items: AiChatTimelineItem[],
): {
  tokenUsage?: AiChatTokenUsageSummary;
  contextTokens?: number;
} | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    const hasTokenUsage = !!item.tokenUsageSnapshot;
    const hasContextTokens = typeof item.contextTokensSnapshot === "number";
    if (!hasTokenUsage && !hasContextTokens) continue;
    return {
      tokenUsage: item.tokenUsageSnapshot
        ? { ...item.tokenUsageSnapshot }
        : undefined,
      contextTokens: hasContextTokens ? item.contextTokensSnapshot : undefined,
    };
  }

  return null;
};
