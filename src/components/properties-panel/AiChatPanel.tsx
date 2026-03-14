import React from "react";
import {
  Brain,
  ChevronDown,
  FileText,
  History,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { PanelLayout } from "./PanelLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelect, type ModelSelectGroup } from "@/components/ModelSelect";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AiChatSessionSummary,
  AiChatTimelineItem,
  AiChatUserMessageInput,
  AiChatSelectionAttachment,
} from "@/services/aiChat/types";
import { appEventBus } from "@/lib/eventBus";
import { cn } from "@/utils/cn";

export interface AiChatPanelProps {
  isFloating: boolean;
  isOpen: boolean;
  onOpen: () => void;
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;

  sessions: AiChatSessionSummary[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewConversation: () => void;
  onClearConversation: () => void;
  onDeleteConversation: (id: string) => void;

  timeline: AiChatTimelineItem[];
  runStatus: "idle" | "running" | "cancelling" | "error";
  lastError: string | null;

  selectedModelKey?: string;
  onSelectModel: (value: string) => void;
  modelGroups: ModelSelectGroup[];

  onSend: (input: AiChatUserMessageInput) => void;
  onStop: () => void;
  disabledReason: "no_document" | "no_model" | null;
}

type TranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

type ToolTimelineItem = Extract<AiChatTimelineItem, { kind: "tool" }>;

type TimelineRenderEntry =
  | { kind: "item"; item: AiChatTimelineItem }
  | { kind: "tool_batch"; id: string; items: ToolTimelineItem[] };

const PromptButton = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="bg-background/80 hover:bg-accent/50 rounded-lg px-3 py-2.5 text-left text-sm transition-colors"
  >
    {children}
  </button>
);

const getSelectionAttachmentLocationLabel = (
  t: TranslateFn,
  attachment: AiChatSelectionAttachment,
) =>
  t("ai_chat.attachment_location", {
    page: attachment.pageIndex + 1,
    start: attachment.startOffset,
    end: attachment.endOffset,
  });

const getSelectionAttachmentKey = (attachment: AiChatSelectionAttachment) =>
  `${attachment.pageIndex}:${attachment.startOffset}:${attachment.endOffset}`;

const SelectionAttachmentChip = ({
  t,
  attachment,
  onRemove,
  onActivate,
  inverted = false,
}: {
  t: TranslateFn;
  attachment: AiChatSelectionAttachment;
  onRemove?: () => void;
  onActivate?: (attachment: AiChatSelectionAttachment) => void;
  inverted?: boolean;
}) => (
  <div
    className={cn(
      "inline-flex max-w-full min-w-0 items-center overflow-hidden rounded-full border text-xs font-medium",
      inverted
        ? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground"
        : "border-border bg-muted/50 text-foreground",
    )}
  >
    <button
      type="button"
      className={cn(
        "inline-flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1 text-left transition-colors",
        inverted ? "hover:bg-primary-foreground/5" : "hover:bg-accent",
      )}
      title={getSelectionAttachmentLocationLabel(t, attachment)}
      onClick={() => {
        onActivate?.(attachment);
      }}
    >
      <FileText size={12} className="shrink-0 opacity-70" />
      <span className="truncate">
        {getSelectionAttachmentLocationLabel(t, attachment)}
      </span>
    </button>
    {onRemove ? (
      <button
        type="button"
        className={cn(
          "inline-flex shrink-0 items-center justify-center self-stretch px-2 py-1 transition-colors",
          inverted
            ? "text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        aria-label={t("ai_chat.attachment_remove")}
        title={t("ai_chat.attachment_remove")}
      >
        <X size={12} />
      </button>
    ) : null}
  </div>
);

const formatThinkingDuration = (t: TranslateFn, durationMs?: number) => {
  if (typeof durationMs !== "number" || durationMs <= 0) {
    return t("ai_chat.thought_for", {
      duration: t("ai_chat.duration_seconds", { count: 0 }),
    });
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return t("ai_chat.thought_for", {
      duration: t("ai_chat.duration_hours_minutes", {
        hours,
        minutes,
      }),
    });
  }

  if (minutes > 0) {
    return t("ai_chat.thought_for", {
      duration: t("ai_chat.duration_minutes_seconds", {
        minutes,
        seconds,
      }),
    });
  }

  return t("ai_chat.thought_for", {
    duration: t("ai_chat.duration_seconds", { count: totalSeconds }),
  });
};

const ThinkingMessageBubble = ({
  text,
  isStreaming,
  thinkingLabel,
  completedLabel,
}: {
  text: string;
  isStreaming?: boolean;
  thinkingLabel: string;
  completedLabel: string;
}) => {
  const [open, setOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    if (!open || !isStreaming) return;
    const el = contentRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, isStreaming, text]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("max-w-[88%]", isStreaming && "w-full")}
    >
      <div className="border-border/70 bg-muted/30 text-muted-foreground w-full rounded-lg border border-dashed px-3 py-2">
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-[11px] font-medium"
              aria-label={isStreaming ? thinkingLabel : completedLabel}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Brain size={12} />
                <span className="flex min-w-0 items-center gap-1.5">
                  <span>{isStreaming ? thinkingLabel : completedLabel}</span>
                  {isStreaming ? (
                    <span
                      className="inline-flex items-center gap-1"
                      aria-hidden="true"
                    >
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current/70 [animation-delay:-0.3s]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current/70 [animation-delay:-0.15s]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current/70" />
                    </span>
                  ) : null}
                </span>
              </div>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
        </div>

        {open ? (
          <CollapsibleContent className="pt-1.5">
            <div
              ref={contentRef}
              className="max-h-64 overflow-auto pr-1 text-sm whitespace-pre-wrap"
            >
              {text}
            </div>
          </CollapsibleContent>
        ) : isStreaming && text ? (
          <div className="relative mt-1.5 h-10 overflow-hidden">
            <div className="absolute right-0 bottom-0 left-0 text-sm leading-5 break-words whitespace-pre-wrap">
              {text}
            </div>
          </div>
        ) : null}
      </div>
    </Collapsible>
  );
};

