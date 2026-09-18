import { useEffect, useId, useRef, useState, type Dispatch } from "react";
import { Languages, X } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { TranslationWindowContent } from "@/components/workspace/widgets/TranslationWindowContent";
import { ModelSelect } from "@/components/ModelSelect";
import { getDemoCopy, type DemoCopy } from "./copy";
import { getTranslationId, type DemoState, type DemoAction } from "./types";
import { useDemoPlayback } from "./useDemoPlayback";
import { DEMO_MODELS } from "./DemoPanels";

export function DemoTranslationWindow({
  state,
  dispatch,
  copy,
  language,
}: {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
  copy: DemoCopy;
  language: string;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const [input, setInput] = useState(state.selection);
  const [target, setTarget] = useState(language === "en" ? "zh-CN" : language);
  const [activeTab, setActiveTab] = useState<"source" | "result">("source");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const lastToken = useRef(-1);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { text, playing, start, stop } = useDemoPlayback("");
  function translate(value = input) {
    const id = getTranslationId(value);
    setCopied(false);
    setActiveTab("result");
    setError(id ? null : copy.unsupported);
    start(id ? getDemoCopy(target).translations[id] : "");
  }
  function close() {
    stop();
    dispatch({ type: "translate", open: false });
  }
  useEffect(() => {
    if (!state.translationOpen) {
      stop();
      return;
    }
    setInput(state.selection);
    setActiveTab("source");
    setError(null);
    if (
      state.translationToken !== lastToken.current &&
      state.translationToken > 0
    ) {
      lastToken.current = state.translationToken;
      const id = getTranslationId(state.selection);
      setActiveTab("result");
      setError(id ? null : copy.unsupported);
      start(id ? getDemoCopy(target).translations[id] : "");
    }
  }, [
    state.translationOpen,
    state.translationToken,
    state.selection,
    copy,
    start,
    stop,
  ]);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  if (!state.translationOpen) return null;

  // Keep the application's header/content appearance, but not FloatingWindow's
  // document.body portal, viewport positioning, dragging or resize handles.
  return (
    <section
      className="demo-translation-window bg-background border-border rounded-xl border shadow-xl"
      role="region"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div className="demo-translation-header flex shrink-0 items-center justify-between gap-2 border-b px-2 py-1.5">
        <h3
          id={titleId}
          className="flex shrink-0 items-center gap-2 text-sm font-semibold text-nowrap"
        >
          <Languages size={16} />
          {t("translate.title")}
        </h3>
        <div className="min-w-0 flex-1">
          <ModelSelect
            value="demo-deepseek"
            onValueChange={() => {}}
            placeholder={t("translate.provider")}
            groups={DEMO_MODELS}
            triggerClassName="h-7! max-w-full border-none text-xs"
            triggerSize="sm"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={close}
          title={t("common.actions.close")}
          aria-label={t("common.actions.close")}
        >
          <X size={16} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TranslationWindowContent
          // This demo has one fixed compact layout (CSS caps its width at 420px).
          width={420}
          windowBodyRef={body}
          input={input}
          setInput={setInput}
          output={text}
          error={error}
          isLoading={playing}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          targetLang={target}
          setTargetLang={(value) => {
            stop();
            setTarget(value);
            setActiveTab("source");
          }}
          canTranslate={!!input.trim() && !playing}
          copied={copied}
          handleCancel={stop}
          handleTranslate={() => translate()}
          handleCopy={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              if (copyTimer.current) clearTimeout(copyTimer.current);
              copyTimer.current = setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        />
      </div>
      <p className="text-muted-foreground shrink-0 px-2 pb-2 text-[10px] leading-4">
        {copy.translateNotice}
      </p>
    </section>
  );
}
