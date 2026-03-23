import React, { useCallback, useEffect, useRef, useState } from "react";
import Toolbar from "../components/toolbar/Toolbar";
import Sidebar from "../components/sidebar/Sidebar";
import PDFSearchHeader from "../components/sidebar/PDFSearchHeader";
import PDFSearchPanel from "../components/sidebar/PDFSearchPanel";
import { useEditorStore } from "../store/useEditorStore";
import { Button } from "../components/ui/button";
import { appEventBus } from "@/lib/eventBus";
import { RightPanelTabDock } from "../components/properties-panel/RightPanelTabDock";
import { PropertiesPanel } from "../components/properties-panel/PropertiesPanel";
import { FormDetectionPanel } from "../components/properties-panel/FormDetectionPanel";
import { PageTranslatePanel } from "../components/properties-panel/PageTranslatePanel";
import { AiChatPanel } from "../components/properties-panel/AiChatPanel";
import { useIsMobile } from "../hooks/useIsMobile";
import { usePageTranslation } from "../hooks/usePageTranslation";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";
import { TranslationFloatingWindow } from "../components/workspace/widgets/TranslationFloatingWindow";
import { useAiChatController } from "@/hooks/useAiChatController";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../components/ui/dialog";
import { useLanguage } from "../components/language-provider";
import type {
  Annotation,
  EditorState,
  EditorUiState,
  FormField,
  MoveDirection,
  PDFMetadata,
  PDFSearchResult,
  Tool,
} from "../types";
import type { FormDetectionOptions } from "../components/FormDetectionOptionsForm";
import { ANNOTATION_STYLES } from "../constants";
import { recentFilesService } from "../services/recentFilesService";
import { pdfWorkerService } from "../services/pdfService/pdfWorkerService";
import { findPdfSearchResults, type PDFSearchMode } from "../lib/pdfSearch";
import { getMovedAnnotationUpdates } from "@/lib/controlMovement";
import { getPdfSearchSelectionOffsets } from "../components/workspace/lib/pdfSearchHighlights";
import {
  calculateWorkspaceFitScreenScale,
  calculateWorkspaceFitWidthScale,
} from "../components/workspace/lib/calculateWorkspaceFitScale";
import {
  getDistanceSquaredBetweenPoints,
  getPointToRectDistanceSquared,
  getRectCenter,
} from "@/lib/viewportMath";
import { useShallow } from "zustand/react/shallow";
import { selectEditorPageShellState } from "@/store/selectors";
import { EditorCanvasPane } from "@/pages/editor/EditorCanvasPane";
import {
  closePlatformWindow,
  exitPlatformFullscreen,
  getPlatformDocumentSaveMode,
  listenForPlatformCloseRequested,
  saveDraftViewStateIfSupported,
  saveEditorViewState,
  setPlatformFullscreen,
  setPlatformWindowTitle,
  subscribePlatformFullscreenChange,
} from "@/services/platform";

export interface EditorPageProps {
  onExport: () => Promise<boolean>;
  onSaveDraft: (silent?: boolean) => Promise<void>;
  onSaveAs: () => Promise<boolean>;
  onExit: () => void;
  onPrint: () => void;
  onAdvancedDetect: (options: FormDetectionOptions) => void;
}

