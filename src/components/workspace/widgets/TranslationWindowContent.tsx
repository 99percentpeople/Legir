import type React from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { StreamingCursor } from "@/components/ui/streaming-cursor";
import { cn } from "@/utils/cn";
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
      {isLoading && <StreamingCursor />}
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}

export interface TranslationWindowContentProps {
  width: number;
  windowBodyRef?: React.Ref<HTMLDivElement>;
  input: string;
  setInput: (value: string) => void;
  output: string;
  error: string | null;
  isLoading: boolean;
  activeTab: "source" | "result";
  setActiveTab: (value: "source" | "result") => void;
  targetLang: string;
  setTargetLang: (value: string) => void;
  canTranslate: boolean;
  copied: boolean;
  handleCopy: () => void;
  handleCancel: () => void;
  handleTranslate: () => void;
}
// Presentational body shared by the real translation window and the local demo.
export function TranslationWindowContent({
  width,
  windowBodyRef,
  input,
  setInput,
  output,
  error,
  isLoading,
  activeTab,
  setActiveTab,
  targetLang,
  setTargetLang,
  canTranslate,
  copied,
  handleCopy,
  handleCancel,
  handleTranslate,
}: TranslationWindowContentProps) {
  const { t } = useLanguage();

  const isHorizontal = width >= 720;

  if (isHorizontal) {
    return (
      <div
        ref={windowBodyRef}
        className="flex h-full min-h-0 flex-col gap-2 p-2"
      >
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
                  variant={isLoading ? "secondary" : undefined}
                  className={cn(
                    "h-7 px-2 text-xs",
                    !isLoading &&
                      "bg-purple-600 text-white hover:bg-purple-700",
                  )}
                  onClick={() =>
                    isLoading ? handleCancel() : handleTranslate()
                  }
                >
                  {isLoading ? (
                    <>
                      <Spinner />
                      {t("common.actions.cancel")}
                    </>
                  ) : (
                    <>
                      <Languages />
                      {t("translate.action")}
                    </>
                  )}
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
      </div>
    );
  }

  // Vertical: tabs switch between source and result
  return (
    <div ref={windowBodyRef} className="flex h-full min-h-0 flex-col gap-2 p-2">
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
                  variant={isLoading ? "secondary" : undefined}
                  className={cn(
                    "h-7 px-2 text-xs",
                    !isLoading &&
                      "bg-purple-600 text-white hover:bg-purple-700",
                  )}
                  onClick={() =>
                    isLoading ? handleCancel() : handleTranslate()
                  }
                >
                  {isLoading ? (
                    <>
                      <Spinner />
                      {t("common.actions.cancel")}
                    </>
                  ) : (
                    <>
                      <Languages />
                      {t("translate.action")}
                    </>
                  )}
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
    </div>
  );
}
