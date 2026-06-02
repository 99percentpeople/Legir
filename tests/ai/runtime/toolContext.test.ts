import { beforeEach, describe, expect, test } from "vitest";
import type { MutableRefObject } from "react";

import { createAiChatToolContext } from "@/hooks/useAiChatController/toolContext";
import type { AiChatSessionData } from "@/hooks/useAiChatController/sessionPersistence";
import { useEditorStore } from "@/store/useEditorStore";
import type { AiStoredSearchResult } from "@/services/ai/chat/types";
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
    useEditorStore.setState({
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

    const state = useEditorStore.getState();
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
      sortTop: 120,
      sortLeft: 72,
      rect: { x: 72, y: 120, width: 64, height: 14 },
      rects: [{ x: 72, y: 120, width: 64, height: 14 }],
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

    const state = useEditorStore.getState();
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