const EditorPage: React.FC<EditorPageProps> = ({
  onExport,
  onSaveDraft,
  onSaveAs,
  onExit,
  onPrint,
  onAdvancedDetect,
}) => {
  const editorStore = useEditorStore(useShallow(selectEditorPageShellState));
  const state = editorStore;
  const { t, effectiveLanguage } = useLanguage();
  const {
    setState,
    setUiState,
    addAnnotations,
    updateAnnotation,
    deleteSelection,
    selectControl,
    setTool,
    saveCheckpoint,
    setProcessingStatus,
    withProcessing,
    undo,
    redo,
    deleteAnnotation,
    openDialog,
    setPageTranslateParagraphCandidates,
    clearPageTranslateParagraphCandidates,
    setSelectedPageTranslateParagraphIds,
    mergeSelectedPageTranslateParagraphs,
    toggleExcludeSelectedPageTranslateParagraphs,
    deleteSelectedPageTranslateParagraphs,
    removePageTranslateParagraphCandidatesByPageIndex,
    setAllFreetextFlatten,
  } = editorStore;

  const isMobile = useIsMobile();
  const defaultTool: Tool = isMobile ? "pan" : "select";
  const platformDocumentSaveMode = getPlatformDocumentSaveMode();
  const prevSelectedIdRef = useRef<string | null>(null);
  const skipNextWindowCloseRef = useRef(false);
  const initialTitleRef = useRef<string | null>(null);
  const workspaceScrollContainerRef = useRef<HTMLElement | null>(null);
  const webViewStateRef = useRef({
    lastScroll: null as { left: number; top: number } | null,
    cleanup: null as null | (() => void),
    rafId: null as number | null,
    lastSaveAt: 0,
  });

  const [isTranslateOpen, setIsTranslateOpen] = useState(false);
  const [translateSourceText, setTranslateSourceText] = useState("");
  const [translateAutoToken, setTranslateAutoToken] = useState(0);
  const [isPdfSearchOpen, setIsPdfSearchOpen] = useState(false);
  const [pdfSearchQuery, setPdfSearchQuery] = useState("");
  const [pdfSearchResults, setPdfSearchResults] = useState<PDFSearchResult[]>(
    [],
  );
  const [activePdfSearchResultId, setActivePdfSearchResultId] = useState<
    string | null
  >(null);
  const [isPdfSearchLoading, setIsPdfSearchLoading] = useState(false);
  const [pdfSearchFocusToken, setPdfSearchFocusToken] = useState(0);
  const [isPdfSearchCaseSensitive, setIsPdfSearchCaseSensitive] =
    useState(false);
  const [pdfSearchMode, setPdfSearchMode] = useState<PDFSearchMode>("plain");
  const [pdfSearchError, setPdfSearchError] = useState<string | null>(null);
  const pdfSearchSeqRef = useRef(0);
  const pdfSearchViewportStateRef = useRef({
    scale: useEditorStore.getState().scale,
    currentPageIndex: useEditorStore.getState().currentPageIndex,
  });
  const pendingPdfSearchPreferredSelectionRef = useRef<{
    query: string;
    pageIndex: number;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  const pdfSearchOpenedWithSidebarRef = useRef(false);
  useEffect(
    () =>
      useEditorStore.subscribe((nextState) => {
        pdfSearchViewportStateRef.current = {
          scale: nextState.scale,
          currentPageIndex: nextState.currentPageIndex,
        };
      }),
    [],
  );

  useEffect(() => {
    if (!isMobile) return;
    const currentState = useEditorStore.getState();
    if (currentState.tool !== "select") return;
    if (currentState.selectedId) return;
    currentState.setTool("pan");
  }, [isMobile]);

  const {
    isPageTranslating,
    pageTranslateStatus,
    cancelPageTranslate,
    handleStartPageTranslate,
    handlePreviewParagraphs,
    handleUnmergeSelectedParagraphs,
  } = usePageTranslation({
    state,
    t,
    addAnnotations,
    setState,
    setUiState,
    setProcessingStatus,
    withProcessing,
    setPageTranslateParagraphCandidates,
    setSelectedPageTranslateParagraphIds,
    removePageTranslateParagraphCandidatesByPageIndex,
  });

  const aiChat = useAiChatController(state);
  const openAiChatPanel = useCallback(() => {
    setUiState((prev) => {
      const updates: Partial<EditorUiState> = {
        rightPanelTab: "ai_chat",
        isRightPanelOpen: true,
      };
      if (prev.isPanelFloating) {
        updates.isSidebarOpen = false;
      }
      return updates;
    });
  }, [setUiState]);

  const setEditorFullscreen = useCallback(
    async (next: boolean) => {
      setState({ isFullscreen: next });
      try {
        await setPlatformFullscreen(next);
      } catch (error) {
        console.error("Failed to toggle fullscreen", error);
        setState({ isFullscreen: !next });
      }
    },
    [setState],
  );

  const exitEditorFullscreen = useCallback(async () => {
    try {
      await exitPlatformFullscreen();
    } catch (error) {
      console.error("Failed to exit fullscreen", error);
    } finally {
      setState({ isFullscreen: false });
    }
  }, [setState]);

  const toggleFullscreen = useCallback(() => {
    const next = !useEditorStore.getState().isFullscreen;
    void setEditorFullscreen(next);
  }, [setEditorFullscreen]);

  const handleExitEditorPage = useCallback(() => {
    void (async () => {
      await exitEditorFullscreen();
      onExit();
    })();
  }, [exitEditorFullscreen, onExit]);

  useEffect(() => {
    return () => {
      void exitEditorFullscreen();
    };
  }, [exitEditorFullscreen]);

  const handleModeChange = useCallback(
    (mode: EditorState["mode"]) => {
      setState({ mode, tool: defaultTool });
    },
    [defaultTool, setState],
  );

  useEventListener(
    typeof window !== "undefined" ? window : null,
    "keydown",
    (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
      }
    },
  );

  useEffect(() => {
    return subscribePlatformFullscreenChange((isFullscreen) => {
      setState({ isFullscreen });
    });
  }, [setState]);

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;

      try {
        webViewStateRef.current.cleanup?.();
      } catch {
        // ignore
      }
      webViewStateRef.current.cleanup = null;

      const update = () => {
        webViewStateRef.current.lastScroll = {
          left: element.scrollLeft,
          top: element.scrollTop,
        };

        if (webViewStateRef.current.rafId !== null) return;
        if (typeof window === "undefined") return;
        webViewStateRef.current.rafId = window.requestAnimationFrame(() => {
          webViewStateRef.current.rafId = null;
          const now = Date.now();
          if (now - webViewStateRef.current.lastSaveAt < 200) return;
          webViewStateRef.current.lastSaveAt = now;
          const snapshot = useEditorStore.getState();
          if (!snapshot.pages || snapshot.pages.length === 0) return;
          const last = webViewStateRef.current.lastScroll ?? {
            left: element.scrollLeft,
            top: element.scrollTop,
          };
          saveDraftViewStateIfSupported({
            pagesLength: snapshot.pages.length,
            scale: snapshot.scale,
            scrollContainer: {
              scrollLeft: last.left,
              scrollTop: last.top,
            },
          });
        });
      };

      update();
      element.addEventListener("scroll", update, { passive: true });
      webViewStateRef.current.cleanup = () => {
        element.removeEventListener("scroll", update);
      };
    },
    { replayLast: true },
  );

  useEffect(() => {
    return () => {
      try {
        webViewStateRef.current.cleanup?.();
      } catch {
        // ignore
      }
      webViewStateRef.current.cleanup = null;

      if (webViewStateRef.current.rafId !== null) {
        try {
          if (typeof window !== "undefined") {
            window.cancelAnimationFrame(webViewStateRef.current.rafId);
          }
        } catch {
          // ignore
        }
      }
      webViewStateRef.current.rafId = null;
    };
  }, []);

  useAppEvent("sidebar:focusAnnotation", () => {
    setIsPdfSearchOpen(false);
    setUiState((prev) => ({
      isSidebarOpen: true,
      sidebarTab: "annotations",
      ...(prev.isPanelFloating ? { isRightPanelOpen: false } : {}),
    }));
  });

  useAppEvent("workspace:openTranslate", ({ sourceText, autoTranslate }) => {
    const trimmed = typeof sourceText === "string" ? sourceText.trim() : "";

    // handle if translate is already open
    if (isTranslateOpen) {
      if (trimmed !== "") setTranslateSourceText(trimmed);
    } else {
      setTranslateSourceText(trimmed);
      setIsTranslateOpen(true);
    }

    if (autoTranslate) setTranslateAutoToken((x) => x + 1);
  });

  useAppEvent("workspace:askAi", () => {
    openAiChatPanel();
  });

  useEffect(() => {
    if (isTranslateOpen) {
      setUiState((prev) => {
        if (prev.rightPanelDockTab?.includes("translate")) return {};
        return {
          rightPanelDockTab: [...(prev.rightPanelDockTab ?? []), "translate"],
        };
      });
      return;
    }

    setUiState((prev) => {
      if (!prev.rightPanelDockTab?.includes("translate")) return {};
      return {
        rightPanelDockTab: (prev.rightPanelDockTab ?? []).filter(
          (t) => t !== "translate",
        ),
      };
    });
  }, [isTranslateOpen, setUiState]);

  const selectedField =
    state.selectedId && state.fields.find((f) => f.id === state.selectedId)
      ? state.fields.find((f) => f.id === state.selectedId) || null
      : null;

  const selectedAnnotation =
    state.selectedId && state.annotations.find((a) => a.id === state.selectedId)
      ? state.annotations.find((a) => a.id === state.selectedId) || null
      : null;

  const selectedControl = selectedField || selectedAnnotation;

  useEffect(() => {
    setState({ isPanelFloating: isMobile });

    if (isMobile) {
      setUiState((prev) => {
        if (!prev.isSidebarOpen || !prev.isRightPanelOpen) return prev;
        return { isSidebarOpen: true, isRightPanelOpen: false };
      });
    }
  }, [isMobile, setState, setUiState]);

  useEffect(() => {
    if (!state.isPanelFloating) return;
    if (state.isSidebarOpen && state.isRightPanelOpen) {
      setUiState({ isRightPanelOpen: false });
    }
  }, [
    state.isPanelFloating,
    state.isSidebarOpen,
    state.isRightPanelOpen,
    setUiState,
  ]);

  useEffect(() => {
    const prev = prevSelectedIdRef.current;
    const next = state.selectedId;
    if (!prev && next) {
      setUiState({ rightPanelTab: "properties" });
    }
    prevSelectedIdRef.current = next;
  }, [state.selectedId, setUiState]);

  useEffect(() => {
    if (!state.selectedId && state.rightPanelTab === "properties") {
      setUiState({ rightPanelTab: "document" });
    }
  }, [state.selectedId, state.rightPanelTab, setUiState]);

  useEffect(() => {
    if (!state.isSidebarOpen && isPdfSearchOpen) {
      setIsPdfSearchOpen(false);
    }
  }, [isPdfSearchOpen, state.isSidebarOpen]);

  useEffect(() => {
    appEventBus.clearSticky("workspace:focusTextRange");
  }, [state.filename, state.pages.length, state.pdfBytes]);

  const getWorkspaceSelectedSearchText = useCallback(() => {
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
      query: selectedText.replace(/\s+/g, " ").trim(),
      pageIndex,
      startOffset: offsets.startOffset,
      endOffset: offsets.endOffset,
    };
  }, []);

  const getPreferredPdfSearchResultId = useCallback(
    (
      results: PDFSearchResult[],
      preferredSelection: {
        pageIndex: number;
        startOffset: number;
        endOffset: number;
      },
    ) => {
      const pageResults = results.filter(
        (result) => result.pageIndex === preferredSelection.pageIndex,
      );
      if (pageResults.length === 0) return null;

      let bestResult: PDFSearchResult | null = null;
      let bestOverlap = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const result of pageResults) {
        const overlap = Math.max(
          0,
          Math.min(result.endOffset, preferredSelection.endOffset) -
            Math.max(result.startOffset, preferredSelection.startOffset),
        );
        const distance =
          Math.abs(result.startOffset - preferredSelection.startOffset) +
          Math.abs(result.endOffset - preferredSelection.endOffset);

        if (overlap > bestOverlap) {
          bestResult = result;
          bestOverlap = overlap;
          bestDistance = distance;
          continue;
        }

        if (overlap === bestOverlap && distance < bestDistance) {
          bestResult = result;
          bestDistance = distance;
        }
      }

      return bestResult?.id ?? null;
    },
    [],
  );

  const getViewportClosestPdfSearchResultId = useCallback(
    (results: PDFSearchResult[]) => {
      const container = workspaceScrollContainerRef.current;
      if (!container || results.length === 0) return null;
      const viewportState = pdfSearchViewportStateRef.current;

      const containerRect = container.getBoundingClientRect();
      const viewportCenter = getRectCenter(containerRect);

      let bestResult: PDFSearchResult | null = null;
      let bestViewportDistance = Number.POSITIVE_INFINITY;
      let bestCenterDistance = Number.POSITIVE_INFINITY;

      for (const result of results) {
        const pageElement = document.getElementById(
          `page-${result.pageIndex}`,
        ) as HTMLElement | null;
        if (!pageElement) continue;

        const pageRect = pageElement.getBoundingClientRect();
        const resultCenter = {
          x:
            pageRect.left +
            (result.rect.x + result.rect.width / 2) * viewportState.scale,
          y:
            pageRect.top +
            (result.rect.y + result.rect.height / 2) * viewportState.scale,
        };
        const viewportDistance = getPointToRectDistanceSquared(
          resultCenter,
          containerRect,
        );
        const centerDistance = getDistanceSquaredBetweenPoints(
          resultCenter,
          viewportCenter,
        );

        if (viewportDistance < bestViewportDistance) {
          bestResult = result;
          bestViewportDistance = viewportDistance;
          bestCenterDistance = centerDistance;
          continue;
        }

        if (
          viewportDistance === bestViewportDistance &&
          centerDistance < bestCenterDistance
        ) {
          bestResult = result;
          bestCenterDistance = centerDistance;
        }
      }

      if (bestResult) return bestResult.id;

      const currentPageResults = results.filter(
        (result) => result.pageIndex === viewportState.currentPageIndex,
      );
      return currentPageResults[0]?.id ?? results[0]?.id ?? null;
    },
    [],
  );

  const openPdfSearch = useCallback(() => {
    const selectedSearch = getWorkspaceSelectedSearchText();
    pendingPdfSearchPreferredSelectionRef.current = selectedSearch
      ? {
          query: selectedSearch.query,
          pageIndex: selectedSearch.pageIndex,
          startOffset: selectedSearch.startOffset,
          endOffset: selectedSearch.endOffset,
        }
      : null;
    if (selectedSearch) {
      window.getSelection?.()?.removeAllRanges?.();
    }
    if (selectedSearch?.query) setPdfSearchQuery(selectedSearch.query);
    if (!isPdfSearchOpen) {
      pdfSearchOpenedWithSidebarRef.current = state.isSidebarOpen;
      setPdfSearchResults([]);
      setActivePdfSearchResultId(null);
    }
    setIsPdfSearchOpen(true);
    setPdfSearchFocusToken((value) => value + 1);
    setUiState((prev) => {
      if (prev.isPanelFloating) {
        return { isSidebarOpen: true, isRightPanelOpen: false };
      }
      return { isSidebarOpen: true };
    });
  }, [
    getWorkspaceSelectedSearchText,
    isPdfSearchOpen,
    setUiState,
    state.isSidebarOpen,
  ]);

  const closePdfSearch = useCallback(() => {
    const activeResult =
      pdfSearchResults.find(
        (result) => result.id === activePdfSearchResultId,
      ) ?? null;
    const shouldKeepSidebarOpen = pdfSearchOpenedWithSidebarRef.current;

    setIsPdfSearchOpen(false);
    pdfSearchOpenedWithSidebarRef.current = false;

    if (!shouldKeepSidebarOpen) {
      setUiState({ isSidebarOpen: false });
    }

    if (!activeResult) return;

    window.requestAnimationFrame(() => {
      appEventBus.emit(
        "workspace:focusTextRange",
        {
          pageIndex: activeResult.pageIndex,
          startOffset: activeResult.startOffset,
          endOffset: activeResult.endOffset,
          rect: activeResult.rect,
          behavior: "auto",
        },
        { sticky: true },
      );
    });
  }, [activePdfSearchResultId, pdfSearchResults, setUiState]);

  useEffect(() => {
    const trimmedQuery = pdfSearchQuery.trim();
    const currentSeq = ++pdfSearchSeqRef.current;

    if (!isPdfSearchOpen) {
      pendingPdfSearchPreferredSelectionRef.current = null;
      setIsPdfSearchLoading(false);
      setPdfSearchError(null);
      return;
    }

    if (!trimmedQuery || state.pages.length === 0) {
      pendingPdfSearchPreferredSelectionRef.current = null;
      setIsPdfSearchLoading(false);
      setPdfSearchError(null);
      setPdfSearchResults([]);
      setActivePdfSearchResultId(null);
      return;
    }

    const abortController = new AbortController();
    setIsPdfSearchLoading(true);
    setPdfSearchError(null);
    setPdfSearchResults([]);
    setActivePdfSearchResultId(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const pageMatches = await Promise.all(
            state.pages.map(async (page) => {
              const textContent = await pdfWorkerService.getTextContent({
                pageIndex: page.pageIndex,
                signal: abortController.signal,
              });
              if (!textContent) return [];
              return findPdfSearchResults(textContent, trimmedQuery, page, {
                caseSensitive: isPdfSearchCaseSensitive,
                mode: pdfSearchMode,
              });
            }),
          );

          if (abortController.signal.aborted) return;
          if (pdfSearchSeqRef.current !== currentSeq) return;

          const nextResults = pageMatches.flat();
          const preferredResultId = (() => {
            const preferredSelection =
              pendingPdfSearchPreferredSelectionRef.current;
            if (!preferredSelection) return null;
            if (preferredSelection.query !== trimmedQuery) {
              pendingPdfSearchPreferredSelectionRef.current = null;
              return null;
            }
            pendingPdfSearchPreferredSelectionRef.current = null;
            return getPreferredPdfSearchResultId(
              nextResults,
              preferredSelection,
            );
          })();
          const viewportClosestResultId = preferredResultId
            ? null
            : getViewportClosestPdfSearchResultId(nextResults);
          setPdfSearchResults(nextResults);
          setActivePdfSearchResultId(
            (currentId) =>
              preferredResultId ??
              viewportClosestResultId ??
              (nextResults.some((result) => result.id === currentId)
                ? currentId
                : (nextResults[0]?.id ?? null)),
          );
        } catch (error) {
          if ((error as Error)?.name !== "AbortError") {
            console.error("Failed to search PDF text", error);
            const message = error instanceof Error ? error.message : "";
            setPdfSearchResults([]);
            setActivePdfSearchResultId(null);
            setPdfSearchError(
              message.includes("Invalid regex search pattern")
                ? t("sidebar.search_invalid_regex")
                : t("sidebar.search_failed"),
            );
          }
        } finally {
          if (
            !abortController.signal.aborted &&
            pdfSearchSeqRef.current === currentSeq
          ) {
            setIsPdfSearchLoading(false);
          }
        }
      })();
    }, 180);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [
    getPreferredPdfSearchResultId,
    getViewportClosestPdfSearchResultId,
    isPdfSearchCaseSensitive,
    isPdfSearchOpen,
    pdfSearchMode,
    pdfSearchQuery,
    state.pages,
    t,
  ]);

  const pdfSearchResultsByPage = React.useMemo(() => {
    const grouped = new Map<number, PDFSearchResult[]>();
    for (const result of pdfSearchResults) {
      const pageResults = grouped.get(result.pageIndex);
      if (pageResults) pageResults.push(result);
      else grouped.set(result.pageIndex, [result]);
    }
    return grouped;
  }, [pdfSearchResults]);

  const workspaceTextHighlightsByPage = React.useMemo(() => {
    const grouped = new Map<number, PDFSearchResult[]>();

    const append = (source?: Map<number, PDFSearchResult[]>) => {
      if (!source) return;
      for (const [pageIndex, results] of source.entries()) {
        const existing = grouped.get(pageIndex);
        if (existing) existing.push(...results);
        else grouped.set(pageIndex, [...results]);
      }
    };

    if (isPdfSearchOpen) {
      append(pdfSearchResultsByPage);
    }
    append(aiChat.highlightedSearchResultsByPage);

    return grouped.size > 0 ? grouped : undefined;
  }, [
    aiChat.highlightedSearchResultsByPage,
    isPdfSearchOpen,
    pdfSearchResultsByPage,
  ]);

  const activePdfSearchResultIndex = React.useMemo(
    () =>
      pdfSearchResults.findIndex(
        (result) => result.id === activePdfSearchResultId,
      ),
    [activePdfSearchResultId, pdfSearchResults],
  );

  const handleSelectPdfSearchResult = useCallback((result: PDFSearchResult) => {
    setActivePdfSearchResultId(result.id);
    appEventBus.emit("workspace:focusSearchResult", {
      pageIndex: result.pageIndex,
      rect: result.rect,
      behavior: "smooth",
    });
  }, []);

  const handleSelectPreviousPdfSearchResult = useCallback(() => {
    if (pdfSearchResults.length === 0) return;
    const targetIndex =
      activePdfSearchResultIndex >= 0
        ? (activePdfSearchResultIndex - 1 + pdfSearchResults.length) %
          pdfSearchResults.length
        : pdfSearchResults.length - 1;
    handleSelectPdfSearchResult(pdfSearchResults[targetIndex]!);
  }, [
    activePdfSearchResultIndex,
    handleSelectPdfSearchResult,
    pdfSearchResults,
  ]);

  const handleSelectNextPdfSearchResult = useCallback(() => {
    if (pdfSearchResults.length === 0) return;
    const targetIndex =
      activePdfSearchResultIndex >= 0
        ? (activePdfSearchResultIndex + 1) % pdfSearchResults.length
        : 0;
    handleSelectPdfSearchResult(pdfSearchResults[targetIndex]!);
  }, [
    activePdfSearchResultIndex,
    handleSelectPdfSearchResult,
    pdfSearchResults,
  ]);

  useEffect(() => {
    const appName = process.env.APP_NAME;

    if (typeof document !== "undefined") {
      if (initialTitleRef.current === null) {
        initialTitleRef.current = document.title;
      }
    }

    const hasOpenDocument = state.pages.length > 0;
    const nextTitle = hasOpenDocument
      ? `${state.filename || appName} - ${appName}`
      : appName;

    void setPlatformWindowTitle(nextTitle).catch(() => {
      // ignore
    });

    return () => {
      void setPlatformWindowTitle(initialTitleRef.current ?? appName).catch(
        () => {
          // ignore
        },
      );
    };
  }, [state.filename, state.pages.length]);

  useEffect(() => {
    let unlisten: null | (() => void) = null;
    let cancelled = false;

    void (async () => {
      unlisten = await listenForPlatformCloseRequested((event) => {
        if (skipNextWindowCloseRef.current) {
          skipNextWindowCloseRef.current = false;
          return;
        }

        recentFilesService.cancelPreviewTasks();

        const snapshot = useEditorStore.getState();
        if (!snapshot.pages || snapshot.pages.length === 0) return;

        saveEditorViewState({
          saveTarget: snapshot.saveTarget,
          pagesLength: snapshot.pages.length,
          scale: snapshot.scale,
          currentPageIndex: snapshot.currentPageIndex,
          scrollContainer: workspaceScrollContainerRef.current,
        });

        if (!snapshot.isDirty) return;
        event.preventDefault();
        snapshot.setState({
          activeDialog: "close_confirm",
          closeConfirmSource: "window",
        });
      });

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [state.isDirty, state.pages.length]);

  const closeConfirmOpen = state.activeDialog === "close_confirm";
  const closeSource = state.closeConfirmSource || "menu";

  const closeDialog = useCallback(() => {
    setState({ activeDialog: null, closeConfirmSource: null });
  }, [setState]);

  const runPrimarySaveAction = useCallback(
    async (silentDraft = false) => {
      if (platformDocumentSaveMode === "draft") {
        await onSaveDraft(silentDraft);
        return true;
      }

      const snapshot = useEditorStore.getState();
      if (!snapshot.isDirty) return false;
      return await onExport();
    },
    [onExport, onSaveDraft, platformDocumentSaveMode],
  );

  const closeWindow = async () => {
    recentFilesService.cancelPreviewTasks();
    const snapshot = useEditorStore.getState();
    saveEditorViewState({
      saveTarget: snapshot.saveTarget,
      pagesLength: snapshot.pages.length,
      scale: snapshot.scale,
      currentPageIndex: snapshot.currentPageIndex,
      scrollContainer: workspaceScrollContainerRef.current,
    });

    skipNextWindowCloseRef.current = true;
    await closePlatformWindow();
  };

  const finishConfirmedClose = useCallback(async () => {
    if (closeSource === "window") {
      await closeWindow();
      return;
    }
    handleExitEditorPage();
  }, [closeSource, closeWindow, handleExitEditorPage]);

  const persistDraftViewState = useCallback(() => {
    const snapshot = useEditorStore.getState();
    const el = workspaceScrollContainerRef.current;
    if (!el) return;

    const last = webViewStateRef.current.lastScroll;
    saveDraftViewStateIfSupported({
      pagesLength: snapshot.pages.length,
      scale: snapshot.scale,
      scrollContainer:
        last === null
          ? el
          : {
              scrollLeft: last.left,
              scrollTop: last.top,
            },
    });
  }, []);

  useEventListener<BeforeUnloadEvent>(
    typeof window !== "undefined" ? window : null,
    "beforeunload",
    (e) => {
      persistDraftViewState();
      if (
        platformDocumentSaveMode === "draft" &&
        state.pages.length > 0 &&
        state.isDirty
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    },
  );

  useEventListener(
    typeof window !== "undefined" ? window : null,
    "pagehide",
    () => {
      persistDraftViewState();
      if (platformDocumentSaveMode !== "draft") return;
      const snapshot = useEditorStore.getState();
      if (snapshot.isDirty) {
        void onSaveDraft(true);
      }
    },
  );

  useEventListener(
    typeof document !== "undefined" ? document : null,
    "visibilitychange",
    () => {
      if (document.visibilityState !== "hidden") return;
      persistDraftViewState();
      if (platformDocumentSaveMode !== "draft") return;
      const snapshot = useEditorStore.getState();
      if (snapshot.isDirty) {
        void onSaveDraft(true);
      }
    },
  );

  useEffect(() => {
    if (platformDocumentSaveMode !== "draft") return;
    if (state.pages.length > 0 && state.pdfBytes) {
      const timer = setTimeout(() => {
        if (!state.isDirty) return;
        void onSaveDraft(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [
    state.isDirty,
    state.fields,
    state.annotations,
    state.metadata,
    state.filename,
    state.pages.length,
    state.pdfBytes,
    onSaveDraft,
    platformDocumentSaveMode,
  ]);

  useEventListener<KeyboardEvent>(
    typeof window !== "undefined" ? window : null,
    "keydown",
    (e) => {
      const currentState = useEditorStore.getState();

      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        currentState.setKeys({
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
          space: currentState.keys.space,
        });
        return;
      }

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === " " && !isInput) {
        e.preventDefault();
        e.stopPropagation();
        if (!currentState.keys.space) {
          currentState.setKeys({ space: true });
        }
        return;
      }

      if (e.key === "Escape") {
        if (currentState.activeDialog) return;
        if (isPdfSearchOpen) {
          e.preventDefault();
          if (isInput) target.blur();
          closePdfSearch();
          return;
        }
        if (isInput) target.blur();
        if (currentState.selectedId) {
          currentState.selectControl(null);
        } else if (currentState.tool !== defaultTool) {
          currentState.setTool(defaultTool);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void runPrimarySaveAction(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onPrint();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openPdfSearch();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (isInput && !(target as HTMLInputElement).readOnly) {
          return;
        }
        const isSelectedField = currentState.fields.some(
          (f) => f.id === currentState.selectedId,
        );
        if (currentState.mode === "annotation" && isSelectedField) {
          return;
        }
        currentState.deleteSelection();
        return;
      }

      if (isInput && !(target as HTMLInputElement).readOnly) {
        return;
      }

      const isMoveKey = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(e.key);
      const isKeyboardHandleTarget =
        target instanceof HTMLElement &&
        !!target.closest("[data-ff-keyboard-handle]");
      const isSelectedField = currentState.fields.some(
        (f) => f.id === currentState.selectedId,
      );
      const isSelectedAnnotation = currentState.annotations.some(
        (a) => a.id === currentState.selectedId,
      );

      if (
        !isKeyboardHandleTarget &&
        currentState.selectedId &&
        isMoveKey &&
        ((currentState.mode === "form" && isSelectedField) ||
          (currentState.mode === "annotation" && isSelectedAnnotation))
      ) {
        e.preventDefault();
        const isFast = e.shiftKey;
        let direction: MoveDirection = "UP";
        if (e.key === "ArrowUp") direction = "UP";
        else if (e.key === "ArrowDown") direction = "DOWN";
        else if (e.key === "ArrowLeft") direction = "LEFT";
        else if (e.key === "ArrowRight") direction = "RIGHT";
        currentState.moveSelectedControl(direction, isFast);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) currentState.redo();
        else currentState.undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        currentState.redo();
        return;
      }

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        currentState.openDialog("shortcuts");
        return;
      }
    },
    true,
  );

  useEventListener<KeyboardEvent>(
    typeof window !== "undefined" ? window : null,
    "keyup",
    (e) => {
      const currentState = useEditorStore.getState();
      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        currentState.setKeys({
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
          space: currentState.keys.space,
        });
      }

      if (e.key === " ") {
        currentState.setKeys({ space: false });
      }
    },
    true,
  );

  const handlePenStyleChange = useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      setState((prev) => ({
        ...prev,
        penStyle: { ...prev.penStyle, ...style },
      }));
    },
    [setState],
  );

  const handleHighlightStyleChange = useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      setState((prev) => ({
        ...prev,
        highlightStyle: {
          ...(prev.highlightStyle || {
            color: ANNOTATION_STYLES.highlight.color,
            thickness: ANNOTATION_STYLES.highlight.thickness,
            opacity: ANNOTATION_STYLES.highlight.opacity,
          }),
          ...style,
        },
      }));
    },
    [setState],
  );

  const handleCommentStyleChange = useCallback(
    (style: { color: string }) => {
      setState((prev) => ({
        ...prev,
        commentStyle: { ...prev.commentStyle, ...style },
      }));
    },
    [setState],
  );

  const handleFreetextStyleChange = useCallback(
    (style: { color: string }) => {
      setState((prev) => ({
        ...prev,
        freetextStyle: { ...prev.freetextStyle!, ...style },
      }));
    },
    [setState],
  );

  const handleShapeStyleChange = useCallback(
    (style: Partial<NonNullable<EditorState["shapeStyle"]>>) => {
      setState((prev) => ({
        ...prev,
        shapeStyle: { ...prev.shapeStyle!, ...style },
      }));
    },
    [setState],
  );

  const handleEditAnnotation = useCallback(
    (id: string) => {
      selectControl(id);

      appEventBus.emit(
        "sidebar:focusAnnotation",
        { id },
        {
          sticky: true,
        },
      );
    },
    [selectControl],
  );

  const handlePropertiesChange = useCallback(
    (updates: Partial<FormField | Annotation>) => {
      const currentSelectedId = editorStore.selectedId;
      if (!currentSelectedId) return;

      const isField = editorStore.fields.some(
        (f) => f.id === currentSelectedId,
      );
      if (isField) {
        editorStore.updateField(
          currentSelectedId,
          updates as Partial<FormField>,
        );
        return;
      }

      const isAnnotation = editorStore.annotations.some(
        (a) => a.id === currentSelectedId,
      );
      if (isAnnotation) {
        const currentAnnotation = editorStore.annotations.find(
          (annotation) => annotation.id === currentSelectedId,
        );
        const nextRect = updates.rect;
        const currentRect = currentAnnotation?.rect;

        if (
          currentAnnotation &&
          currentRect &&
          nextRect &&
          nextRect.width === currentRect.width &&
          nextRect.height === currentRect.height &&
          (nextRect.x !== currentRect.x || nextRect.y !== currentRect.y)
        ) {
          editorStore.updateAnnotation(currentSelectedId, {
            ...updates,
            ...getMovedAnnotationUpdates(
              currentAnnotation,
              nextRect.x - currentRect.x,
              nextRect.y - currentRect.y,
            ),
          } as Partial<Annotation>);
          return;
        }

        editorStore.updateAnnotation(
          currentSelectedId,
          updates as Partial<Annotation>,
        );
      }
    },
    [editorStore],
  );

  const handleMetadataChange = useCallback(
    (updates: Partial<PDFMetadata>) => {
      setState((prev) => ({
        ...prev,
        metadata: { ...prev.metadata, ...updates },
        isDirty: true,
      }));
    },
    [setState],
  );

  const handleFilenameChange = useCallback(
    (name: string) => {
      setState({ filename: name, isDirty: true });
    },
    [setState],
  );
  const getWorkspaceViewport = useCallback(() => {
    const el = workspaceScrollContainerRef.current;
    if (el) return { width: el.clientWidth, height: el.clientHeight };
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 0, height: 0 };
  }, []);
  const handleZoomIn = useCallback(() => {
    const currentScale = useEditorStore.getState().scale;
    setState({ scale: Math.min(5.0, currentScale * 1.25) });
  }, [setState]);
  const handleZoomOut = useCallback(() => {
    const currentScale = useEditorStore.getState().scale;
    setState({ scale: Math.max(0.25, currentScale / 1.25) });
  }, [setState]);
  const handleFitWidth = useCallback(() => {
    const liveState = useEditorStore.getState();
    setState({
      scale: calculateWorkspaceFitWidthScale({
        pages: liveState.pages,
        pageIndex: liveState.currentPageIndex,
        pageLayout: liveState.pageLayout,
        pageFlow: liveState.pageFlow,
        viewport: getWorkspaceViewport(),
      }),
      fitTrigger: Date.now(),
    });
  }, [getWorkspaceViewport, setState]);
  const handleFitScreen = useCallback(() => {
    const liveState = useEditorStore.getState();
    setState({
      scale: calculateWorkspaceFitScreenScale({
        pages: liveState.pages,
        pageIndex: liveState.currentPageIndex,
        pageLayout: liveState.pageLayout,
        pageFlow: liveState.pageFlow,
        viewport: getWorkspaceViewport(),
      }),
      fitTrigger: Date.now(),
    });
  }, [getWorkspaceViewport, setState]);

  const canRenderRightPanel =
    state.mode === "form" || state.mode === "annotation" || selectedControl;
  const normalizedSidebarTab =
    state.sidebarTab === "search" ? "thumbnails" : state.sidebarTab;
  const activeSidebarTab = isPdfSearchOpen ? "search" : normalizedSidebarTab;

  return (
    <>
      <Toolbar
        editorState={state}
        isSaving={state.isSaving}
        isDirty={state.isDirty}
        hideModeSelector={isMobile}
        hideToolSection={isMobile}
        compactZoomControl={isMobile}
        showPageSettingsControl={isMobile}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitWidth={handleFitWidth}
        onFitScreen={handleFitScreen}
        onPageLayoutChange={(layout) => {
          setState({ pageLayout: layout, fitTrigger: Date.now() });
        }}
        onPageFlowChange={(flow) => {
          setState({ pageFlow: flow, fitTrigger: Date.now() });
        }}
        onToggleFullscreen={toggleFullscreen}
        onToolChange={(tool: Tool) => setTool(tool)}
        onModeChange={handleModeChange}
        onPenStyleChange={handlePenStyleChange}
        onHighlightStyleChange={handleHighlightStyleChange}
        onCommentStyleChange={handleCommentStyleChange}
        onFreetextStyleChange={handleFreetextStyleChange}
        onShapeStyleChange={handleShapeStyleChange}
        onExport={onExport}
        onSaveDraft={onSaveDraft}
        onSaveAs={onSaveAs}
        onExit={handleExitEditorPage}
        onClose={() => {
          if (!state.isDirty) {
            handleExitEditorPage();
            return;
          }
          setState({
            activeDialog: "close_confirm",
            closeConfirmSource: "menu",
          });
        }}
        onPrint={onPrint}
        onUndo={undo}
        onRedo={redo}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        onOpenShortcuts={() => openDialog("shortcuts")}
        onOpenSearch={openPdfSearch}
        isFieldListOpen={state.isSidebarOpen}
        onToggleFieldList={() =>
          setUiState((prev) => {
            const next = !prev.isSidebarOpen;
            if (prev.isPanelFloating && next)
              return { isSidebarOpen: true, isRightPanelOpen: false };
            return { isSidebarOpen: next };
          })
        }
        isPropertiesPanelOpen={state.isRightPanelOpen}
        onTogglePropertiesPanel={() =>
          setUiState((prev) => {
            const next = !prev.isRightPanelOpen;
            if (prev.isPanelFloating && next)
              return { isRightPanelOpen: true, isSidebarOpen: false };
            return { isRightPanelOpen: next };
          })
        }
        onOpenSettings={() => openDialog("settings")}
        isSearchOpen={isPdfSearchOpen}
      />

      <Dialog
        open={closeConfirmOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>{t("dialog.confirm_close.title")}</DialogTitle>
          <DialogDescription>
            {t("dialog.confirm_close.desc")}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t("dialog.confirm_close.cancel")}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                if (state.isDirty) {
                  const ok = await runPrimarySaveAction(false);
                  if (!ok && platformDocumentSaveMode === "file") return;
                }
                closeDialog();
                await finishConfirmedClose();
              }}
            >
              {platformDocumentSaveMode === "file"
                ? t("dialog.confirm_close.save_close")
                : t("dialog.confirm_close.save_draft_close")}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                closeDialog();
                await finishConfirmedClose();
              }}
            >
              {t("dialog.confirm_close.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="relative flex flex-1 overflow-hidden">
        {state.isPanelFloating &&
          (state.isSidebarOpen || state.isRightPanelOpen) && (
            <div
              className="absolute inset-0 z-30 bg-black/20"
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget) return;
                setUiState({
                  isSidebarOpen: false,
                  isRightPanelOpen: false,
                });
              }}
            />
          )}

        <Sidebar
          isOpen={state.isSidebarOpen}
          onOpen={() => {
            setUiState((prev) => {
              if (prev.isPanelFloating) {
                return { isSidebarOpen: true, isRightPanelOpen: false };
              }
              return { isSidebarOpen: true };
            });
          }}
          onClose={() => setUiState({ isSidebarOpen: false })}
          onExitSearch={closePdfSearch}
          isFloating={state.isPanelFloating}
          pages={state.pages}
          fields={state.fields}
          annotations={state.annotations}
          outline={state.outline}
          selectedId={state.selectedId}
          thumbnailsLayout={state.options.thumbnailsLayout}
          onSelectControl={(id, options) => {
            selectControl(id);
            if (id) {
              appEventBus.emit(
                "workspace:focusControl",
                {
                  id,
                  behavior: options?.behavior,
                  skipScroll: options?.skipScroll,
                },
                { sticky: true },
              );
            }
          }}
          onDeleteAnnotation={deleteAnnotation}
          onUpdateAnnotation={updateAnnotation}
          onNavigatePage={(idx) => {
            appEventBus.emit("workspace:navigatePage", {
              pageIndex: idx,
              behavior: "smooth",
            });
          }}
          currentPageIndex={state.currentPageIndex}
          width={state.sidebarWidth}
          onResize={(w) => setUiState({ sidebarWidth: w })}
          activeTab={activeSidebarTab}
          isSearchActive={isPdfSearchOpen}
          onTabChange={(tab) => {
            setIsPdfSearchOpen(false);
            setUiState({ sidebarTab: tab });
          }}
          searchHeaderContent={
            <PDFSearchHeader
              query={pdfSearchQuery}
              focusToken={pdfSearchFocusToken}
              canGoPrevious={pdfSearchResults.length > 0}
              canGoNext={pdfSearchResults.length > 0}
              onQueryChange={setPdfSearchQuery}
              onPrevious={handleSelectPreviousPdfSearchResult}
              onNext={handleSelectNextPdfSearchResult}
            />
          }
          searchContent={
            <PDFSearchPanel
              query={pdfSearchQuery}
              mode={pdfSearchMode}
              caseSensitive={isPdfSearchCaseSensitive}
              results={pdfSearchResults}
              activeResultId={activePdfSearchResultId}
              activeResultIndex={activePdfSearchResultIndex}
              isSearching={isPdfSearchLoading}
              errorMessage={pdfSearchError}
              onToggleCaseSensitive={() =>
                setIsPdfSearchCaseSensitive((value) => !value)
              }
              onToggleRegex={() =>
                setPdfSearchMode((value) =>
                  value === "regex" ? "plain" : "regex",
                )
              }
              onSelectResult={handleSelectPdfSearchResult}
            />
          }
        />

        <EditorCanvasPane
          onEditAnnotation={handleEditAnnotation}
          onToggleFullscreen={toggleFullscreen}
          pdfSearchResultsByPage={workspaceTextHighlightsByPage}
          activePdfSearchResultId={
            isPdfSearchOpen ? activePdfSearchResultId : null
          }
          mobileToolbar={{
            isDirty: state.isDirty,
            canUndo: state.past.length > 0,
            canRedo: state.future.length > 0,
            onModeChange: handleModeChange,
            onPenStyleChange: handlePenStyleChange,
            onHighlightStyleChange: handleHighlightStyleChange,
            onCommentStyleChange: handleCommentStyleChange,
            onFreetextStyleChange: handleFreetextStyleChange,
            onShapeStyleChange: handleShapeStyleChange,
            onUndo: undo,
            onRedo: redo,
            onOpenShortcuts: () => openDialog("shortcuts"),
            onOpenSearch: openPdfSearch,
            isFieldListOpen: state.isSidebarOpen,
            onToggleFieldList: () =>
              setUiState((prev) => {
                const next = !prev.isSidebarOpen;
                if (prev.isPanelFloating && next)
                  return { isSidebarOpen: true, isRightPanelOpen: false };
                return { isSidebarOpen: next };
              }),
            isPropertiesPanelOpen: state.isRightPanelOpen,
            onTogglePropertiesPanel: () =>
              setUiState((prev) => {
                const next = !prev.isRightPanelOpen;
                if (prev.isPanelFloating && next)
                  return { isRightPanelOpen: true, isSidebarOpen: false };
                return { isRightPanelOpen: next };
              }),
            onOpenSettings: () => openDialog("settings"),
            isSearchOpen: isPdfSearchOpen,
            onExport,
            onSaveDraft,
            onSaveAs,
            onPrint,
            onExit: handleExitEditorPage,
            onClose: () => {
              if (!state.isDirty) {
                handleExitEditorPage();
                return;
              }
              setState({
                activeDialog: "close_confirm",
                closeConfirmSource: "menu",
              });
            },
          }}
        />

        <RightPanelTabDock
          activeTabs={
            state.isRightPanelOpen
              ? [state.rightPanelTab, ...state.rightPanelDockTab]
              : [...state.rightPanelDockTab]
          }
          isRightPanelOpen={state.isRightPanelOpen}
          isFloating={state.isPanelFloating}
          rightOffsetPx={state.isRightPanelOpen ? state.rightPanelWidth : 0}
          canOpenProperties={!!selectedControl}
          onSelectTab={(tab) => {
            if (tab === "properties" && !selectedControl) return;
            setUiState((prev) => {
              const updates: Partial<EditorUiState> = {
                rightPanelTab: tab,
                isRightPanelOpen: true,
              };
              if (prev.isPanelFloating) {
                updates.isSidebarOpen = false;
              }
              return updates;
            });
          }}
        />

        {canRenderRightPanel &&
          (state.rightPanelTab === "ai_chat" ? (
            <AiChatPanel
              isFloating={state.isPanelFloating}
              isOpen={state.isRightPanelOpen}
              onOpen={() => {
                setUiState((prev) => {
                  if (prev.isPanelFloating) {
                    return { isRightPanelOpen: true, isSidebarOpen: false };
                  }
                  return { isRightPanelOpen: true };
                });
              }}
              width={state.rightPanelWidth}
              onResize={(w) => setUiState({ rightPanelWidth: w })}
              onCollapse={() => setUiState({ isRightPanelOpen: false })}
              sessions={aiChat.sessions}
              activeSessionId={aiChat.activeSessionId}
              onSelectSession={aiChat.selectSession}
              onNewConversation={aiChat.newConversation}
              onClearConversation={aiChat.clearConversation}
              onDeleteConversation={aiChat.deleteConversation}
              timeline={aiChat.timeline}
              runStatus={aiChat.runStatus}
              lastError={aiChat.lastError}
              awaitingContinue={aiChat.awaitingContinue}
              selectedModelKey={aiChat.selectedModelKey}
              onSelectModel={aiChat.setSelectedModelKey}
              modelGroups={aiChat.modelSelectGroups}
              onSend={(input) => {
                void aiChat.sendMessage(input);
              }}
              onContinueConversation={() => {
                void aiChat.continueConversation();
              }}
              onRegenerateMessage={(messageId) => {
                void aiChat.regenerateAssistantMessage(messageId);
              }}
              onRetryLastError={() => {
                void aiChat.retryLastFailedMessage();
              }}
              onEditUserMessage={aiChat.editUserMessage}
              onStop={aiChat.stop}
              onOpenDocumentLink={aiChat.openDocumentLink}
              disabledReason={aiChat.disabledReason}
            />
          ) : state.rightPanelTab === "form_detect" ? (
            <FormDetectionPanel
              isFloating={state.isPanelFloating}
              isOpen={state.isRightPanelOpen}
              onOpen={() => {
                setUiState((prev) => {
                  if (prev.isPanelFloating) {
                    return { isRightPanelOpen: true, isSidebarOpen: false };
                  }
                  return { isRightPanelOpen: true };
                });
              }}
              width={state.rightPanelWidth}
              onResize={(w) => setUiState({ rightPanelWidth: w })}
              onCollapse={() => setUiState({ isRightPanelOpen: false })}
              totalPages={state.pages.length}
              isProcessing={state.isProcessing}
              onDetect={(options) => {
                onAdvancedDetect(options);
              }}
            />
          ) : state.rightPanelTab === "page_translate" ? (
            <PageTranslatePanel
              isFloating={state.isPanelFloating}
              isOpen={state.isRightPanelOpen}
              onOpen={() => {
                setUiState((prev) => {
                  if (prev.isPanelFloating) {
                    return { isRightPanelOpen: true, isSidebarOpen: false };
                  }
                  return { isRightPanelOpen: true };
                });
              }}
              width={state.rightPanelWidth}
              onResize={(w) => setUiState({ rightPanelWidth: w })}
              onCollapse={() => setUiState({ isRightPanelOpen: false })}
              totalPages={state.pages.length}
              isProcessing={isPageTranslating}
              processingStatus={pageTranslateStatus}
              initialTranslateOption={state.translateOption}
              initialTargetLanguage={
                state.translateTargetLanguage || effectiveLanguage
              }
              fontFamily={state.pageTranslateOptions.fontFamily}
              onFontFamilyChange={(val) =>
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    fontFamily: val,
                  },
                }))
              }
              freetextPadding={state.pageTranslateOptions.freetextPadding}
              onFreetextPaddingChange={(val) =>
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    freetextPadding: val,
                  },
                }))
              }
              usePositionAwarePrompt={
                state.pageTranslateOptions.usePositionAwarePrompt
              }
              onUsePositionAwarePromptChange={(val) =>
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    usePositionAwarePrompt: val,
                  },
                }))
              }
              aiReflowParagraphs={state.pageTranslateOptions.aiReflowParagraphs}
              onAiReflowParagraphsChange={(val) =>
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    aiReflowParagraphs: val,
                  },
                }))
              }
              contextWindow={state.pageTranslateOptions.contextWindow}
              onContextWindowChange={(val) =>
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    contextWindow: val,
                  },
                }))
              }
              flattenAllFreetext={state.pageTranslateOptions.flattenFreetext}
              onFlattenAllFreetextChange={(val) => {
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    flattenFreetext: val,
                  },
                }));
                setAllFreetextFlatten(val);
              }}
              useParagraphs={state.pageTranslateOptions.useParagraphs}
              onUseParagraphsChange={(val) =>
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    useParagraphs: val,
                  },
                }))
              }
              paragraphXGap={state.pageTranslateOptions.paragraphXGap}
              onParagraphXGapChange={(val) =>
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    paragraphXGap: val,
                  },
                }))
              }
              paragraphYGap={state.pageTranslateOptions.paragraphYGap}
              onParagraphYGapChange={(val) =>
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    paragraphYGap: val,
                  },
                }))
              }
              paragraphSplitByFontSize={
                state.pageTranslateOptions.paragraphSplitByFontSize
              }
              onParagraphSplitByFontSizeChange={(val) =>
                setUiState((prev) => ({
                  pageTranslateOptions: {
                    ...prev.pageTranslateOptions,
                    paragraphSplitByFontSize: val,
                  },
                }))
              }
              paragraphCandidatesCount={
                state.pageTranslateParagraphCandidates.length
              }
              selectedParagraphCount={
                state.pageTranslateSelectedParagraphIds.length
              }
              onPreviewParagraphs={(opts) => {
                void handlePreviewParagraphs(opts);
              }}
              onClearParagraphs={clearPageTranslateParagraphCandidates}
              onMergeSelectedParagraphs={mergeSelectedPageTranslateParagraphs}
              onUnmergeSelectedParagraphs={() => {
                void handleUnmergeSelectedParagraphs();
              }}
              onToggleExcludeSelectedParagraphs={
                toggleExcludeSelectedPageTranslateParagraphs
              }
              onDeleteSelectedParagraphs={deleteSelectedPageTranslateParagraphs}
              onStart={(opts) => {
                void handleStartPageTranslate(opts);
              }}
              onCancel={cancelPageTranslate}
            />
          ) : (
            <PropertiesPanel
              selectedControl={selectedControl}
              activeTab={
                state.rightPanelTab === "properties" ? "properties" : "document"
              }
              metadata={state.metadata}
              filename={state.filename}
              onChange={handlePropertiesChange}
              onMetadataChange={handleMetadataChange}
              onFilenameChange={handleFilenameChange}
              onDelete={deleteSelection}
              onClose={() => {
                setUiState({ rightPanelTab: "document" });
                selectControl(null);
              }}
              onCollapse={() => {
                setUiState({ isRightPanelOpen: false });
              }}
              isOpen={state.isRightPanelOpen}
              onOpen={() => {
                setUiState((prev) => {
                  if (prev.isPanelFloating) {
                    return { isRightPanelOpen: true, isSidebarOpen: false };
                  }
                  return { isRightPanelOpen: true };
                });
              }}
              isFloating={state.isPanelFloating}
              onTriggerHistorySave={saveCheckpoint}
              width={state.rightPanelWidth}
              onResize={(w) => setUiState({ rightPanelWidth: w })}
            />
          ))}

        <TranslationFloatingWindow
          isOpen={isTranslateOpen}
          sourceText={translateSourceText}
          autoTranslateToken={translateAutoToken}
          onClose={() => setIsTranslateOpen(false)}
        />
      </div>
    </>
  );
};

export default React.memo(EditorPage);
