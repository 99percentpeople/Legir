import React from "react";
import {
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileText,
  GitBranch,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { TimeAgoText } from "@/components/timeText";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StreamingCursor } from "@/components/ui/streaming-cursor";
import { cn } from "@/utils/cn";
import { useStickyBottomScroll } from "../useStickyBottomScroll";
import type { TranslateFn } from "./types";
import { getMessageAttachmentLocationLabel, getSessionTitle } from "./utils";
import type {
  AiChatMessageAttachment,
  AiChatSessionSummary,
} from "@/services/ai/chat/types";

export const PromptButton = ({
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

export const MessageAttachmentChip = ({
  t,
  attachment,
  onRemove,
  onActivate,
  inverted = false,
}: {
  t: TranslateFn;
  attachment: AiChatMessageAttachment;
  onRemove?: () => void;
  onActivate?: (attachment: AiChatMessageAttachment) => void;
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
      title={getMessageAttachmentLocationLabel(t, attachment)}
      onClick={() => {
        onActivate?.(attachment);
      }}
    >
      <FileText size={12} className="shrink-0 opacity-70" />
      <span className="truncate">
        {getMessageAttachmentLocationLabel(t, attachment)}
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

export const ThinkingMessageBubble = ({
  text,
  isStreaming,
  showCollapsedPreview,
  thinkingLabel,
  completedLabel,
}: {
  text: string;
  isStreaming?: boolean;
  showCollapsedPreview?: boolean;
  thinkingLabel: string;
  completedLabel: string;
}) => {
  const [open, setOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const showPreview = Boolean(isStreaming && text && showCollapsedPreview);
  const useWideLayout = open || showPreview;
  const { scrollToBottom } = useStickyBottomScroll(contentRef, {
    enabled: open,
  });

  React.useLayoutEffect(() => {
    if (!open || !isStreaming) return;
    scrollToBottom(false);
  }, [open, isStreaming, scrollToBottom, text]);

  React.useEffect(() => {
    if (!open) return;
    scrollToBottom(true);
  }, [open, scrollToBottom]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("max-w-[88%] min-w-0", useWideLayout ? "w-full" : "w-fit")}
    >
      <div className="border-border/70 bg-muted/80 text-muted-foreground min-w-0 rounded-lg border border-dashed px-3 py-2 backdrop-blur-md">
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
              className="max-h-64 overflow-auto pr-1 text-sm break-words whitespace-pre-wrap"
            >
              {text}
            </div>
          </CollapsibleContent>
        ) : showPreview ? (
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

export const PendingAssistantBubble = () => (
  <div className="flex justify-start">
    <div className="inline-flex max-w-[88%] items-center px-3 py-2 text-sm">
      <StreamingCursor />
    </div>
  </div>
);

export const MessageActionBar = ({
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
          aria-label={copied ? t("ai_chat.copied") : t("common.actions.copy")}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {copied ? t("ai_chat.copied") : t("common.actions.copy")}
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
            aria-label={t("common.actions.edit")}
          >
            <Pencil size={12} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("common.actions.edit")}
        </TooltipContent>
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
            aria-label={t("common.actions.regenerate")}
          >
            <RotateCcw size={12} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("common.actions.regenerate")}
        </TooltipContent>
      </Tooltip>
    ) : null}
  </div>
);
