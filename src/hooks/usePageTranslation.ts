import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { pageTranslationService } from "@/services/pageTranslationService";

import type {
  Annotation,
  EditorState,
  EditorUiState,
  PageTranslateContextWindow,
  TranslateOptionId,
} from "../types";

type TranslateFn = (key: string) => string;

export const usePageTranslation = (deps: {
  state: EditorState;
  t: TranslateFn;
  addAnnotations: (
    annotations: Annotation[],
    options?: { select?: boolean },
  ) => void;
  setState: (
    next: Partial<EditorState> | ((prev: EditorState) => Partial<EditorState>),
  ) => void;
  setUiState: (
    next:
      | Partial<EditorUiState>
      | ((prev: EditorUiState) => Partial<EditorUiState>),
  ) => void;
  setProcessingStatus: (status: string | null) => void;
  withProcessing: <T>(
    status: string | null,
    fn: () => Promise<T>,
  ) => Promise<T>;
  setPageTranslateParagraphCandidates: (
    next: EditorState["pageTranslateParagraphCandidates"],
  ) => void;
  setSelectedPageTranslateParagraphIds: (ids: string[]) => void;
  removePageTranslateParagraphCandidatesByPageIndex: (
    pageIndex: number,
  ) => void;
}) => {
  const {
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
  } = deps;

  const [isPageTranslating, setIsPageTranslating] = useState(false);
  const [pageTranslateStatus, setPageTranslateStatus] = useState<string | null>(
    null,
  );
  const pageTranslateAbortRef = useRef<AbortController | null>(null);

  const cancelPageTranslate = useCallback(() => {
    pageTranslateAbortRef.current?.abort();
    pageTranslateAbortRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cancelPageTranslate();
    };
  }, [cancelPageTranslate]);

  const handleStartPageTranslate = useCallback(
    async (options: {
      pageRange: string;
      targetLanguage: string;
      translateOption: TranslateOptionId;
      prompt: string;
      fontFamily: string;
      usePositionAwarePrompt: boolean;
      aiReflowParagraphs: boolean;
      useParagraphs: boolean;
      contextWindow: PageTranslateContextWindow;
    }) => {
      if (state.pages.length === 0) return;
      if (pageTranslateAbortRef.current) return;

      const parsed = pageTranslationService.parsePageRange(
        options.pageRange,
        state.pages.length,
      );
      if (!parsed.ok) return;

      setState({
        translateOption: options.translateOption,
        translateTargetLanguage: options.targetLanguage,
      });
      setUiState((prev) => ({
        pageTranslateOptions: {
          ...prev.pageTranslateOptions,
          fontFamily: options.fontFamily,
          usePositionAwarePrompt: options.usePositionAwarePrompt,
          aiReflowParagraphs: options.aiReflowParagraphs,
          useParagraphs: options.useParagraphs,
          contextWindow: options.contextWindow,
        },
      }));

      cancelPageTranslate();
      const controller = new AbortController();
      pageTranslateAbortRef.current = controller;
      setIsPageTranslating(true);
      setPageTranslateStatus(null);

      try {
        const pagesSnapshot = state.pages;
        const targetPageIndices = parsed.pageIndices;

        const isStructuredTranslate =
          pageTranslationService.isStructuredTranslateOption(
            options.translateOption,
          );

        await withProcessing(t("common.processing"), async () => {
          if (options.useParagraphs) {
            for await (const {
              pageIndex,
              annotations,
            } of pageTranslationService.translateParagraphCandidatesToFreetextAnnotationsByPage(
              {
                pages: pagesSnapshot,
                pageIndices: targetPageIndices,
                paragraphCandidates: state.pageTranslateParagraphCandidates,
                translate: {
                  targetLanguage: options.targetLanguage,
                  sourceLanguage: undefined,
                  translateOption: options.translateOption,
                  prompt: options.prompt,
                },
                contextWindow: options.contextWindow,
                fontFamily: options.fontFamily,
                usePositionAwarePrompt: options.usePositionAwarePrompt,
                aiReflowParagraphs: options.aiReflowParagraphs,
                padding: state.pageTranslateOptions.freetextPadding,
                flattenFreetext: state.pageTranslateOptions.flattenFreetext,
                signal: controller.signal,
                onProgress: ({ processed, total }) => {
                  const status = `${t("common.processing")} ${processed}/${total}`;
                  setPageTranslateStatus(status);
                  setProcessingStatus(status);
                },
                onError: ({ pageIndex }, e) => {
                  console.error("Paragraph translation failed", e);
                  const msg =
                    typeof (e as { message?: unknown })?.message === "string"
                      ? (e as { message: string }).message
                      : String(e);
                  toast.error(
                    msg ||
                      `Paragraph translation failed (page ${pageIndex + 1}).`,
                  );
                },
              },
            )) {
              if (controller.signal.aborted) return;
              if (annotations.length > 0) {
                addAnnotations(annotations, { select: false });
              }
              removePageTranslateParagraphCandidatesByPageIndex(pageIndex);
            }

            return;
          }

          for await (const {
            annotations,
          } of pageTranslationService.translateTextLayerPagesToFreetextAnnotationsByPage(
            {
              pages: pagesSnapshot,
              pageIndices: targetPageIndices,
              translate: {
                targetLanguage: options.targetLanguage,
                sourceLanguage: undefined,
                translateOption: options.translateOption,
                prompt: options.prompt,
              },
              contextWindow: options.contextWindow,
              fontFamily: options.fontFamily,
              usePositionAwarePrompt: options.usePositionAwarePrompt,
              aiReflowParagraphs: options.aiReflowParagraphs,
              padding: state.pageTranslateOptions.freetextPadding,
              flattenFreetext: state.pageTranslateOptions.flattenFreetext,
              signal: controller.signal,
              onProgress: ({
                pageNumber,
                totalPages,
                lineIndex,
                totalLines,
              }) => {
                const status = isStructuredTranslate
                  ? `${t("common.processing")} (${pageNumber}/${totalPages})`
                  : `${t("common.processing")} (${pageNumber}/${totalPages}) ${lineIndex}/${totalLines}`;
                setPageTranslateStatus(status);
                setProcessingStatus(status);
              },
              onError: ({ pageNumber, totalPages }, e) => {
                console.error("Page translation failed", e);
                const msg =
                  typeof (e as { message?: unknown })?.message === "string"
                    ? (e as { message: string }).message
                    : String(e);
                toast.error(
                  msg || `Page translate failed (${pageNumber}/${totalPages}).`,
                );
              },
            },
          )) {
            if (controller.signal.aborted) return;
            if (annotations.length > 0) {
              // Commit translated annotations page-by-page so earlier results persist
              // even if later AI calls fail.
              addAnnotations(annotations, { select: false });
            }
          }
        });
      } catch (e: unknown) {
        if (typeof (e as { name?: unknown })?.name === "string") {
          if ((e as { name: string }).name === "AbortError") return;
        }
        console.error("Page translation failed", e);
        const msg =
          typeof (e as { message?: unknown })?.message === "string"
            ? (e as { message: string }).message
            : String(e);
        toast.error(msg || "Page translation failed.");
      } finally {
        setIsPageTranslating(false);
        pageTranslateAbortRef.current = null;
      }
    },
    [
      addAnnotations,
      cancelPageTranslate,
      removePageTranslateParagraphCandidatesByPageIndex,
      setProcessingStatus,
      setState,
      setUiState,
      state.pageTranslateParagraphCandidates,
      state.pageTranslateOptions.flattenFreetext,
      state.pages,
      t,
      withProcessing,
    ],
  );

  const handlePreviewParagraphs = useCallback(
    async (options: { pageIndices: number[]; xGap: number; yGap: number }) => {
      if (state.pages.length === 0) return;
      if (pageTranslateAbortRef.current) return;
      const controller = new AbortController();
      cancelPageTranslate();
      pageTranslateAbortRef.current = controller;

      setIsPageTranslating(true);
      setPageTranslateStatus(null);

      try {
        const pagesSnapshot = state.pages;

        const all = await withProcessing(t("common.processing"), async () => {
          return await pageTranslationService.extractParagraphCandidatesFromTextLayerForPages(
            {
              pages: pagesSnapshot,
              pageIndices: options.pageIndices,
              xGap: options.xGap,
              yGap: options.yGap,
              splitByFontSize:
                state.pageTranslateOptions.paragraphSplitByFontSize,
              signal: controller.signal,
              onProgress: ({ pageNumber, totalPages }) => {
                const status = `${t("common.processing")} (${pageNumber}/${totalPages})`;
                setPageTranslateStatus(status);
                setProcessingStatus(status);
              },
            },
          );
        });

        if (controller.signal.aborted) return;
        setPageTranslateParagraphCandidates(all);
      } catch (e: unknown) {
        if (typeof (e as { name?: unknown })?.name === "string") {
          if ((e as { name: string }).name === "AbortError") return;
        }
        console.error("Preview paragraphs failed", e);
        const msg =
          typeof (e as { message?: unknown })?.message === "string"
            ? (e as { message: string }).message
            : String(e);
        toast.error(msg || "Preview paragraphs failed.");
      } finally {
        setIsPageTranslating(false);
        pageTranslateAbortRef.current = null;
      }
    },
    [
      cancelPageTranslate,
      setPageTranslateParagraphCandidates,
      setProcessingStatus,
      state.pages,
      state.pageTranslateOptions.paragraphSplitByFontSize,
      t,
      withProcessing,
    ],
  );

  const handleUnmergeSelectedParagraphs = useCallback(async () => {
    if (state.pages.length === 0) return;
    if (pageTranslateAbortRef.current) return;
    const selectedIds = state.pageTranslateSelectedParagraphIds;
    if (selectedIds.length === 0) return;

    const controller = new AbortController();
    cancelPageTranslate();
    pageTranslateAbortRef.current = controller;

    setIsPageTranslating(true);
    setPageTranslateStatus(null);

    try {
      await withProcessing(t("common.processing"), async () => {
        const res =
          await pageTranslationService.unmergeSelectedParagraphCandidatesFromTextLayer(
            {
              pages: state.pages,
              candidates: state.pageTranslateParagraphCandidates,
              selectedIds,
              signal: controller.signal,
              onProgress: ({ pageNumber, totalPages }) => {
                const status = `${t("common.processing")} (${pageNumber}/${totalPages})`;
                setPageTranslateStatus(status);
                setProcessingStatus(status);
              },
            },
          );

        if (controller.signal.aborted) return;

        setPageTranslateParagraphCandidates(res.candidates);
        setSelectedPageTranslateParagraphIds(res.selectedIds);
      });
    } catch (e: unknown) {
      if (typeof (e as { name?: unknown })?.name === "string") {
        if ((e as { name: string }).name === "AbortError") return;
      }
      console.error("Unmerge selected paragraphs failed", e);
      const msg =
        typeof (e as { message?: unknown })?.message === "string"
          ? (e as { message: string }).message
          : String(e);
      toast.error(msg || "Unmerge selected paragraphs failed.");
    } finally {
      setIsPageTranslating(false);
      pageTranslateAbortRef.current = null;
      setPageTranslateStatus(null);
    }
  }, [
    cancelPageTranslate,
    setPageTranslateParagraphCandidates,
    setPageTranslateStatus,
    setProcessingStatus,
    setSelectedPageTranslateParagraphIds,
    state.pageTranslateParagraphCandidates,
    state.pageTranslateSelectedParagraphIds,
    state.pages,
    t,
    withProcessing,
  ]);

  return {
    isPageTranslating,
    pageTranslateStatus,
    cancelPageTranslate,
    handleStartPageTranslate,
    handlePreviewParagraphs,
    handleUnmergeSelectedParagraphs,
  };
};
