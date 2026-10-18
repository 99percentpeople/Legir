import { describe, expect, test } from "vitest";

import {
  applyAssistantUpdateToTimeline,
  applyToolUpdateToTimeline,
  applyUsageSnapshotToTurnTimeline,
  getLatestTimelineUsageSnapshot,
  getThinkingItemId,
  settleIncompleteTimeline,
} from "@/hooks/useAiChatController/timelineUpdates";
import type {
  AiChatTimelineItem,
  AiChatAssistantUpdate,
  AiChatTokenUsageSummary,
  AiChatToolUpdate,
} from "@/services/ai/chat/types";

const startIso = "2026-04-29T00:00:00.000Z";
const nextIso = "2026-04-29T00:00:01.000Z";

describe("AI chat timeline updates", () => {
  test("keeps separate thinking blocks around successive calls and does not recount tool time", () => {
    let timeline: AiChatTimelineItem[] = [];
    const assistant = (update: AiChatAssistantUpdate, seconds: number) => {
      timeline = applyAssistantUpdateToTimeline(
        timeline,
        update,
        new Date(Date.parse(startIso) + seconds * 1000).toISOString(),
      ).timeline;
    };
    const delta = (
      phase: "reasoning_delta" | "delta",
      text: string,
      segmentId: string,
      seconds: number,
    ) =>
      assistant({ phase, delta: text, segmentId, turnId: "turn_1" }, seconds);
    delta("reasoning_delta", "Plan A", "1:reasoning", 0);
    delta("reasoning_delta", " continues", "1:reasoning", 1);
    assistant(
      {
        phase: "segment_end",
        role: "thinking",
        segmentId: "1:reasoning",
        turnId: "turn_1",
      },
      2,
    );
    delta("delta", " I will read. ", "1:text", 3);
    const call = {
      id: "call_1",
      name: "get_pages_text",
      args: { page_numbers: [1] },
    };
    timeline = applyToolUpdateToTimeline(
      timeline,
      {
        phase: "start",
        call,
        batchId: "turn_1:step_1",
        isParallelBatch: false,
      },
      "2026-04-29T00:00:04.000Z",
    ).timeline;
    timeline = applyToolUpdateToTimeline(
      timeline,
      {
        phase: "success",
        call,
        batchId: "turn_1:step_1",
        isParallelBatch: false,
        result: { summary: "Read", payload: {} },
      },
      "2026-04-29T00:00:10.000Z",
    ).timeline;
    delta("reasoning_delta", "Plan B", "2:reasoning", 11);
    assistant(
      {
        phase: "segment_end",
        role: "thinking",
        segmentId: "2:reasoning",
        turnId: "turn_1",
      },
      12,
    );
    delta("delta", "Final answer", "2:text", 13);
    assistant(
      {
        phase: "end",
        assistantMessage: "I will read. Final answer",
        reasoningText: "Plan A continuesPlan B",
        finishReason: "stop",
        toolCalls: [],
        durationMs: 15000,
        turnId: "turn_1",
      },
      15,
    );

    expect(
      timeline.map((item) => (item.kind === "tool" ? item.id : item.text)),
    ).toEqual([
      "Plan A continues",
      " I will read. ",
      "call_1",
      "Plan B",
      "Final answer",
    ]);
    expect(timeline[0]).toMatchObject({
      id: "turn_1:thinking",
      durationMs: 2000,
      isStreaming: false,
    });
    expect(timeline[3]).toMatchObject({
      id: "turn_1:thinking_1",
      durationMs: 1000,
      isStreaming: false,
    });
    expect(timeline.at(-1)).toMatchObject({
      isFinalAnswer: true,
      turnCompleted: true,
      turnDurationMs: 15000,
    });
  });

  test("splits consecutive SDK reasoning blocks and ignores a late end for the previous block", () => {
    let timeline = applyAssistantUpdateToTimeline(
      [],
      {
        phase: "reasoning_delta",
        turnId: "turn_1",
        segmentId: "1:a",
        delta: "First",
      },
      startIso,
    ).timeline;
    timeline = applyAssistantUpdateToTimeline(
      timeline,
      {
        phase: "reasoning_delta",
        turnId: "turn_1",
        segmentId: "1:b",
        delta: "Second",
      },
      nextIso,
    ).timeline;
    timeline = applyAssistantUpdateToTimeline(
      timeline,
      {
        phase: "segment_end",
        turnId: "turn_1",
        role: "thinking",
        segmentId: "1:a",
      },
      nextIso,
    ).timeline;
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      text: "First",
      isStreaming: false,
      durationMs: 1000,
    });
    expect(timeline[1]).toMatchObject({ text: "Second", isStreaming: true });
  });

  test("tool execution closes reasoning even if the provider omits a block end", () => {
    const thinking = applyAssistantUpdateToTimeline(
      [],
      { phase: "reasoning_delta", turnId: "turn_1", delta: "Before tool" },
      startIso,
    ).timeline;
    const withTool = applyToolUpdateToTimeline(
      thinking,
      {
        phase: "start",
        call: { id: "call_1", name: "get_pages_text", args: {} },
        batchId: "turn_1:step_1",
        isParallelBatch: false,
      },
      nextIso,
    ).timeline;
    const resumed = applyAssistantUpdateToTimeline(
      withTool,
      { phase: "reasoning_delta", turnId: "turn_1", delta: "After tool" },
      nextIso,
    ).timeline;
    expect(resumed.map((item) => item.id)).toEqual([
      "turn_1:thinking",
      "call_1",
      "turn_1:thinking_1",
    ]);
    expect(resumed[0]).toMatchObject({ durationMs: 1000, isStreaming: false });
  });

  test("a stopped or truncated response is not a completed final answer", () => {
    const streaming = applyAssistantUpdateToTimeline(
      [],
      { phase: "delta", turnId: "turn_1", delta: "Partial answer" },
      startIso,
    ).timeline;
    expect(settleIncompleteTimeline(streaming, nextIso)[0]).not.toHaveProperty(
      "turnCompleted",
    );
    const limited = applyAssistantUpdateToTimeline(
      streaming,
      {
        phase: "end",
        turnId: "turn_1",
        reasoningText: "",
        assistantMessage: "Partial answer",
        finishReason: "stop",
        isFinalAnswer: false,
        toolCalls: [],
      },
      nextIso,
    ).timeline;
    expect(limited[0]).toMatchObject({
      isStreaming: false,
      isFinalAnswer: false,
      turnCompleted: true,
    });
  });

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
      turnCompleted: undefined,
    });
    expect(result[1]).toMatchObject({
      role: "assistant",
      text: "Partial answer",
      isStreaming: false,
      turnCompleted: true,
    });
  });

  test("final assistant update can replace a mismatched streaming prefix", () => {
    const result = applyAssistantUpdateToTimeline(
      [
        {
          id: "turn_1",
          kind: "message",
          role: "assistant",
          turnId: "turn_1",
          segmentIndex: 0,
          text: "stale streamed prefix: ",
          createdAt: startIso,
          isStreaming: true,
        },
      ],
      {
        phase: "end",
        turnId: "turn_1",
        reasoningText: "",
        assistantMessage: "Final answer.",
        toolCalls: [],
        finishReason: "stop",
      },
      nextIso,
    ).timeline;

    expect(result[0]).toMatchObject({
      role: "assistant",
      text: "Final answer.",
      isStreaming: false,
      turnCompleted: true,
    });
  });

  test("marks the last tool item as completed when a turn ends without assistant text", () => {
    const started = applyToolUpdateToTimeline(
      [],
      {
        phase: "start",
        batchId: "turn_1:step_1",
        isParallelBatch: false,
        call: {
          id: "call_1",
          name: "get_pages_text",
          args: { page_numbers: [1] },
        },
      },
      startIso,
    ).timeline;

    const ended = applyAssistantUpdateToTimeline(
      started,
      {
        phase: "end",
        turnId: "turn_1",
        reasoningText: "",
        assistantMessage: "",
        toolCalls: [],
        finishReason: "tool_calls",
      },
      nextIso,
    ).timeline;

    expect(ended[0]).toMatchObject({
      kind: "tool",
      id: "call_1",
      turnCompleted: true,
    });
  });

  test("applies tool lifecycle updates and extracts visual previews", () => {
    const startUpdate: AiChatToolUpdate = {
      phase: "start",
      batchId: "turn_1:step_1",
      isParallelBatch: true,
      call: {
        id: "call_1",
        name: "inspect_pages_visual",
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
          counts: { pending: 0, running: 1, done: 0 },
        },
      },
      nextIso,
    ).timeline;
    expect(progressed[0]).toMatchObject({
      resultSummary: "Rendering",
      progressCounts: { pending: 0, running: 1, done: 0 },
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

    const finalized = settleIncompleteTimeline(timeline, nextIso);
    expect(finalized[0]).toMatchObject({ isStreaming: false });
    expect(finalized[1]).toMatchObject({ status: "incomplete" });
    expect(
      finalized[1]?.kind === "tool" ? finalized[1].error : undefined,
    ).toBeUndefined();

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
