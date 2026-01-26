import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  translatePageBlocksStructured,
  type GeminiPageTranslateBlock,
  type GeminiModelId,
} from "@/services/LLMService/providers/geminiProvider";
import { pageTranslationService } from "@/services/pageTranslationService";
import { translateService } from "@/services/translateService";

import type {
  Annotation,
  EditorState,
  EditorUiState,
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
      removePageTranslateParagraphCandidatesByPageIndex,
      setProcessingStatus,
      setState,
      setUiState,
      state.pageTranslateParagraphCandidates,
      state.pageTranslateFlattenFreetext,
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
                  splitByFontSize: state.pageTranslateParagraphSplitByFontSize,
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
      setProcessingStatus,
      state.pages,
      state.pageTranslateParagraphSplitByFontSize,
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
