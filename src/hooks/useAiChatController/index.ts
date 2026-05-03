import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPdfSearchSelectionOffsets } from "@/components/workspace/lib/pdfSearchHighlights";
import {
  getChatModelGroups,
  parseAiSdkModelSpecifier,
  summarizePageImages,
  summarizeConversationMemory,
  summarizeDigestText,
  subscribeLLMModelRegistry,
} from "@/services/ai";
import { useEditorStore } from "@/store/useEditorStore";
import { type EditorState, type PDFSearchResult } from "@/types";
import { aiChatService } from "@/services/ai/chat/aiChatService";
import { createAiToolRegistry } from "@/services/ai/chat/aiToolRegistry";
import { composeAiToolContext } from "@/services/ai/chat/aiToolContext";
import { createDocumentContextService } from "@/services/ai/chat/documentContextService";
import {
  buildAiChatContextMemorySystemPrompt,
  buildDocumentDigestMergePrompt,
  buildDocumentDigestSummaryPrompt,
} from "@/services/ai/chat/prompts";
import type {
  AiChatAssistantUpdate,
  AiChatContextMemory,
  AiDocumentLinkTarget,
  AiChatSessionSummary,
  AiChatTimelineItem,
  AiChatToolUpdate,
  AiChatUserMessageInput,
  AiChatMessageRecord,
  AiDocumentDigestSourceKind,
  AiSummaryInstructions,
  AiStoredSearchResult,
  AiTextSelectionContext,
} from "@/services/ai/chat/types";
import type { ModelSelectGroup } from "@/components/ModelSelect";
import {
  addAiChatTokenUsageSummary,
  type AiChatRunStatus,
  type AiChatSessionData,
  buildAiChatRequestRecoveryMessages,
  canUseLocalStorage,
  createEmptyAiChatTokenUsageSummary,
  createAiChatSessionData,
  createAiChatSessionId,
  getConversationMessageCountForTimelinePrefix,
  loadPersistedSelectedModelKey,
  normalizeMessageAttachments,
  persistAiChatDocumentState,
  recoverAiChatRuntimeTranscript,
  type RestoredAiChatDocumentState,
  persistSelectedModelKey,
  restorePersistedAiChatDocumentState,
  setAiChatRuntimeTimelineBoundaries,
  sliceAiChatRuntimeTranscriptForTimelinePrefix,
  syncAiChatSessionConversation,
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
  type AiChatFlatModel,
} from "@/hooks/useAiChatController/conversationActions";
import { createAiChatToolContext } from "@/hooks/useAiChatController/toolContext";
import { applyAiChatSessionUiState } from "@/hooks/useAiChatController/uiStateSync";
import { retainAiChatContextMemoryForTimeline } from "@/services/ai/chat/runtime/contextMemory";
import { defaultAiChatCompressionEngine } from "@/services/ai/chat/runtime/compression/engine";
import { createDefaultAiChatCompressionPolicy } from "@/services/ai/chat/runtime/compression/types";
import {
  estimateAiChatMessageTokens,
  prepareAiChatMessagesForModel,
} from "@/services/ai/chat/runtime/messageContext";
import {
  applyAssistantUpdateToTimeline,
  getLatestTimelineUsageSnapshot,
  applyUsageSnapshotToTurnTimeline,
  applyToolUpdateToTimeline,
  settleIncompleteTimeline,
} from "@/hooks/useAiChatController/timelineUpdates";
import { appEventBus } from "@/lib/eventBus";
import { exportPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

const inMemoryAiChatScopeRegistry = new Map<
  string,
  RestoredAiChatDocumentState
>();

const getFirstLineTitleSnippet = (text: string) => {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  return toTitleSnippet(firstLine);
};

const FIELD_BATCH_CONFIRMATION_PATTERNS = [
  /\b(confirm|confirmed|go ahead|proceed|apply (it|them|this)|create (it|them|these)|use this plan|looks good)\b/i,
  /(确认|确认创建|按这个|照这个|就按这个|开始创建|开始吧|应用这个|没问题，创建|可以创建|就这样)/,
];

const isDetectedFieldBatchConfirmationMessage = (text: string) => {
  const normalized = text.trim();
  if (!normalized) return false;
  return FIELD_BATCH_CONFIRMATION_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
};

const isAiChatSessionStarted = (
  session: Pick<
    AiChatSessionData,
    | "title"
    | "timeline"
    | "conversation"
    | "searchResultsById"
    | "highlightedResultIds"
    | "pendingDetectedFieldBatches"
    | "contextMemory"
    | "tokenUsage"
    | "contextTokens"
    | "contextTokenOverhead"
    | "runStatus"
    | "lastError"
    | "awaitingContinue"
  >,
) => {
  if (session.title.trim()) return true;
  if (session.timeline.length > 0 || session.conversation.length > 0) {
    return true;
  }
  if (session.searchResultsById.size > 0) return true;
  if (session.highlightedResultIds.length > 0) return true;
  if (session.pendingDetectedFieldBatches.length > 0) return true;
  if (session.contextMemory) return true;
  if (session.contextTokens > 0 || session.contextTokenOverhead > 0) {
    return true;
  }
  if (
    session.tokenUsage.inputTokens > 0 ||
    session.tokenUsage.outputTokens > 0 ||
    session.tokenUsage.totalTokens > 0 ||
    session.tokenUsage.reasoningTokens > 0 ||
    session.tokenUsage.cachedInputTokens > 0
  ) {
    return true;
  }
  if (session.runStatus !== "idle") return true;
  if (session.lastError) return true;
  return session.awaitingContinue;
};

const updateDetectedFieldBatchConfirmation = (options: {
  session: AiChatSessionData;
  userMessageId: string;
  text: string;
}) => {
  const latestDraftBatch = options.session.pendingDetectedFieldBatches.find(
    (batch) => batch.status === "draft",
  );
  if (!latestDraftBatch) return;

  const shouldConfirm = isDetectedFieldBatchConfirmationMessage(options.text);
  options.session.pendingDetectedFieldBatches =
    options.session.pendingDetectedFieldBatches.map((batch) => {
      if (batch.status !== "draft") return batch;
      if (!shouldConfirm || batch.batchId !== latestDraftBatch.batchId) {
        return {
          ...batch,
          confirmedAt: undefined,
          confirmedByMessageId: undefined,
          confirmedByUserText: undefined,
        };
      }

      return {
        ...batch,
        confirmedAt: new Date().toISOString(),
        confirmedByMessageId: options.userMessageId,
        confirmedByUserText: options.text.trim(),
      };
    });
};

const createInMemoryAiChatDocumentState = (options: {
  activeSessionId: string;
  sessions: AiChatSessionSummary[];
  sessionsMap: Map<string, AiChatSessionData>;
}): RestoredAiChatDocumentState => ({
  activeSessionId: options.activeSessionId,
  sessionsMap: new Map(options.sessionsMap),
  sessionSummaries: options.sessions.map((session) => ({ ...session })),
});

export const useAiChatController = (
  editorState: EditorState,
  scopeId?: string,
  workerService?: PDFWorkerService,
) => {
  const [registryVersion, setRegistryVersion] = useState(0);
  const [selectedModelKey, setSelectedModelKey] = useState<string | undefined>(
    () => loadPersistedSelectedModelKey(),
  );
  const [contextMemoryPendingVersion, setContextMemoryPendingVersion] =
    useState(0);

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
  const sessionSummariesRef = useRef(sessions);

  const [timeline, setTimeline] = useState<AiChatTimelineItem[]>(() => []);
  const [runStatus, setRunStatus] = useState<AiChatRunStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [awaitingContinue, setAwaitingContinue] = useState(false);
  const [tokenUsage, setTokenUsage] = useState(() =>
    createEmptyAiChatTokenUsageSummary(),
  );
  const [contextTokens, setContextTokens] = useState(0);
  const [highlightedResultIds, setHighlightedResultIds] = useState<string[]>(
    [],
  );

  const conversationRef = useRef<AiChatMessageRecord[]>([]);
  const searchResultsRef = useRef<Map<string, AiStoredSearchResult>>(
    sessionsRef.current.get(initialSession.id)!.searchResultsById,
  );
  const abortRef = useRef<AbortController | null>(null);
  const contextMemoryJobIdsRef = useRef<Map<string, number>>(new Map());
  const contextMemoryJobSeqRef = useRef(0);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    sessionSummariesRef.current = sessions;
  }, [sessions]);

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
      setAwaitingContinue,
      setTokenUsage,
      setContextTokens,
      setHighlightedResultIds,
    });
  }, []);

  const notifyContextMemoryPendingChanged = useCallback(() => {
    setContextMemoryPendingVersion((value) => value + 1);
  }, []);

  const estimateProjectedContextTokens = useCallback(
    (
      session: Pick<
        AiChatSessionData,
        "conversation" | "contextMemory" | "contextTokenOverhead"
      >,
      aiChatOptions: Pick<
        EditorState["options"]["aiChat"],
        | "contextCompressionEnabled"
        | "contextCompressionThresholdTokens"
        | "contextCompressionMode"
        | "visualHistoryWindow"
      >,
    ) => {
      if (session.conversation.length === 0) return 0;

      const preparedMessages = prepareAiChatMessagesForModel({
        messages: session.conversation,
        aiChatOptions,
        contextMemory: session.contextMemory,
        policy: createDefaultAiChatCompressionPolicy({
          reasoningReplayPolicy: "none",
          turnStartMessageCount: session.conversation.length,
          visualHistoryWindow: aiChatOptions.visualHistoryWindow,
        }),
      });
      const estimatedMessageTokens =
        estimateAiChatMessageTokens(preparedMessages);
      return Math.max(
        0,
        estimatedMessageTokens + Math.max(0, session.contextTokenOverhead || 0),
      );
    },
    [],
  );

  const getTimelineItemCountForConversationMessageCount = useCallback(
    (
      timelineItems: AiChatTimelineItem[],
      conversationMessageCount: number,
      runtimeBoundaries?: Record<string, number>,
    ) => {
      const target = Math.max(0, Math.trunc(conversationMessageCount || 0));
      if (target <= 0) return 0;

      if (runtimeBoundaries) {
        let bestBoundaryIndex = 0;
        let sawBoundary = false;
        for (let index = 1; index <= timelineItems.length; index += 1) {
          const item = timelineItems[index - 1];
          const boundary = item ? runtimeBoundaries[item.id] : undefined;
          if (typeof boundary === "number" && Number.isFinite(boundary)) {
            if (boundary <= target) {
              bestBoundaryIndex = index;
              sawBoundary = true;
              continue;
            }
            if (sawBoundary) return bestBoundaryIndex;
          }
        }
        if (sawBoundary) return bestBoundaryIndex;
      }

      for (let index = 1; index <= timelineItems.length; index += 1) {
        if (
          getConversationMessageCountForTimelinePrefix(timelineItems, index) >=
          target
        ) {
          return index;
        }
      }

      return timelineItems.length;
    },
    [],
  );

  const applyLatestTimelineUsageSnapshot = useCallback(
    (
      session: Pick<
        AiChatSessionData,
        "timeline" | "tokenUsage" | "contextTokens"
      >,
    ) => {
      const snapshot = getLatestTimelineUsageSnapshot(session.timeline);
      if (!snapshot) {
        session.contextTokens = 0;
        return;
      }
      if (snapshot.tokenUsage) {
        session.tokenUsage = snapshot.tokenUsage;
      }
      session.contextTokens =
        typeof snapshot.contextTokens === "number" ? snapshot.contextTokens : 0;
    },
    [],
  );

  const applyAlgorithmicContextCompression = useCallback(
    (
      session: Pick<
        AiChatSessionData,
        | "id"
        | "conversation"
        | "runtimeTranscript"
        | "timeline"
        | "contextMemory"
        | "contextTokens"
        | "contextTokenOverhead"
      >,
      aiChatOptions: Pick<
        EditorState["options"]["aiChat"],
        | "contextCompressionEnabled"
        | "contextCompressionThresholdTokens"
        | "visualHistoryWindow"
        | "contextCompressionMode"
      >,
    ) => {
      const nextContextMemory =
        defaultAiChatCompressionEngine.buildAlgorithmicContextMemory({
          session,
          aiChatOptions,
          estimateProjectedTokens: (contextMemory) =>
            estimateProjectedContextTokens(
              {
                conversation: session.conversation,
                contextMemory,
                contextTokenOverhead: session.contextTokenOverhead,
              },
              aiChatOptions,
            ),
          getTimelineItemCountForConversationMessageCount: (
            timelineItems,
            conversationMessageCount,
          ) =>
            getTimelineItemCountForConversationMessageCount(
              timelineItems,
              conversationMessageCount,
              session.runtimeTranscript.timelineBoundaries,
            ),
        });

      session.contextMemory = nextContextMemory;
      return !!nextContextMemory;
    },
    [
      estimateProjectedContextTokens,
      getTimelineItemCountForConversationMessageCount,
    ],
  );

  const refreshSessionProjectedContext = useCallback(
    (
      session: Pick<
        AiChatSessionData,
        | "id"
        | "conversation"
        | "runtimeTranscript"
        | "timeline"
        | "contextMemory"
        | "contextTokens"
        | "contextTokenOverhead"
      >,
      aiChatOptions: Pick<
        EditorState["options"]["aiChat"],
        | "contextCompressionEnabled"
        | "contextCompressionThresholdTokens"
        | "visualHistoryWindow"
        | "contextCompressionMode"
      >,
    ) => {
      const compressionThreshold = Math.max(
        0,
        Math.trunc(aiChatOptions.contextCompressionThresholdTokens || 0),
      );
      if (
        !aiChatOptions.contextCompressionEnabled ||
        session.contextTokens < compressionThreshold
      ) {
        session.contextMemory = undefined;
      } else if (aiChatOptions.contextCompressionMode === "algorithmic") {
        applyAlgorithmicContextCompression(session, aiChatOptions);
      }
    },
    [applyAlgorithmicContextCompression],
  );

  const resetDraftConversationUi = useCallback(() => {
    conversationRef.current = [];
    searchResultsRef.current = new Map();
    setTimeline([]);
    setRunStatus("idle");
    setLastError(null);
    setAwaitingContinue(false);
    setTokenUsage(createEmptyAiChatTokenUsageSummary());
    setContextTokens(0);
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

  const toolCapableChatModelGroups = useMemo(
    () =>
      chatModelGroups
        .map((group) => ({
          ...group,
          models: group.models.filter(
            (model) => model.capabilities.supportsToolCalls,
          ),
        }))
        .filter((group) => group.models.length > 0),
    [chatModelGroups],
  );

  const modelSelectGroups = useMemo<ModelSelectGroup[]>(() => {
    return toolCapableChatModelGroups.map((group) => ({
      id: group.providerId,
      label: group.label,
      options: group.models.map((model) => ({
        value: `${group.providerId}:${model.id}`,
        label: model.label,
        capabilities: model.capabilities,
        disabled: !group.isAvailable,
      })),
    }));
  }, [toolCapableChatModelGroups]);

  const flatModels = useMemo(
    () =>
      toolCapableChatModelGroups.flatMap((group) =>
        group.models.map((model) => ({
          providerId: group.providerId,
          providerLabel: group.label,
          modelId: model.id,
          modelLabel: model.label,
          capabilities: model.capabilities,
          isAvailable: group.isAvailable,
        })),
      ),
    [toolCapableChatModelGroups],
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
  const digestEnabled = editorState.options.aiChat.digestEnabled;
  const visualSummaryEnabled = editorState.options.aiChat.visualSummaryEnabled;
  const visualSummaryModelKey =
    editorState.options.aiChat.visualSummaryModelKey?.trim() || "";

  const digestCharsPerChunk = useMemo(() => {
    const sourceChars = Math.max(
      1,
      editorState.options.aiChat.digestSourceCharsPerChunk,
    );
    return Math.max(
      180,
      Math.floor(
        sourceChars / editorState.options.aiChat.digestOutputRatioDenominator,
      ),
    );
  }, [
    editorState.options.aiChat.digestOutputRatioDenominator,
    editorState.options.aiChat.digestSourceCharsPerChunk,
  ]);

  const summarizeDigestChunk = useCallback(
    async (options: {
      startPage: number;
      endPage: number;
      sampledText: string;
      maxChars: number;
      sourceKind?: AiDocumentDigestSourceKind;
      summaryInstructions?: AiSummaryInstructions;
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

      return await summarizeDigestText(options.sampledText, {
        providerId,
        modelId,
        prompt:
          options.sourceKind === "chunk_summaries"
            ? buildDocumentDigestMergePrompt({
                startPage: options.startPage,
                endPage: options.endPage,
                maxChars: options.maxChars,
                summaryInstructions: options.summaryInstructions,
              })
            : buildDocumentDigestSummaryPrompt({
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

  const summarizeRenderedPages = useCallback(
    async (options: {
      pages: Parameters<typeof summarizePageImages>[0];
      summaryInstructions?: AiSummaryInstructions;
      signal?: AbortSignal;
    }) => {
      if (!visualSummaryModelKey) return "";

      return await summarizePageImages(options.pages, {
        modelKey: visualSummaryModelKey,
        summaryInstructions: options.summaryInstructions,
        signal: options.signal,
      });
    },
    [visualSummaryModelKey],
  );

  const getRenderablePdfBytes = useCallback(
    async (options: { pageNumbers: number[]; signal?: AbortSignal }) => {
      const snapshot = useEditorStore.getState();
      if (!snapshot.pdfBytes) {
        throw new Error("No PDF is currently loaded.");
      }

      const pageIndexes = Array.from(
        new Set(
          options.pageNumbers
            .map((pageNumber) => Math.trunc(pageNumber) - 1)
            .filter(
              (pageIndex) =>
                Number.isFinite(pageIndex) &&
                pageIndex >= 0 &&
                pageIndex < snapshot.pages.length,
            ),
        ),
      ).sort((left, right) => left - right);

      if (pageIndexes.length === 0) {
        throw new Error("No valid pages were selected for AI rendering.");
      }

      const pageIndexSet = new Set(pageIndexes);

      return await exportPDF(
        snapshot.pdfBytes,
        snapshot.fields.filter((field) => pageIndexSet.has(field.pageIndex)),
        snapshot.metadata,
        snapshot.annotations.filter((annotation) =>
          pageIndexSet.has(annotation.pageIndex),
        ),
        undefined,
        {
          openPassword: snapshot.pdfOpenPassword,
          removeTextUnderFlattenedFreetext:
            snapshot.options.removeTextUnderFlattenedFreetext,
          pageIndexes,
          preservedSourceAnnotations:
            snapshot.preservedSourceAnnotations.filter((annotation) =>
              pageIndexSet.has(annotation.pageIndex),
            ),
        },
      );
    },
    [],
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
  const aiScopeId = scopeId?.trim() || documentIdentity;

  const isDocumentLoaded = editorState.pages.length > 0;

  const documentToolContext = useMemo(
    () =>
      createDocumentContextService({
        getSnapshot: () => ({
          filename: editorState.filename,
          metadata: editorState.metadata,
          pages: editorState.pages,
          outline: editorState.outline,
          currentPageIndex: editorState.currentPageIndex,
          scale: editorState.scale,
          pageLayout: editorState.pageLayout,
          pageFlow: editorState.pageFlow,
        }),
        getSelectedTextContext,
        getPdfSource: () => ({
          pdfBytes: editorState.pdfBytes,
          password: editorState.pdfOpenPassword,
        }),
        getRenderablePdfBytes,
        getDigestConfig: () => ({
          charsPerChunk: digestCharsPerChunk,
          sourceCharsPerChunk:
            editorState.options.aiChat.digestSourceCharsPerChunk,
        }),
        getPagesTextConfig: () => ({
          maxChars: editorState.options.aiChat.getPagesTextMaxChars,
        }),
        summarizeDigestChunk:
          digestEnabled && digestSummaryModel
            ? summarizeDigestChunk
            : undefined,
        summarizeRenderedPages:
          visualSummaryEnabled && visualSummaryModelKey
            ? summarizeRenderedPages
            : undefined,
        workerService,
      }),
    [
      digestEnabled,
      digestSummaryModel,
      documentIdentity,
      digestCharsPerChunk,
      editorState.currentPageIndex,
      editorState.filename,
      editorState.metadata,
      editorState.options.aiChat.digestSourceCharsPerChunk,
      editorState.options.aiChat.getPagesTextMaxChars,
      editorState.options.aiChat.visualSummaryEnabled,
      editorState.options.aiChat.visualSummaryModelKey,
      editorState.outline,
      editorState.pageFlow,
      editorState.pageLayout,
      editorState.pages,
      editorState.pdfBytes,
      editorState.pdfOpenPassword,
      editorState.scale,
      getRenderablePdfBytes,
      getSelectedTextContext,
      summarizeDigestChunk,
      summarizeRenderedPages,
      visualSummaryEnabled,
      visualSummaryModelKey,
      workerService,
    ],
  );

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    contextMemoryJobIdsRef.current.clear();
    notifyContextMemoryPendingChanged();
    searchSeqRef.current = 0;

    const restoredInMemory = inMemoryAiChatScopeRegistry.get(aiScopeId);
    if (restoredInMemory) {
      sessionsRef.current = restoredInMemory.sessionsMap;
      setSessions(restoredInMemory.sessionSummaries);
      setActiveSessionId(restoredInMemory.activeSessionId);
      setIsDraftConversation(false);

      const active = restoredInMemory.sessionsMap.get(
        restoredInMemory.activeSessionId,
      );
      if (active) {
        applyAiChatSessionUiState({
          session: active,
          conversationRef,
          searchResultsRef,
          setTimeline,
          setRunStatus,
          setLastError,
          setAwaitingContinue,
          setTokenUsage,
          setContextTokens,
          setHighlightedResultIds,
        });
        return;
      }
    }

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
          setAwaitingContinue,
          setTokenUsage,
          setContextTokens,
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
      setAwaitingContinue,
      setTokenUsage,
      setContextTokens,
      setHighlightedResultIds,
    });
  }, [
    aiScopeId,
    documentIdentity,
    notifyContextMemoryPendingChanged,
    resetDraftConversationUi,
  ]);

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
    tokenUsage,
    timeline,
  ]);

  useEffect(() => {
    const currentActiveSessionId = activeSessionId;
    if (!currentActiveSessionId) return;
    if (!sessionsRef.current.has(currentActiveSessionId)) return;

    inMemoryAiChatScopeRegistry.set(
      aiScopeId,
      createInMemoryAiChatDocumentState({
        activeSessionId: currentActiveSessionId,
        sessions,
        sessionsMap: sessionsRef.current,
      }),
    );
  }, [
    activeSessionId,
    aiScopeId,
    awaitingContinue,
    contextTokens,
    highlightedResultIds,
    lastError,
    runStatus,
    sessions,
    timeline,
    tokenUsage,
  ]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const interactionToolContext = useMemo(
    () =>
      createAiChatToolContext({
        searchResultsRef,
        searchSeqRef,
        sessionsRef,
        activeSessionIdRef,
        setHighlightedResultIds,
        formToolsEnabled: editorState.options.aiChat.formToolsEnabled,
        detectFormFieldsEnabled:
          editorState.options.aiChat.detectFormFieldsEnabled,
        formToolsVisionModelKey:
          editorState.options.aiChat.formToolsVisionModelKey,
        selectedChatModel,
        selectedChatModelAuthor,
        workerService,
      }),
    [
      editorState.options.aiChat.formToolsEnabled,
      editorState.options.aiChat.detectFormFieldsEnabled,
      editorState.options.aiChat.formToolsVisionModelKey,
      selectedChatModel,
      selectedChatModelAuthor,
      workerService,
    ],
  );

  const toolContext = useMemo(
    () => composeAiToolContext(documentToolContext, interactionToolContext),
    [documentToolContext, interactionToolContext],
  );

  const toolRegistry = useMemo(
    () =>
      createAiToolRegistry(toolContext, {
        modelCapabilities: selectedChatModel?.capabilities,
      }),
    [selectedChatModel?.capabilities, toolContext],
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

  const persistAiChatSessionsNow = useCallback(() => {
    if (!canUseLocalStorage()) return;
    if (!isDocumentLoaded) return;

    persistAiChatDocumentState({
      documentIdentity,
      activeSessionId: activeSessionIdRef.current,
      sessions: sessionSummariesRef.current,
      sessionsMap: sessionsRef.current,
    });
  }, [documentIdentity, isDocumentLoaded]);

  const scheduleContextMemory = useCallback(
    (session: AiChatSessionData, selected: AiChatFlatModel) => {
      if (contextMemoryJobIdsRef.current.has(session.id)) return;

      const appOptions = useEditorStore.getState().options;
      if (appOptions.aiChat.contextCompressionMode !== "ai") return;
      const plan = defaultAiChatCompressionEngine.buildAiContextMemoryPlan({
        session,
        aiChatOptions: appOptions.aiChat,
        getTimelineItemCountForConversationMessageCount: (
          timelineItems,
          conversationMessageCount,
        ) =>
          getTimelineItemCountForConversationMessageCount(
            timelineItems,
            conversationMessageCount,
            session.runtimeTranscript.timelineBoundaries,
          ),
      });
      if (!plan) return;

      const requestedSummaryModel = parseAiSdkModelSpecifier(
        appOptions.aiChat.contextCompressionModelKey,
      ) ?? {
        providerId: selected.providerId,
        modelId: selected.modelId,
      };
      const existingSummary = session.contextMemory?.text?.trim();
      const sourceText = existingSummary
        ? [
            "Existing memory:",
            existingSummary,
            "",
            "New history:",
            plan.sourceText,
          ].join("\n\n")
        : plan.sourceText;
      const system = buildAiChatContextMemorySystemPrompt({
        existingSummary,
      });
      const candidateCoveredMessageCount = plan.candidateCoveredMessageCount;
      const jobId = contextMemoryJobSeqRef.current + 1;
      contextMemoryJobSeqRef.current = jobId;
      contextMemoryJobIdsRef.current.set(session.id, jobId);
      notifyContextMemoryPendingChanged();

      void summarizeConversationMemory(sourceText, {
        providerId: requestedSummaryModel.providerId,
        modelId: requestedSummaryModel.modelId,
        system,
      })
        .then((text) => {
          const normalized = text.trim();
          if (!normalized) return;
          if (
            useEditorStore.getState().options.aiChat.contextCompressionMode !==
            "ai"
          ) {
            return;
          }

          const activeSession = sessionsRef.current.get(session.id);
          if (!activeSession) return;
          if (contextMemoryJobIdsRef.current.get(session.id) !== jobId) {
            return;
          }
          if (
            activeSession.timeline.length <
              plan.candidateCoveredTimelineItemCount ||
            activeSession.conversation.length < candidateCoveredMessageCount
          ) {
            return;
          }

          activeSession.contextMemory = {
            text: normalized,
            coveredTimelineItemCount: plan.candidateCoveredTimelineItemCount,
            coveredMessageCount: candidateCoveredMessageCount,
            updatedAt: new Date().toISOString(),
          } satisfies AiChatContextMemory;

          const aiChatOptions = useEditorStore.getState().options.aiChat;
          refreshSessionProjectedContext(activeSession, aiChatOptions);
          persistAiChatSessionsNow();
        })
        .catch(() => {
          // ignore background summary failures
        })
        .finally(() => {
          if (contextMemoryJobIdsRef.current.get(session.id) === jobId) {
            contextMemoryJobIdsRef.current.delete(session.id);
            notifyContextMemoryPendingChanged();
          }
        });
    },
    [
      notifyContextMemoryPendingChanged,
      persistAiChatSessionsNow,
      refreshSessionProjectedContext,
    ],
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
      setAwaitingContinue,
      setTokenUsage,
      setContextTokens,
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

  const runAssistantTurn = useCallback(
    async (options: {
      session: AiChatSessionData;
      selected: AiChatFlatModel;
      assistantBranchAnchorId?: string;
      requestConversation?: AiChatMessageRecord[];
      persistentConversation?: AiChatMessageRecord[];
    }) => {
      const {
        session,
        selected,
        assistantBranchAnchorId,
        requestConversation,
        persistentConversation,
      } = options;
      const sessionId = session.id;
      const modelKey = `${selected.providerId}:${selected.modelId}`;
      const tokenUsageBeforeTurn = { ...session.tokenUsage };
      let stepTokenUsage = createEmptyAiChatTokenUsageSummary();
      let latestStepContextTokens = session.contextTokens;
      let latestContextTokenOverhead = session.contextTokenOverhead;

      setLastError(null);
      setAwaitingContinue(false);
      setRunStatus("running");
      session.lastError = null;
      session.awaitingContinue = false;
      session.runStatus = "running";

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const appOptions = useEditorStore.getState().options;
        const result = await aiChatService.runConversation({
          appOptions,
          modelCache: editorState.llmModelCache,
          messages: requestConversation ?? conversationRef.current,
          persistedMessages: persistentConversation ?? conversationRef.current,
          modelKey,
          getContextMemory: appOptions.aiChat.contextCompressionEnabled
            ? () => session.contextMemory
            : undefined,
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
          onUsageUpdate: (update) => {
            stepTokenUsage = addAiChatTokenUsageSummary(
              stepTokenUsage,
              update.tokenUsage,
            );
            latestStepContextTokens = update.contextTokens;
            latestContextTokenOverhead = update.contextTokenOverhead;
            session.tokenUsage = addAiChatTokenUsageSummary(
              tokenUsageBeforeTurn,
              stepTokenUsage,
            );
            session.contextTokenOverhead = latestContextTokenOverhead;
            session.contextTokens = latestStepContextTokens;
            setTokenUsage(session.tokenUsage);
            setContextTokens(session.contextTokens);
          },
        });

        applyConversationSuccess({
          session,
          conversationRef,
          conversation: result.conversation,
          modelKey,
        });
        session.tokenUsage = addAiChatTokenUsageSummary(
          tokenUsageBeforeTurn,
          result.tokenUsage,
        );
        session.contextTokenOverhead = result.contextTokenOverhead;
        const actualTurnContextTokens = result.contextTokens;
        session.contextTokens = actualTurnContextTokens;
        setTimeline((prev) => {
          const next = applyUsageSnapshotToTurnTimeline(prev, {
            turnId: result.turnId,
            tokenUsage: session.tokenUsage,
            contextTokens: actualTurnContextTokens,
          });
          session.timeline = next;
          setAiChatRuntimeTimelineBoundaries({
            session,
            timelineItemIds: next.flatMap((item) => {
              if (
                item.kind === "message" &&
                (item.turnId === result.turnId ||
                  item.id === result.turnId ||
                  item.id === `${result.turnId}:thinking`)
              ) {
                return [item.id];
              }
              if (item.kind === "tool" && item.turnId === result.turnId) {
                return [item.id];
              }
              return [];
            }),
            messageCount: result.conversation.length,
          });
          return next;
        });
        session.awaitingContinue = result.awaitingContinue;
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

        const compressionThreshold = Math.max(
          0,
          Math.trunc(appOptions.aiChat.contextCompressionThresholdTokens || 0),
        );
        if (
          !appOptions.aiChat.contextCompressionEnabled ||
          actualTurnContextTokens < compressionThreshold
        ) {
          session.contextMemory = undefined;
        } else if (appOptions.aiChat.contextCompressionMode === "algorithmic") {
          applyAlgorithmicContextCompression(session, appOptions.aiChat);
        }
        refreshSessionProjectedContext(session, appOptions.aiChat);
        setTokenUsage(session.tokenUsage);
        setContextTokens(session.contextTokens);
        setAwaitingContinue(result.awaitingContinue);
        setRunStatus("idle");
        if (appOptions.aiChat.contextCompressionMode === "ai") {
          scheduleContextMemory(session, selected);
        }
      } catch (error) {
        session.awaitingContinue = false;

        if (isAbortError(error)) {
          setAwaitingContinue(false);
          setRunStatus("idle");
          session.runStatus = "idle";

          setTimeline((prev) => {
            const next = settleIncompleteTimeline(
              prev,
              new Date().toISOString(),
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
          const next = settleIncompleteTimeline(prev, new Date().toISOString());
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
        setAwaitingContinue(false);
        setLastError(message);
        setRunStatus("error");
        session.lastError = message;
        session.runStatus = "error";
      } finally {
        abortRef.current = null;
      }
    },
    [
      applyAssistantUpdate,
      applyAlgorithmicContextCompression,
      applyToolUpdate,
      editorState.llmModelCache,
      refreshSessionProjectedContext,
      toolRegistry,
      touchSessionSummary,
      scheduleContextMemory,
    ],
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
        setAwaitingContinue(false);
        setRunStatus("error");
        const session = sessionsRef.current.get(activeSessionIdRef.current);
        if (session) {
          session.lastError = "No available AI chat model.";
          session.awaitingContinue = false;
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
      const recoveredRuntimeTranscript = recoverAiChatRuntimeTranscript({
        sourceSession: session,
        timeline: session.timeline,
      });
      syncAiChatSessionConversation({
        session,
        conversationRef,
        conversation: recoveredRuntimeTranscript.messages,
        modelKey: recoveredRuntimeTranscript.modelKey,
      });
      const requestRecoveryMessages = buildAiChatRequestRecoveryMessages({
        timeline: session.timeline,
      });
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

      updateDetectedFieldBatchConfirmation({
        session,
        userMessageId: userItem.id,
        text: displayText || text,
      });

      const { persistentConversation, requestConversation } =
        pushUserConversationMessage({
          session,
          conversationRef,
          conversationText,
          timelineItemId: userItem.id,
          modelKey: `${selected.providerId}:${selected.modelId}`,
          requestContextMessages: requestRecoveryMessages,
        });

      const assistantBranchAnchorId = getPendingBranchAnchorId(
        session,
        "assistant",
      );
      await runAssistantTurn({
        session,
        selected,
        assistantBranchAnchorId,
        requestConversation,
        persistentConversation,
      });
    },
    [
      appendTimelineItem,
      createBranchSession,
      flatModels,
      getPendingBranchAnchorId,
      isDraftConversation,
      materializeDraftConversation,
      runAssistantTurn,
      runStatus,
      selectedModelKey,
      touchSessionSummary,
    ],
  );

  const continueConversation = useCallback(async () => {
    if (runStatus === "running" || runStatus === "cancelling") {
      return;
    }

    const session = sessionsRef.current.get(activeSessionIdRef.current);
    if (!session || !session.awaitingContinue) return;

    const selected = resolveSelectedAiChatModel(flatModels, selectedModelKey);
    if (!selected) {
      setLastError("No available AI chat model.");
      setAwaitingContinue(false);
      setRunStatus("error");
      if (session) {
        session.lastError = "No available AI chat model.";
        session.awaitingContinue = false;
        session.runStatus = "error";
      }
      return;
    }

    const assistantBranchAnchorId = getPendingBranchAnchorId(
      session,
      "assistant",
    );
    await runAssistantTurn({
      session,
      selected,
      assistantBranchAnchorId,
    });
  }, [
    flatModels,
    getPendingBranchAnchorId,
    runAssistantTurn,
    runStatus,
    selectedModelKey,
  ]);

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
    nextSession.runtimeTranscript =
      sliceAiChatRuntimeTranscriptForTimelinePrefix({
        sourceSession: options.sourceSession,
        timeline: nextTimeline,
      });
    nextSession.conversation = nextSession.runtimeTranscript.messages;
    nextSession.searchResultsById = new Map(
      options.sourceSession.searchResultsById,
    );
    nextSession.highlightedResultIds = [];
    nextSession.pendingDetectedFieldBatches =
      options.sourceSession.pendingDetectedFieldBatches.map((batch) => ({
        ...batch,
        pageNumbers: [...batch.pageNumbers],
        allowedTypes: batch.allowedTypes ? [...batch.allowedTypes] : undefined,
        drafts: batch.drafts.map((draft) => ({
          draftId: draft.draftId,
          field: {
            ...draft.field,
            rect: { ...draft.field.rect },
            style: draft.field.style ? { ...draft.field.style } : undefined,
            options: draft.field.options ? [...draft.field.options] : undefined,
          },
          summary: {
            ...draft.summary,
            rect: { ...draft.summary.rect },
            options: draft.summary.options
              ? [...draft.summary.options]
              : undefined,
          },
        })),
      }));
    nextSession.contextMemory = retainAiChatContextMemoryForTimeline(
      options.sourceSession.contextMemory,
      {
        timelineItemCount: nextTimeline.length,
        conversationMessageCount: nextSession.conversation.length,
      },
    );
    nextSession.tokenUsage = { ...options.sourceSession.tokenUsage };
    nextSession.contextTokenOverhead =
      options.sourceSession.contextTokenOverhead;
    applyLatestTimelineUsageSnapshot(nextSession);
    refreshSessionProjectedContext(
      nextSession,
      useEditorStore.getState().options.aiChat,
    );
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
      setAwaitingContinue,
      setTokenUsage,
      setContextTokens,
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
    const nextRuntimeTranscript = sliceAiChatRuntimeTranscriptForTimelinePrefix(
      {
        sourceSession: session,
        timeline: nextTimeline,
      },
    );
    const nextConversation = nextRuntimeTranscript.messages;
    const updatedAt = new Date().toISOString();
    session.timeline = nextTimeline;
    session.runtimeTranscript = nextRuntimeTranscript;
    syncAiChatSessionConversation({
      session,
      conversationRef,
      conversation: nextConversation,
      updatedAt,
    });
    session.updatedAt = updatedAt;
    session.runStatus = "idle";
    session.lastError = null;
    session.awaitingContinue = false;
    session.contextTokenOverhead = Math.max(0, session.contextTokenOverhead);
    session.contextMemory = retainAiChatContextMemoryForTimeline(
      session.contextMemory,
      {
        timelineItemCount: nextTimeline.length,
        conversationMessageCount: nextConversation.length,
      },
    );
    applyLatestTimelineUsageSnapshot(session);
    refreshSessionProjectedContext(
      session,
      useEditorStore.getState().options.aiChat,
    );

    setTimeline(nextTimeline);
    setRunStatus("idle");
    setLastError(null);
    setAwaitingContinue(false);
    setTokenUsage(session.tokenUsage);
    setContextTokens(session.contextTokens);

    touchSessionSummary(session.id, {
      title: session.title,
      updatedAt,
    });

    await sendMessage(retryInput);
  }, [
    applyLatestTimelineUsageSnapshot,
    refreshSessionProjectedContext,
    runStatus,
    sendMessage,
    touchSessionSummary,
  ]);

  const stop = useCallback(() => {
    if (!abortRef.current) return;
    setRunStatus("cancelling");
    const session = sessionsRef.current.get(activeSessionIdRef.current);
    if (session) session.runStatus = "cancelling";
    abortRef.current.abort();
    abortRef.current = null;
  }, []);

  const openDocumentLink = useCallback(
    (target: AiDocumentLinkTarget) => {
      switch (target.kind) {
        case "page": {
          const pageIndex = target.pageNumber - 1;
          if (
            !Number.isInteger(pageIndex) ||
            pageIndex < 0 ||
            pageIndex >= editorState.pages.length
          ) {
            return;
          }
          appEventBus.emit("workspace:navigatePage", {
            pageIndex,
            behavior: "smooth",
          });
          return;
        }
        case "control": {
          const controlId = target.controlId.trim();
          if (!controlId) return;

          const store = useEditorStore.getState();
          const exists =
            store.fields.some((field) => field.id === controlId) ||
            store.annotations.some((annotation) => annotation.id === controlId);
          if (!exists) return;

          appEventBus.emit("workspace:focusControl", {
            id: controlId,
            behavior: "smooth",
          });
          return;
        }
        case "result": {
          const resultId = target.resultId.trim();
          if (!resultId) return;

          const stored = searchResultsRef.current.get(resultId);
          if (!stored) return;

          appEventBus.emit("workspace:focusSearchResult", {
            pageIndex: stored.result.pageIndex,
            rect: stored.result.rect,
            behavior: "smooth",
          });
          return;
        }
      }
    },
    [editorState.pages.length],
  );

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
    syncAiChatSessionConversation({
      session,
      conversationRef,
      conversation: [],
      updatedAt,
    });
    session.searchResultsById = new Map();
    session.highlightedResultIds = [];
    session.pendingDetectedFieldBatches = [];
    session.contextMemory = undefined;
    session.tokenUsage = createEmptyAiChatTokenUsageSummary();
    session.contextTokens = 0;
    session.contextTokenOverhead = 0;
    session.runStatus = "idle";
    session.lastError = null;
    session.awaitingContinue = false;

    applyAiChatSessionUiState({
      session,
      conversationRef,
      searchResultsRef,
      setTimeline,
      setRunStatus,
      setLastError,
      setAwaitingContinue,
      setTokenUsage,
      setContextTokens,
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
        setAwaitingContinue,
        setTokenUsage,
        setContextTokens,
        setHighlightedResultIds,
      });
    },
    [runStatus, sessions],
  );

  const canDeleteConversation = useCallback((id: string) => {
    const session = sessionsRef.current.get(id);
    if (!session) return false;
    return isAiChatSessionStarted(session);
  }, []);

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
  const isContextCompressionRunning = useMemo(() => {
    return (
      !isDraftConversation &&
      contextMemoryJobIdsRef.current.has(activeSessionId)
    );
  }, [activeSessionId, contextMemoryPendingVersion, isDraftConversation]);

  return {
    sessions,
    activeSessionId: isDraftConversation ? "" : activeSessionId,
    selectSession,
    newConversation,
    clearConversation,
    deleteConversation,
    canDeleteConversation,

    timeline,
    runStatus,
    lastError,
    awaitingContinue,
    isContextCompressionRunning,
    tokenUsage,
    contextTokens,
    selectedModelKey,
    setSelectedModelKey,
    modelSelectGroups,
    sendMessage,
    continueConversation,
    regenerateAssistantMessage,
    retryLastFailedMessage,
    editUserMessage,
    switchMessageBranch,
    stop,
    openDocumentLink,

    highlightedSearchResultsByPage,
    hasAvailableModel,
    disabledReason,
    formToolsEnabled: editorState.options.aiChat.formToolsEnabled,
  };
};
