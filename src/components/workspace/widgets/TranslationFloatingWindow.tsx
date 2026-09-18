import { TranslationWindowContent } from "./TranslationWindowContent";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Languages } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { ModelSelect, type ModelSelectGroup } from "@/components/ModelSelect";
import {
  translateService,
  type TranslateOptionGroup,
} from "@/services/translateService";
import { AI_PROVIDER_IDS_SORTED_BY_LABEL } from "@/services/ai/providers/catalog";
import { FloatingWindow } from "@/components/ui/floating-window";
import { cn } from "@/utils/cn";
import { useEditorStore } from "@/store/useEditorStore";
import type { TranslateOptionId } from "@/types";
import { useShallow } from "zustand/react/shallow";
import { selectTranslationFloatingWindowState } from "@/store/selectors";

export interface TranslationFloatingWindowProps {
  isOpen: boolean;
  sourceText: string;
  autoTranslateToken?: number;
  onClose: () => void;
}

export const TranslationFloatingWindow: React.FC<
  TranslationFloatingWindowProps
> = ({ isOpen, sourceText, autoTranslateToken, onClose }) => {
  const { t, effectiveLanguage } = useLanguage();
  const { translateOptionRaw, translateTargetLanguage, setState } =
    useEditorStore(useShallow(selectTranslationFloatingWindowState));

  const [registryVersion, setRegistryVersion] = useState(0);

  const translateOption = useMemo(() => {
    return translateService.normalizeTranslateOption(translateOptionRaw);
  }, [translateOptionRaw]);

  useEffect(() => {
    return translateService.subscribe(() => {
      setRegistryVersion((v) => v + 1);
    });
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
  const selectedTranslateOption = translateService.isOptionAvailable(
    translateOption,
  )
    ? translateOption
    : firstAvailableOption;
  useEffect(() => {
    if (translateService.isOptionAvailable(translateOption)) return;
    if (!firstAvailableOption) return;

    setState({
      translateOption:
        translateService.normalizeTranslateOption(firstAvailableOption),
    });
  }, [firstAvailableOption, setState, translateOption]);
  const [targetLang, setTargetLang] = useState<string>(
    translateTargetLanguage || effectiveLanguage,
  );

  const [input, setInput] = useState<string>(sourceText);
  const [output, setOutput] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"source" | "result">("source");

  const lastAutoTranslateTokenRef = useRef<number | undefined>(undefined);
  const windowBodyRef = useRef<HTMLDivElement | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (sourceText.trim()) {
      setInput(sourceText);
    }
    setError(null);
    setActiveTab("source");

    // Keep target language in sync with persisted preference.
    // If user hasn't set one yet, default to effectiveLanguage.
    setTargetLang(translateTargetLanguage || effectiveLanguage);
  }, [effectiveLanguage, isOpen, sourceText, translateTargetLanguage]);

  useEffect(() => {
    if (!isOpen) return;

    const frameId = window.requestAnimationFrame(() => {
      const textarea = windowBodyRef.current?.querySelector("textarea");
      if (!(textarea instanceof HTMLTextAreaElement)) return;
      textarea.focus();
      textarea.select();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setTargetLang(translateTargetLanguage || effectiveLanguage);
  }, [effectiveLanguage, isOpen, translateTargetLanguage]);

  useEffect(() => {
    if (!isOpen) {
      cancelStream();
      setIsLoading(false);
    }
  }, [cancelStream, isOpen]);

  useEffect(() => {
    return () => {
      cancelStream();
    };
  }, [cancelStream]);

  const canTranslate = useMemo(() => {
    return (
      translateService.isOptionAvailable(translateOption) &&
      !isLoading &&
      input.trim().length > 0
    );
  }, [input, isLoading, translateOption]);

  const handleTranslate = useCallback(
    async (overrideText?: string) => {
      const textToTranslate = (overrideText ?? input).trim();
      if (!textToTranslate) return;
      setError(null);
      setIsLoading(true);
      setOutput("");
      setActiveTab("result");

      cancelStream();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        let receivedAny = false;
        for await (const chunk of translateService.translateStream(
          textToTranslate,
          {
            translateOption,
            targetLanguage: targetLang,
            signal: controller.signal,
          },
        )) {
          receivedAny = true;
          setOutput((prev) => prev + chunk);
        }

        // If the stream API isn't available and we fell back to non-stream,
        // translateService.translateStream will yield the full response as a single chunk.
        if (!receivedAny) {
          const res = await translateService.translate(textToTranslate, {
            translateOption,
            targetLanguage: targetLang,
          });
          setOutput(res);
        }
      } catch (e: unknown) {
        const err =
          typeof e === "object" && e !== null
            ? (e as { name?: string; message?: string })
            : null;

        if (err?.name === "AbortError") {
          // user cancelled
          return;
        }
        setError(err?.message || String(e));
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [cancelStream, input, targetLang, translateOption],
  );

  useEffect(() => {
    if (!isOpen) return;
    if (autoTranslateToken === undefined) return;
    if (lastAutoTranslateTokenRef.current === autoTranslateToken) return;
    lastAutoTranslateTokenRef.current = autoTranslateToken;

    // Mirror the latest selected text then start translating.
    setInput(sourceText);
    void Promise.resolve().then(() => {
      void handleTranslate(sourceText);
    });
  }, [autoTranslateToken, handleTranslate, isOpen, sourceText]);

  const handleCancel = useCallback(() => {
    cancelStream();
    setIsLoading(false);
  }, [cancelStream]);

  const [copied, setCopied] = useState(false);
  let copiedTimeout: NodeJS.Timeout | null = null;

  const handleCopy = useCallback(async () => {
    const text = output.trim();
    if (!text) return;
    if (copiedTimeout) clearTimeout(copiedTimeout);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      copiedTimeout = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // ignore
    }
  }, [output]);

  return (
    <FloatingWindow
      isOpen={isOpen}
      title={
        <>
          <Languages size={16} /> {t("translate.title")}
        </>
      }
      closeLabel={t("common.actions.close")}
      onClose={() => {
        cancelStream();
        setIsLoading(false);
        onClose();
      }}
      defaultPosition="center"
      defaultSize={{ width: 520, height: 460 }}
      minSize={{ width: 360, height: 420 }}
      className="rounded-xl"
      headerClassName="px-2 py-1.5"
      closeButtonClassName="h-7 w-7"
      header={({ width }) => (
        <div
          className={cn(
            "flex min-w-0 flex-1",
            width >= 720 && "justify-center",
          )}
        >
          <div
            className="flex min-w-0 shrink cursor-auto items-center gap-2 **:cursor-auto"
            data-floating-window-no-drag
          >
            {width >= 720 && (
              <div className="text-muted-foreground text-[11px] leading-4">
                {t("translate.provider")}
              </div>
            )}

            <ModelSelect
              value={selectedTranslateOption}
              onValueChange={(v) => {
                setState({
                  translateOption: translateService.normalizeTranslateOption(v),
                });
              }}
              placeholder={
                firstAvailableOption
                  ? t("translate.provider")
                  : t("translate.no_available_services")
              }
              groups={modelSelectGroups}
              disabled={!firstAvailableOption}
              triggerClassName="h-7! border-none text-xs"
              triggerSize="sm"
              triggerTitle={
                firstAvailableOption
                  ? t("translate.provider")
                  : t("translate.no_available_services")
              }
            />
          </div>
        </div>
      )}
    >
      {({ width }) => (
        <TranslationWindowContent
          width={width}
          windowBodyRef={windowBodyRef}
          input={input}
          setInput={setInput}
          output={output}
          error={error}
          isLoading={isLoading}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          targetLang={targetLang}
          setTargetLang={(value) => {
            setTargetLang(value);
            setState({ translateTargetLanguage: value });
          }}
          canTranslate={canTranslate}
          copied={copied}
          handleCopy={handleCopy}
          handleCancel={handleCancel}
          handleTranslate={handleTranslate}
        />
      )}
    </FloatingWindow>
  );
};
