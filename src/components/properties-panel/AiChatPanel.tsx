import React from "react";
import {
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileText,
  GitBranch,
  History,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  AiChatSessionSummary,
  AiChatTimelineItem,
  AiChatUserMessageInput,
  AiChatSelectionAttachment,
} from "@/services/ai/chat/types";
import { TimeAgoText } from "@/components/timeText";
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
  onRegenerateMessage: (messageId: string) => Promise<void> | void;
  onRetryLastError: () => Promise<void> | void;
  onEditUserMessage: (messageId: string) => {
    text: string;
    attachments?: AiChatSelectionAttachment[];
    sourceSessionId: string;
    targetMessageId: string;
  } | null;
  onStop: () => void;
  disabledReason: "no_document" | "no_model" | null;
}

type TranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

type ToolTimelineItem = Extract<AiChatTimelineItem, { kind: "tool" }>;
type MessageTimelineItem = Extract<AiChatTimelineItem, { kind: "message" }>;
type UserMessageTimelineItem = MessageTimelineItem & { role: "user" };

type TimelineRenderEntry =
  | { kind: "item"; item: AiChatTimelineItem }
  | { kind: "tool_batch"; id: string; items: ToolTimelineItem[] };

const SESSION_TREE_BASE_PADDING_PX = 8;
const SESSION_TREE_INDENT_PX = 12;
const SESSION_TREE_GUIDE_OFFSET_PX = 10;

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

const getMessageCopyText = (item: MessageTimelineItem) => {
  if (item.role === "assistant") {
    return item.text.trim();
  }

  const selectionTexts =
    item.role === "user"
      ? (item.attachments ?? [])
          .filter((attachment) => attachment.kind === "workspace_selection")
          .map((attachment) => attachment.text.trim())
          .filter(Boolean)
      : [];

  return [item.text.trim(), ...selectionTexts].filter(Boolean).join("\n\n");
};

const getMessageBranchAnchorId = (item: MessageTimelineItem) =>
  item.branchAnchorId ?? item.id;

const getMessageBranchKind = (item: MessageTimelineItem) => {
  if (item.role === "user") return "edit" as const;
  if (item.role === "assistant") return "regenerate" as const;
  return undefined;
};

const isLastAssistantSegmentForTurn = (
  timeline: AiChatTimelineItem[],
  item: MessageTimelineItem,
) => {
  if (item.role !== "assistant") return true;
  const turnId = item.turnId ?? item.id;
  const currentIndex = timeline.findIndex(
    (timelineItem) =>
      timelineItem.kind === "message" && timelineItem.id === item.id,
  );
  if (currentIndex < 0) return true;

  return !timeline
    .slice(currentIndex + 1)
    .some(
      (timelineItem) =>
        timelineItem.kind === "message" &&
        timelineItem.role === "assistant" &&
        (timelineItem.turnId ?? timelineItem.id) === turnId,
    );
};

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

