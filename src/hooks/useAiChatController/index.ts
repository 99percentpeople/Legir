import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPdfSearchSelectionOffsets } from "@/components/workspace/lib/pdfSearchHighlights";
import {
  getChatModelGroups,
  subscribeLLMModelRegistry,
  summarizeText,
} from "@/services/ai";
import { useEditorStore } from "@/store/useEditorStore";
import { type EditorState, type PDFSearchResult } from "@/types";
import { aiChatService } from "@/services/ai/chat/aiChatService";
import { createAiToolRegistry } from "@/services/ai/chat/aiToolRegistry";
import { createDocumentContextService } from "@/services/ai/chat/documentContextService";
import { buildDocumentDigestSummaryPrompt } from "@/services/ai/chat/prompts";
import type {
  AiChatAssistantUpdate,
  AiChatSessionSummary,
  AiChatTimelineItem,
  AiChatToolUpdate,
  AiChatUserMessageInput,
  AiChatMessageRecord,
  AiStoredSearchResult,
  AiTextSelectionContext,
} from "@/services/ai/chat/types";
import type { ModelSelectGroup } from "@/components/ModelSelect";
import {
  type AiChatRunStatus,
  type AiChatSessionData,
  canUseLocalStorage,
  createAiChatSessionData,
  createAiChatSessionId,
  loadPersistedSelectedModelKey,
  normalizeMessageAttachments,
  persistAiChatDocumentState,
  persistSelectedModelKey,
  restoreConversationFromTimeline,
  restorePersistedAiChatDocumentState,
  toTitleSnippet,
} from "@/hooks/useAiChatController/sessionPersistence";
import {
  buildDeleteConversationPlan,
  createFreshAiChatSessionBundle,
} from "@/hooks/useAiChatController/sessionActions";
import {
  applyConversationSuccess,
  createAiChatUserTimelineItem,
  extractAiChatErrorConversation,
  prepareAiChatUserInput,
  pushUserConversationMessage,
  resolveSelectedAiChatModel,
  restoreConversationAfterTimelineMutation,
} from "@/hooks/useAiChatController/conversationActions";
import { createAiChatToolContext } from "@/hooks/useAiChatController/toolContext";
import { applyAiChatSessionUiState } from "@/hooks/useAiChatController/uiStateSync";
import {
  applyAssistantUpdateToTimeline,
  applyToolUpdateToTimeline,
  finalizeStreamingTimeline,
} from "@/hooks/useAiChatController/timelineUpdates";

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

const getFirstLineTitleSnippet = (text: string) => {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  return toTitleSnippet(firstLine);
};

