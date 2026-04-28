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
type AssistantTimelineSegment = MessageTimelineItem & {
  role: "assistant";
};

export const getThinkingItemId = (turnId: string) => `${turnId}:thinking`;
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

const isAssistantTurnSegment = (
  item: AiChatTimelineItem,
  turnId: string,
): item is AssistantTimelineSegment =>
  item.kind === "message" &&
  item.role === "assistant" &&
  (item.turnId === turnId || item.id === turnId);

const isToolTurnItem = (item: AiChatTimelineItem, turnId: string) =>
  item.kind === "tool" &&
  (item.turnId === turnId ||
    (typeof item.batchId === "string" &&
      getTurnIdFromBatchId(item.batchId) === turnId));

const getAssistantTurnSegments = (
  items: AiChatTimelineItem[],
  turnId: string,
) =>
  items.flatMap((item, index) =>
    isAssistantTurnSegment(item, turnId) ? [{ item, index }] : [],
  );

const resolveFinalThinkingText = (currentText: string, finalText: string) => {
  const current = currentText.trim();
  const final = finalText.trim();

  if (!current) return finalText;
  if (!final) return currentText;
  if (final.startsWith(current)) return finalText;
  if (current.startsWith(final)) return currentText;

  return currentText;
};

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
): TimelineMutationResult => {
  if (update.phase === "reasoning_delta") {
    const thinkingId = getThinkingItemId(update.turnId);
    const idx = prev.findIndex((item) => item.id === thinkingId);
    if (idx < 0) {
      const nextItem: AiChatTimelineItem = {
        id: thinkingId,
        kind: "message",
        role: "thinking",
        text: update.delta,
        showCollapsedPreview: update.showCollapsedPreview,
        createdAt: nowIso,
        isStreaming: true,
      };
      const assistantIdx = prev.findIndex((item) => item.id === update.turnId);
      const next = prev.slice();
      if (assistantIdx >= 0) next.splice(assistantIdx, 0, nextItem);
      else next.push(nextItem);
      return { timeline: next, touchedSession: true };
    }

    const current = prev[idx];
    if (!current || current.kind !== "message") {
      return { timeline: prev, touchedSession: false };
    }

    const next = prev.slice();
    next[idx] = {
      ...current,
      role: "thinking",
      text: `${current.text}${update.delta}`,
      showCollapsedPreview:
        update.showCollapsedPreview ?? current.showCollapsedPreview,
      isStreaming: true,
    };
    return { timeline: next, touchedSession: false };
  }

  if (update.phase === "delta") {
    const thinkingId = getThinkingItemId(update.turnId);
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

    const assistantSegments = getAssistantTurnSegments(next, update.turnId);
    const lastSegment = assistantSegments.at(-1);
    const shouldCreateNewSegment =
      !lastSegment ||
      next.some(
        (item, index) =>
          index > lastSegment.index && isToolTurnItem(item, update.turnId),
      );

    if (shouldCreateNewSegment) {
      const segmentIndex =
        (lastSegment?.item.segmentIndex ?? 0) + (lastSegment ? 1 : 0);
      next.push({
        id: getAssistantSegmentId(update.turnId, segmentIndex),
        kind: "message",
        role: "assistant",
        turnId: update.turnId,
        segmentIndex,
        text: update.delta,
        branchAnchorId: update.branchAnchorId,
        createdAt: nowIso,
        isStreaming: true,
      });
      return { timeline: next, touchedSession: true };
    }

    const current = lastSegment.item;

    next[lastSegment.index] = {
      ...current,
      role: "assistant",
      text: `${current.text}${update.delta}`,
      branchAnchorId: current.branchAnchorId ?? update.branchAnchorId,
      isStreaming: true,
    };
    return { timeline: next, touchedSession: false };
  }

  const thinkingId = getThinkingItemId(update.turnId);
  if (!update.assistantMessage && !update.reasoningText) {
    return {
      timeline: prev.map((item) => {
        if (isAssistantTurnSegment(item, update.turnId)) {
          return { ...item, isStreaming: false };
        }
        if (item.id === thinkingId && item.kind === "message") {
          return {
            ...item,
            isStreaming: false,
            durationMs: calculateDurationMs(item.createdAt),
          };
        }
        return item;
      }),
      touchedSession: false,
    };
  }

  const next = prev.slice();
  const assistantSegments = getAssistantTurnSegments(next, update.turnId);
  const assistantExistingIdx = assistantSegments[0]?.index ?? -1;

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
      showCollapsedPreview:
        update.showCollapsedPreview ??
        (thinkingIdx >= 0 &&
        next[thinkingIdx]?.kind === "message" &&
        next[thinkingIdx]?.role === "thinking"
          ? next[thinkingIdx].showCollapsedPreview
          : undefined),
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
    } else {
      next[thinkingIdx] = thinkingItem;
    }
  } else {
    const thinkingIdx = next.findIndex((item) => item.id === thinkingId);
    if (thinkingIdx >= 0) {
      const current = next[thinkingIdx];
      if (current?.kind === "message") {
        next[thinkingIdx] = {
          ...current,
          isStreaming: false,
          durationMs: calculateDurationMs(current.createdAt, nowIso),
        };
      }
    }
  }

  if (!update.assistantMessage) {
    return { timeline: next, touchedSession: true };
  }

  const currentSegments = getAssistantTurnSegments(next, update.turnId);
  const lastSegment = currentSegments.at(-1);
  if (!lastSegment) {
    next.push({
      id: update.turnId,
      kind: "message",
      role: "assistant",
      turnId: update.turnId,
      segmentIndex: 0,
      text: update.assistantMessage,
      branchAnchorId: update.branchAnchorId,
      createdAt: nowIso,
      isStreaming: false,
    });
  } else {
    const current = lastSegment.item;
    const existingText = currentSegments.map(({ item }) => item.text).join("");
    const remainder = update.assistantMessage.startsWith(existingText)
      ? update.assistantMessage.slice(existingText.length)
      : "";
    const hasToolAfterLastSegment = next.some(
      (item, index) =>
        index > lastSegment.index && isToolTurnItem(item, update.turnId),
    );

    if (remainder && hasToolAfterLastSegment) {
      next[lastSegment.index] = {
        ...current,
        role: "assistant",
        branchAnchorId: current.branchAnchorId ?? update.branchAnchorId,
        isStreaming: false,
      };
      next.push({
        id: getAssistantSegmentId(
          update.turnId,
          (lastSegment.item.segmentIndex ?? 0) + 1,
        ),
        kind: "message",
        role: "assistant",
        turnId: update.turnId,
        segmentIndex: (lastSegment.item.segmentIndex ?? 0) + 1,
        text: remainder,
        branchAnchorId: current.branchAnchorId ?? update.branchAnchorId,
        createdAt: nowIso,
        isStreaming: false,
      });
    } else {
      next[lastSegment.index] = {
        ...current,
        role: "assistant",
        text: remainder ? `${current.text}${remainder}` : current.text,
        branchAnchorId: current.branchAnchorId ?? update.branchAnchorId,
        isStreaming: false,
      };
    }

    for (const segment of currentSegments.slice(0, -1)) {
      const segmentItem = next[segment.index];
      if (segmentItem && isAssistantTurnSegment(segmentItem, update.turnId)) {
        next[segment.index] = {
          ...segmentItem,
          isStreaming: false,
        };
      }
    }
  }

  return { timeline: next, touchedSession: false };
};

