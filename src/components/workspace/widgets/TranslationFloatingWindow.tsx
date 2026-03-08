import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Copy, Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/components/language-provider";
import { ModelSelect, type ModelSelectGroup } from "@/components/ModelSelect";
import {
  translateService,
  type TranslateOptionGroup,
} from "@/services/translateService";
import { FloatingWindow } from "@/components/ui/floating-window";
import { cn } from "@/utils/cn";
import { useEditorStore } from "@/store/useEditorStore";
import type { TranslateOptionId } from "@/types";

export interface TranslationFloatingWindowProps {
  isOpen: boolean;
  sourceText: string;
  autoTranslateToken?: number;
  onClose: () => void;
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

function ResultOutputBox({
  output,
  isLoading,
  error,
  className,
}: {
  output: string;
  isLoading: boolean;
  error: string | null;
  className?: string;
}) {
  return (
    <div
      tabIndex={0}
      role="textbox"
      aria-readonly="true"
      onMouseDownCapture={(e) => {
        e.currentTarget.focus();
      }}
      onKeyDownCapture={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
          e.preventDefault();
          e.stopPropagation();

          const sel = window.getSelection();
          if (!sel) return;
          const range = document.createRange();
          range.selectNodeContents(e.currentTarget);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }}
      className={cn(
        "bg-muted/20 min-h-0 flex-1 overflow-auto rounded-md border px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap outline-none select-text",
        className,
      )}
    >
      {output}
      {isLoading && (
        <span className="text-muted-foreground animation-duration-[.5s] inline-block animate-pulse">
          ⬤
        </span>
      )}
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}

export const TranslationFloatingWindow: React.FC<
  TranslationFloatingWindowProps
> = ({ isOpen, sourceText, autoTranslateToken, onClose }) => {
  const { t, effectiveLanguage } = useLanguage();
  const translateOptionRaw = useEditorStore((s) => s.translateOption);
  const translateTargetLanguage = useEditorStore(
    (s) => s.translateTargetLanguage,
  );
  const setState = useEditorStore((s) => s.setState);

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
      if (groupId === "openai") return 1;
      if (groupId === "gemini") return 2;
      return 3;
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

  const abortRef = useRef<AbortController | null>(null);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setInput(sourceText);
    setError(null);
    setActiveTab("source");

    // Keep target language in sync with persisted preference.
    // If user hasn't set one yet, default to effectiveLanguage.
    setTargetLang(translateTargetLanguage || effectiveLanguage);
  }, [isOpen, sourceText]);

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

  const unavailableMessageKey = useMemo(() => {
    if (translateService.isOptionAvailable(translateOption)) return undefined;
    return translateService.getOptionUnavailableMessageKey(translateOption);
  }, [translateOption]);

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
      closeLabel={t("common.close")}
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
        <div className={cn("flex flex-1", width >= 720 && "justify-center")}>
          <div
            className="flex cursor-auto items-center gap-2 **:cursor-auto"
            data-floating-window-no-drag
          >
            {width >= 720 && (
              <div className="text-muted-foreground text-[11px] leading-4">
                {t("translate.provider")}
              </div>
            )}
            <ModelSelect
              value={translateOption}
              onValueChange={(v) => {
                setState({
                  translateOption: translateService.normalizeTranslateOption(v),
                });
              }}
              placeholder={t("translate.provider")}
              groups={modelSelectGroups}
              triggerClassName="h-7! border-none text-xs"
              triggerSize="sm"
              triggerTitle={t("translate.provider")}
            />
          </div>
        </div>
      )}
    >
      {({ width }) => {
        const isHorizontal = width >= 720;

        if (isHorizontal) {
          return (
            <div className="flex h-full min-h-0 flex-col gap-2 p-2">
              <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2 gap-2">
                <div className="flex min-h-0 flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-muted-foreground text-[11px] leading-4">
                      {t("translate.source_text")}
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={targetLang}
                        onValueChange={(v) => {
                          setTargetLang(v);
                          setState({ translateTargetLanguage: v });
                        }}
                      >
                        <SelectTrigger
                          className="h-7! text-xs"
                          size="sm"
                          title={t("translate.target")}
                        >
                          <SelectValue placeholder={t("translate.target")} />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_LANG_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        disabled={!canTranslate && !isLoading}
                        className="h-7 bg-purple-600 px-2 text-xs text-white hover:bg-purple-700"
                        onClick={
                          isLoading
                            ? handleCancel
                            : () => {
                                void handleTranslate();
                              }
                        }
                      >
                        {isLoading ? t("common.cancel") : t("translate.action")}
                      </Button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1">
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      className="field-sizing-fixed h-full min-h-0 resize-none overflow-auto text-sm"
                    />
                  </div>
                </div>

                <div className="flex min-h-0 flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-muted-foreground text-[11px] leading-4">
                      {t("translate.result")}
                    </div>
                    <Button
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={!output.trim()}
                      onClick={handleCopy}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {t("translate.copy")}
                    </Button>
                  </div>

                  <ResultOutputBox
                    output={output}
                    isLoading={isLoading}
                    error={error}
                  />
                </div>
              </div>
              {unavailableMessageKey && (
                <div className="text-muted-foreground text-[11px] leading-4">
                  {t(unavailableMessageKey)}
                </div>
              )}
            </div>
          );
        }

        // Vertical: tabs switch between source and result
        return (
          <div className="flex h-full min-h-0 flex-col gap-2 p-2">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "source" | "result")}
              className="min-h-0 flex-1"
            >
              <div className="flex items-end gap-2 border-b">
                <TabsList className="text-foreground h-auto gap-2 rounded-none bg-transparent px-0 py-0">
                  <TabsTrigger
                    value="source"
                    className="hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:after:bg-primary relative rounded-b-none border-none text-xs after:absolute after:inset-x-0 after:bottom-0 after:-mb-1 after:h-0.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    {t("translate.source_text")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="result"
                    className="hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:after:bg-primary relative rounded-b-none border-none text-xs after:absolute after:inset-x-0 after:bottom-0 after:-mb-1 after:h-0.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    {t("translate.result")}
                  </TabsTrigger>
                </TabsList>

                <div className="mb-1 ml-auto flex items-center gap-2">
                  {activeTab === "source" ? (
                    <>
                      <Select
                        value={targetLang}
                        onValueChange={(v) => {
                          setTargetLang(v);
                          setState({ translateTargetLanguage: v });
                        }}
                      >
                        <SelectTrigger
                          className="h-7! w-32 text-xs"
                          size="sm"
                          title={t("translate.target")}
                        >
                          <SelectValue placeholder={t("translate.target")} />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_LANG_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        disabled={!canTranslate && !isLoading}
                        className="h-7 bg-purple-600 px-2 text-xs text-white hover:bg-purple-700"
                        onClick={
                          isLoading
                            ? handleCancel
                            : () => {
                                void handleTranslate();
                              }
                        }
                      >
                        {isLoading ? t("common.cancel") : t("translate.action")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={!output.trim()}
                      onClick={handleCopy}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {t("translate.copy")}
                    </Button>
                  )}
                </div>
              </div>

              <TabsContent value="source" className="min-h-0 w-full">
                <div className="flex h-full min-h-0 flex-col gap-2">
                  <div className="min-h-0 flex-1">
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      className="field-sizing-fixed h-full min-h-0 resize-none overflow-auto text-sm"
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="result" className="min-h-0 w-full">
                <div className="flex h-full min-h-0 flex-col gap-2">
                  <ResultOutputBox
                    output={output}
                    isLoading={isLoading}
                    error={error}
                  />
                </div>
              </TabsContent>
            </Tabs>
            {unavailableMessageKey && (
              <div className="text-muted-foreground mb-1.5 text-[11px] leading-4">
                {t(unavailableMessageKey)}
              </div>
            )}
          </div>
        );
      }}
    </FloatingWindow>
  );
};