export const useAiChatController = (editorState: EditorState) => {
  const [registryVersion, setRegistryVersion] = useState(0);
  const [selectedModelKey, setSelectedModelKey] = useState<string | undefined>(
    () => loadPersistedSelectedModelKey(),
  );

  const sessionsRef = useRef<Map<string, AiChatSessionData>>(new Map());
  const initialSession = useMemo(
    () => createFreshAiChatSessionBundle(new Date().toISOString()),
    [],
  );

  if (!sessionsRef.current.has(initialSession.id)) {
    sessionsRef.current.set(initialSession.id, initialSession.session);
  }

  const [sessions, setSessions] = useState<AiChatSessionSummary[]>(() => [
    initialSession.summary,
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>(
    initialSession.id,
  );
  const [isDraftConversation, setIsDraftConversation] = useState(false);
  const activeSessionIdRef = useRef(activeSessionId);

  const [timeline, setTimeline] = useState<AiChatTimelineItem[]>(() => []);
  const [runStatus, setRunStatus] = useState<AiChatRunStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [highlightedResultIds, setHighlightedResultIds] = useState<string[]>(
    [],
  );

  const conversationRef = useRef<AiChatMessageRecord[]>([]);
  const searchResultsRef = useRef<Map<string, AiStoredSearchResult>>(
    sessionsRef.current.get(initialSession.id)!.searchResultsById,
  );
  const abortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const touchSessionSummary = useCallback(
    (sessionId: string, patch: Partial<AiChatSessionSummary>) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === sessionId);
        const base =
          idx >= 0
            ? prev[idx]!
            : {
                id: sessionId,
                title: "",
                updatedAt: new Date().toISOString(),
                branchDepth: 0,
              };
        const nextItem = { ...base, ...patch };
        return [nextItem, ...prev.filter((s) => s.id !== sessionId)];
      });
    },
    [],
  );

  const loadSession = useCallback((sessionId: string) => {
    const session = sessionsRef.current.get(sessionId);
    if (!session) return;

    applyAiChatSessionUiState({
      session,
      conversationRef,
      searchResultsRef,
      setTimeline,
      setRunStatus,
      setLastError,
      setHighlightedResultIds,
    });
  }, []);

  const resetDraftConversationUi = useCallback(() => {
    conversationRef.current = [];
    searchResultsRef.current = new Map();
    setTimeline([]);
    setRunStatus("idle");
    setLastError(null);
    setHighlightedResultIds([]);
  }, []);

  useEffect(() => {
    loadSession(activeSessionId);
  }, [activeSessionId, loadSession]);

  useEffect(() => {
    return subscribeLLMModelRegistry(() => {
      setRegistryVersion((value) => value + 1);
    });
  }, []);

  const chatModelGroups = useMemo(
    () => getChatModelGroups(),
    [registryVersion],
  );

  const modelSelectGroups = useMemo<ModelSelectGroup[]>(() => {
    return chatModelGroups.map((group) => ({
      id: group.providerId,
      label: group.label,
      options: group.models.map((model) => ({
        value: `${group.providerId}:${model.id}`,
        label: model.label,
        disabled: !group.isAvailable,
      })),
    }));
  }, [chatModelGroups]);

  const flatModels = useMemo(
    () =>
      chatModelGroups.flatMap((group) =>
        group.models.map((model) => ({
          providerId: group.providerId,
          providerLabel: group.label,
          modelId: model.id,
          modelLabel: model.label,
          isAvailable: group.isAvailable,
        })),
      ),
    [chatModelGroups],
  );

  const selectedChatModel = useMemo(
    () =>
      flatModels.find(
        (item) => `${item.providerId}:${item.modelId}` === selectedModelKey,
      ),
    [flatModels, selectedModelKey],
  );

  const selectedChatModelAuthor = useMemo(() => {
    const selectedModelLabel = selectedChatModel?.modelLabel?.trim();
    if (selectedModelLabel) return `AI · ${selectedModelLabel}`;

    const fallbackModelId = selectedModelKey
      ?.split(":")
      .slice(1)
      .join(":")
      .trim();
    return fallbackModelId ? `AI · ${fallbackModelId}` : "AI";
  }, [selectedChatModel, selectedModelKey]);

  const digestSummaryModel = useMemo(
    () =>
      flatModels.find(
        (item) =>
          `${item.providerId}:${item.modelId}` ===
          editorState.options.aiChat.digestSummaryModelKey,
      ),
    [editorState.options.aiChat.digestSummaryModelKey, flatModels],
  );

  const summarizeDigestChunk = useCallback(
    async (options: {
      startPage: number;
      endPage: number;
      sampledText: string;
      maxChars: number;
      summaryInstructions?: string;
      signal?: AbortSignal;
    }) => {
      const modelKey = editorState.options.aiChat.digestSummaryModelKey?.trim();
      if (!modelKey) return "";
      const separatorIndex = modelKey.indexOf(":");
      if (separatorIndex <= 0 || separatorIndex >= modelKey.length - 1) {
        return "";
      }
      const providerId = modelKey.slice(0, separatorIndex);
      const modelId = modelKey.slice(separatorIndex + 1);

      return await summarizeText(options.sampledText, {
        providerId,
        modelId,
        prompt: buildDocumentDigestSummaryPrompt({
          startPage: options.startPage,
          endPage: options.endPage,
          maxChars: options.maxChars,
          summaryInstructions: options.summaryInstructions,
        }),
        signal: options.signal,
      });
    },
    [editorState.options.aiChat.digestSummaryModelKey],
  );

  const getDefaultModelKey = useCallback(() => {
    const firstAvailable = flatModels.find((item) => item.isAvailable);
    if (firstAvailable) {
      return `${firstAvailable.providerId}:${firstAvailable.modelId}`;
    }
    const firstAny = flatModels[0];
    return firstAny ? `${firstAny.providerId}:${firstAny.modelId}` : undefined;
  }, [flatModels]);

  useEffect(() => {
    const nextDefault = getDefaultModelKey();

    if (!selectedModelKey) {
      if (nextDefault) setSelectedModelKey(nextDefault);
      return;
    }

    const exists = flatModels.some(
      (item) =>
        `${item.providerId}:${item.modelId}` === selectedModelKey &&
        item.isAvailable,
    );
    if (!exists) {
      setSelectedModelKey(nextDefault);
    }
  }, [flatModels, getDefaultModelKey, selectedModelKey]);

  const getSelectedTextContext =
    useCallback((): AiTextSelectionContext | null => {
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return null;
      }

      const selectedText = selection.toString();
      if (!selectedText.trim()) return null;

      const range = selection.getRangeAt(0);
      const getClosestTextLayer = (node: Node | null) => {
        if (!node) return null;
        const element = node instanceof Element ? node : node.parentElement;
        return element?.closest?.(".textLayer") ?? null;
      };

      const startTextLayer = getClosestTextLayer(range.startContainer);
      const endTextLayer = getClosestTextLayer(range.endContainer);
      const textLayer =
        startTextLayer && endTextLayer && startTextLayer === endTextLayer
          ? (startTextLayer as HTMLElement)
          : null;
      if (!textLayer) return null;

      const pageElement = textLayer.closest?.(
        "[id^='page-']",
      ) as HTMLElement | null;
      const pageIndex = Number.parseInt(
        pageElement?.id.replace(/^page-/, "") ?? "",
        10,
      );
      const offsets = getPdfSearchSelectionOffsets(textLayer, selection);
      if (!Number.isFinite(pageIndex) || !offsets) return null;

      return {
        text: selectedText.replace(/\s+/g, " ").trim(),
        pageIndex,
        startOffset: offsets.startOffset,
        endOffset: offsets.endOffset,
      };
    }, []);

  const documentIdentity = [
    editorState.filename,
    editorState.pages.length,
    editorState.pdfBytes?.byteLength ?? 0,
  ].join(":");

  const isDocumentLoaded = editorState.pages.length > 0;

  const documentContextService = useMemo(
    () =>
      createDocumentContextService({
        getSnapshot: () => ({
          filename: editorState.filename,
          metadata: editorState.metadata,
          pages: editorState.pages,
          outline: editorState.outline,
          currentPageIndex: editorState.currentPageIndex,
        }),
        getSelectedTextContext,
        getDigestConfig: () => ({
          charsPerChunk: editorState.options.aiChat.digestCharsPerChunk,
          sourceCharsPerChunk:
            editorState.options.aiChat.digestSourceCharsPerChunk,
        }),
        summarizeDigestChunk: digestSummaryModel
          ? summarizeDigestChunk
          : undefined,
      }),
    [
      digestSummaryModel,
      documentIdentity,
      editorState.currentPageIndex,
      editorState.filename,
      editorState.metadata,
      editorState.options.aiChat.digestCharsPerChunk,
      editorState.options.aiChat.digestSourceCharsPerChunk,
      editorState.outline,
      editorState.pages,
      getSelectedTextContext,
      summarizeDigestChunk,
    ],
  );

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    searchSeqRef.current = 0;

    if (isDocumentLoaded) {
      const restored = restorePersistedAiChatDocumentState(documentIdentity);
      if (restored) {
        sessionsRef.current = restored.sessionsMap;
        setSessions(restored.sessionSummaries);
        setActiveSessionId(restored.activeSessionId);
        setIsDraftConversation(false);

        const active = restored.sessionsMap.get(restored.activeSessionId)!;
        applyAiChatSessionUiState({
          session: active,
          conversationRef,
          searchResultsRef,
          setTimeline,
          setRunStatus,
          setLastError,
          setHighlightedResultIds,
        });
        return;
      }
    }

    sessionsRef.current = new Map();
    const fresh = createFreshAiChatSessionBundle(new Date().toISOString());
    sessionsRef.current.set(fresh.id, fresh.session);

    setSessions([fresh.summary]);
    setActiveSessionId(fresh.id);
    setIsDraftConversation(false);

    applyAiChatSessionUiState({
      session: fresh.session,
      conversationRef,
      searchResultsRef,
      setTimeline,
      setRunStatus,
      setLastError,
      setHighlightedResultIds,
    });
  }, [documentIdentity, resetDraftConversationUi]);

  useEffect(() => {
    persistSelectedModelKey(selectedModelKey);
  }, [selectedModelKey]);

  useEffect(() => {
    if (!canUseLocalStorage()) return;
    if (!isDocumentLoaded) return;

    const sessionId = activeSessionId;
    const session = sessionsRef.current.get(sessionId);
    if (!session) return;

    const timeout = window.setTimeout(() => {
      persistAiChatDocumentState({
        documentIdentity,
        activeSessionId,
        sessions,
        sessionsMap: sessionsRef.current,
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [
    activeSessionId,
    documentIdentity,
    highlightedResultIds,
    isDocumentLoaded,
    lastError,
    runStatus,
    sessions,
    timeline,
  ]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const toolContext = useMemo(
    () =>
      createAiChatToolContext({
        searchResultsRef,
        searchSeqRef,
        sessionsRef,
        activeSessionIdRef,
        setHighlightedResultIds,
        selectedChatModel,
        selectedChatModelAuthor,
      }),
    [selectedChatModel, selectedChatModelAuthor],
  );

  const {
    rememberSearchResults,
    listFormFields,
    fillFormFields,
    focusField,
    getStoredSearchResult,
    setActiveHighlightedResultIds,
    clearActiveHighlightedResultIds,
    listAnnotations,
    createSearchHighlightAnnotations,
    clearSearchHighlights,
    navigatePage,
    focusSearchResult,
  } = toolContext;

  const toolRegistry = useMemo(
    () =>
      createAiToolRegistry({
        documentContextService,
        rememberSearchResults,
        listAnnotations,
        listFormFields,
        fillFormFields,
        focusField,
        getStoredSearchResult,
        createSearchHighlightAnnotations,
        clearSearchHighlights,
        setHighlightedResultIds: setActiveHighlightedResultIds,
        clearHighlightedResultIds: clearActiveHighlightedResultIds,
        navigatePage,
        focusSearchResult,
      }),
    [
      clearSearchHighlights,
      clearActiveHighlightedResultIds,
      createSearchHighlightAnnotations,
      documentContextService,
      fillFormFields,
      focusField,
      focusSearchResult,
      getStoredSearchResult,
      listAnnotations,
      listFormFields,
      navigatePage,
      rememberSearchResults,
      setActiveHighlightedResultIds,
    ],
  );

  const appendTimelineItem = useCallback(
    (item: AiChatTimelineItem) => {
      const sessionId = activeSessionIdRef.current;
      const session = sessionsRef.current.get(sessionId);
      if (!session) return;

      const updatedAt = new Date().toISOString();
      session.updatedAt = updatedAt;

      setTimeline((prev) => {
        const next = [...prev, item];
        session.timeline = next;
        return next;
      });

      touchSessionSummary(sessionId, {
        title: session.title,
        updatedAt,
      });
    },
    [touchSessionSummary],
  );

  const applyAssistantUpdate = useCallback(
    (update: AiChatAssistantUpdate) => {
      const nowIso = new Date().toISOString();
      const session = sessionsRef.current.get(activeSessionIdRef.current);
      if (!session) return;

      setTimeline((prev) => {
        const result = applyAssistantUpdateToTimeline(prev, update, nowIso);
        session.timeline = result.timeline;
        if (result.touchedSession) {
          session.updatedAt = nowIso;
          touchSessionSummary(session.id, {
            title: session.title,
            updatedAt: nowIso,
          });
        }
        return result.timeline;
      });
    },
    [touchSessionSummary],
  );

  const applyToolUpdate = useCallback(
    (update: AiChatToolUpdate) => {
      const nowIso = new Date().toISOString();
      const session = sessionsRef.current.get(activeSessionIdRef.current);
      if (!session) return;

      setTimeline((prev) => {
        const result = applyToolUpdateToTimeline(prev, update, nowIso);
        session.timeline = result.timeline;
        if (result.touchedSession) {
          session.updatedAt = nowIso;
          touchSessionSummary(session.id, {
            title: session.title,
            updatedAt: nowIso,
          });
        }
        return result.timeline;
      });
    },
    [touchSessionSummary],
  );

  const materializeDraftConversation = useCallback(() => {
    const fresh = createFreshAiChatSessionBundle(new Date().toISOString());
    sessionsRef.current.set(fresh.id, fresh.session);
    activeSessionIdRef.current = fresh.id;
    setSessions((prev) => [fresh.summary, ...prev]);
    setActiveSessionId(fresh.id);
    setIsDraftConversation(false);

    applyAiChatSessionUiState({
      session: fresh.session,
      conversationRef,
      searchResultsRef,
      setTimeline,
      setRunStatus,
      setLastError,
      setHighlightedResultIds,
    });

    return fresh.session;
  }, []);

  const getPendingBranchAnchorId = useCallback(
    (
      session: AiChatSessionData,
      role: Extract<AiChatTimelineItem, { kind: "message" }>["role"],
    ) => {
      const branchAnchorId =
        role === "user" && session.branchKind === "regenerate"
          ? session.branchContextUserAnchorId?.trim()
          : session.branchSourceMessageId?.trim();
      if (!branchAnchorId) return undefined;
      if (session.branchKind === "edit" && role !== "user") return undefined;
      if (
        session.branchKind === "regenerate" &&
        role !== "assistant" &&
        role !== "user"
      ) {
        return undefined;
      }

      const alreadyAnchored = session.timeline.some(
        (item) =>
          item.kind === "message" &&
          item.role === role &&
          (item.id === branchAnchorId ||
            item.branchAnchorId === branchAnchorId),
      );
      return alreadyAnchored ? undefined : branchAnchorId;
    },
    [],
  );

  const sendMessage = useCallback(
    async (input: AiChatUserMessageInput) => {
      const prepared = prepareAiChatUserInput(input);
      if (!prepared || runStatus === "running" || runStatus === "cancelling") {
        return;
      }

      const { attachments, conversationText, displayText, text, editContext } =
        prepared;
      const selected = resolveSelectedAiChatModel(flatModels, selectedModelKey);
      if (!selected) {
        setLastError("No available AI chat model.");
        setRunStatus("error");
        const session = sessionsRef.current.get(activeSessionIdRef.current);
        if (session) {
          session.lastError = "No available AI chat model.";
          session.runStatus = "error";
        }
        return;
      }

      const session = editContext
        ? (() => {
            const sourceSession = sessionsRef.current.get(
              editContext.sourceSessionId,
            );
            if (!sourceSession) return null;

            const targetIndex = sourceSession.timeline.findIndex(
              (item) =>
                item.kind === "message" &&
                item.role === "user" &&
                item.id === editContext.targetMessageId,
            );
            if (targetIndex < 0) return null;

            const targetItem = sourceSession.timeline[targetIndex];
            if (
              !targetItem ||
              targetItem.kind !== "message" ||
              targetItem.role !== "user"
            ) {
              return null;
            }

            return createBranchSession({
              sourceSession,
              targetTimelineIndex: targetIndex,
              branchKind: "edit",
              branchSourceMessageId:
                targetItem.branchAnchorId ?? editContext.targetMessageId,
              branchContextUserMessageId:
                targetItem.branchAnchorId ?? editContext.targetMessageId,
              branchContextUserAnchorId:
                targetItem.branchAnchorId ?? editContext.targetMessageId,
              titleSeed: targetItem.text,
            });
          })()
        : isDraftConversation
          ? materializeDraftConversation()
          : sessionsRef.current.get(activeSessionIdRef.current);
      if (!session) return;
      const sessionId = session.id;
      const userBranchAnchorId = getPendingBranchAnchorId(session, "user");

      const nextUserTitle = toTitleSnippet(
        attachments?.[0]?.text || displayText || text,
      );
      if (
        (session.branchKind === "edit" &&
          userBranchAnchorId &&
          nextUserTitle) ||
        (!session.title && nextUserTitle)
      ) {
        const title = nextUserTitle;
        session.title = title;
        touchSessionSummary(sessionId, {
          title,
        });
      }

      const userItem = createAiChatUserTimelineItem({
        displayText,
        conversationText,
        attachments,
        branchAnchorId: userBranchAnchorId,
      });
      appendTimelineItem(userItem);

      setLastError(null);
      setRunStatus("running");
      session.lastError = null;
      session.runStatus = "running";

      const controller = new AbortController();
      abortRef.current = controller;

      pushUserConversationMessage({
        session,
        conversationRef,
        conversationText,
      });

      try {
        const assistantBranchAnchorId = getPendingBranchAnchorId(
          session,
          "assistant",
        );
        const appOptions = useEditorStore.getState().options;
        const result = await aiChatService.runConversation({
          appOptions,
          modelCache: editorState.llmModelCache,
          messages: conversationRef.current,
          modelKey: `${selected.providerId}:${selected.modelId}`,
          toolRegistry,
          signal: controller.signal,
          onAssistantUpdate: (update) => {
            if (
              assistantBranchAnchorId &&
              (update.phase === "delta" || update.phase === "end")
            ) {
              applyAssistantUpdate({
                ...update,
                branchAnchorId: assistantBranchAnchorId,
              });
              return;
            }
            applyAssistantUpdate(update);
          },
          onToolUpdate: applyToolUpdate,
        });

        applyConversationSuccess({
          session,
          conversationRef,
          conversation: result.conversation,
        });
        if (
          assistantBranchAnchorId &&
          session.branchKind === "regenerate" &&
          result.assistantMessage.trim()
        ) {
          const nextTitle = getFirstLineTitleSnippet(result.assistantMessage);
          if (nextTitle && nextTitle !== session.title) {
            session.title = nextTitle;
            touchSessionSummary(sessionId, {
              title: nextTitle,
            });
          }
        }
        setRunStatus("idle");
      } catch (error) {
        if (isAbortError(error)) {
          setRunStatus("idle");
          session.runStatus = "idle";

          setTimeline((prev) => {
            const next = finalizeStreamingTimeline(
              prev,
              new Date().toISOString(),
              "Cancelled",
            );

            session.timeline = next;
            restoreConversationAfterTimelineMutation({
              session,
              conversationRef,
              timeline: next,
            });
            return next;
          });
          return;
        }

        const carriedConversation = extractAiChatErrorConversation(error);
        setTimeline((prev) => {
          const next = finalizeStreamingTimeline(
            prev,
            new Date().toISOString(),
            "Failed",
          );
          session.timeline = next;
          restoreConversationAfterTimelineMutation({
            session,
            conversationRef,
            timeline: next,
            carriedConversation,
          });
          return next;
        });

        const message =
          error instanceof Error ? error.message : "AI chat request failed.";
        setLastError(message);
        setRunStatus("error");
        session.lastError = message;
        session.runStatus = "error";
      } finally {
        abortRef.current = null;
      }
    },
    [
      appendTimelineItem,
      applyAssistantUpdate,
      applyToolUpdate,
      flatModels,
      getPendingBranchAnchorId,
      isDraftConversation,
      createBranchSession,
      materializeDraftConversation,
      runStatus,
      selectedModelKey,
      toolRegistry,
      touchSessionSummary,
    ],
  );

  function createBranchSession(options: {
    sourceSession: AiChatSessionData;
    targetTimelineIndex: number;
    branchKind: "edit" | "regenerate";
    branchSourceMessageId: string;
    branchContextUserMessageId?: string;
    branchContextUserAnchorId?: string;
    titleSeed: string;
  }) {
    const nextTimeline = options.sourceSession.timeline.slice(
      0,
      Math.max(0, options.targetTimelineIndex),
    );
    const nowIso = new Date().toISOString();
    const nextSessionId = createAiChatSessionId();
    const nextSession = createAiChatSessionData(nextSessionId, nowIso, {
      parentSessionId: options.sourceSession.id,
      branchDepth: (options.sourceSession.branchDepth ?? 0) + 1,
      branchKind: options.branchKind,
      branchSourceMessageId: options.branchSourceMessageId,
      branchContextUserMessageId: options.branchContextUserMessageId,
      branchContextUserAnchorId: options.branchContextUserAnchorId,
    });

    nextSession.title =
      options.sourceSession.title || toTitleSnippet(options.titleSeed);
    nextSession.timeline = nextTimeline;
    nextSession.conversation = restoreConversationFromTimeline(nextTimeline);
    nextSession.searchResultsById = new Map(
      options.sourceSession.searchResultsById,
    );
    nextSession.highlightedResultIds = [];
    nextSession.runStatus = "idle";
    nextSession.lastError = null;

    const nextSummary: AiChatSessionSummary = {
      id: nextSession.id,
      title: nextSession.title,
      updatedAt: nextSession.updatedAt,
      parentSessionId: nextSession.parentSessionId,
      branchDepth: nextSession.branchDepth,
      branchKind: nextSession.branchKind,
      branchSourceMessageId: nextSession.branchSourceMessageId,
      branchContextUserMessageId: nextSession.branchContextUserMessageId,
      branchContextUserAnchorId: nextSession.branchContextUserAnchorId,
    };

    sessionsRef.current.set(nextSession.id, nextSession);
    activeSessionIdRef.current = nextSession.id;
    setSessions((prev) => [nextSummary, ...prev]);
    setActiveSessionId(nextSession.id);

    applyAiChatSessionUiState({
      session: nextSession,
      conversationRef,
      searchResultsRef,
      setTimeline,
      setRunStatus,
      setLastError,
      setHighlightedResultIds,
    });

    return nextSession;
  }

  const editUserMessage = useCallback(
    (messageId: string) => {
      if (runStatus === "running" || runStatus === "cancelling") return null;
      const session = sessionsRef.current.get(activeSessionIdRef.current);
      if (!session) return null;

      const targetIndex = session.timeline.findIndex(
        (item) =>
          item.kind === "message" &&
          item.role === "user" &&
          item.id === messageId,
      );
      if (targetIndex < 0) return null;

      const target = session.timeline[targetIndex];
      if (!target || target.kind !== "message" || target.role !== "user") {
        return null;
      }

      return {
        text: target.text,
        attachments: normalizeMessageAttachments(target.attachments),
        sourceSessionId: session.id,
        targetMessageId: messageId,
      };
    },
    [runStatus],
  );

  const regenerateAssistantMessage = useCallback(
    async (messageId: string) => {
      if (runStatus === "running" || runStatus === "cancelling") return;
      const session = sessionsRef.current.get(activeSessionIdRef.current);
      if (!session) return;

      const assistantIndex = session.timeline.findIndex(
        (item) =>
          item.kind === "message" &&
          item.role === "assistant" &&
          item.id === messageId,
      );
      if (assistantIndex < 0) return;

      let userIndex = -1;
      for (let index = assistantIndex; index >= 0; index -= 1) {
        const item = session.timeline[index];
        if (item?.kind === "message" && item.role === "user") {
          userIndex = index;
          break;
        }
      }
      if (userIndex < 0) return;

      const userItem = session.timeline[userIndex];
      if (
        !userItem ||
        userItem.kind !== "message" ||
        userItem.role !== "user"
      ) {
        return;
      }
      const assistantItem = session.timeline[assistantIndex];
      if (
        !assistantItem ||
        assistantItem.kind !== "message" ||
        assistantItem.role !== "assistant"
      ) {
        return;
      }

      const branchSession = createBranchSession({
        sourceSession: session,
        targetTimelineIndex: userIndex,
        branchKind: "regenerate",
        branchSourceMessageId: assistantItem.branchAnchorId ?? messageId,
        branchContextUserMessageId: userItem.id,
        branchContextUserAnchorId: userItem.branchAnchorId ?? userItem.id,
        titleSeed: userItem.text,
      });
      if (!branchSession) return;

      await sendMessage({
        text: userItem.text,
        displayText: userItem.text,
        attachments: normalizeMessageAttachments(userItem.attachments),
      });
    },
    [createBranchSession, runStatus, sendMessage],
  );

  const retryLastFailedMessage = useCallback(async () => {
    if (runStatus === "running" || runStatus === "cancelling") return;
    const session = sessionsRef.current.get(activeSessionIdRef.current);
    if (!session || !session.lastError) return;

    let userIndex = -1;
    for (let index = session.timeline.length - 1; index >= 0; index -= 1) {
      const item = session.timeline[index];
      if (item?.kind === "message" && item.role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return;

    const userItem = session.timeline[userIndex];
    if (!userItem || userItem.kind !== "message" || userItem.role !== "user") {
      return;
    }

    const retryAttachments = normalizeMessageAttachments(userItem.attachments);
    const conversationText = userItem.conversationText?.trim() ?? "";
    const attachmentMarker = "\n\nSELECTION_ATTACHMENT\nattachment_index: 1\n";
    const retryText = retryAttachments?.length
      ? (() => {
          const markerIndex = conversationText.indexOf(attachmentMarker);
          if (markerIndex >= 0) {
            return conversationText.slice(0, markerIndex).trim();
          }
          return userItem.text || conversationText;
        })()
      : userItem.text || conversationText;
    const retryInput: AiChatUserMessageInput = {
      text: retryText,
      displayText: userItem.text,
      attachments: retryAttachments?.length ? retryAttachments : undefined,
    };

    const nextTimeline = session.timeline.slice(0, userIndex);
    const updatedAt = new Date().toISOString();
    session.timeline = nextTimeline;
    session.updatedAt = updatedAt;
    session.runStatus = "idle";
    session.lastError = null;

    setTimeline(nextTimeline);
    setRunStatus("idle");
    setLastError(null);

    restoreConversationAfterTimelineMutation({
      session,
      conversationRef,
      timeline: nextTimeline,
    });

    touchSessionSummary(session.id, {
      title: session.title,
      updatedAt,
    });

    await sendMessage(retryInput);
  }, [runStatus, sendMessage, touchSessionSummary]);

  const stop = useCallback(() => {
    if (!abortRef.current) return;
    setRunStatus("cancelling");
    const session = sessionsRef.current.get(activeSessionIdRef.current);
    if (session) session.runStatus = "cancelling";
    abortRef.current.abort();
    abortRef.current = null;
  }, []);

  const clearConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const sessionId = activeSessionIdRef.current;
    const session = sessionsRef.current.get(sessionId);
    if (!session) return;

    const updatedAt = new Date().toISOString();
    session.updatedAt = updatedAt;
    session.title = "";
    session.timeline = [];
    session.conversation = [];
    session.searchResultsById = new Map();
    session.highlightedResultIds = [];
    session.runStatus = "idle";
    session.lastError = null;

    applyAiChatSessionUiState({
      session,
      conversationRef,
      searchResultsRef,
      setTimeline,
      setRunStatus,
      setLastError,
      setHighlightedResultIds,
    });

    touchSessionSummary(sessionId, {
      title: "",
      updatedAt,
    });
  }, [touchSessionSummary]);

  const newConversation = useCallback(() => {
    if (runStatus === "running" || runStatus === "cancelling") return;
    setIsDraftConversation(true);
    resetDraftConversationUi();
  }, [resetDraftConversationUi, runStatus]);

  const selectSession = useCallback(
    (id: string) => {
      if (runStatus === "running" || runStatus === "cancelling") return;
      if (!sessionsRef.current.has(id)) return;
      setIsDraftConversation(false);
      if (id === activeSessionIdRef.current) {
        loadSession(id);
        touchSessionSummary(id, {}); // move to top
        return;
      }
      activeSessionIdRef.current = id;
      setActiveSessionId(id);
      touchSessionSummary(id, {}); // move to top
    },
    [loadSession, runStatus, touchSessionSummary],
  );

  const switchMessageBranch = useCallback(
    (messageId: string) => {
      if (runStatus === "running" || runStatus === "cancelling") return;

      const candidateIds = new Set<string>();
      for (const [sessionId, session] of sessionsRef.current.entries()) {
        if (
          session.branchSourceMessageId === messageId ||
          session.timeline.some(
            (item) =>
              item.kind === "message" &&
              (item.id === messageId || item.branchAnchorId === messageId),
          )
        ) {
          candidateIds.add(sessionId);
        }
      }

      if (candidateIds.size <= 1) return;

      const orderedSessionIds = sessions
        .map((session) => session.id)
        .filter((sessionId) => candidateIds.has(sessionId));
      if (orderedSessionIds.length <= 1) return;

      const activeId = activeSessionIdRef.current;
      const activeIndex = orderedSessionIds.indexOf(activeId);
      const nextId =
        activeIndex >= 0
          ? orderedSessionIds[(activeIndex + 1) % orderedSessionIds.length]
          : orderedSessionIds[0];
      if (!nextId || nextId === activeId) return;

      selectSession(nextId);
    },
    [runStatus, selectSession, sessions],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      if (runStatus === "running" || runStatus === "cancelling") return;
      if (!sessionsRef.current.has(id)) return;
      setIsDraftConversation(false);

      const plan = buildDeleteConversationPlan({
        sessions,
        activeSessionId: activeSessionIdRef.current,
        deleteSessionId: id,
        nowIso: new Date().toISOString(),
      });

      if (plan.type === "noop") return;
      for (const sessionId of plan.deletedSessionIds) {
        sessionsRef.current.delete(sessionId);
      }
      if (plan.type === "remove_non_active") {
        setSessions(plan.nextSummaries);
        return;
      }
      if (plan.type === "activate_existing") {
        setSessions(plan.nextSummaries);
        setActiveSessionId(plan.nextActiveSessionId);
        return;
      }

      sessionsRef.current.set(plan.nextActiveSessionId, plan.nextSession);
      setSessions(plan.nextSummaries);
      setActiveSessionId(plan.nextActiveSessionId);

      applyAiChatSessionUiState({
        session: plan.nextSession,
        conversationRef,
        searchResultsRef,
        setTimeline,
        setRunStatus,
        setLastError,
        setHighlightedResultIds,
      });
    },
    [runStatus, sessions],
  );

  const highlightedSearchResultsByPage = useMemo(() => {
    const map = new Map<number, PDFSearchResult[]>();

    for (const id of highlightedResultIds) {
      const stored = searchResultsRef.current.get(id);
      if (!stored) continue;
      const list = map.get(stored.result.pageIndex);
      if (list) list.push(stored.result);
      else map.set(stored.result.pageIndex, [stored.result]);
    }

    return map;
  }, [highlightedResultIds]);

  const hasAvailableModel = flatModels.some((item) => item.isAvailable);
  const disabledReason: "no_document" | "no_model" | null = !editorState.pages
    .length
    ? "no_document"
    : !hasAvailableModel
      ? "no_model"
      : null;

  return {
    sessions,
    activeSessionId: isDraftConversation ? "" : activeSessionId,
    selectSession,
    newConversation,
    clearConversation,
    deleteConversation,

    timeline,
    runStatus,
    lastError,
    selectedModelKey,
    setSelectedModelKey,
    modelSelectGroups,
    sendMessage,
    regenerateAssistantMessage,
    retryLastFailedMessage,
    editUserMessage,
    switchMessageBranch,
    stop,

    highlightedSearchResultsByPage,
    hasAvailableModel,
    disabledReason,
  };
};