export const applyToolUpdateToTimeline = (
  prev: AiChatTimelineItem[],
  update: AiChatToolUpdate,
  nowIso: string,
): TimelineMutationResult => {
  if (update.phase === "start") {
    const turnId = getTurnIdFromBatchId(update.batchId);
    const item: AiChatTimelineItem = {
      id: update.call.id,
      kind: "tool",
      toolCallId: update.call.id,
      turnId,
      batchId: update.batchId,
      isParallelBatch: update.isParallelBatch,
      toolName: update.call.name as AiToolName,
      status: "running",
      argsText: stringifyToolArgs(update.call.args),
      createdAt: nowIso,
    };
    const next = prev.map((entry) => {
      if (isAssistantTurnSegment(entry, turnId) && entry.isStreaming) {
        return { ...entry, isStreaming: false };
      }
      return entry;
    });
    return {
      timeline: [...next, item],
      touchedSession: true,
    };
  }

  if (update.phase === "success") {
    return {
      timeline: prev.map((item) =>
        item.id === update.call.id && item.kind === "tool"
          ? {
              ...item,
              status: "done",
              resultSummary: update.result.summary,
              progressDetails: undefined,
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
              progressDetails: update.progress.details,
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
            progressDetails: undefined,
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

export const finalizeStreamingTimeline = (
  prev: AiChatTimelineItem[],
  nowIso: string,
  toolError: string,
) =>
  prev.map((item) => {
    if (item.kind === "tool" && item.status === "running") {
      return {
        ...item,
        status: "error" as const,
        error: toolError,
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
