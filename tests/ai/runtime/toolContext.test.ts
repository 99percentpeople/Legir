import { beforeEach, describe, expect, test, vi } from "vitest";
import type { MutableRefObject } from "react";

vi.mock("@/components/workspace/lib/pdfTextRangeGeometry", () => ({
  resolvePdfSearchResultGeometry: vi.fn(async () => ({
    rect: { x: 72, y: 120, width: 64, height: 14 },
    rects: [{ x: 72, y: 120, width: 64, height: 14 }],
  })),
  resolvePdfTextRangeGeometry: vi.fn(async () => ({
    rect: { x: 72, y: 120, width: 64, height: 14 },
    rects: [{ x: 72, y: 120, width: 64, height: 14 }],
  })),
}));

import { createAiChatToolContext } from "@/hooks/useAiChatController/toolContext";
import type { AiChatSessionData } from "@/hooks/useAiChatController/sessionPersistence";
import { useEditorView } from "@/store/useEditorView";
import type { AiStoredSearchResult } from "@/services/ai/chat/types";
import { field } from "../../helpers/editorStore";
import { createAiToolRegistry } from "@/services/ai/chat/aiToolRegistry";
import type { AiToolContext } from "@/services/ai/chat/aiToolContext";
import type { PDFSearchResult } from "@/types";

const ref = <T>(current: T): MutableRefObject<T> => ({ current });

const createSession = (): AiChatSessionData =>
  ({
    id: "session_1",
    title: "Session",
    updatedAt: "2026-05-27T00:00:00.000Z",
    branchDepth: 0,
    timeline: [],
    conversation: [],
    runtimeTranscript: {
      version: 1,
      messages: [],
      updatedAt: "2026-05-27T00:00:00.000Z",
      timelineBoundaries: {},
    },
    searchResultsById: new Map(),
    highlightedResultIds: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    },
    contextTokens: 0,
    contextTokenOverhead: 0,
    runStatus: "idle",
    lastError: null,
    awaitingContinue: false,
  }) satisfies AiChatSessionData;

const createToolContext = (options?: {
  searchResultsRef?: MutableRefObject<Map<string, AiStoredSearchResult>>;
}) =>
  createAiChatToolContext({
    searchResultsRef:
      options?.searchResultsRef ?? ref(new Map<string, AiStoredSearchResult>()),
    searchSeqRef: ref(0),
    sessionsRef: ref(new Map([["session_1", createSession()]])),
    activeSessionIdRef: ref("session_1"),
    setHighlightedResultIds: () => {},
    formToolsEnabled: true,
    selectedChatModelAuthor: "AI",
  });

