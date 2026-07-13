import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { canPerformPdfPermissionOperation } from "@/lib/pdfPermissions";
import { pageTranslationService } from "@/services/pageTranslationService";
import { useEditorStore } from "@/store/useEditorStore";
import { useShallow } from "zustand/react/shallow";
import { useLanguage } from "@/components/language-provider";
import { useEditorDocumentRuntime } from "@/app/editorRuntime";

import type { PageTranslateContextWindow, TranslateOptionId } from "../types";

export const usePageTranslation = () => {
  const { workerService, sessionRenderKey } = useEditorDocumentRuntime();
  const { t } = useLanguage();
  const state = useEditorStore(
    useShallow((store) => ({
      pages: store.pages,
      documentPermissions: store.documentPermissions,
      pageTranslateOptions: store.pageTranslateOptions,
      pageTranslateParagraphCandidates: store.pageTranslateParagraphCandidates,
      pageTranslateSelectedParagraphIds:
        store.pageTranslateSelectedParagraphIds,
      addAnnotations: store.addAnnotations,
      setState: store.setState,
      setUiState: store.setUiState,
      setProcessingStatus: store.setProcessingStatus,
      withProcessing: store.withProcessing,
      setPageTranslateParagraphCandidates:
        store.setPageTranslateParagraphCandidates,
      setSelectedPageTranslateParagraphIds:
        store.setSelectedPageTranslateParagraphIds,
      removePageTranslateParagraphCandidatesByPageIndex:
        store.removePageTranslateParagraphCandidatesByPageIndex,
    })),
  );
  const {
    addAnnotations,
    setState,
    setUiState,
    setProcessingStatus,
    withProcessing,
    setPageTranslateParagraphCandidates,
    setSelectedPageTranslateParagraphIds,
    removePageTranslateParagraphCandidatesByPageIndex,
  } = state;

  const [isPageTranslating, setIsPageTranslating] = useState(false);
  const [pageTranslateStatus, setPageTranslateStatus] = useState<string | null>(
    null,
  );
  const pageTranslateAbortRef = useRef<AbortController | null>(null);

  const cancelPageTranslate = useCallback(() => {
    pageTranslateAbortRef.current?.abort();
    pageTranslateAbortRef.current = null;
    setIsPageTranslating(false);
    setPageTranslateStatus(null);
  }, []);

  useEffect(() => {
    return () => {
      pageTranslateAbortRef.current?.abort();
      pageTranslateAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    cancelPageTranslate();
    setIsPageTranslating(false);
    setPageTranslateStatus(null);
  }, [cancelPageTranslate, sessionRenderKey]);

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
      if (
        !canPerformPdfPermissionOperation(
          "extract_text",
          state.documentPermissions,
        ) ||
        !canPerformPdfPermissionOperation(
          "create_annotation",
          state.documentPermissions,
        )
      ) {
        toast.error(t("toolbar.permission_restricted"));
        return;
      }

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
                workerService: workerService ?? undefined,
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
              workerService: workerService ?? undefined,
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
        if (pageTranslateAbortRef.current === controller) {
          setIsPageTranslating(false);
          pageTranslateAbortRef.current = null;
        }
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
      state.documentPermissions,
      t,
      workerService,
      withProcessing,
    ],
  );

  const handlePreviewParagraphs = useCallback(
    async (options: { pageIndices: number[]; xGap: number; yGap: number }) => {
      if (state.pages.length === 0) return;
      if (pageTranslateAbortRef.current) return;
      if (
        !canPerformPdfPermissionOperation(
          "extract_text",
          state.documentPermissions,
        )
      ) {
        toast.error(t("toolbar.permission_restricted"));
        return;
      }
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
              workerService: workerService ?? undefined,
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
        if (pageTranslateAbortRef.current === controller) {
          setIsPageTranslating(false);
          pageTranslateAbortRef.current = null;
        }
      }
    },
    [
      cancelPageTranslate,
      setPageTranslateParagraphCandidates,
      setProcessingStatus,
      state.documentPermissions,
      state.pages,
      state.pageTranslateOptions.paragraphSplitByFontSize,
      t,
      workerService,
      withProcessing,
    ],
  );

  const handleUnmergeSelectedParagraphs = useCallback(async () => {
    if (state.pages.length === 0) return;
    if (pageTranslateAbortRef.current) return;
    if (
      !canPerformPdfPermissionOperation(
        "extract_text",
        state.documentPermissions,
      )
    ) {
      toast.error(t("toolbar.permission_restricted"));
      return;
    }
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
              workerService: workerService ?? undefined,
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
      if (pageTranslateAbortRef.current === controller) {
        setIsPageTranslating(false);
        pageTranslateAbortRef.current = null;
        setPageTranslateStatus(null);
      }
    }
  }, [
    cancelPageTranslate,
    setPageTranslateParagraphCandidates,
    setPageTranslateStatus,
    setProcessingStatus,
    setSelectedPageTranslateParagraphIds,
    state.documentPermissions,
    state.pageTranslateParagraphCandidates,
    state.pageTranslateSelectedParagraphIds,
    state.pages,
    t,
    workerService,
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
