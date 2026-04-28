import React, { useEffect, useMemo, useState } from "react";
import { Languages } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FONT_FAMILY_MAP } from "@/constants";
import { resolveFontStackForDisplay } from "@/lib/fonts";
import { getSystemFontFamilies } from "@/lib/system-fonts";
import { AI_PROVIDER_IDS_SORTED_BY_LABEL } from "@/services/ai/providers/catalog";
import { PanelLayout } from "./PanelLayout";
import {
  translateService,
  type TranslateOptionGroup,
} from "@/services/translateService";
import type { PageTranslateContextWindow, TranslateOptionId } from "@/types";
import { ModelSelect, type ModelSelectGroup } from "@/components/ModelSelect";

export type PageTranslateOptions = {
  pageRange: string;
  targetLanguage: string;
  translateOption: TranslateOptionId;
  prompt: string;
  fontFamily: string;
  usePositionAwarePrompt: boolean;
  aiReflowParagraphs: boolean;
  useParagraphs: boolean;
  contextWindow: PageTranslateContextWindow;
};

export interface PageTranslatePanelProps {
  isFloating: boolean;
  isOpen: boolean;
  onOpen: () => void;
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;

  totalPages: number;
  isProcessing: boolean;
  processingStatus?: string | null;

  initialTranslateOption: TranslateOptionId;
  initialTargetLanguage: string;
  fontFamily: string;
  onFontFamilyChange: (fontFamily: string) => void;
  freetextPadding: number;
  onFreetextPaddingChange: (value: number) => void;
  usePositionAwarePrompt: boolean;
  onUsePositionAwarePromptChange: (value: boolean) => void;

  aiReflowParagraphs: boolean;
  onAiReflowParagraphsChange: (value: boolean) => void;

  contextWindow: PageTranslateContextWindow;
  onContextWindowChange: (value: PageTranslateContextWindow) => void;

  flattenAllFreetext: boolean;
  onFlattenAllFreetextChange: (value: boolean) => void;

  useParagraphs: boolean;
  onUseParagraphsChange: (value: boolean) => void;
  paragraphXGap: number;
  onParagraphXGapChange: (value: number) => void;
  paragraphYGap: number;
  onParagraphYGapChange: (value: number) => void;
  paragraphSplitByFontSize: boolean;
  onParagraphSplitByFontSizeChange: (value: boolean) => void;
  paragraphCandidatesCount: number;
  selectedParagraphCount: number;
  onPreviewParagraphs: (options: {
    pageIndices: number[];
    xGap: number;
    yGap: number;
  }) => void;
  onClearParagraphs: () => void;
  onMergeSelectedParagraphs: () => void;
  onUnmergeSelectedParagraphs: () => void;
  onToggleExcludeSelectedParagraphs: () => void;
  onDeleteSelectedParagraphs: () => void;

  onStart: (options: PageTranslateOptions) => void;
  onCancel: () => void;
}

const TARGET_LANG_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ja", label: "日本語" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
] as const;

const parsePageRange = (input: string, totalPages: number) => {
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
        return {
          ok: false as const,
          errorKey: "properties.form_detection.err_format",
        };
      }
      const start = parseInt(rangeParts[0]!, 10);
      const end = parseInt(rangeParts[1]!, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        return {
          ok: false as const,
          errorKey: "properties.form_detection.err_format",
        };
      }
      if (start < 1 || end > totalPages) {
        return {
          ok: false as const,
          errorKey: "properties.form_detection.err_bounds",
        };
      }
      for (let i = start; i <= end; i++) pages.add(i - 1);
      continue;
    }

    const num = parseInt(p, 10);
    if (!Number.isFinite(num)) {
      return {
        ok: false as const,
        errorKey: "properties.form_detection.err_format",
      };
    }
    if (num < 1 || num > totalPages) {
      return {
        ok: false as const,
        errorKey: "properties.form_detection.err_bounds",
      };
    }
    pages.add(num - 1);
  }

  const pageIndices = Array.from(pages).sort((a, b) => a - b);
  if (pageIndices.length === 0) {
    return {
      ok: false as const,
      errorKey: "properties.form_detection.err_format",
    };
  }

  return { ok: true as const, pageIndices };
};

