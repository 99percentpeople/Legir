import type { AiChatTimelineItem } from "@/services/ai/chat/types";
import type { TimelineContentEntry, TimelineRenderEntry } from "./types";

const groupParallelTools = (
  timeline: AiChatTimelineItem[],
): TimelineContentEntry[] => {
  const entries: TimelineContentEntry[] = [];
  for (const item of timeline) {
    const previous = entries.at(-1);
    if (item.kind === "tool" && item.isParallelBatch && item.batchId) {
      if (
        previous?.kind === "tool_batch" &&
        previous.items[0]?.batchId === item.batchId
      ) {
        previous.items.push(item);
        continue;
      }
      if (
        previous?.kind === "item" &&
        previous.item.kind === "tool" &&
        previous.item.isParallelBatch &&
        previous.item.batchId === item.batchId
      ) {
        entries[entries.length - 1] = {
          kind: "tool_batch",
          id: `${item.batchId}:${previous.item.id}`,
          items: [previous.item, item],
        };
        continue;
      }
    }
    entries.push({ kind: "item", item });
  }
  return entries;
};

/** Keep the stored transcript flat; collapse only its completed presentation. */
export const buildTimelineRenderEntries = (
  timeline: AiChatTimelineItem[],
): TimelineRenderEntry[] => {
  const entries: TimelineRenderEntry[] = [];
  let pending: AiChatTimelineItem[] = [];
  const flush = () => {
    entries.push(...groupParallelTools(pending));
    pending = [];
  };

  for (const item of timeline) {
    if (item.kind === "message" && item.role === "user") {
      flush();
      entries.push({ kind: "item", item });
      continue;
    }
    pending.push(item);
    if (
      item.kind !== "message" ||
      item.role !== "assistant" ||
      !item.turnCompleted ||
      item.isFinalAnswer === false ||
      item.isStreaming ||
      !item.text.trim() ||
      pending.some(
        (entry) => entry.kind === "tool" && entry.status === "running",
      )
    )
      continue;

    const activity = pending.slice(0, -1);
    if (!activity.length) {
      flush();
      continue;
    }
    // Continue can span several model runs. Sum measured processing time, excluding
    // the wait for the user's Continue action. Legacy history may have no timings.
    const durations = new Map<string, number>();
    for (const entry of pending) {
      if (
        entry.turnCompleted &&
        entry.turnId &&
        typeof entry.turnDurationMs === "number" &&
        Number.isFinite(entry.turnDurationMs) &&
        entry.turnDurationMs >= 0
      ) {
        durations.set(entry.turnId, entry.turnDurationMs);
      }
    }
    entries.push({
      kind: "completed_turn",
      id: item.id,
      activity: groupParallelTools(activity),
      finalMessage: item,
      durationMs: pending.every(
        (entry) => entry.turnId && durations.has(entry.turnId),
      )
        ? [...durations.values()].reduce((sum, duration) => sum + duration, 0)
        : undefined,
    });
    pending = [];
  }
  flush();
  return entries;
};