const PendingAssistantBubble = ({ label }: { label: string }) => {
  return (
    <div className="flex justify-start">
      <div className="bg-muted text-foreground inline-flex max-w-[88%] items-center gap-2 rounded-lg px-3 py-2 text-sm">
        <Spinner size="sm" />
        <span>{label}</span>
      </div>
    </div>
  );
};

const ToolTimelineCall = ({
  item,
  t,
  grouped = false,
}: {
  item: ToolTimelineItem;
  t: TranslateFn;
  grouped?: boolean;
}) => {
  const content = (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-muted-foreground font-mono text-xs">
              {item.toolName}
            </div>
            {item.status !== "done" ? (
              <Badge
                className="h-5 px-1.5 text-[10px]"
                variant={item.status === "error" ? "destructive" : "outline"}
              >
                {item.status === "running" ? <Spinner size="sm" /> : null}
                {item.status}
              </Badge>
            ) : null}
          </div>
          {item.resultSummary ? (
            <div className="text-xs">{item.resultSummary}</div>
          ) : null}
          {item.error ? (
            <div className="text-destructive text-sm">{item.error}</div>
          ) : null}
        </div>

        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="group h-7 w-7 shrink-0"
            aria-label={t("ai_chat.tool_details")}
          >
            <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="space-y-2">
        <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {t("ai_chat.tool_args")}
        </div>
        <div className="text-muted-foreground bg-muted/40 rounded-md px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">
          {item.argsText}
        </div>

        <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {t("ai_chat.tool_result")}
        </div>
        <div className="text-muted-foreground bg-muted/40 max-h-64 overflow-auto rounded-md px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">
          {item.resultText ?? ""}
        </div>
      </CollapsibleContent>
    </div>
  );

  return (
    <Collapsible defaultOpen={false}>
      {grouped ? (
        <div className="px-2 py-1.5">{content}</div>
      ) : (
        <Card className="bg-background">
          <CardContent className="px-2 py-1">{content}</CardContent>
        </Card>
      )}
    </Collapsible>
  );
};

const getSessionTitle = (
  t: (key: string) => string,
  session: AiChatSessionSummary,
) => {
  return session.title?.trim() ? session.title : t("ai_chat.session_default");
};

