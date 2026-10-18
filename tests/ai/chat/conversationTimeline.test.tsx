import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LanguageProvider } from "@/components/language-provider";
import { ConversationTimeline } from "@/components/properties-panel/AiChatPanel/ConversationTimeline";
import { buildTimelineRenderEntries } from "@/components/properties-panel/AiChatPanel/timeline";
import { normalizeTimelineForPersist } from "@/hooks/useAiChatController/sessionPersistence";
import type { AiChatTimelineItem } from "@/services/ai/chat/types";

type MessageItem = Extract<AiChatTimelineItem, { kind: "message" }>;

const createdAt = "2026-10-17T00:00:00.000Z";
const message = (
  id: string,
  role: "user" | "assistant" | "thinking",
  text: string,
): MessageItem => ({
  id,
  role,
  text,
  kind: "message",
  turnId: role === "user" ? undefined : "turn",
  createdAt,
  durationMs: role === "thinking" ? 1000 : undefined,
});
const activity: AiChatTimelineItem[] = [
  message("user", "user", "Read the document"),
  message("think-1", "thinking", "First reasoning"),
  message("interim", "assistant", "Reading the page"),
  {
    id: "call",
    kind: "tool",
    toolCallId: "call",
    turnId: "turn",
    toolName: "get_pages_text",
    status: "done",
    argsText: "{}",
    resultSummary: "Page read",
    createdAt,
  },
  message("think-2", "thinking", "Second reasoning"),
];
const finalAnswer: MessageItem = {
  ...message("final", "assistant", "Final answer"),
  turnCompleted: true,
  isFinalAnswer: true,
  turnDurationMs: 12000,
};

describe("timeline activity grouping", () => {
  test("preserves persisted segments and timing while grouping a completed response", () => {
    const original = [...activity, finalAnswer];
    const restored = JSON.parse(
      JSON.stringify(normalizeTimelineForPersist(original)),
    ) as AiChatTimelineItem[];
    expect(buildTimelineRenderEntries(restored)).toMatchObject([
      { kind: "item", item: { role: "user" } },
      {
        kind: "completed_turn",
        durationMs: 12000,
        finalMessage: { text: "Final answer" },
        activity: [
          { kind: "item", item: { text: "First reasoning" } },
          { kind: "item", item: { text: "Reading the page" } },
          { kind: "item", item: { id: "call" } },
          { kind: "item", item: { text: "Second reasoning" } },
        ],
      },
    ]);
    expect(restored).toEqual(original);
  });

  test("keeps running and unfinished turns outside completed activity", () => {
    for (const final of [
      { ...finalAnswer, isFinalAnswer: false },
      { ...finalAnswer, isStreaming: true },
      { ...finalAnswer, turnCompleted: false },
    ]) {
      expect(
        buildTimelineRenderEntries([...activity, final]).some(
          (entry) => entry.kind === "completed_turn",
        ),
      ).toBe(false);
    }
  });

  test("groups continued runs and parallel calls, sums run durations, and retains user boundaries", () => {
    const tool = activity[3]!;
    if (tool.kind !== "tool") throw new Error("Expected tool fixture");
    const limited: AiChatTimelineItem[] = [
      ...activity.slice(0, 3),
      { ...tool, isParallelBatch: true, batchId: "batch" },
      {
        ...tool,
        id: "call-2",
        toolCallId: "call-2",
        isParallelBatch: true,
        batchId: "batch",
        turnCompleted: true,
        turnDurationMs: 5000,
      },
    ];
    expect(buildTimelineRenderEntries(limited).at(-1)).toMatchObject({
      kind: "tool_batch",
    });
    const completed = buildTimelineRenderEntries([
      ...limited,
      { ...finalAnswer, turnId: "continued", turnDurationMs: 7000 },
    ]);
    expect(completed.at(-1)).toMatchObject({
      kind: "completed_turn",
      durationMs: 12000,
    });
    const separated = buildTimelineRenderEntries([
      ...limited,
      message("user-2", "user", "New question"),
      { ...finalAnswer, turnId: "new" },
    ]);
    expect(separated.some((entry) => entry.kind === "completed_turn")).toBe(
      false,
    );
  });
});

