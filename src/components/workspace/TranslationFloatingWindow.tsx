import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Copy, Sparkles } from "lucide-react";

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
import {
  GEMINI_API_AVAILABLE,
  GEMINI_MODEL_OPTIONS,
  translateText,
  translateTextStream,
  type GeminiModelId,
} from "@/services/geminiService";
import { FloatingWindow } from "@/components/ui/floating-window";

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

export const TranslationFloatingWindow: React.FC<
  TranslationFloatingWindowProps
> = ({ isOpen, sourceText, autoTranslateToken, onClose }) => {
  const { t, effectiveLanguage } = useLanguage();
  const [model, setModel] = useState<GeminiModelId>(
    GEMINI_MODEL_OPTIONS[0]?.value ?? "gemini-2.5-flash",
  );
  const [targetLang, setTargetLang] = useState<string>(effectiveLanguage);

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
  }, [isOpen, sourceText]);

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
    return GEMINI_API_AVAILABLE && !isLoading && input.trim().length > 0;
  }, [input, isLoading]);

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
        for await (const chunk of translateTextStream(textToTranslate, {
          model,
          targetLanguage: targetLang,
          signal: controller.signal,
        })) {
          receivedAny = true;
          setOutput((prev) => prev + chunk);
        }

        // If the stream API isn't available and we fell back to non-stream,
        // translateTextStream will yield the full response as a single chunk.
        if (!receivedAny) {
          const res = await translateText(textToTranslate, {
            model,
            targetLanguage: targetLang,
          });
          setOutput(res);
        }
      } catch (e: any) {
        if (e?.name === "AbortError") {
          // user cancelled
          return;
        }
        setError(e?.message || String(e));
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [cancelStream, input, model, targetLang],
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

  const handleCopy = useCallback(async () => {
    const text = output.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }, [output]);

  return (
    <FloatingWindow
      isOpen={isOpen}
      title={
        <>
          <Sparkles size={16} /> {t("translate.title")}
        </>
      }
      headerRight={({ portalContainer, width }) => {
        const triggerW = Math.max(140, Math.min(220, Math.floor(width * 0.35)));

        return (
          <div className="flex items-center gap-2" data-floating-window-no-drag>
            <Select
              value={model}
              onValueChange={(v) => setModel(v as GeminiModelId)}
            >
              <SelectTrigger
                className="h-7! text-xs"
                style={{ width: triggerW }}
                size="sm"
                title={t("translate.model")}
              >
                <SelectValue placeholder={t("translate.model")} />
              </SelectTrigger>
              <SelectContent
                portalContainer={portalContainer}
                className="z-9999"
              >
                {GEMINI_MODEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      }}
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
    >
      {({ width, height, portalContainer }) => {
        const isHorizontal = width >= 720;

        if (isHorizontal) {
          return (
            <div className="grid h-full min-h-0 grid-cols-2 gap-2 p-2">
              <div className="flex min-h-0 flex-col gap-1.5">
                {!GEMINI_API_AVAILABLE && (
                  <div className="text-muted-foreground text-[11px] leading-4">
                    {t("ai_panel.api_key_missing")}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="text-muted-foreground text-[11px] leading-4">
                    {t("translate.source_text")}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={targetLang} onValueChange={setTargetLang}>
                      <SelectTrigger
                        className="h-7! text-xs"
                        size="sm"
                        title={t("translate.target")}
                      >
                        <SelectValue placeholder={t("translate.target")} />
                      </SelectTrigger>
                      <SelectContent
                        portalContainer={portalContainer}
                        className="z-9999"
                      >
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

                {error && (
                  <div className="text-destructive text-[11px] leading-4">
                    {error}
                  </div>
                )}
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
                    <Copy size={16} className="mr-2" />
                    {t("translate.copy")}
                  </Button>
                </div>

                <div className="bg-muted/20 min-h-0 flex-1 overflow-auto rounded-md border p-1.5 text-sm whitespace-pre-wrap">
                  {output}
                  {isLoading && (
                    <span className="text-muted-foreground inline-block animate-pulse">
                      ▍
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // Vertical: tabs switch between source and result
        return (
          <div className="flex h-full min-h-0 flex-col p-2">
            {!GEMINI_API_AVAILABLE && (
              <div className="text-muted-foreground mb-1.5 text-[11px] leading-4">
                {t("ai_panel.api_key_missing")}
              </div>
            )}

            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "source" | "result")}
              className="min-h-0 flex-1"
            >
              <div className="flex items-center gap-2 border-b py-1">
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

                <div className="ml-auto flex items-center gap-2">
                  {activeTab === "source" ? (
                    <>
                      <Select value={targetLang} onValueChange={setTargetLang}>
                        <SelectTrigger
                          className="h-7! w-32 text-xs"
                          size="sm"
                          title={t("translate.target")}
                        >
                          <SelectValue placeholder={t("translate.target")} />
                        </SelectTrigger>
                        <SelectContent
                          portalContainer={portalContainer}
                          className="z-9999"
                        >
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
                      <Copy size={16} />
                      {t("translate.copy")}
                    </Button>
                  )}
                </div>
              </div>

              <TabsContent value="source" className="min-h-0 w-full">
                <div className="flex h-full min-h-0 flex-col gap-2 pt-2">
                  <div className="min-h-0 flex-1">
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      className="field-sizing-fixed h-full min-h-0 resize-none overflow-auto text-sm"
                    />
                  </div>

                  {error && (
                    <div className="text-destructive text-[11px] leading-4">
                      {error}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="result" className="min-h-0 w-full">
                <div className="flex h-full min-h-0 flex-col gap-2 pt-2">
                  <div className="bg-muted/20 min-h-0 flex-1 overflow-auto rounded-md border p-1.5 text-sm whitespace-pre-wrap">
                    {output}
                    {isLoading && (
                      <span className="text-muted-foreground inline-block animate-pulse">
                        ▍
                      </span>
                    )}
                  </div>

                  {error && (
                    <div className="text-destructive text-[11px] leading-4">
                      {error}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        );
      }}
    </FloatingWindow>
  );
};