export function AiChatPanel({
  isFloating,
  isOpen,
  onOpen,
  width,
  onResize,
  onCollapse,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewConversation,
  onClearConversation,
  onDeleteConversation,
  timeline,
  runStatus,
  lastError,
  selectedModelKey,
  onSelectModel,
  modelGroups,
  onSend,
  onStop,
  disabledReason,
}: AiChatPanelProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = React.useState("");
  const [pendingAttachments, setPendingAttachments] = React.useState<
    AiChatSelectionAttachment[]
  >([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = React.useRef<HTMLElement | null>(null);
  const isNearBottomRef = React.useRef(true);
  const scrollRafRef = React.useRef<number | null>(null);
  const previousSessionIdRef = React.useRef<string | null>(null);
  const draftRef = React.useRef("");

  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  React.useEffect(() => {
    return appEventBus.on(
      "workspace:askAi",
      (attachment) => {
        appEventBus.clearSticky("workspace:askAi");
        if (attachment.kind !== "workspace_selection") return;
        if (!attachment.text.trim()) return;
        setPendingAttachments((prev) =>
          prev.some(
            (item) =>
              getSelectionAttachmentKey(item) ===
              getSelectionAttachmentKey(attachment),
          )
            ? prev
            : [...prev, attachment],
        );

        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          const caret = draftRef.current.length;
          el.setSelectionRange(caret, caret);
        });
      },
      { replayLast: true },
    );
  }, []);

  React.useEffect(() => {
    if (previousSessionIdRef.current === null) {
      previousSessionIdRef.current = activeSessionId;
      return;
    }
    if (previousSessionIdRef.current !== activeSessionId) {
      previousSessionIdRef.current = activeSessionId;
      setPendingAttachments([]);
    }
  }, [activeSessionId]);

  React.useEffect(() => {
    if (!isOpen) return;
    const endEl = endRef.current;
    if (!endEl) return;
    const scrollEl = endEl.closest?.(
      '[data-slot="panel-body"]',
    ) as HTMLElement | null;
    if (!scrollEl) return;
    scrollContainerRef.current = scrollEl;

    const update = () => {
      const distance =
        scrollEl.scrollHeight - (scrollEl.scrollTop + scrollEl.clientHeight);
      isNearBottomRef.current = distance < 96;
    };
    update();
    scrollEl.addEventListener("scroll", update, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", update);
      if (scrollContainerRef.current === scrollEl) {
        scrollContainerRef.current = null;
      }
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    if (!isNearBottomRef.current) return;
    const scrollEl =
      scrollContainerRef.current ??
      (endRef.current?.closest?.(
        '[data-slot="panel-body"]',
      ) as HTMLElement | null);
    if (!scrollEl) return;
    scrollContainerRef.current = scrollEl;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollEl.scrollHeight;
      isNearBottomRef.current = true;
      scrollRafRef.current = null;
    });
  }, [isOpen, timeline, runStatus]);

  const handleSend = React.useCallback(() => {
    const text = draft.trim();
    if (!text && pendingAttachments.length === 0) return;
    onSend({
      text: text || t("ai_chat.selection_only_message"),
      displayText: text,
      attachments:
        pendingAttachments.length > 0 ? pendingAttachments : undefined,
    });
    setDraft("");
    setPendingAttachments([]);
  }, [draft, onSend, pendingAttachments, t]);

  const handleActivateAttachment = React.useCallback(
    (attachment: AiChatSelectionAttachment) => {
      appEventBus.emit(
        "workspace:focusTextRange",
        {
          pageIndex: attachment.pageIndex,
          startOffset: attachment.startOffset,
          endOffset: attachment.endOffset,
          rect: attachment.rect,
          behavior: "auto",
        },
        { sticky: true },
      );
    },
    [],
  );

  const starterGroups = React.useMemo(
    () => [
      {
        id: "reading",
        title: t("ai_chat.starters.reading.title"),
        prompts: [
          t("ai_chat.starters.reading.current_page"),
          t("ai_chat.starters.reading.whole_document"),
        ],
      },
      {
        id: "search",
        title: t("ai_chat.starters.search.title"),
        prompts: [
          t("ai_chat.starters.search.keyword"),
          t("ai_chat.starters.search.jump"),
        ],
      },
      {
        id: "actions",
        title: t("ai_chat.starters.actions.title"),
        prompts: [
          t("ai_chat.starters.actions.highlight"),
          t("ai_chat.starters.actions.annotations"),
        ],
      },
    ],
    [t],
  );

  const canSend =
    !disabledReason &&
    (draft.trim().length > 0 || pendingAttachments.length > 0) &&
    runStatus !== "running" &&
    runStatus !== "cancelling";

  const actionIsStop = runStatus === "running" || runStatus === "cancelling";
  const showHeaderBadges = disabledReason === "no_document";
  const modelSelectPlaceholder =
    disabledReason === "no_model"
      ? t("ai_chat.disabled.no_model")
      : t("common.select");

  const footer = (
    <div
      className={cn(
        "border-input bg-background rounded-2xl border py-1 pr-1 pl-2 shadow-xs transition-[color,box-shadow]",
        "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
        (!!disabledReason || runStatus === "cancelling") &&
          "bg-muted/20 opacity-80",
      )}
    >
      {pendingAttachments.length > 0 ? (
        <div className="px-1 pb-1">
          <div className="flex flex-wrap gap-2">
            {pendingAttachments.map((attachment) => (
              <SelectionAttachmentChip
                key={getSelectionAttachmentKey(attachment)}
                t={t}
                attachment={attachment}
                onActivate={(nextAttachment) => {
                  void handleActivateAttachment(nextAttachment);
                }}
                onRemove={() =>
                  setPendingAttachments((prev) =>
                    prev.filter(
                      (item) =>
                        getSelectionAttachmentKey(item) !==
                        getSelectionAttachmentKey(attachment),
                    ),
                  )
                }
              />
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("ai_chat.input_placeholder")}
          disabled={!!disabledReason || runStatus === "cancelling"}
          className="max-h-[180px] min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent! px-1 py-1.5 shadow-none focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (actionIsStop) onStop();
              else handleSend();
            }
          }}
        />

        <Button
          type="button"
          size="icon"
          className="shrink-0 rounded-xl"
          variant={actionIsStop ? "outline" : "default"}
          onClick={actionIsStop ? onStop : handleSend}
          disabled={actionIsStop ? runStatus === "cancelling" : !canSend}
          aria-label={actionIsStop ? t("ai_chat.stop") : t("ai_chat.send")}
          title={actionIsStop ? t("ai_chat.stop") : t("ai_chat.send")}
        >
          {actionIsStop ? (
            runStatus === "cancelling" ? (
              <Spinner size="sm" />
            ) : (
              <Square size={14} />
            )
          ) : (
            <Send size={14} />
          )}
        </Button>
      </div>
    </div>
  );

  const isBusy = runStatus === "running" || runStatus === "cancelling";
  const isBlankConversation =
    timeline.length === 0 && runStatus === "idle" && !lastError;
  const isAwaitingFirstResponse = React.useMemo(() => {
    if (!isBusy) return false;

    const lastUserIndex = [...timeline]
      .map((item, index) =>
        item.kind === "message" && item.role === "user" ? index : -1,
      )
      .filter((index) => index >= 0)
      .at(-1);

    if (typeof lastUserIndex !== "number") return false;

    return !timeline.slice(lastUserIndex + 1).some((item) => {
      if (item.kind === "tool") return true;
      return (
        item.kind === "message" &&
        (item.role === "assistant" || item.role === "thinking")
      );
    });
  }, [isBusy, timeline]);
  const renderEntries = React.useMemo<TimelineRenderEntry[]>(() => {
    const entries: TimelineRenderEntry[] = [];

    for (let index = 0; index < timeline.length; index += 1) {
      const item = timeline[index]!;
      if (
        item.kind === "tool" &&
        item.isParallelBatch &&
        typeof item.batchId === "string"
      ) {
        const items: ToolTimelineItem[] = [item];
        let nextIndex = index + 1;

        while (nextIndex < timeline.length) {
          const nextItem = timeline[nextIndex]!;
          if (
            nextItem.kind !== "tool" ||
            !nextItem.isParallelBatch ||
            nextItem.batchId !== item.batchId
          ) {
            break;
          }
          items.push(nextItem);
          nextIndex += 1;
        }

        if (items.length > 1) {
          entries.push({
            kind: "tool_batch",
            id: `${item.batchId}:${item.id}`,
            items,
          });
          index = nextIndex - 1;
          continue;
        }
      }

      entries.push({ kind: "item", item });
    }

    return entries;
  }, [timeline]);

  const headerActions = (
    <>
      <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t("ai_chat.history")}
            disabled={isBusy}
          >
            <History size={18} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <PopoverHeader>
            <PopoverTitle>{t("ai_chat.sessions")}</PopoverTitle>
          </PopoverHeader>

          <div className="grid gap-1">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={cn(
                  "hover:bg-accent/50 flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors",
                  session.id === activeSessionId ? "bg-accent/40" : null,
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm"
                  onClick={() => {
                    onSelectSession(session.id);
                    setHistoryOpen(false);
                  }}
                >
                  {getSessionTitle(t, session)}
                </button>
                {session.id === activeSessionId ? (
                  <Badge variant="secondary" className="shrink-0">
                    {t("ai_chat.session_active")}
                  </Badge>
                ) : null}
                {session.title?.trim() ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={t("ai_chat.delete")}
                    disabled={isBusy}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDeleteConversation(session.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setHistoryOpen(false);
                setClearConfirmOpen(true);
              }}
              disabled={isBusy || timeline.length === 0}
            >
              <Trash2 size={14} />
              {t("ai_chat.clear")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onNewConversation}
        aria-label={t("ai_chat.new_chat")}
        disabled={isBusy || isBlankConversation}
      >
        <Plus size={18} />
      </Button>
    </>
  );

  const title = (
    <div className="flex min-w-0 shrink flex-wrap items-center gap-x-2 gap-y-1">
      <div className="flex min-w-0 shrink items-center gap-2">
        <MessageSquare size={18} className="shrink-0" />
        <span className="min-w-0 truncate">{t("ai_chat.title")}</span>
      </div>
      <div className="max-w-full min-w-0 shrink-0">
        <ModelSelect
          value={disabledReason === "no_model" ? undefined : selectedModelKey}
          onValueChange={onSelectModel}
          placeholder={modelSelectPlaceholder}
          groups={modelGroups}
          disabled={modelGroups.length === 0 || disabledReason === "no_model"}
          showSeparators={false}
          triggerSize="sm"
          triggerTitle={modelSelectPlaceholder}
          triggerClassName={cn(
            "h-7 max-w-full justify-start gap-2 rounded-full border-0 bg-background/80 px-2.5 shadow-none backdrop-blur-sm",
            "text-muted-foreground hover:bg-background focus-visible:border-transparent focus-visible:ring-0",
            "[&_svg]:text-muted-foreground",
          )}
        />
      </div>
    </div>
  );

  return (
    <PanelLayout
      isFloating={isFloating}
      isOpen={isOpen}
      onOpen={onOpen}
      onCollapse={onCollapse}
      onClose={onCollapse}
      title={title}
      headerActions={headerActions}
      width={width}
      onResize={onResize}
      footer={footer}
    >
      <div className="space-y-4">
        {showHeaderBadges ? (
          <div className="flex flex-wrap items-center gap-2">
            {disabledReason === "no_document" ? (
              <Badge variant="destructive">
                {t("ai_chat.disabled.no_document")}
              </Badge>
            ) : null}
          </div>
        ) : null}

        {lastError ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="pt-6">
              <div className="text-sm font-medium">
                {t("ai_chat.error_title")}
              </div>
              <div className="text-muted-foreground mt-1 text-sm">
                {lastError}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {timeline.length === 0 ? (
          <Card className="bg-muted/20 border-dashed">
            <CardContent className="pt-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Sparkles size={16} />
                {t("ai_chat.empty_title")}
              </div>
              <div className="text-muted-foreground mb-4 text-sm">
                {disabledReason === "no_document"
                  ? t("ai_chat.empty_no_document")
                  : disabledReason === "no_model"
                    ? t("ai_chat.empty_no_model")
                    : t("ai_chat.empty_desc")}
              </div>
              {!disabledReason ? (
                <Tabs defaultValue={starterGroups[0]?.id} className="gap-3">
                  <TabsList className="h-auto w-full justify-start rounded-xl p-1">
                    {starterGroups.map((group) => (
                      <TabsTrigger
                        key={group.id}
                        value={group.id}
                        className="min-w-0 flex-none px-3 text-xs sm:text-sm"
                      >
                        {group.title}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {starterGroups.map((group) => (
                    <TabsContent
                      key={group.id}
                      value={group.id}
                      className="mt-0 grid gap-2"
                    >
                      {group.prompts.map((prompt) => (
                        <PromptButton
                          key={prompt}
                          onClick={() => {
                            setDraft(prompt);
                            textareaRef.current?.focus();
                          }}
                        >
                          {prompt}
                        </PromptButton>
                      ))}
                    </TabsContent>
                  ))}
                </Tabs>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {timeline.length > 0 ? (
          <div className="space-y-2">
            {renderEntries.map((entry) => {
              if (entry.kind === "tool_batch") {
                return (
                  <Card
                    key={entry.id}
                    className="bg-background overflow-hidden"
                  >
                    <div className="divide-border/70 divide-y">
                      {entry.items.map((item) => (
                        <ToolTimelineCall
                          key={item.id}
                          item={item}
                          t={t}
                          grouped
                        />
                      ))}
                    </div>
                  </Card>
                );
              }

              const { item } = entry;

              if (item.kind === "message") {
                const isUser = item.role === "user";
                const isThinking = item.role === "thinking";
                const hasVisibleText = item.text.trim().length > 0;
                const selectionAttachments = isUser
                  ? (item.attachments?.filter(
                      (attachment) => attachment.kind === "workspace_selection",
                    ) ?? [])
                  : [];
                const hasSelectionAttachments = selectionAttachments.length > 0;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex",
                      isUser ? "justify-end" : "justify-start",
                    )}
                  >
                    {isThinking ? (
                      <ThinkingMessageBubble
                        text={item.text}
                        isStreaming={item.isStreaming}
                        thinkingLabel={t("ai_chat.thinking")}
                        completedLabel={formatThinkingDuration(
                          t,
                          item.durationMs,
                        )}
                      />
                    ) : hasSelectionAttachments && !hasVisibleText ? (
                      <div className="flex max-w-[88%] flex-col items-end gap-2">
                        {selectionAttachments.map((attachment, index) => (
                          <SelectionAttachmentChip
                            key={`${item.id}:attachment:${index}`}
                            t={t}
                            attachment={attachment}
                            onActivate={(nextAttachment) => {
                              void handleActivateAttachment(nextAttachment);
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "flex max-w-[88%] flex-col gap-2",
                          isUser ? "items-end" : "items-start",
                        )}
                      >
                        {isUser && hasSelectionAttachments ? (
                          <div className="space-y-2">
                            {selectionAttachments.map((attachment, index) => (
                              <SelectionAttachmentChip
                                key={`${item.id}:attachment:${index}`}
                                t={t}
                                attachment={attachment}
                                onActivate={(nextAttachment) => {
                                  void handleActivateAttachment(nextAttachment);
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                        <div
                          className={cn(
                            "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                            isUser
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground",
                          )}
                        >
                          {hasVisibleText ? item.text : null}
                          {!isUser && item.isStreaming ? (
                            <span className="ml-2 inline-flex align-middle">
                              <Spinner size="sm" />
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              return <ToolTimelineCall key={item.id} item={item} t={t} />;
            })}
            {isAwaitingFirstResponse ? (
              <PendingAssistantBubble label={t("ai_chat.responding")} />
            ) : null}
          </div>
        ) : null}

        <div ref={endRef} />
      </div>
      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("ai_chat.clear_confirm.title")}</DialogTitle>
            <DialogDescription>
              {t("ai_chat.clear_confirm.desc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                onClearConversation();
                setClearConfirmOpen(false);
              }}
            >
              {t("ai_chat.clear_confirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelLayout>
  );
}
