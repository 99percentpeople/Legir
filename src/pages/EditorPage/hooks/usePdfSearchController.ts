import React from "react";
import { appEventBus } from "@/lib/eventBus";
import { findPdfSearchResults, type PDFSearchMode } from "@/lib/pdfSearch";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { useEditorStore } from "@/store/useEditorStore";
import type { EditorState, PDFSearchResult } from "@/types";
import {
  getDistanceSquaredBetweenPoints,
  getPointToRectDistanceSquared,
  getRectCenter,
} from "@/lib/viewportMath";
import { getPdfSearchSelectionOffsets } from "@/components/workspace/lib/pdfSearchHighlights";
import type {
  EditorUiStateSetter,
  TranslateFn,
  WorkspaceTextHighlightsByPage,
} from "../types";

interface UsePdfSearchControllerOptions {
  pages: EditorState["pages"];
  sidebarOpen: boolean;
  setUiState: EditorUiStateSetter;
  workspaceScrollContainerRef: React.RefObject<HTMLElement | null>;
  highlightedSearchResultsByPage?: Map<number, PDFSearchResult[]>;
  t: TranslateFn;
}

export function usePdfSearchController({
  pages,
  sidebarOpen,
  setUiState,
  workspaceScrollContainerRef,
  highlightedSearchResultsByPage,
  t,
}: UsePdfSearchControllerOptions) {
  const [isPdfSearchOpen, setIsPdfSearchOpen] = React.useState(false);
  const [pdfSearchQuery, setPdfSearchQuery] = React.useState("");
  const [pdfSearchResults, setPdfSearchResults] = React.useState<
    PDFSearchResult[]
  >([]);
  const [activePdfSearchResultId, setActivePdfSearchResultId] = React.useState<
    string | null
  >(null);
  const [isPdfSearchLoading, setIsPdfSearchLoading] = React.useState(false);
  const [pdfSearchFocusToken, setPdfSearchFocusToken] = React.useState(0);
  const [isPdfSearchCaseSensitive, setIsPdfSearchCaseSensitive] =
    React.useState(false);
  const [pdfSearchMode, setPdfSearchMode] =
    React.useState<PDFSearchMode>("plain");
  const [pdfSearchError, setPdfSearchError] = React.useState<string | null>(
    null,
  );

  const pdfSearchSeqRef = React.useRef(0);
  const pdfSearchViewportStateRef = React.useRef({
    scale: useEditorStore.getState().scale,
    currentPageIndex: useEditorStore.getState().currentPageIndex,
  });
  const pendingPdfSearchPreferredSelectionRef = React.useRef<{
    query: string;
    pageIndex: number;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  const pdfSearchOpenedWithSidebarRef = React.useRef(false);

  React.useEffect(
    () =>
      useEditorStore.subscribe((nextState) => {
        pdfSearchViewportStateRef.current = {
          scale: nextState.scale,
          currentPageIndex: nextState.currentPageIndex,
        };
      }),
    [],
  );

  React.useEffect(() => {
    if (!sidebarOpen && isPdfSearchOpen) {
      setIsPdfSearchOpen(false);
      pdfSearchOpenedWithSidebarRef.current = false;
    }
  }, [isPdfSearchOpen, sidebarOpen]);

  const getWorkspaceSelectedSearchText = React.useCallback(() => {
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

  const getPreferredPdfSearchResultId = React.useCallback(
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

  const getViewportClosestPdfSearchResultId = React.useCallback(
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
    [workspaceScrollContainerRef],
  );

  const openPdfSearch = React.useCallback(() => {
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
      pdfSearchOpenedWithSidebarRef.current = sidebarOpen;
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
    sidebarOpen,
  ]);

  const dismissPdfSearch = React.useCallback(() => {
    setIsPdfSearchOpen(false);
    pdfSearchOpenedWithSidebarRef.current = false;
  }, []);

  const closePdfSearch = React.useCallback(() => {
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

  React.useEffect(() => {
    const trimmedQuery = pdfSearchQuery.trim();
    const currentSeq = ++pdfSearchSeqRef.current;

    if (!isPdfSearchOpen) {
      pendingPdfSearchPreferredSelectionRef.current = null;
      setIsPdfSearchLoading(false);
      setPdfSearchError(null);
      return;
    }

    if (!trimmedQuery || pages.length === 0) {
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
            pages.map(async (page) => {
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
    pages,
    pdfSearchMode,
    pdfSearchQuery,
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

  const workspaceTextHighlightsByPage =
    React.useMemo<WorkspaceTextHighlightsByPage>(() => {
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
      append(highlightedSearchResultsByPage);

      return grouped.size > 0 ? grouped : undefined;
    }, [
      highlightedSearchResultsByPage,
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

  const handleSelectPdfSearchResult = React.useCallback(
    (result: PDFSearchResult) => {
      setActivePdfSearchResultId(result.id);
      appEventBus.emit("workspace:focusSearchResult", {
        pageIndex: result.pageIndex,
        rect: result.rect,
        behavior: "smooth",
      });
    },
    [],
  );

  const handleSelectPreviousPdfSearchResult = React.useCallback(() => {
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

  const handleSelectNextPdfSearchResult = React.useCallback(() => {
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

  return {
    isPdfSearchOpen,
    pdfSearchQuery,
    setPdfSearchQuery,
    pdfSearchResults,
    activePdfSearchResultId,
    setActivePdfSearchResultId,
    isPdfSearchLoading,
    pdfSearchFocusToken,
    isPdfSearchCaseSensitive,
    togglePdfSearchCaseSensitive: () =>
      setIsPdfSearchCaseSensitive((value) => !value),
    pdfSearchMode,
    togglePdfSearchMode: () =>
      setPdfSearchMode((value) => (value === "regex" ? "plain" : "regex")),
    pdfSearchError,
    pdfSearchResultsByPage,
    workspaceTextHighlightsByPage,
    activePdfSearchResultIndex,
    openPdfSearch,
    closePdfSearch,
    dismissPdfSearch,
    handleSelectPdfSearchResult,
    handleSelectPreviousPdfSearchResult,
    handleSelectNextPdfSearchResult,
  };
}