describe("AI chat tool context", () => {
  beforeEach(() => {
    useEditorView.setState({
      pages: [
        {
          pageIndex: 0,
          width: 612,
          height: 792,
          viewBox: [0, 0, 612, 792],
          userUnit: 1,
          rotation: 0,
        },
      ],
      fields: [],
      annotations: [],
      selectedId: null,
      isDirty: false,
      past: [],
      future: [],
    });
  });

  test("mixed annotation patches use one undo checkpoint and reject mismatched/duplicate targets", async () => {
    useEditorView.setState({
      annotations: [
        {
          id: "note",
          type: "comment",
          pageIndex: 0,
          text: "before",
          color: "#123456",
        },
        {
          id: "highlight",
          type: "highlight",
          pageIndex: 0,
          text: "old",
          color: "#123456",
          rect: { x: 10, y: 20, width: 50, height: 10 },
        },
        {
          id: "shape",
          type: "shape",
          shapeType: "square",
          pageIndex: 0,
          color: "#123456",
          rect: { x: 10, y: 20, width: 50, height: 50 },
        },
      ],
    });
    const registry = createAiToolRegistry(createToolContext() as AiToolContext);
    const result = await registry.execute("update_annotations", {
      updates: [
        { annotation_id: "note", text: "" },
        {
          annotation_id: "highlight",
          annotation_type: "highlight",
          text: "new",
          style: { color: "#ff0000" },
        },
        { annotation_id: "shape", annotation_type: "shape", rect: { x: 40 } },
        { annotation_id: "shape", text: "duplicate" },
        {
          annotation_id: "note",
          annotation_type: "freetext",
          style: { font_size: 15 },
        },
        { annotation_id: "missing", text: "no" },
      ],
    });
    expect(result.payload).toMatchObject({ updatedCount: 3, rejectedCount: 3 });
    const state = useEditorView.getState();
    expect(state.annotations[0]).toMatchObject({ text: "", color: "#123456" });
    expect(state.annotations[1]).toMatchObject({
      text: "new",
      color: "#ff0000",
      rect: { x: 10 },
    });
    expect(state.annotations[2]).toMatchObject({ rect: { x: 40, width: 50 } });
    expect(state.past).toHaveLength(1);
    state.undo();
    expect(useEditorView.getState().annotations[0]!.text).toBe("before");
    expect(useEditorView.getState().annotations[1]!.color).toBe("#123456");
    expect(useEditorView.getState().annotations[2]!.rect!.x).toBe(10);
  });

  test("invalid style/schema rejects the whole batch before any edits", async () => {
    useEditorView.setState({
      annotations: [
        {
          id: "note",
          type: "comment",
          pageIndex: 0,
          text: "before",
          color: "#123456",
        },
      ],
    });
    const registry = createAiToolRegistry(createToolContext() as AiToolContext);
    for (const invalid of [
      {
        annotation_id: "highlight",
        annotation_type: "highlight",
        style: { font_size: 12 },
      },
      { annotation_id: "shape", annotation_type: "shape" },
      { annotation_id: "note", rect: { x: 2 } },
    ]) {
      const result = await registry.execute("update_annotations", {
        updates: [{ annotation_id: "note", text: "changed" }, invalid],
      });
      expect(result.payload).toMatchObject({ error: "INVALID_ARGUMENTS" });
      expect(useEditorView.getState().annotations[0]!.text).toBe("before");
      expect(useEditorView.getState().past).toHaveLength(0);
    }
  });

  test("annotation and field pagination returns each matching id once and caps payloads", () => {
    const ctx = createToolContext();
    useEditorView.setState({
      fields: Array.from({ length: 505 }, (_, index) =>
        field(`f-${index}`, {
          rect: { x: 1, y: index, width: 10, height: 10 },
        }),
      ),
      annotations: Array.from({ length: 505 }, (_, index) => ({
        id: `a-${index}`,
        pageIndex: 0,
        type: "comment",
        text: "match",
        color: "#123456",
        rect: { x: index, y: index * 20, width: 10, height: 10 },
      })),
    });
    const firstFields = ctx.listFormFields({ maxResults: 999 });
    const firstAnnotations = ctx.listAnnotations({
      maxResults: 999,
      query: "match",
    });
    for (const batch of [firstFields, firstAnnotations]) {
      expect(batch).toMatchObject({
        total: 505,
        returned: 500,
        nextOffset: 500,
        truncated: true,
      });
    }
    const lastFields = ctx.listFormFields({ offset: firstFields.nextOffset! });
    const lastAnnotations = ctx.listAnnotations({
      offset: firstAnnotations.nextOffset!,
      query: "match",
    });
    for (const batch of [lastFields, lastAnnotations]) {
      expect(batch).toMatchObject({
        total: 505,
        returned: 5,
        nextOffset: null,
        truncated: false,
      });
    }
    expect(
      new Set(
        [...firstFields.fields, ...lastFields.fields].map((item) => item.id),
      ).size,
    ).toBe(505);
    expect(
      new Set(
        [...firstAnnotations.annotations, ...lastAnnotations.annotations].map(
          (item) => item.id,
        ),
      ).size,
    ).toBe(505);
    expect(ctx.listAnnotations({ offset: 999 })).toMatchObject({
      returned: 0,
      nextOffset: null,
      annotations: [],
    });
    expect(ctx.listFormFields({ offset: 999 })).toMatchObject({
      returned: 0,
      nextOffset: null,
      fields: [],
    });
  });

  test("createFormFields does not select the last created field", () => {
    const toolContext = createToolContext();

    const result = toolContext.createFormFields({
      fields: [
        {
          pageNumber: 1,
          name: "First name",
          type: "text",
          rect: { x: 72, y: 120, width: 180, height: 24 },
        },
        {
          pageNumber: 1,
          name: "Last name",
          type: "text",
          rect: { x: 72, y: 156, width: 180, height: 24 },
        },
      ],
    });

    const state = useEditorView.getState();
    expect(result.createdCount).toBe(2);
    expect(state.fields).toHaveLength(2);
    expect(state.selectedId).toBeNull();
  });

  test("createSearchHighlightAnnotations applies style overrides", async () => {
    const searchResult = {
      id: "result_1",
      pageIndex: 0,
      matchIndexOnPage: 0,
      startOffset: 0,
      endOffset: 5,
      matchText: "Hello",
      contextBefore: "",
      contextAfter: " world",
      displaySegments: [{ text: "Hello", highlighted: true }],
    } satisfies PDFSearchResult;
    const searchResultsRef = ref(
      new Map<string, AiStoredSearchResult>([
        [
          "result_1",
          {
            id: "result_1",
            query: "Hello",
            result: searchResult,
          },
        ],
      ]),
    );
    const toolContext = createToolContext({ searchResultsRef });

    const result = await toolContext.createSearchHighlightAnnotations({
      resultIds: ["result_1"],
      style: {
        color: "#ff5500",
        opacity: 0.25,
      },
    });

    const state = useEditorView.getState();
    expect(result.createdCount).toBe(1);
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0]).toMatchObject({
      type: "highlight",
      color: "#ff5500",
      opacity: 0.25,
    });
    expect(state.selectedId).toBeNull();
  });
});
