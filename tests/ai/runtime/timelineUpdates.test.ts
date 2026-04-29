import { describe, expect, test } from "vitest";

import {
  applyAssistantUpdateToTimeline,
  applyToolUpdateToTimeline,
  applyUsageSnapshotToTurnTimeline,
  finalizeStreamingTimeline,
  getLatestTimelineUsageSnapshot,
  getThinkingItemId,
} from "@/hooks/useAiChatController/timelineUpdates";
import type {
  AiChatTimelineItem,
  AiChatTokenUsageSummary,
  AiChatToolUpdate,
} from "@/services/ai/chat/types";

const startIso = "2026-04-29T00:00:00.000Z";
const nextIso = "2026-04-29T00:00:01.000Z";

describe("AI chat timeline updates", () => {
  test("streams reasoning before assistant text and closes thinking on delta", () => {
    const withReasoning = applyAssistantUpdateToTimeline(
      [],
      {
        phase: "reasoning_delta",
        turnId: "turn_1",
        delta: "Thinking...",
        showCollapsedPreview: false,
      },
      startIso,
    ).timeline;

    expect(withReasoning[0]).toMatchObject({
      id: getThinkingItemId("turn_1"),
      role: "thinking",
      text: "Thinking...",
      isStreaming: true,
      showCollapsedPreview: false,
    });

    const withAssistant = applyAssistantUpdateToTimeline(
      withReasoning,
      {
        phase: "delta",
        turnId: "turn_1",
        delta: "Answer",
        branchAnchorId: "user_1",
      },
      nextIso,
    ).timeline;

    expect(withAssistant[0]).toMatchObject({
      role: "thinking",
      isStreaming: false,
      durationMs: 1000,
    });
    expect(withAssistant[1]).toMatchObject({
      id: "turn_1",
      role: "assistant",
      text: "Answer",
      isStreaming: true,
      branchAnchorId: "user_1",
    });
  });

  test("final assistant update inserts reasoning and only appends missing assistant text", () => {
    const timeline: AiChatTimelineItem[] = [
      {
        id: "turn_1",
        kind: "message",
        role: "assistant",
        turnId: "turn_1",
        segmentIndex: 0,
        text: "Partial",
        createdAt: startIso,
        isStreaming: true,
      },
    ];

    const result = applyAssistantUpdateToTimeline(
      timeline,
      {
        phase: "end",
        turnId: "turn_1",
        reasoningText: "Final reasoning",
        assistantMessage: "Partial answer",
        toolCalls: [],
        finishReason: "stop",
      },
      nextIso,
    ).timeline;

    expect(result[0]).toMatchObject({
      role: "thinking",
      text: "Final reasoning",
      isStreaming: false,
    });
    expect(result[1]).toMatchObject({
      role: "assistant",
      text: "Partial answer",
      isStreaming: false,
    });
  });

  test("applies tool lifecycle updates and extracts visual previews", () => {
    const startUpdate: AiChatToolUpdate = {
      phase: "start",
      batchId: "turn_1:step_1",
      isParallelBatch: true,
      call: {
        id: "call_1",
        name: "get_pages_visual",
        args: { page_numbers: [1] },
      },
    };
    const started = applyToolUpdateToTimeline(
      [],
      startUpdate,
      startIso,
    ).timeline;

    expect(started[0]).toMatchObject({
      id: "call_1",
      kind: "tool",
      turnId: "turn_1",
      status: "running",
      argsText: JSON.stringify({ page_numbers: [1] }, null, 2),
    });

    const progressed = applyToolUpdateToTimeline(
      started,
      {
        ...startUpdate,
        phase: "progress",
        progress: {
          summary: "Rendering",
          details: ["page 1"],
          counts: { pending: 0, running: 1, done: 0 },
        },
      },
      nextIso,
    ).timeline;
    expect(progressed[0]).toMatchObject({
      resultSummary: "Rendering",
      progressDetails: ["page 1"],
    });

    const finished = applyToolUpdateToTimeline(
      progressed,
      {
        ...startUpdate,
        phase: "success",
        result: {
          summary: "Rendered page",
          payload: { ok: true },
          modelOutput: {
            pages: [
              {
                pageNumber: 1,
                mimeType: "image/png",
                base64Data: "abc",
                renderedWidth: 100,
                renderedHeight: 200,
              },
            ],
          },
        },
      },
      nextIso,
    ).timeline;

    const item = finished[0];
    expect(item?.kind).toBe("tool");
    if (item?.kind !== "tool") return;
    expect(item.status).toBe("done");
    expect(item.resultSummary).toBe("Rendered page");
    expect(item.resultText).toContain('"ok": true');
    expect(item.previewImages?.[0]).toMatchObject({
      src: "data:image/png;base64,abc",
      label: "Page 1",
      width: 100,
      height: 200,
    });
  });

  test("finalizes streaming items and stores latest usage snapshots", () => {
    const usage: AiChatTokenUsageSummary = {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 2,
      cachedInputTokens: 1,
    };
    const timeline: AiChatTimelineItem[] = [
      {
        id: "turn_1",
        kind: "message",
        role: "assistant",
        turnId: "turn_1",
        text: "Answer",
        createdAt: startIso,
        isStreaming: true,
      },
      {
        id: "call_1",
        kind: "tool",
        toolCallId: "call_1",
        turnId: "turn_1",
        toolName: "get_pages_text",
        status: "running",
        argsText: "{}",
        createdAt: startIso,
      },
    ];

    const finalized = finalizeStreamingTimeline(
      timeline,
      nextIso,
      "Tool failed",
    );
    expect(finalized[0]).toMatchObject({ isStreaming: false });
    expect(finalized[1]).toMatchObject({
      status: "error",
      error: "Tool failed",
    });

    const withUsage = applyUsageSnapshotToTurnTimeline(finalized, {
      turnId: "turn_1",
      tokenUsage: usage,
      contextTokens: 120,
    });
    expect(getLatestTimelineUsageSnapshot(withUsage)).toEqual({
      tokenUsage: usage,
      contextTokens: 120,
    });
  });
});