export function PageTranslatePanel({
  isFloating,
  isOpen,
  onOpen,
  width,
  onResize,
  onCollapse,
  totalPages,
  isProcessing,
  processingStatus,
  initialTranslateOption,
  initialTargetLanguage,
  fontFamily,
  onFontFamilyChange,
  freetextPadding,
  onFreetextPaddingChange,
  usePositionAwarePrompt,
  onUsePositionAwarePromptChange,
  aiReflowParagraphs,
  onAiReflowParagraphsChange,
  contextWindow,
  onContextWindowChange,
  flattenAllFreetext,
  onFlattenAllFreetextChange,
  useParagraphs,
  onUseParagraphsChange,
  paragraphXGap,
  onParagraphXGapChange,
  paragraphYGap,
  onParagraphYGapChange,
  paragraphSplitByFontSize,
  onParagraphSplitByFontSizeChange,
  paragraphCandidatesCount,
  selectedParagraphCount,
  onPreviewParagraphs,
  onClearParagraphs,
  onMergeSelectedParagraphs,
  onUnmergeSelectedParagraphs,
  onToggleExcludeSelectedParagraphs,
  onDeleteSelectedParagraphs,
  onStart,
  onCancel,
}: PageTranslatePanelProps) {
  const { t, effectiveLanguage } = useLanguage();

  const [registryVersion, setRegistryVersion] = useState(0);

  useEffect(() => {
    return translateService.subscribe(() => setRegistryVersion((v) => v + 1));
  }, []);

  const optionGroups = useMemo<TranslateOptionGroup[]>(() => {
    void registryVersion;
    return translateService.getOptionGroups();
  }, [registryVersion]);

  const modelSelectGroups = useMemo<ModelSelectGroup[]>(() => {
    const weight = (groupId: string) => {
      if (groupId === "cloud") return 0;
      const providerIndex = AI_PROVIDER_IDS_SORTED_BY_LABEL.indexOf(
        groupId as (typeof AI_PROVIDER_IDS_SORTED_BY_LABEL)[number],
      );
      return providerIndex >= 0
        ? providerIndex + 1
        : AI_PROVIDER_IDS_SORTED_BY_LABEL.length + 1;
    };

    const sorted = optionGroups
      .map((g, idx) => ({ g, idx }))
      .sort((a, b) => {
        const wa = weight(a.g.id);
        const wb = weight(b.g.id);
        if (wa !== wb) return wa - wb;
        return a.idx - b.idx;
      })
      .map((x) => x.g);

    return sorted.map((group) => {
      const groupLabel = group.labelKey ? t(group.labelKey) : group.label;
      return {
        id: group.id,
        label: groupLabel,
        options: group.options.map((opt) => {
          const optLabel = opt.labelKey ? t(opt.labelKey) : opt.label;
          return {
            value: opt.id,
            label: optLabel,
            capabilities: opt.capabilities,
            disabled: !translateService.isOptionAvailable(opt.id),
          };
        }),
      };
    });
  }, [optionGroups, t]);

  const firstAvailableOption = useMemo<TranslateOptionId | undefined>(() => {
    for (const group of optionGroups) {
      for (const opt of group.options) {
        if (translateService.isOptionAvailable(opt.id)) return opt.id;
      }
    }
    return undefined;
  }, [optionGroups]);

  const [pageRange, setPageRange] = useState<string>("All");
  const [targetLanguage, setTargetLanguage] = useState<string>(
    initialTargetLanguage || effectiveLanguage,
  );
  const [translateOption, setTranslateOption] = useState<TranslateOptionId>(
    translateService.normalizeTranslateOption(initialTranslateOption),
  );
  const [prompt, setPrompt] = useState<string>("");

  const [systemFamilies, setSystemFamilies] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getSystemFontFamilies().then((families) => {
      if (cancelled) return;
      setSystemFamilies(families);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTargetLanguage(initialTargetLanguage || effectiveLanguage);
  }, [effectiveLanguage, initialTargetLanguage, isOpen]);

  useEffect(() => {
    if (
      !translateService.isOptionAvailable(translateOption) &&
      firstAvailableOption
    ) {
      setTranslateOption(
        translateService.normalizeTranslateOption(firstAvailableOption),
      );
    }
  }, [firstAvailableOption, translateOption]);

  const availabilityMessageKey = useMemo(() => {
    if (translateService.isOptionAvailable(translateOption)) return undefined;
    return translateService.getOptionUnavailableMessageKey(translateOption);
  }, [translateOption]);

  const isPositionAwareAvailable = useMemo(() => {
    return translateService.isOptionLLM(translateOption);
  }, [translateOption]);

  const isAiReflowAvailable = isPositionAwareAvailable;

  const isContextWindowAvailable = isPositionAwareAvailable;

  const parsed = useMemo(() => {
    return parsePageRange(pageRange, totalPages);
  }, [pageRange, totalPages]);

  const canStart =
    !isProcessing &&
    parsed.ok &&
    translateService.isOptionAvailable(translateOption) &&
    targetLanguage.trim().length > 0 &&
    (!useParagraphs || paragraphCandidatesCount > 0);

  const availableFontKeys = useMemo(() => {
    return [...Object.keys(FONT_FAMILY_MAP), ...systemFamilies];
  }, [systemFamilies]);

  const currentFontValue = (fontFamily || "Helvetica").trim() || "Helvetica";
  const isCustomFontValue =
    !!fontFamily && !availableFontKeys.includes(fontFamily);

  const currentUsePositionAwarePrompt =
    isPositionAwareAvailable && Boolean(usePositionAwarePrompt);

  const currentAiReflowParagraphs =
    isAiReflowAvailable && Boolean(aiReflowParagraphs);

  useEffect(() => {
    if (isPositionAwareAvailable) return;
    if (!usePositionAwarePrompt) return;
    onUsePositionAwarePromptChange(false);
  }, [
    isPositionAwareAvailable,
    onUsePositionAwarePromptChange,
    usePositionAwarePrompt,
  ]);

  useEffect(() => {
    if (isAiReflowAvailable) return;
    if (!aiReflowParagraphs) return;
    onAiReflowParagraphsChange(false);
  }, [aiReflowParagraphs, isAiReflowAvailable, onAiReflowParagraphsChange]);

  return (
    <PanelLayout
      title={
        <>
          <Languages size={16} /> {t("right_panel.tabs.page_translate")}
        </>
      }
      isFloating={isFloating}
      isOpen={isOpen}
      onOpen={onOpen}
      onCollapse={onCollapse}
      onClose={onCollapse}
      width={width}
      onResize={onResize}
      footer={
        <div className="space-y-2">
          {availabilityMessageKey && (
            <div className="text-muted-foreground text-xs">
              {t(availabilityMessageKey)}
            </div>
          )}
          {isProcessing && processingStatus && (
            <div className="text-muted-foreground text-xs">
              {processingStatus}
            </div>
          )}
          <DialogFooter className="p-0">
            {isProcessing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                className="w-full"
              >
                {t("common.actions.cancel")}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={!canStart}
                className="w-full bg-purple-600 text-white hover:bg-purple-700"
                onClick={() => {
                  if (!parsed.ok) return;
                  onStart({
                    pageRange,
                    targetLanguage,
                    translateOption,
                    prompt,
                    fontFamily: currentFontValue,
                    usePositionAwarePrompt: currentUsePositionAwarePrompt,
                    aiReflowParagraphs: currentAiReflowParagraphs,
                    useParagraphs,
                    contextWindow,
                  });
                }}
              >
                <Languages size={16} />
                {t("translate.action")}
              </Button>
            )}
          </DialogFooter>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label>{t("properties.form_detection.page_range")}</Label>
            <span className="text-muted-foreground text-xs">
              Total: {totalPages}
            </span>
          </div>
          <Input
            value={pageRange}
            disabled={isProcessing}
            onChange={(e) => setPageRange(e.target.value)}
            placeholder={t("properties.form_detection.page_range_hint")}
          />
          {!parsed.ok && (
            <div className="text-destructive text-xs">
              {t(parsed.errorKey, { total: totalPages })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t("translate.target")}</Label>
          <Select value={targetLanguage} onValueChange={setTargetLanguage}>
            <SelectTrigger disabled={isProcessing}>
              <SelectValue placeholder={t("common.select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{t("translate.target")}</SelectLabel>
                {TARGET_LANG_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("translate.model")}</Label>
          <ModelSelect
            value={translateOption}
            onValueChange={(v) =>
              setTranslateOption(translateService.normalizeTranslateOption(v))
            }
            placeholder={t("common.select")}
            groups={modelSelectGroups}
            disabled={isProcessing}
          />
        </div>

        <div className="space-y-2">
          <Label>{t("properties.form_detection.prompt")}</Label>
          <Textarea
            value={prompt}
            disabled={isProcessing}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("properties.form_detection.prompt_ph")}
            className="resize-none"
            rows={3}
          />
          <p className="text-muted-foreground text-xs">
            {t("properties.form_detection.prompt_hint")}
          </p>
        </div>

        <div className="space-y-2">
          <Label>{t("properties.page_translate.freetext_padding")}</Label>
          <Input
            type="number"
            step="0.5"
            value={String(freetextPadding)}
            disabled={isProcessing}
            onChange={(e) => {
              const next = parseFloat(e.target.value);
              if (!Number.isFinite(next)) return;
              onFreetextPaddingChange(Math.max(0, Math.min(50, next)));
            }}
          />
          <p className="text-muted-foreground text-xs">
            {t("properties.page_translate.freetext_padding_hint")}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="page-translate-flatten-all"
              className="cursor-pointer"
            >
              {t("properties.page_translate.flatten_all_freetext")}
            </Label>
            <Switch
              id="page-translate-flatten-all"
              checked={flattenAllFreetext}
              onCheckedChange={onFlattenAllFreetextChange}
              disabled={isProcessing}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t("properties.page_translate.flatten_all_freetext_hint")}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="page-translate-position-aware"
              className="cursor-pointer"
            >
              {t("properties.page_translate.position_aware")}
            </Label>
            <Switch
              id="page-translate-position-aware"
              checked={currentUsePositionAwarePrompt}
              onCheckedChange={onUsePositionAwarePromptChange}
              disabled={isProcessing || !isPositionAwareAvailable}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t("properties.page_translate.position_aware_hint")}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="page-translate-ai-reflow"
              className="cursor-pointer"
            >
              {t("properties.page_translate.ai_reflow_paragraphs")}
            </Label>
            <Switch
              id="page-translate-ai-reflow"
              checked={currentAiReflowParagraphs}
              onCheckedChange={onAiReflowParagraphsChange}
              disabled={isProcessing || !isAiReflowAvailable}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t("properties.page_translate.ai_reflow_paragraphs_hint")}
          </p>
        </div>

        <div className="space-y-2">
          <Label>{t("properties.page_translate.context_window")}</Label>
          <Select
            value={contextWindow}
            onValueChange={(v) =>
              onContextWindowChange(v as PageTranslateContextWindow)
            }
          >
            <SelectTrigger disabled={isProcessing || !isContextWindowAvailable}>
              <SelectValue placeholder={t("common.select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>
                  {t("properties.page_translate.context_window")}
                </SelectLabel>
                <SelectItem value="none">
                  {t("properties.page_translate.context_window_none")}
                </SelectItem>
                <SelectItem value="prev">
                  {t("properties.page_translate.context_window_prev")}
                </SelectItem>
                <SelectItem value="next">
                  {t("properties.page_translate.context_window_next")}
                </SelectItem>
                <SelectItem value="prev_next">
                  {t("properties.page_translate.context_window_prev_next")}
                </SelectItem>
                <SelectItem value="all_prev">
                  {t("properties.page_translate.context_window_all_prev")}
                </SelectItem>
                <SelectItem value="all_next">
                  {t("properties.page_translate.context_window_all_next")}
                </SelectItem>
                <SelectItem value="all">
                  {t("properties.page_translate.context_window_all")}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {t("properties.page_translate.context_window_hint")}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="page-translate-use-paragraphs"
              className="cursor-pointer"
            >
              {t("properties.page_translate.use_paragraphs")}
            </Label>
            <Switch
              id="page-translate-use-paragraphs"
              checked={useParagraphs}
              onCheckedChange={onUseParagraphsChange}
              disabled={isProcessing}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t("properties.page_translate.use_paragraphs_hint")}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("properties.page_translate.paragraph_x_gap")}</Label>
              <Input
                type="number"
                step="0.1"
                value={String(paragraphXGap)}
                disabled={!useParagraphs || isProcessing}
                onChange={(e) => {
                  const next = parseFloat(e.target.value);
                  if (!Number.isFinite(next)) return;
                  onParagraphXGapChange(next);
                }}
              />
            </div>

            <div className="space-y-1">
              <Label>{t("properties.page_translate.paragraph_y_gap")}</Label>
              <Input
                type="number"
                step="0.1"
                value={String(paragraphYGap)}
                disabled={!useParagraphs || isProcessing}
                onChange={(e) => {
                  const next = parseFloat(e.target.value);
                  if (!Number.isFinite(next)) return;
                  onParagraphYGapChange(next);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="page-translate-paragraph-split-font-size"
                className="cursor-pointer"
              >
                {t("properties.page_translate.paragraph_split_by_font_size")}
              </Label>
              <Switch
                id="page-translate-paragraph-split-font-size"
                checked={paragraphSplitByFontSize}
                onCheckedChange={onParagraphSplitByFontSizeChange}
                disabled={!useParagraphs || isProcessing}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {t("properties.page_translate.paragraph_split_by_font_size_hint")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!useParagraphs || isProcessing || !parsed.ok}
              onClick={() => {
                if (!parsed.ok) return;
                onPreviewParagraphs({
                  pageIndices: parsed.pageIndices,
                  xGap: paragraphXGap,
                  yGap: paragraphYGap,
                });
              }}
            >
              {t("properties.page_translate.preview_paragraphs")}
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={
                !useParagraphs || isProcessing || paragraphCandidatesCount === 0
              }
              onClick={onClearParagraphs}
            >
              {t("properties.page_translate.clear_paragraphs")}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={
                !useParagraphs || isProcessing || selectedParagraphCount < 2
              }
              onClick={onMergeSelectedParagraphs}
            >
              {t("properties.page_translate.merge_selected")}
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={
                !useParagraphs || isProcessing || selectedParagraphCount === 0
              }
              onClick={onUnmergeSelectedParagraphs}
            >
              {t("properties.page_translate.unmerge_selected")}
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={
                !useParagraphs || isProcessing || selectedParagraphCount === 0
              }
              onClick={onToggleExcludeSelectedParagraphs}
            >
              {t("properties.page_translate.toggle_exclude_selected")}
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={
                !useParagraphs || isProcessing || selectedParagraphCount === 0
              }
              onClick={onDeleteSelectedParagraphs}
            >
              {t("common.actions.delete")}
            </Button>
          </div>

          <div className="text-muted-foreground text-xs">
            {t("properties.page_translate.paragraph_candidates_count", {
              count: paragraphCandidatesCount,
              selected: selectedParagraphCount,
            })}
          </div>

          {useParagraphs && paragraphCandidatesCount === 0 && (
            <div className="text-muted-foreground text-xs">
              {t("properties.page_translate.paragraph_preview_required")}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t("properties.font_family")}</Label>
          <Select value={currentFontValue} onValueChange={onFontFamilyChange}>
            <SelectTrigger className="w-full" disabled={isProcessing}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FONT_FAMILY_MAP).map(([name, stack]) => (
                <SelectItem key={name} value={name}>
                  <span style={{ fontFamily: stack }}>{name}</span>
                </SelectItem>
              ))}
              {systemFamilies
                .filter(
                  (name) =>
                    !Object.prototype.hasOwnProperty.call(
                      FONT_FAMILY_MAP,
                      name,
                    ),
                )
                .map((name) => (
                  <SelectItem key={name} value={name}>
                    <span
                      style={{ fontFamily: resolveFontStackForDisplay(name) }}
                    >
                      {name}
                    </span>
                  </SelectItem>
                ))}
              {isCustomFontValue && (
                <SelectItem value={fontFamily}>{fontFamily}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
    </PanelLayout>
  );
}
