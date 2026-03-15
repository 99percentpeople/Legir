import type {
  AiChatAssistantUpdate,
  AiChatTimelineItem,
  AiChatToolUpdate,
  AiToolName,
} from "@/services/ai/chat/types";

import {
  stringifyToolArgs,
  stringifyToolPayload,
} from "@/hooks/useAiChatController/sessionPersistence";

export const getThinkingItemId = (turnId: string) => `${turnId}:thinking`;

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

    const idx = next.findIndex((item) => item.id === update.turnId);
    if (idx < 0) {
      next.push({
        id: update.turnId,
        kind: "message",
        role: "assistant",
        text: update.delta,
        branchAnchorId: update.branchAnchorId,
        createdAt: nowIso,
        isStreaming: true,
      });
      return { timeline: next, touchedSession: true };
    }

    const current = next[idx];
    if (!current || current.kind !== "message") {
      return { timeline: prev, touchedSession: false };
    }

    next[idx] = {
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
        if (item.id === update.turnId && item.kind === "message") {
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

  const idx = next.findIndex((item) => item.id === update.turnId);
  if (idx < 0) {
    next.push({
      id: update.turnId,
      kind: "message",
      role: "assistant",
      text: update.assistantMessage,
      branchAnchorId: update.branchAnchorId,
      createdAt: nowIso,
      isStreaming: false,
    });
  } else {
    const current = next[idx];
    if (!current || current.kind !== "message") {
      return { timeline: prev, touchedSession: false };
    }
    next[idx] = {
      ...current,
      role: "assistant",
      text: update.assistantMessage,
      branchAnchorId: current.branchAnchorId ?? update.branchAnchorId,
      isStreaming: false,
    };
  }

  return { timeline: next, touchedSession: false };
};

export const applyToolUpdateToTimeline = (
  prev: AiChatTimelineItem[],
  update: AiChatToolUpdate,
  nowIso: string,
): TimelineMutationResult => {
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
    return {
      timeline: [...prev, item],
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
              resultText: stringifyToolPayload(update.result.payload),
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
