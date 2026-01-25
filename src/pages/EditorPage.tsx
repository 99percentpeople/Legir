import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Toolbar from "../components/toolbar/Toolbar";
import Sidebar from "../components/sidebar/Sidebar";
import FloatingBar from "../components/toolbar/FloatingBar";
import { Skeleton } from "../components/ui/skeleton";
import { useEditorStore, type EditorStore } from "../store/useEditorStore";
import { Button } from "../components/ui/button";
import { appEventBus } from "@/lib/eventBus";
import { RightPanelTabDock } from "../components/properties-panel/RightPanelTabDock";
import { PropertiesPanel } from "../components/properties-panel/PropertiesPanel";
import { AIDetectionPanel } from "../components/properties-panel/AIDetectionPanel";
import { PageTranslatePanel } from "../components/properties-panel/PageTranslatePanel";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";
import { TranslationFloatingWindow } from "../components/workspace/widgets/TranslationFloatingWindow";
import { pageTranslationService } from "@/services/pageTranslationService";
import { translateService } from "@/services/translateService";
import {
  translatePageBlocksStructured,
  type GeminiPageTranslateBlock,
  type GeminiModelId,
} from "@/services/LLMService/providers/geminiProvider";

const Workspace = React.lazy(() => import("../components/workspace/Workspace"));
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../components/ui/dialog";
import { useLanguage } from "../components/language-provider";
import { toast } from "sonner";
import type {
  Annotation,
  EditorState,
  EditorUiState,
  FormField,
  PDFMetadata,
  Tool,
  TranslateOptionId,
} from "../types";
import type { AIDetectionOptions } from "../components/AIDetectionOptionsForm";
import {
  ANNOTATION_STYLES,
  FIT_SCREEN_PADDING_X,
  FIT_SCREEN_PADDING_Y,
  FIT_WIDTH_PADDING_X,
  WORKSPACE_BASE_PAGE_GAP_PX,
} from "../constants";
import { isTauri } from "@tauri-apps/api/core";
import {
  type CloseRequestedEvent,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { recentFilesService } from "../services/recentFilesService";

export interface EditorPageProps {
  editorStore: EditorStore;

  onExport: () => Promise<boolean>;
  onSaveDraft: (silent?: boolean) => Promise<void>;
  onSaveAs: () => Promise<boolean>;
  onExit: () => void;
  onPrint: () => void;
  onAdvancedDetect: (options: AIDetectionOptions) => void;
}

const EditorPage: React.FC<EditorPageProps> = ({
  editorStore,
  onExport,
  onSaveDraft,
  onSaveAs,
  onExit,
  onPrint,
  onAdvancedDetect,
}) => {
  const state = editorStore;
  const tauri = isTauri();
  const { t, effectiveLanguage } = useLanguage();
  const {
    setState,
    setUiState,
    addField,
    addAnnotation,
    addAnnotations,
    updateField,
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
    selectPageTranslateParagraphId,
    setSelectedPageTranslateParagraphIds,
    mergeSelectedPageTranslateParagraphs,
    toggleExcludeSelectedPageTranslateParagraphs,
    deleteSelectedPageTranslateParagraphs,
    removePageTranslateParagraphCandidatesByPageIndex,
    setAllFreetextFlatten,
  } = editorStore;

  const isMobile = useIsMobile();
  const prevSelectedIdRef = useRef<string | null>(null);
  const lastFitKeyRef = useRef<string | null>(null);
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

  const parsePageRange = useCallback(
    (input: string) => {
      const totalPages = state.pages.length;
      const raw = input.trim();
      if (!raw || raw.toLowerCase() === "all") {
        return {
          ok: true as const,
          pageIndices: [...Array(totalPages)].map((_, i) => i),
        };
      }

      const parts = raw.split(",");
      const pages = new Set<number>();

      for (const part of parts) {
        const p = part.trim();
        if (!p) continue;

        if (p.includes("-")) {
          const rangeParts = p.split("-");
          if (rangeParts.length !== 2) {
            return { ok: false as const };
          }
          const start = parseInt(rangeParts[0]!, 10);
          const end = parseInt(rangeParts[1]!, 10);
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
            return { ok: false as const };
          }
          if (start < 1 || end > totalPages) {
            return { ok: false as const };
          }
          for (let i = start; i <= end; i++) pages.add(i - 1);
          continue;
        }

        const num = parseInt(p, 10);
        if (!Number.isFinite(num)) {
          return { ok: false as const };
        }
        if (num < 1 || num > totalPages) {
          return { ok: false as const };
        }
        pages.add(num - 1);
      }

      const pageIndices = Array.from(pages).sort((a, b) => a - b);
      if (pageIndices.length === 0) {
        return { ok: false as const };
      }

      return { ok: true as const, pageIndices };
    },
    [state.pages.length],
  );

  const handleStartPageTranslate = useCallback(
    async (options: {
      pageRange: string;
      targetLanguage: string;
      translateOption: TranslateOptionId;
      prompt: string;
      fontFamily: string;
      usePositionAwarePrompt: boolean;
      useParagraphs: boolean;
      contextWindow: EditorState["pageTranslateContextWindow"];
    }) => {
      if (state.pages.length === 0) return;
      if (pageTranslateAbortRef.current) return;

      const parsed = parsePageRange(options.pageRange);
      if (!parsed.ok) return;

      setState({
        translateOption: options.translateOption,
        translateTargetLanguage: options.targetLanguage,
      });
      setUiState({
        pageTranslateFontFamily: options.fontFamily,
        pageTranslateUsePositionAwarePrompt: options.usePositionAwarePrompt,
        pageTranslateUseParagraphs: options.useParagraphs,
        pageTranslateContextWindow: options.contextWindow,
      });

      cancelPageTranslate();
      const controller = new AbortController();
      pageTranslateAbortRef.current = controller;
      setIsPageTranslating(true);
      setPageTranslateStatus(null);

      try {
        const pagesSnapshot = state.pages;
        const targetPageIndices = parsed.pageIndices;

        const parseTranslateOption = (id: TranslateOptionId) => {
          const idx = id.indexOf(":");
          if (idx <= 0) return { providerId: "", modelId: "" };
          return {
            providerId: id.slice(0, idx),
            modelId: id.slice(idx + 1),
          };
        };

        const translateOpt = parseTranslateOption(options.translateOption);
        const canUseStructured =
          translateService.isOptionLLM(options.translateOption) &&
          translateOpt.providerId === "gemini";

        const getContextPageIndices = (
          pageIndex: number,
          mode: EditorState["pageTranslateContextWindow"],
          totalPages: number,
        ): number[] => {
          const clamp = (i: number) => i >= 0 && i < totalPages;
          if (mode === "none") return [];
          if (mode === "prev")
            return clamp(pageIndex - 1) ? [pageIndex - 1] : [];
          if (mode === "next")
            return clamp(pageIndex + 1) ? [pageIndex + 1] : [];
          if (mode === "prev_next") {
            const out: number[] = [];
            if (clamp(pageIndex - 1)) out.push(pageIndex - 1);
            if (clamp(pageIndex + 1)) out.push(pageIndex + 1);
            return out;
          }
          if (mode === "all_prev") {
            const out: number[] = [];
            for (let i = pageIndex - 1; i >= 0; i--) out.push(i);
            return out;
          }
          if (mode === "all_next") {
            const out: number[] = [];
            for (let i = pageIndex + 1; i < totalPages; i++) out.push(i);
            return out;
          }
          if (mode === "all") {
            const out: number[] = [];
            for (let i = 0; i < totalPages; i++) {
              if (i === pageIndex) continue;
              out.push(i);
            }
            return out;
          }
          return [];
        };

        const buildContextForPage = async (pageIndex: number) => {
          const indices = getContextPageIndices(
            pageIndex,
            options.contextWindow,
            pagesSnapshot.length,
          );

          const maxCharsTotal = 20_000;
          const maxCharsPerPage = 8_000;
          let used = 0;

          const takePrevClosestFirst =
            options.contextWindow === "all_prev" ||
            options.contextWindow === "all";
          const ordered = takePrevClosestFirst
            ? [...indices].reverse()
            : indices;

          const out: Array<{ pageIndex: number; text: string }> = [];
          for (const idx of ordered) {
            if (controller.signal.aborted) return [];
            if (used >= maxCharsTotal) break;
            const page = pagesSnapshot[idx];
            if (!page) continue;
            const lines =
              await pageTranslationService.extractLinesFromTextLayer({
                pageIndex: idx,
                page,
                signal: controller.signal,
              });
            const raw = lines
              .map((l) => l.sourceText)
              .join("\n")
              .trim();
            if (!raw) continue;
            const clipped = raw.slice(
              0,
              Math.min(maxCharsPerPage, maxCharsTotal - used),
            );
            used += clipped.length;
            out.push({ pageIndex: idx, text: clipped });
          }
          return out;
        };

        await withProcessing(t("common.processing"), async () => {
          if (options.useParagraphs) {
            const candidatesByPage = new Map<
              number,
              typeof state.pageTranslateParagraphCandidates
            >();
            for (const c of state.pageTranslateParagraphCandidates) {
              if (!targetPageIndices.includes(c.pageIndex)) continue;
              if (c.isExcluded) continue;
              if (c.sourceText.trim().length === 0) continue;
              const arr = candidatesByPage.get(c.pageIndex);
              if (arr) arr.push(c);
              else candidatesByPage.set(c.pageIndex, [c]);
            }

            const pageIndicesSorted = Array.from(candidatesByPage.keys()).sort(
              (a, b) => a - b,
            );

            let processed = 0;
            const total = pageIndicesSorted.reduce(
              (sum, pageIndex) =>
                sum + (candidatesByPage.get(pageIndex)?.length ?? 0),
              0,
            );

            for (const pageIndex of pageIndicesSorted) {
              if (controller.signal.aborted) return;
              const page = pagesSnapshot[pageIndex];
              if (!page) continue;

              const candidates = (candidatesByPage.get(pageIndex) ?? [])
                .slice()
                .sort((a, b) => {
                  const dy = a.rect.y - b.rect.y;
                  if (Math.abs(dy) > 0.001) return dy;
                  return a.rect.x - b.rect.x;
                });

              const translatedLines: Array<{
                pageIndex: number;
                sourceText: string;
                rect: { x: number; y: number; width: number; height: number };
                fontSize: number;
                fontFamily: string;
                translatedText: string;
              }> = [];

              if (canUseStructured) {
                processed += candidates.length;
                const status = `${t("common.processing")} ${Math.min(processed, total)}/${total}`;
                setPageTranslateStatus(status);
                setProcessingStatus(status);

                const blocks: GeminiPageTranslateBlock[] = candidates.map(
                  (c, i) => ({
                    id: c.id,
                    order: i,
                    text: c.sourceText,
                    rect: c.rect,
                    fontSize: c.fontSize || 12,
                    fontFamily: c.fontFamily || "sans-serif",
                  }),
                );

                const context = await buildContextForPage(pageIndex);

                const res = await translatePageBlocksStructured({
                  blocks,
                  context,
                  targetLanguage: options.targetLanguage,
                  sourceLanguage: undefined,
                  model: translateOpt.modelId as GeminiModelId,
                  prompt: options.prompt,
                  usePositionAwarePrompt: options.usePositionAwarePrompt,
                  signal: controller.signal,
                });

                const byId = new Map(
                  res.translations.map((tr) => [tr.id, tr] as const),
                );
                for (const c of candidates) {
                  const tr = byId.get(c.id);
                  if (!tr || tr.action !== "translate") continue;
                  const tt = (tr.translatedText || "").trim();
                  if (!tt) continue;
                  translatedLines.push({
                    pageIndex,
                    sourceText: c.sourceText,
                    rect: c.rect,
                    fontSize: c.fontSize,
                    fontFamily: c.fontFamily,
                    translatedText: tt,
                  });
                }
              } else {
                for (const c of candidates) {
                  processed += 1;
                  const status = `${t("common.processing")} ${processed}/${total}`;
                  setPageTranslateStatus(status);
                  setProcessingStatus(status);

                  try {
                    const perParagraphPrompt = (() => {
                      const base = (options.prompt || "").trim();
                      const allowLineBreaks = c.sourceText.includes("\n");
                      if (!options.usePositionAwarePrompt) {
                        if (!allowLineBreaks) return base || undefined;
                        const preserve =
                          "Preserve existing line breaks. Do NOT add extra line breaks.";
                        if (!base) return preserve;
                        return `${base}\n\n${preserve}`;
                      }
                      const extra =
                        pageTranslationService.buildPositionAwarePrompt({
                          page,
                          rect: c.rect,
                          fontSize: c.fontSize || 12,
                          allowLineBreaks,
                        });
                      if (!base) return extra;
                      return `${base}\n\n${extra}`;
                    })();

                    let translatedText = "";
                    for await (const chunk of translateService.translateStream(
                      c.sourceText,
                      {
                        targetLanguage: options.targetLanguage,
                        translateOption: options.translateOption,
                        prompt: perParagraphPrompt,
                        signal: controller.signal,
                      },
                    )) {
                      translatedText += chunk;
                    }
                    translatedText = translatedText.trim();
                    if (!translatedText) continue;

                    translatedLines.push({
                      pageIndex,
                      sourceText: c.sourceText,
                      rect: c.rect,
                      fontSize: c.fontSize,
                      fontFamily: c.fontFamily,
                      translatedText,
                    });
                  } catch (e: unknown) {
                    if (typeof (e as { name?: unknown })?.name === "string") {
                      if ((e as { name: string }).name === "AbortError") return;
                    }
                    console.error("Paragraph translation failed", e);
                    const msg =
                      typeof (e as { message?: unknown })?.message === "string"
                        ? (e as { message: string }).message
                        : String(e);
                    toast.error(msg || "Paragraph translation failed.");
                  }
                }
              }

              if (translatedLines.length > 0) {
                const annots =
                  pageTranslationService.buildFreetextAnnotationsFromTranslation(
                    {
                      results: [
                        {
                          pageIndex,
                          lines: translatedLines.map((l) => ({
                            pageIndex,
                            sourceText: l.sourceText,
                            rect: l.rect,
                            fontSize: l.fontSize,
                            fontFamily: l.fontFamily,
                            translatedText: l.translatedText,
                          })),
                        },
                      ],
                      pages: pagesSnapshot,
                      translate: {
                        targetLanguage: options.targetLanguage,
                        translateOption: options.translateOption,
                        prompt: options.prompt,
                      },
                      source: "text_layer",
                      granularity: "paragraph",
                      fontFamily: options.fontFamily,
                      flattenFreetext: state.pageTranslateFlattenFreetext,
                    },
                  );

                if (annots.length > 0) {
                  addAnnotations(annots, { select: false });
                }
              }

              removePageTranslateParagraphCandidatesByPageIndex(pageIndex);
            }

            return;
          }

          for (let p = 0; p < targetPageIndices.length; p++) {
            const pageIndex = targetPageIndices[p]!;
            if (controller.signal.aborted) return;

            if (canUseStructured) {
              const page = pagesSnapshot[pageIndex];
              if (!page) continue;
              const lines =
                await pageTranslationService.extractLinesFromTextLayer({
                  pageIndex,
                  page,
                  signal: controller.signal,
                });

              const usable = lines.filter(
                (l) => l.sourceText.trim().length > 0,
              );
              if (usable.length === 0) continue;

              const status = `${t("common.processing")} (${p + 1}/${targetPageIndices.length})`;
              setPageTranslateStatus(status);
              setProcessingStatus(status);

              const blocks: GeminiPageTranslateBlock[] = usable.map((l, i) => ({
                id: `page_translate_line_${pageIndex}_${i}`,
                order: i,
                text: l.sourceText,
                rect: l.rect,
                fontSize: l.fontSize || 12,
                fontFamily: l.fontFamily || "sans-serif",
              }));

              const context = await buildContextForPage(pageIndex);
              const res = await translatePageBlocksStructured({
                blocks,
                context,
                targetLanguage: options.targetLanguage,
                sourceLanguage: undefined,
                model: translateOpt.modelId as GeminiModelId,
                prompt: options.prompt,
                usePositionAwarePrompt: options.usePositionAwarePrompt,
                signal: controller.signal,
              });

              if (controller.signal.aborted) return;

              const byId = new Map(
                res.translations.map((tr) => [tr.id, tr] as const),
              );
              const translated = usable
                .map((l, i) => {
                  const tr = byId.get(`page_translate_line_${pageIndex}_${i}`);
                  if (!tr || tr.action !== "translate") return null;
                  const tt = (tr.translatedText || "").trim();
                  if (!tt) return null;
                  return {
                    ...l,
                    translatedText: tt,
                  };
                })
                .filter(Boolean) as Array<
                (typeof usable)[number] & { translatedText: string }
              >;

              if (translated.length > 0) {
                const annots =
                  pageTranslationService.buildFreetextAnnotationsFromTranslation(
                    {
                      results: [{ pageIndex, lines: translated }],
                      pages: pagesSnapshot,
                      translate: {
                        targetLanguage: options.targetLanguage,
                        translateOption: options.translateOption,
                        prompt: options.prompt,
                      },
                      source: "text_layer",
                      granularity: "line",
                      fontFamily: options.fontFamily,
                      flattenFreetext: state.pageTranslateFlattenFreetext,
                    },
                  );

                if (annots.length > 0) {
                  addAnnotations(annots, { select: false });
                }
              }

              continue;
            }

            try {
              const annots =
                await pageTranslationService.translatePagesToFreetextAnnotationsFromTextLayer(
                  {
                    pages: pagesSnapshot,
                    pageIndices: [pageIndex],
                    translate: {
                      targetLanguage: options.targetLanguage,
                      translateOption: options.translateOption,
                      prompt: options.prompt,
                    },
                    fontFamily: options.fontFamily,
                    usePositionAwarePrompt: options.usePositionAwarePrompt,
                    flattenFreetext: state.pageTranslateFlattenFreetext,
                    signal: controller.signal,
                    onProgress: ({ lineIndex, totalLines }) => {
                      const status = `${t("common.processing")} (${p + 1}/${targetPageIndices.length}) ${lineIndex}/${totalLines}`;
                      setPageTranslateStatus(status);
                      setProcessingStatus(status);
                    },
                  },
                );

              if (controller.signal.aborted) return;

              if (annots.length > 0) {
                // Commit translated annotations page-by-page so earlier results persist
                // even if later AI calls fail.
                addAnnotations(annots, { select: false });
              }
            } catch (e: unknown) {
              if (typeof (e as { name?: unknown })?.name === "string") {
                if ((e as { name: string }).name === "AbortError") return;
              }
              console.error("Page translation failed", e);
              const msg =
                typeof (e as { message?: unknown })?.message === "string"
                  ? (e as { message: string }).message
                  : String(e);
              toast.error(
                msg ||
                  `Page translate failed (${p + 1}/${targetPageIndices.length}).`,
              );
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
      parsePageRange,
      setProcessingStatus,
      setState,
      setUiState,
      state.pages,
      state.pageTranslateParagraphCandidates,
      state.pageTranslateFlattenFreetext,
      withProcessing,
      t,
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
        const all: EditorState["pageTranslateParagraphCandidates"] = [];

        await withProcessing(t("common.processing"), async () => {
          for (let i = 0; i < options.pageIndices.length; i++) {
            const pageIndex = options.pageIndices[i]!;
            const page = pagesSnapshot[pageIndex];
            if (!page) continue;
            if (controller.signal.aborted) return;

            const status = `${t("common.processing")} (${i + 1}/${options.pageIndices.length})`;
            setPageTranslateStatus(status);
            setProcessingStatus(status);

            const candidates =
              await pageTranslationService.extractParagraphCandidatesFromTextLayer(
                {
                  pageIndex,
                  page,
                  xGap: options.xGap,
                  yGap: options.yGap,
                  signal: controller.signal,
                },
              );

            all.push(...candidates);
          }
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
      setPageTranslateStatus,
      setProcessingStatus,
      state.pages,
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

    const selectedSet = new Set(selectedIds);
    const selected = state.pageTranslateParagraphCandidates.filter((c) =>
      selectedSet.has(c.id),
    );
    if (selected.length === 0) return;

    const rectOverlaps = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) => {
      return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      );
    };

    try {
      await withProcessing(t("common.processing"), async () => {
        const pagesSnapshot = state.pages;
        const candidatesSnapshot = state.pageTranslateParagraphCandidates;

        const remaining = candidatesSnapshot.filter(
          (c) => !selectedSet.has(c.id),
        );
        const created: EditorState["pageTranslateParagraphCandidates"] = [];
        const createdIds: string[] = [];

        const selectedByPage = new Map<number, typeof selected>();
        for (const c of selected) {
          const arr = selectedByPage.get(c.pageIndex);
          if (arr) arr.push(c);
          else selectedByPage.set(c.pageIndex, [c]);
        }

        const dedupe = new Set<string>();
        const pagesToProcess = Array.from(selectedByPage.keys()).sort(
          (a, b) => a - b,
        );

        for (let i = 0; i < pagesToProcess.length; i++) {
          const pageIndex = pagesToProcess[i]!;
          const group = selectedByPage.get(pageIndex) ?? [];
          const page = pagesSnapshot[pageIndex];
          if (!page) continue;
          if (controller.signal.aborted) return;

          const status = `${t("common.processing")} (${i + 1}/${pagesToProcess.length})`;
          setPageTranslateStatus(status);
          setProcessingStatus(status);

          const lines = await pageTranslationService.extractLinesFromTextLayer({
            pageIndex,
            page,
            signal: controller.signal,
          });

          for (const parent of group) {
            const matched = lines.filter((l) =>
              rectOverlaps(l.rect, parent.rect),
            );
            if (matched.length === 0) {
              created.push(parent);
              createdIds.push(parent.id);
              continue;
            }

            for (const l of matched) {
              const key = `${pageIndex}|${l.rect.x.toFixed(2)}|${l.rect.y.toFixed(2)}|${l.rect.width.toFixed(2)}|${l.rect.height.toFixed(2)}|${l.sourceText}`;
              if (dedupe.has(key)) continue;
              dedupe.add(key);

              const id = `page_translate_line_${pageIndex}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
              created.push({
                id,
                pageIndex,
                rect: l.rect,
                sourceText: l.sourceText,
                fontSize: l.fontSize || parent.fontSize || 12,
                fontFamily: l.fontFamily || parent.fontFamily || "sans-serif",
                isExcluded: parent.isExcluded,
              });
              createdIds.push(id);
            }
          }
        }

        if (controller.signal.aborted) return;

        const next = [...remaining, ...created].sort((a, b) => {
          if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
          const dy = a.rect.y - b.rect.y;
          if (Math.abs(dy) > 0.001) return dy;
          return a.rect.x - b.rect.x;
        });

        setPageTranslateParagraphCandidates(next);
        setSelectedPageTranslateParagraphIds(createdIds);
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
    setSelectedPageTranslateParagraphIds,
    setPageTranslateStatus,
    setProcessingStatus,
    state.pageTranslateParagraphCandidates,
    state.pageTranslateSelectedParagraphIds,
    state.pages,
    t,
    withProcessing,
  ]);

  const handleInitialScrollApplied = useCallback(() => {
    setState({ pendingViewStateRestore: null });
  }, [setState]);

  const toggleFullscreen = useCallback(() => {
    const next = !state.isFullscreen;
    setState({ isFullscreen: next });

    if (tauri) {
      void (async () => {
        try {
          const win = getCurrentWindow();
          await win.setFullscreen(next);
        } catch (error) {
          console.error("Failed to toggle fullscreen", error);
          setState({ isFullscreen: !next });
        }
      })();
      return;
    }

    void (async () => {
      try {
        if (next) {
          await document.documentElement.requestFullscreen();
        } else {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          }
        }
      } catch (error) {
        console.error("Failed to toggle fullscreen", error);
        setState({ isFullscreen: !next });
      }
    })();
  }, [setState, state.isFullscreen, tauri]);

  useEventListener(
    tauri ? undefined : window,
    "keydown",
    (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
      }
    },
  );

  useEventListener(tauri ? undefined : document, "fullscreenchange", () => {
    console.log("fullscreenchange");
    setState({ isFullscreen: !!document.fullscreenElement });
  });

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;

      if (tauri) return;

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
          recentFilesService.saveWebDraftViewState({
            scale: snapshot.scale,
            scrollLeft: last.left,
            scrollTop: last.top,
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
    const appName = process.env.APP_NAME;

    if (!tauri && typeof document !== "undefined") {
      if (initialTitleRef.current === null) {
        initialTitleRef.current = document.title;
      }
    }

    const hasOpenDocument = state.pages.length > 0;
    const nextTitle = hasOpenDocument
      ? `${state.filename || appName} - ${appName}`
      : appName;

    if (tauri) {
      let cancelled = false;
      void (async () => {
        try {
          if (cancelled) return;
          const win = getCurrentWindow();
          await win.setTitle(nextTitle);
        } catch {
          // ignore
        }
      })();

      return () => {
        cancelled = true;
        void (async () => {
          try {
            const win = getCurrentWindow();
            await win.setTitle(appName);
          } catch {
            // ignore
          }
        })();
      };
    }

    if (typeof document !== "undefined") {
      document.title = nextTitle;
    }

    return () => {
      if (typeof document !== "undefined") {
        document.title = initialTitleRef.current ?? appName;
      }
    };
  }, [tauri, state.filename, state.pages.length, t]);

  useEffect(() => {
    if (tauri) {
      if (state.pages.length === 0) return;

      let unlisten: null | (() => void) = null;
      let cancelled = false;
      (async () => {
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested((event: CloseRequestedEvent) => {
          if (skipNextWindowCloseRef.current) {
            skipNextWindowCloseRef.current = false;
            return;
          }

          recentFilesService.cancelPreviewTasks();

          const { isDirty, pages, setState } = useEditorStore.getState();
          if (!pages || pages.length === 0) return;

          const snapshot = useEditorStore.getState();
          const tauriPath =
            snapshot.saveTarget?.kind === "tauri"
              ? snapshot.saveTarget.path
              : null;
          if (tauriPath) {
            const el = workspaceScrollContainerRef.current;
            if (el) {
              recentFilesService.saveTauriViewState({
                path: tauriPath,
                scale: snapshot.scale,
                pageIndex: snapshot.currentPageIndex,
                scrollLeft: el.scrollLeft,
                scrollTop: el.scrollTop,
              });
            }
          }

          if (!isDirty) return;
          try {
            event.preventDefault();
          } catch {
            // ignore
          }
          setState({
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
    }
  }, [tauri, state.isDirty, state.pages.length]);

  const closeConfirmOpen = state.activeDialog === "close_confirm";
  const closeSource = state.closeConfirmSource || "menu";

  const closeDialog = () => {
    setState({ activeDialog: null, closeConfirmSource: null });
  };

  const closeWindow = async () => {
    recentFilesService.cancelPreviewTasks();
    const snapshot = useEditorStore.getState();
    const tauriPath =
      snapshot.saveTarget?.kind === "tauri" ? snapshot.saveTarget.path : null;
    if (tauriPath) {
      const el = workspaceScrollContainerRef.current;
      if (el) {
        recentFilesService.saveTauriViewState({
          path: tauriPath,
          scale: snapshot.scale,
          pageIndex: snapshot.currentPageIndex,
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
        });
      }
    }

    skipNextWindowCloseRef.current = true;
    await getCurrentWindow().close();
  };

  const persistWebViewState = useCallback(() => {
    const snapshot = useEditorStore.getState();
    if (!snapshot.pages || snapshot.pages.length === 0) return;
    const el = workspaceScrollContainerRef.current;
    if (!el) return;

    const last = webViewStateRef.current.lastScroll;
    recentFilesService.saveWebDraftViewState({
      scale: snapshot.scale,
      scrollLeft: last?.left ?? el.scrollLeft,
      scrollTop: last?.top ?? el.scrollTop,
    });
  }, []);

  useEventListener<BeforeUnloadEvent>(
    !tauri && typeof window !== "undefined" ? window : null,
    "beforeunload",
    (e) => {
      persistWebViewState();
      if (state.pages.length > 0 && state.isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    },
  );

  useEventListener(
    !tauri && typeof window !== "undefined" ? window : null,
    "pagehide",
    () => {
      persistWebViewState();
      const snapshot = useEditorStore.getState();
      if (snapshot.isDirty) {
        void onSaveDraft(true);
      }
    },
  );

  useEventListener(
    !tauri && typeof document !== "undefined" ? document : null,
    "visibilitychange",
    () => {
      if (document.visibilityState !== "hidden") return;
      persistWebViewState();
      const snapshot = useEditorStore.getState();
      if (snapshot.isDirty) {
        void onSaveDraft(true);
      }
    },
  );

  useEffect(() => {
    if (tauri) return;
    if (state.pages.length > 0 && state.pdfBytes) {
      const timer = setTimeout(() => {
        if (!state.isDirty) return;
        void onSaveDraft(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [
    tauri,
    state.isDirty,
    state.fields,
    state.annotations,
    state.metadata,
    state.filename,
    state.pages.length,
    state.pdfBytes,
    onSaveDraft,
  ]);

  const getWorkspaceViewport = useCallback(() => {
    const el = workspaceScrollContainerRef.current;
    if (el) return { width: el.clientWidth, height: el.clientHeight };
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 0, height: 0 };
  }, []);

  const calculateFitWidthScale = useCallback(
    (pageIndex: number = 0) => {
      if (!state.pages || state.pages.length === 0) return 1.0;
      const targetIndex = Math.max(
        0,
        Math.min(pageIndex, state.pages.length - 1),
      );
      const page = state.pages[targetIndex];
      if (!page.width) return 1.0;

      const { width } = getWorkspaceViewport();
      const availableWidth = width - FIT_WIDTH_PADDING_X;
      if (state.pageLayout !== "single") {
        if (state.pageFlow === "horizontal") {
          const scale = availableWidth / page.width;
          return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
        }
        const denom = page.width * 2 + WORKSPACE_BASE_PAGE_GAP_PX;
        const scale = denom > 0 ? availableWidth / denom : 1.0;
        return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
      }

      const scale = availableWidth / page.width;
      return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
    },
    [state.pages, state.pageLayout, getWorkspaceViewport],
  );

  const calculateFitScreenScale = useCallback(
    (pageIndex: number = 0) => {
      if (!state.pages || state.pages.length === 0) return 1.0;
      const targetIndex = Math.max(
        0,
        Math.min(pageIndex, state.pages.length - 1),
      );
      const page = state.pages[targetIndex];
      if (!page.width || !page.height) return 1.0;

      const { width, height } = getWorkspaceViewport();
      const availableWidth = width - FIT_SCREEN_PADDING_X;
      const availableHeight = height - FIT_SCREEN_PADDING_Y;

      const widthScale =
        state.pageLayout !== "single"
          ? (() => {
              if (state.pageFlow === "horizontal") {
                return availableWidth / page.width;
              }
              const denom = page.width * 2 + WORKSPACE_BASE_PAGE_GAP_PX;
              return denom > 0 ? availableWidth / denom : 1.0;
            })()
          : availableWidth / page.width;
      const heightScale =
        state.pageLayout !== "single" && state.pageFlow === "horizontal"
          ? availableHeight / (page.height * 2 + WORKSPACE_BASE_PAGE_GAP_PX)
          : availableHeight / page.height;
      const scale = Math.min(widthScale, heightScale);
      return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
    },
    [state.pages, state.pageLayout, getWorkspaceViewport],
  );

  const updateScale = useCallback(
    (newScale: number) => {
      const clamped = Math.max(0.25, Math.min(5.0, newScale));
      setState({ scale: clamped });
    },
    [setState],
  );

  useEffect(() => {
    if (!state.pages || state.pages.length === 0) return;
    const bytesLen =
      typeof state.pdfBytes?.byteLength === "number"
        ? state.pdfBytes.byteLength
        : state.pdfBytes?.length;
    const fitKey = `${state.filename || ""}:${state.pages.length}:${bytesLen || 0}`;
    if (lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;

    if (state.pendingViewStateRestore) {
      const restore = state.pendingViewStateRestore;
      updateScale(restore.scale);
      return;
    }

    updateScale(calculateFitScreenScale(state.currentPageIndex));
    setState({ fitTrigger: Date.now() });
  }, [
    state.pages,
    state.pdfBytes,
    state.filename,
    state.currentPageIndex,
    state.pendingViewStateRestore,
    calculateFitScreenScale,
    updateScale,
    setState,
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
        if (isInput) target.blur();
        if (currentState.selectedId) {
          currentState.selectControl(null);
        } else if (currentState.tool !== "select") {
          currentState.setTool("select");
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (tauri) {
          if (!currentState.isDirty) return;
          void onExport();
          return;
        }
        onSaveDraft(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onPrint();
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

      if (
        currentState.mode === "form" &&
        currentState.selectedId &&
        currentState.fields.some((f) => f.id === currentState.selectedId) &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const isFast = e.shiftKey;
        let direction: "UP" | "DOWN" | "LEFT" | "RIGHT" = "UP";
        if (e.key === "ArrowUp") direction = "UP";
        else if (e.key === "ArrowDown") direction = "DOWN";
        else if (e.key === "ArrowLeft") direction = "LEFT";
        else if (e.key === "ArrowRight") direction = "RIGHT";
        currentState.moveField(direction, isFast);
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
      setState((prev) => ({ ...prev, filename: name, isDirty: true }));
    },
    [setState],
  );

  const canRenderRightPanel =
    state.mode === "form" || state.mode === "annotation" || selectedControl;

  return (
    <>
      <Toolbar
        editorState={state}
        isSaving={state.isSaving}
        isDirty={state.isDirty}
        onToolChange={(tool: Tool) => setTool(tool)}
        onModeChange={(mode) => setState({ mode, tool: "select" })}
        onPenStyleChange={handlePenStyleChange}
        onHighlightStyleChange={handleHighlightStyleChange}
        onCommentStyleChange={handleCommentStyleChange}
        onFreetextStyleChange={handleFreetextStyleChange}
        onExport={onExport}
        onSaveDraft={onSaveDraft}
        onSaveAs={onSaveAs}
        onExit={onExit}
        onClose={() => {
          if (!state.isDirty) {
            onExit();
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
                if (tauri) {
                  if (state.isDirty) {
                    const ok = await onExport();
                    if (!ok) return;
                  }
                  closeDialog();
                  if (closeSource === "window") {
                    await closeWindow();
                    return;
                  }
                  onExit();
                  return;
                }

                if (state.isDirty) {
                  await onSaveDraft(false);
                }
                closeDialog();
                onExit();
              }}
            >
              {tauri
                ? t("dialog.confirm_close.save_close")
                : t("dialog.confirm_close.save_draft_close")}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                closeDialog();
                if (tauri && closeSource === "window") {
                  await closeWindow();
                  return;
                }
                onExit();
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
          activeTab={state.sidebarTab}
          onTabChange={(tab) => setUiState({ sidebarTab: tab })}
        />

        <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center p-4">
                <div className="flex gap-6">
                  <Skeleton className="h-[70vh] w-[48vh]" />
                </div>
              </div>
            }
          >
            <Workspace
              editorState={state}
              onAddField={addField}
              onAddAnnotation={addAnnotation}
              onSelectControl={selectControl}
              onUpdateField={updateField}
              onUpdateAnnotation={updateAnnotation}
              onDeleteAnnotation={deleteAnnotation}
              onEditAnnotation={handleEditAnnotation}
              onScaleChange={updateScale}
              onTriggerHistorySave={saveCheckpoint}
              onPageIndexChange={(idx) => setState({ currentPageIndex: idx })}
              onToolChange={(tool) => setTool(tool)}
              onSelectPageTranslateParagraphId={selectPageTranslateParagraphId}
              onClearPageTranslateParagraphSelection={() =>
                setSelectedPageTranslateParagraphIds([])
              }
              fitTrigger={state.fitTrigger}
              initialScrollPosition={
                state.pendingViewStateRestore
                  ? {
                      left: state.pendingViewStateRestore.scrollLeft,
                      top: state.pendingViewStateRestore.scrollTop,
                    }
                  : null
              }
              onInitialScrollApplied={handleInitialScrollApplied}
            />
          </Suspense>
          <FloatingBar
            scale={state.scale}
            pageLayout={state.pageLayout}
            pageFlow={state.pageFlow}
            isFullscreen={state.isFullscreen}
            onPageLayoutChange={(layout) => {
              setState({ pageLayout: layout, fitTrigger: Date.now() });
            }}
            onPageFlowChange={(flow) => {
              setState({ pageFlow: flow, fitTrigger: Date.now() });
            }}
            onToggleFullscreen={toggleFullscreen}
            onZoomIn={() => updateScale(state.scale * 1.25)}
            onZoomOut={() => updateScale(state.scale / 1.25)}
            onFitWidth={() => {
              updateScale(calculateFitWidthScale(state.currentPageIndex));
              setState({ fitTrigger: Date.now() });
            }}
            onFitScreen={() => {
              updateScale(calculateFitScreenScale(state.currentPageIndex));
              setState({ fitTrigger: Date.now() });
            }}
          />
        </div>

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
          (state.rightPanelTab === "ai_detect" ? (
            <AIDetectionPanel
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
              fontFamily={state.pageTranslateFontFamily}
              onFontFamilyChange={(val) =>
                setUiState({ pageTranslateFontFamily: val })
              }
              usePositionAwarePrompt={state.pageTranslateUsePositionAwarePrompt}
              onUsePositionAwarePromptChange={(val) =>
                setUiState({ pageTranslateUsePositionAwarePrompt: val })
              }
              contextWindow={state.pageTranslateContextWindow}
              onContextWindowChange={(val) =>
                setUiState({ pageTranslateContextWindow: val })
              }
              flattenAllFreetext={state.pageTranslateFlattenFreetext}
              onFlattenAllFreetextChange={(val) => {
                setUiState({ pageTranslateFlattenFreetext: val });
                setAllFreetextFlatten(val);
              }}
              useParagraphs={state.pageTranslateUseParagraphs}
              onUseParagraphsChange={(val) =>
                setUiState({ pageTranslateUseParagraphs: val })
              }
              paragraphXGap={state.pageTranslateParagraphXGap}
              onParagraphXGapChange={(val) =>
                setUiState({ pageTranslateParagraphXGap: val })
              }
              paragraphYGap={state.pageTranslateParagraphYGap}
              onParagraphYGapChange={(val) =>
                setUiState({ pageTranslateParagraphYGap: val })
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
              activeTab={state.rightPanelTab}
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

export default EditorPage;