const MessageActionBar = ({
  align,
  copied,
  canEdit,
  canRegenerate,
  branchOptions,
  activeBranchSessionId,
  onSelectBranch,
  onCopy,
  onEdit,
  onRegenerate,
  t,
}: {
  align: "start" | "end";
  copied: boolean;
  canEdit?: boolean;
  canRegenerate?: boolean;
  branchOptions?: AiChatSessionSummary[];
  activeBranchSessionId?: string;
  onSelectBranch?: (sessionId: string) => void;
  onCopy: () => void;
  onEdit?: () => void;
  onRegenerate?: () => void;
  t: TranslateFn;
}) => (
  <div
    className={cn(
      "flex items-center gap-1",
      align === "end" ? "justify-end" : "justify-start",
    )}
  >
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground h-6 w-6"
          onClick={onCopy}
          aria-label={copied ? t("ai_chat.copied") : t("ai_chat.copy")}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {copied ? t("ai_chat.copied") : t("ai_chat.copy")}
      </TooltipContent>
    </Tooltip>
    {branchOptions && branchOptions.length > 1 && onSelectBranch ? (
      <DropdownMenu modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-6 w-6"
                aria-label={t("ai_chat.switch_branch")}
              >
                <GitBranch size={12} />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("ai_chat.switch_branch")}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align={align === "end" ? "end" : "start"}
          className="min-w-48"
        >
          <DropdownMenuRadioGroup
            value={activeBranchSessionId}
            onValueChange={onSelectBranch}
          >
            {branchOptions.map((session) => (
              <DropdownMenuRadioItem key={session.id} value={session.id}>
                <span className="flex min-w-0 flex-1 items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      {session.branchKind ? (
                        <GitBranch
                          size={12}
                          className="text-muted-foreground shrink-0"
                        />
                      ) : null}
                      <span className="min-w-0 truncate">
                        {getSessionTitle(t, session)}
                      </span>
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      <TimeAgoText time={session.updatedAt} />
                    </span>
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null}
    {canEdit && onEdit ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground h-6 w-6"
            onClick={onEdit}
            aria-label={t("ai_chat.edit")}
          >
            <Pencil size={12} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("ai_chat.edit")}</TooltipContent>
      </Tooltip>
    ) : null}
    {canRegenerate && onRegenerate ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground h-6 w-6"
            onClick={onRegenerate}
            aria-label={t("ai_chat.regenerate")}
          >
            <RotateCcw size={12} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("ai_chat.regenerate")}</TooltipContent>
      </Tooltip>
    ) : null}
  </div>
);

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
  onRegenerateMessage,
  onRetryLastError,
  onEditUserMessage,
  onStop,
  disabledReason,
}: AiChatPanelProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = React.useState("");
  const [pendingAttachments, setPendingAttachments] = React.useState<
    AiChatSelectionAttachment[]
  >([]);
  const [inlineEditState, setInlineEditState] = React.useState<{
    messageId: string;
    text: string;
    attachments: AiChatSelectionAttachment[];
    sourceSessionId: string;
    targetMessageId: string;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);
  const [copiedMessageId, setCopiedMessageId] = React.useState<string | null>(
    null,
  );
  const [expandedSessionIds, setExpandedSessionIds] = React.useState<
    Set<string>
  >(() => new Set());

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const inlineEditTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = React.useRef<HTMLElement | null>(null);
  const isNearBottomRef = React.useRef(true);
  const scrollRafRef = React.useRef<number | null>(null);
  const previousSessionIdRef = React.useRef<string | null>(null);
  const draftRef = React.useRef("");
  const inlineEditStateRef = React.useRef<typeof inlineEditState>(null);
  const copiedTimeoutRef = React.useRef<number | null>(null);

  const scheduleScrollToBottom = React.useCallback(
    (force = false) => {
      if (!isOpen) return;
      if (!force && !isNearBottomRef.current) return;
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
    },
    [isOpen],
  );

  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  React.useEffect(() => {
    inlineEditStateRef.current = inlineEditState;
  }, [inlineEditState]);

  React.useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    return appEventBus.on(
      "workspace:askAi",
      (attachment) => {
        appEventBus.clearSticky("workspace:askAi");
        if (attachment.kind !== "workspace_selection") return;
        if (!attachment.text.trim()) return;
        const nextFocusTarget =
          inlineEditStateRef.current !== null
            ? inlineEditTextareaRef
            : textareaRef;

        if (inlineEditStateRef.current) {
          setInlineEditState((prev) => {
            if (!prev) return prev;
            return prev.attachments.some(
              (item) =>
                getSelectionAttachmentKey(item) ===
                getSelectionAttachmentKey(attachment),
            )
              ? prev
              : {
                  ...prev,
                  attachments: [...prev.attachments, attachment],
                };
          });
        } else {
          setPendingAttachments((prev) =>
            prev.some(
              (item) =>
                getSelectionAttachmentKey(item) ===
                getSelectionAttachmentKey(attachment),
            )
              ? prev
              : [...prev, attachment],
          );
        }

        requestAnimationFrame(() => {
          const el = nextFocusTarget.current;
          if (!el) return;
          el.focus();
          const caret = el.value.length;
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
      setInlineEditState(null);
      scheduleScrollToBottom(true);
    }
  }, [activeSessionId, scheduleScrollToBottom]);

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
    scheduleScrollToBottom(true);
    scrollEl.addEventListener("scroll", update, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", update);
      if (scrollContainerRef.current === scrollEl) {
        scrollContainerRef.current = null;
      }
    };
  }, [isOpen, scheduleScrollToBottom]);

  React.useEffect(() => {
    scheduleScrollToBottom(false);
  }, [runStatus, scheduleScrollToBottom, timeline]);

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

  const focusTextareaAtEnd = React.useCallback(() => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const caret = draftRef.current.length;
      el.setSelectionRange(caret, caret);
    });
  }, []);

  const focusInlineEditTextareaAtEnd = React.useCallback(() => {
    requestAnimationFrame(() => {
      const el = inlineEditTextareaRef.current;
      if (!el) return;
      el.focus();
      const caret = el.value.length;
      el.setSelectionRange(caret, caret);
    });
  }, []);

  const handleCopyMessage = React.useCallback(
    async (item: MessageTimelineItem) => {
      const text = getMessageCopyText(item);
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopiedMessageId(item.id);
        if (copiedTimeoutRef.current) {
          window.clearTimeout(copiedTimeoutRef.current);
        }
        copiedTimeoutRef.current = window.setTimeout(() => {
          setCopiedMessageId(null);
          copiedTimeoutRef.current = null;
        }, 2000);
      } catch {
        // ignore
      }
    },
    [],
  );

  const handleEditUserMessage = React.useCallback(
    (item: UserMessageTimelineItem) => {
      const restored = onEditUserMessage(item.id);
      if (!restored) return;
      setInlineEditState({
        messageId: item.id,
        text: restored.text,
        attachments: (restored.attachments?.filter(
          (attachment) => attachment.kind === "workspace_selection",
        ) ?? []) as AiChatSelectionAttachment[],
        sourceSessionId: restored.sourceSessionId,
        targetMessageId: restored.targetMessageId,
      });
      focusInlineEditTextareaAtEnd();
    },
    [focusInlineEditTextareaAtEnd, onEditUserMessage],
  );

  const handleInlineEditSubmit = React.useCallback(() => {
    if (!inlineEditState) return;
    const text = inlineEditState.text.trim();
    if (!text && inlineEditState.attachments.length === 0) return;
    onSend({
      text: text || t("ai_chat.selection_only_message"),
      displayText: text,
      attachments:
        inlineEditState.attachments.length > 0
          ? inlineEditState.attachments
          : undefined,
      editContext: {
        sourceSessionId: inlineEditState.sourceSessionId,
        targetMessageId: inlineEditState.targetMessageId,
      },
    });
    setInlineEditState(null);
  }, [inlineEditState, onSend, t]);

  const handleCancelInlineEdit = React.useCallback(() => {
    setInlineEditState(null);
    focusTextareaAtEnd();
  }, [focusTextareaAtEnd]);

  const handleRemoveInlineEditAttachment = React.useCallback(
    (attachment: AiChatSelectionAttachment) => {
      setInlineEditState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          attachments: prev.attachments.filter(
            (item) =>
              getSelectionAttachmentKey(item) !==
              getSelectionAttachmentKey(attachment),
          ),
        };
      });
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
    !inlineEditState &&
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
          disabled={
            !!disabledReason || runStatus === "cancelling" || !!inlineEditState
          }
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
  const sessionTree = React.useMemo(() => {
    const sessionById = new Map(
      sessions.map((session) => [session.id, session]),
    );
    const childrenByParentId = new Map<string, AiChatSessionSummary[]>();
    const roots: AiChatSessionSummary[] = [];
    const orderIndexById = new Map(
      sessions.map((session, index) => [session.id, index]),
    );

    for (const session of sessions) {
      const parentSessionId = session.parentSessionId;
      if (parentSessionId && sessionById.has(parentSessionId)) {
        const siblings = childrenByParentId.get(parentSessionId) ?? [];
        siblings.push(session);
        childrenByParentId.set(parentSessionId, siblings);
        continue;
      }
      roots.push(session);
    }

    const subtreeRankCache = new Map<string, number>();
    const getSubtreeRank = (sessionId: string): number => {
      const cached = subtreeRankCache.get(sessionId);
      if (typeof cached === "number") return cached;

      let rank = orderIndexById.get(sessionId) ?? Number.MAX_SAFE_INTEGER;
      for (const child of childrenByParentId.get(sessionId) ?? []) {
        rank = Math.min(rank, getSubtreeRank(child.id));
      }
      subtreeRankCache.set(sessionId, rank);
      return rank;
    };

    const sortNodes = (items: AiChatSessionSummary[]) =>
      [...items].sort((a, b) => {
        const rankDiff = getSubtreeRank(a.id) - getSubtreeRank(b.id);
        if (rankDiff !== 0) return rankDiff;
        return b.updatedAt.localeCompare(a.updatedAt);
      });

    const sortedChildrenByParentId = new Map<string, AiChatSessionSummary[]>();
    for (const [parentId, children] of childrenByParentId.entries()) {
      sortedChildrenByParentId.set(parentId, sortNodes(children));
    }
    const sortedRoots = sortNodes(roots);

    const flattened: Array<{ session: AiChatSessionSummary; depth: number }> =
      [];
    const visit = (session: AiChatSessionSummary, depth: number) => {
      flattened.push({ session, depth });
      for (const child of sortedChildrenByParentId.get(session.id) ?? []) {
        visit(child, depth + 1);
      }
    };

    for (const root of sortedRoots) {
      visit(root, 0);
    }

    return {
      orderedSessions: flattened,
      roots: sortedRoots,
      childrenByParentId: sortedChildrenByParentId,
      sessionSummaryById: sessionById,
    };
  }, [sessions]);
  const sessionSummaryById = sessionTree.sessionSummaryById;
  const activeExpandedAncestorIds = React.useMemo(() => {
    const ids = new Set<string>();
    let cursorId = sessionSummaryById.get(activeSessionId)?.parentSessionId;
    while (cursorId) {
      ids.add(cursorId);
      cursorId = sessionSummaryById.get(cursorId)?.parentSessionId;
    }
    return ids;
  }, [activeSessionId, sessionSummaryById]);
  const visibleOrderedSessions = React.useMemo(() => {
    const visible: Array<{
      session: AiChatSessionSummary;
      depth: number;
      hasChildren: boolean;
      isExpanded: boolean;
      isLastSibling: boolean;
      ancestorHasNextSiblings: boolean[];
    }> = [];

    const visit = (
      session: AiChatSessionSummary,
      depth: number,
      ancestorHasNextSiblings: boolean[],
      isLastSibling: boolean,
    ) => {
      const children = sessionTree.childrenByParentId.get(session.id) ?? [];
      const hasChildren = children.length > 0;
      const isExpanded =
        expandedSessionIds.has(session.id) ||
        activeExpandedAncestorIds.has(session.id);

      visible.push({
        session,
        depth,
        hasChildren,
        isExpanded,
        isLastSibling,
        ancestorHasNextSiblings,
      });

      if (!hasChildren || !isExpanded) return;
      for (const [childIndex, child] of children.entries()) {
        visit(
          child,
          depth + 1,
          depth > 0
            ? [...ancestorHasNextSiblings, !isLastSibling]
            : ancestorHasNextSiblings,
          childIndex === children.length - 1,
        );
      }
    };

    for (const [rootIndex, root] of sessionTree.roots.entries()) {
      visit(root, 0, [], rootIndex === sessionTree.roots.length - 1);
    }

    return visible;
  }, [activeExpandedAncestorIds, expandedSessionIds, sessionTree]);
  const orderedSessionIds = React.useMemo(
    () => sessionTree.orderedSessions.map(({ session }) => session.id),
    [sessionTree],
  );
  const getRootSessionId = React.useCallback(
    (sessionId: string) => {
      let cursorId: string | undefined = sessionId;
      let rootId = sessionId;
      while (cursorId) {
        rootId = cursorId;
        cursorId = sessionSummaryById.get(cursorId)?.parentSessionId;
      }
      return rootId;
    },
    [sessionSummaryById],
  );
  const getAssistantUserContextAnchorId = React.useCallback(
    (item: MessageTimelineItem) => {
      if (item.role !== "assistant") return undefined;
      const activeSession = sessionSummaryById.get(activeSessionId);
      if (
        activeSession?.branchKind === "regenerate" &&
        activeSession.branchContextUserMessageId
      ) {
        return activeSession.branchContextUserMessageId;
      }
      const assistantIndex = timeline.findIndex(
        (timelineItem) =>
          timelineItem.kind === "message" &&
          timelineItem.role === "assistant" &&
          timelineItem.id === item.id,
      );
      if (assistantIndex < 0) return undefined;

      for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        const timelineItem = timeline[index];
        if (timelineItem?.kind === "message" && timelineItem.role === "user") {
          return timelineItem.id;
        }
      }

      return activeSession?.branchContextUserMessageId;
    },
    [activeSessionId, sessionSummaryById, timeline],
  );
  const getAssistantBaseSessionId = React.useCallback(
    (assistantAnchorId: string, userContextAnchorId: string) => {
      let baseSessionId = activeSessionId;

      while (true) {
        const session = sessionSummaryById.get(baseSessionId);
        if (
          !session ||
          session.branchKind !== "regenerate" ||
          session.branchSourceMessageId !== assistantAnchorId ||
          session.branchContextUserMessageId !== userContextAnchorId ||
          !session.parentSessionId
        ) {
          return baseSessionId;
        }
        baseSessionId = session.parentSessionId;
      }
    },
    [activeSessionId, sessionSummaryById],
  );
  const getBranchOptions = React.useCallback(
    (item: MessageTimelineItem) => {
      const branchKind = getMessageBranchKind(item);
      if (!branchKind) return [];
      const anchorId = getMessageBranchAnchorId(item);
      const assistantUserContextAnchorId =
        branchKind === "regenerate"
          ? getAssistantUserContextAnchorId(item)
          : undefined;
      const candidateIds = new Set<string>();

      if (branchKind === "edit") {
        candidateIds.add(getRootSessionId(activeSessionId));
      } else {
        if (!assistantUserContextAnchorId) return [];
        candidateIds.add(
          getAssistantBaseSessionId(anchorId, assistantUserContextAnchorId),
        );
      }

      for (const session of sessions) {
        if (
          session.branchSourceMessageId === anchorId &&
          session.branchKind === branchKind &&
          (branchKind === "edit" ||
            session.branchContextUserMessageId === assistantUserContextAnchorId)
        ) {
          candidateIds.add(session.id);
        }
      }

      return orderedSessionIds
        .filter((sessionId) => candidateIds.has(sessionId))
        .map((sessionId) => sessionSummaryById.get(sessionId))
        .filter(Boolean) as AiChatSessionSummary[];
    },
    [
      activeSessionId,
      getAssistantBaseSessionId,
      getAssistantUserContextAnchorId,
      getRootSessionId,
      orderedSessionIds,
      sessionSummaryById,
      sessions,
    ],
  );
  const getSelectedBranchOptionId = React.useCallback(
    (branchOptions: AiChatSessionSummary[]) => {
      const optionIds = new Set(branchOptions.map((session) => session.id));
      let cursorId: string | undefined = activeSessionId;
      while (cursorId) {
        if (optionIds.has(cursorId)) return cursorId;
        cursorId = sessionSummaryById.get(cursorId)?.parentSessionId;
      }
      return branchOptions[0]?.id;
    },
    [activeSessionId, sessionSummaryById],
  );
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

          <div className="grid gap-0.5">
            {visibleOrderedSessions.map(
              ({
                session,
                depth,
                hasChildren,
                isExpanded,
                isLastSibling,
                ancestorHasNextSiblings,
              }) => (
                <div
                  key={session.id}
                  className={cn(
                    "hover:bg-accent/50 relative grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
                    session.id === activeSessionId ? "bg-accent/40" : null,
                  )}
                  style={{
                    paddingLeft: `${SESSION_TREE_BASE_PADDING_PX + depth * SESSION_TREE_INDENT_PX}px`,
                  }}
                >
                  {hasChildren && isExpanded ? (
                    <span
                      className="bg-border/70 pointer-events-none absolute w-px"
                      style={{
                        left: `${SESSION_TREE_BASE_PADDING_PX + depth * SESSION_TREE_INDENT_PX + SESSION_TREE_GUIDE_OFFSET_PX}px`,
                        top: "50%",
                        bottom: "-2px",
                      }}
                    />
                  ) : null}
                  {depth > 0 ? (
                    <div className="pointer-events-none absolute inset-y-0 left-0">
                      {ancestorHasNextSiblings.map((hasNextSibling, level) =>
                        hasNextSibling ? (
                          <span
                            key={`${session.id}:guide:${level}`}
                            className="bg-border/70 absolute top-0 bottom-0 w-px"
                            style={{
                              left: `${SESSION_TREE_BASE_PADDING_PX + level * SESSION_TREE_INDENT_PX + SESSION_TREE_GUIDE_OFFSET_PX}px`,
                            }}
                          />
                        ) : null,
                      )}
                      <span
                        className="bg-border/70 absolute w-px"
                        style={{
                          left: `${SESSION_TREE_BASE_PADDING_PX + (depth - 1) * SESSION_TREE_INDENT_PX + SESSION_TREE_GUIDE_OFFSET_PX}px`,
                          top: 0,
                          height: isLastSibling ? "50%" : "100%",
                        }}
                      />
                      <span
                        className="bg-border/70 absolute h-px"
                        style={{
                          left: `${SESSION_TREE_BASE_PADDING_PX + (depth - 1) * SESSION_TREE_INDENT_PX + SESSION_TREE_GUIDE_OFFSET_PX}px`,
                          top: "50%",
                          width: `${SESSION_TREE_INDENT_PX}px`,
                        }}
                      />
                    </div>
                  ) : null}
                  {hasChildren ? (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm"
                      aria-label={
                        isExpanded ? t("common.collapse") : t("common.expand")
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setExpandedSessionIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(session.id)) next.delete(session.id);
                          else next.add(session.id);
                          return next;
                        });
                      }}
                    >
                      <ChevronDown
                        size={12}
                        className={cn(
                          "transition-transform",
                          !isExpanded && "-rotate-90",
                        )}
                      />
                    </button>
                  ) : (
                    <span className="h-5 w-5 shrink-0" />
                  )}
                  <button
                    type="button"
                    className="grid min-w-0 overflow-hidden text-left"
                    onClick={() => {
                      onSelectSession(session.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 overflow-hidden text-sm">
                      {depth > 0 ? (
                        <GitBranch
                          size={11}
                          className="text-muted-foreground shrink-0"
                        />
                      ) : null}
                      <span className="block min-w-0 truncate">
                        {getSessionTitle(t, session)}
                      </span>
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-[11px]">
                      <TimeAgoText time={session.updatedAt} />
                    </span>
                  </button>
                  {session.id === activeSessionId ? (
                    <Badge
                      variant="secondary"
                      className="h-4 shrink-0 px-1 text-[10px]"
                    >
                      {t("ai_chat.session_active")}
                    </Badge>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    aria-label={t("ai_chat.delete")}
                    disabled={isBusy}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDeleteConversation(session.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ),
            )}
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
        disabled={isBusy}
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
                  <TabsList className="flex h-auto flex-wrap justify-start rounded-xl p-1">
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
                            setInlineEditState(null);
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
                const userMessage = isUser
                  ? (item as UserMessageTimelineItem)
                  : null;
                const hasVisibleText = item.text.trim().length > 0;
                const branchOptions = getBranchOptions(item);
                const selectedBranchOptionId =
                  branchOptions.length > 0
                    ? getSelectedBranchOptionId(branchOptions)
                    : undefined;
                const isLastAssistantSegment =
                  item.role === "assistant"
                    ? isLastAssistantSegmentForTurn(timeline, item)
                    : true;
                const isInlineEditingThisMessage =
                  inlineEditState?.messageId === item.id;
                const selectionAttachments = userMessage
                  ? (userMessage.attachments?.filter(
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
                    ) : (
                      <div
                        className={cn(
                          "flex max-w-[88%] flex-col gap-2",
                          isUser ? "items-end" : "items-start",
                        )}
                      >
                        {isUser &&
                        hasSelectionAttachments &&
                        !isInlineEditingThisMessage ? (
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
                        {isUser && isInlineEditingThisMessage ? (
                          <div className="bg-primary text-primary-foreground flex w-full min-w-0 flex-col gap-1.5 rounded-lg px-3 py-[7px]">
                            {inlineEditState.attachments.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {inlineEditState.attachments.map(
                                  (attachment) => (
                                    <SelectionAttachmentChip
                                      key={getSelectionAttachmentKey(
                                        attachment,
                                      )}
                                      t={t}
                                      attachment={attachment}
                                      inverted
                                      onActivate={(nextAttachment) => {
                                        void handleActivateAttachment(
                                          nextAttachment,
                                        );
                                      }}
                                      onRemove={() => {
                                        handleRemoveInlineEditAttachment(
                                          attachment,
                                        );
                                      }}
                                    />
                                  ),
                                )}
                              </div>
                            ) : null}
                            <Textarea
                              ref={inlineEditTextareaRef}
                              rows={1}
                              value={inlineEditState.text}
                              onChange={(event) =>
                                setInlineEditState((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        text: event.target.value,
                                      }
                                    : prev,
                                )
                              }
                              placeholder={t("ai_chat.input_placeholder")}
                              className="text-primary-foreground placeholder:text-primary-foreground/60 field-sizing-content max-h-[180px] min-h-0 resize-none overflow-y-auto border-0 bg-transparent! px-0 py-px shadow-none focus-visible:ring-0"
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                  event.preventDefault();
                                  handleInlineEditSubmit();
                                }
                              }}
                            />
                            <div className="flex items-center justify-end gap-1 py-px">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground h-6 w-6 rounded-md"
                                onClick={handleCancelInlineEdit}
                                aria-label={t("ai_chat.cancel_edit")}
                              >
                                <X size={13} />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                className="bg-primary-foreground/12 text-primary-foreground hover:bg-primary-foreground/18 h-6 w-6 rounded-md"
                                onClick={handleInlineEditSubmit}
                                disabled={
                                  inlineEditState.text.trim().length === 0 &&
                                  inlineEditState.attachments.length === 0
                                }
                                aria-label={t("ai_chat.send")}
                              >
                                <Send size={13} />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {hasVisibleText || (!isUser && item.isStreaming) ? (
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
                            ) : null}
                            <MessageActionBar
                              align={isUser ? "end" : "start"}
                              copied={copiedMessageId === item.id}
                              branchOptions={
                                !isUser && !isLastAssistantSegment
                                  ? []
                                  : branchOptions
                              }
                              activeBranchSessionId={selectedBranchOptionId}
                              onSelectBranch={(sessionId) => {
                                onSelectSession(sessionId);
                              }}
                              canEdit={isUser && !isBusy}
                              canRegenerate={
                                !isUser &&
                                isLastAssistantSegment &&
                                !item.isStreaming &&
                                !isBusy
                              }
                              onCopy={() => {
                                void handleCopyMessage(item);
                              }}
                              onEdit={
                                userMessage
                                  ? () => {
                                      handleEditUserMessage(userMessage);
                                    }
                                  : undefined
                              }
                              onRegenerate={
                                !isUser
                                  ? () => {
                                      void onRegenerateMessage(item.id);
                                    }
                                  : undefined
                              }
                              t={t}
                            />
                          </>
                        )}
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

        {lastError ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-3 pt-6">
              <div className="text-sm font-medium">
                {t("ai_chat.error_title")}
              </div>
              <div className="text-muted-foreground mt-1 text-sm">
                {lastError}
              </div>
              <div className="mt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    runStatus === "running" || runStatus === "cancelling"
                  }
                  onClick={() => {
                    void onRetryLastError();
                  }}
                >
                  <RotateCcw size={14} />
                  {t("ai_chat.retry")}
                </Button>
              </div>
            </CardContent>
          </Card>
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