describe("completed activity disclosure", () => {
  let node: HTMLDivElement;
  let root: Root;
  const openDocumentLink = vi.fn();
  const render = async (timeline: AiChatTimelineItem[], isBusy: boolean) =>
    act(async () => {
      root.render(
        <LanguageProvider defaultLanguage="en">
          <ConversationTimeline
            timeline={timeline}
            sessions={[]}
            activeSessionId="session"
            inlineEditState={null}
            inlineEditTextareaRef={{ current: null }}
            copiedMessageId={null}
            isBusy={isBusy}
            endRef={null}
            onSelectSession={vi.fn()}
            onCopyMessage={vi.fn()}
            onEditUserMessage={vi.fn()}
            onRegenerateMessage={vi.fn()}
            onOpenDocumentLink={openDocumentLink}
            onActivateAttachment={vi.fn()}
            onInlineEditChange={vi.fn()}
            onInlineEditSubmit={vi.fn()}
            onCancelInlineEdit={vi.fn()}
            onRemoveInlineEditAttachment={vi.fn()}
          />
        </LanguageProvider>,
      );
    });
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    node = document.createElement("div");
    document.body.append(node);
    root = createRoot(node);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  });

  test("uses explicit PDF identity for links in final answers and expanded activity", async () => {
    await render(
      [
        ...activity.map((item) =>
          item.id === "interim"
            ? { ...item, text: "[Page 2](#page=2&document=d_AAAAAAAAAAAA)" }
            : item,
        ),
        {
          ...finalAnswer,
          text: "[Field](#control=field&document=d_BBBBBBBBBBBB)",
        },
      ],
      false,
    );
    await act(async () =>
      node.querySelector<HTMLAnchorElement>('a[href^="#control="]')!.click(),
    );
    expect(openDocumentLink).toHaveBeenLastCalledWith({
      kind: "control",
      controlId: "field",
      documentId: "d_BBBBBBBBBBBB",
    });
    await act(async () =>
      node
        .querySelector<HTMLButtonElement>("[data-ai-turn-activity] button")!
        .click(),
    );
    await act(async () =>
      node
        .querySelector<HTMLAnchorElement>('a[href^="#page=2&document="]')!
        .click(),
    );
    expect(openDocumentLink).toHaveBeenLastCalledWith({
      kind: "page",
      pageNumber: 2,
      documentId: "d_AAAAAAAAAAAA",
    });
  });

  test("does not navigate links without a PDF identity", async () => {
    openDocumentLink.mockClear();
    await render(
      [
        {
          ...finalAnswer,
          text: "[Old page](#page=2) [Old field](#control=field) [Old result](#result=result)",
        },
      ],
      false,
    );
    const anchors = node.querySelectorAll("a");
    expect(anchors).toHaveLength(3);
    for (const anchor of anchors) {
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        anchor.dispatchEvent(click);
      });
      expect(click.defaultPrevented).toBe(true);
    }
    expect(openDocumentLink).not.toHaveBeenCalled();
  });

  test("shows separate thinking bubbles while running and auto-collapses all prior content only after the final answer", async () => {
    await render(activity, true);
    expect(
      node.querySelectorAll('button[aria-label="Thought for 1s"]'),
    ).toHaveLength(2);
    expect(node.textContent).toContain("Reading the page");
    expect(node.querySelector("[data-ai-turn-activity]")).toBeNull();
    await render(
      [
        ...activity,
        { ...finalAnswer, turnCompleted: false, isStreaming: true },
      ],
      true,
    );
    expect(node.textContent).toContain("Reading the page");
    await render([...activity, finalAnswer], false);
    const disclosure = node.querySelector<HTMLElement>(
      "[data-ai-turn-activity]",
    )!;
    const toggle = disclosure.querySelector<HTMLButtonElement>("button")!;
    expect(toggle.textContent).toBe("Activity · 12s");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(node.textContent).toContain("Final answer");
    expect(node.textContent).not.toContain("Reading the page");
    expect(disclosure.textContent).not.toContain("Final answer");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(disclosure.textContent).toContain("Reading the page");
    expect(disclosure.textContent).toContain("Page read");
    expect(
      disclosure.querySelectorAll('button[aria-label="Thought for 1s"]'),
    ).toHaveLength(2);
    await act(async () =>
      disclosure
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Thought for 1s"]',
        )!
        .click(),
    );
    expect(disclosure.textContent).toContain("First reasoning");
    expect(disclosure.textContent).not.toContain("Second reasoning");
  });
});
