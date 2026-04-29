import { describe, expect, test } from "vitest";

import {
  buildConversationMessageContent,
  createAiChatSessionData,
  normalizeTimelineForPersist,
  restoreConversationFromTimeline,
  setAiChatRuntimeTimelineBoundary,
  sliceAiChatRuntimeTranscriptForTimelinePrefix,
  syncAiChatSessionConversation,
} from "@/hooks/useAiChatController/sessionPersistence";
import type {
  AiChatMessageRecord,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";

const nowIso = "2026-04-29T00:00:00.000Z";

describe("AI chat session persistence", () => {
  test("builds conversation text with selection and annotation attachments", () => {
    const content = buildConversationMessageContent("Review this.", [
      {
        kind: "workspace_selection",
        pageIndex: 1,
        startOffset: 10,
        endOffset: 20,
        rect: { x: 10, y: 20, width: 100, height: 12 },
        text: "selected text",
      },
      {
        kind: "annotation_reference",
        annotationId: "annot_1",
        annotationType: "highlight",
        pageIndex: 0,
        highlightedText: "highlighted",
        text: "note",
      },
    ]);

    expect(content).toContain("Review this.");
    expect(content).toContain("SELECTION_ATTACHMENT");
    expect(content).toContain("page_number: 2");
    expect(content).toContain("ANNOTATION_ATTACHMENT");
    expect(content).toContain("annotation_id: annot_1");
  });

  test("restores user, assistant, and tool messages from persisted timeline", () => {
    const timeline: AiChatTimelineItem[] = [
      {
        id: "user_1",
        kind: "message",
        role: "user",
        text: "Visible user text",
        conversationText: "Conversation user text",
        createdAt: nowIso,
      },
      {
        id: "turn_1:thinking",
        kind: "message",
        role: "thinking",
        text: "hidden reasoning",
        createdAt: nowIso,
      },
      {
        id: "turn_1",
        kind: "message",
        role: "assistant",
        turnId: "turn_1",
        segmentIndex: 0,
        text: "First part. ",
        createdAt: nowIso,
      },
      {
        id: "turn_1:segment_1",
        kind: "message",
        role: "assistant",
        turnId: "turn_1",
        segmentIndex: 1,
        text: "Second part.",
        createdAt: nowIso,
      },
      {
        id: "call_1",
        kind: "tool",
        toolCallId: "call_1",
        turnId: "turn_1",
        batchId: "turn_1:step_1",
        toolName: "get_pages_text",
        status: "done",
        argsText: JSON.stringify({ page_numbers: [1] }),
        resultText: JSON.stringify({ ok: true, text: "page text" }),
        createdAt: nowIso,
      },
    ];

    const conversation = restoreConversationFromTimeline(timeline);

    expect(conversation).toHaveLength(4);
    expect(conversation[0]).toEqual({
      role: "user",
      content: "Conversation user text",
    });
    expect(conversation[1]).toEqual({
      role: "assistant",
      content: "First part. Second part.",
    });
    expect(conversation[2]).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "get_pages_text",
          input: { page_numbers: [1] },
        },
      ],
    });
    expect(conversation[3]).toMatchObject({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "get_pages_text",
          output: { type: "json", value: { ok: true, text: "page text" } },
        },
      ],
    });
  });

  test("slices runtime transcript by timeline boundary without losing reasoning parts", () => {
    const session = createAiChatSessionData("session_1", nowIso);
    const conversation: AiChatMessageRecord[] = [
      { role: "user", content: "Read page 1." },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Need to inspect text first." },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "get_pages_text",
            input: { page_numbers: [1] },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "get_pages_text",
            output: { type: "json", value: { ok: true } },
          },
        ],
      },
      { role: "assistant", content: "Done." },
    ] as AiChatMessageRecord[];
    syncAiChatSessionConversation({
      session,
      conversation,
      updatedAt: nowIso,
    });
    setAiChatRuntimeTimelineBoundary({
      session,
      timelineItemId: "call_1",
      messageCount: 3,
    });

    const sliced = sliceAiChatRuntimeTranscriptForTimelinePrefix({
      sourceSession: session,
      timeline: [
        {
          id: "call_1",
          kind: "tool",
          toolCallId: "call_1",
          turnId: "turn_1",
          batchId: "turn_1:step_1",
          toolName: "get_pages_text",
          status: "done",
          argsText: "{}",
          createdAt: nowIso,
        },
      ],
    });

    expect(sliced.messages).toHaveLength(3);
    expect(sliced.messages[1]).toEqual(conversation[1]);
  });

  test("normalizes timeline for persistence by trimming transient tool payloads", () => {
    const normalized = normalizeTimelineForPersist([
      {
        id: "call_1",
        kind: "tool",
        toolCallId: "call_1",
        toolName: "get_pages_visual",
        status: "running",
        argsText: "{}",
        resultSummary: "Loading",
        previewImages: [
          {
            id: "preview_1",
            src: "data:image/png;base64,abc",
            alt: "Page 1",
            label: "Page 1",
          },
        ],
        progressDetails: Array.from(
          { length: 20 },
          (_, index) => `detail ${index}`,
        ),
        createdAt: nowIso,
      },
    ]);

    const item = normalized[0];
    expect(item?.kind).toBe("tool");
    if (item?.kind !== "tool") return;
    expect(item.previewImages).toBeUndefined();
    expect(item.progressDetails).toHaveLength(16);
  });
});
