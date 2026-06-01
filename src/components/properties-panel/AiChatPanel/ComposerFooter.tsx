import { Send, Square } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import type {
  AiChatMessageAttachment,
  AiChatTokenUsageSummary,
} from "@/services/ai/chat/types";
import type { AiReasoningLevel, AiReasoningLevelControl } from "@/services/ai";
import { MessageAttachmentChip } from "./MessagePrimitives";
import { cn } from "@/utils/cn";
import { getMessageAttachmentKey } from "./utils";

interface ComposerFooterProps {
  draft: string;
  onDraftChange: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  pendingAttachments: AiChatMessageAttachment[];
  onActivateAttachment: (attachment: AiChatMessageAttachment) => void;
  onRemoveAttachment: (attachment: AiChatMessageAttachment) => void;
  onSend: () => void;
  onStop: () => void;
  canSend: boolean;
  actionIsStop: boolean;
  runStatus: "idle" | "running" | "cancelling" | "error";
  disabledReason: "no_document" | "no_model" | null;
  inlineEditActive: boolean;
  formatTokenCount: (value: number) => string;
  contextTokens: number;
  tokenUsage: AiChatTokenUsageSummary;
  isContextCompressionRunning: boolean;
  reasoningLevelControl: AiReasoningLevelControl;
  onReasoningLevelChange: (level: AiReasoningLevel) => void;
}

export function ComposerFooter({
  draft,
  onDraftChange,
  textareaRef,
  pendingAttachments,
  onActivateAttachment,
  onRemoveAttachment,
  onSend,
  onStop,
  canSend,
  actionIsStop,
  runStatus,
  disabledReason,
  inlineEditActive,
  formatTokenCount,
  contextTokens,
  tokenUsage,
  isContextCompressionRunning,
  reasoningLevelControl,
  onReasoningLevelChange,
}: ComposerFooterProps) {
  const { t } = useLanguage();
  const showReasoningLevelSelect = reasoningLevelControl.showSelect;
  const getReasoningLevelLabel = (level: AiReasoningLevel) =>
    t(`ai_chat.reasoning_levels.${level}`);

  return (
    <div className="space-y-2">
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
                <MessageAttachmentChip
                  key={getMessageAttachmentKey(attachment)}
                  attachment={attachment}
                  onActivate={(nextAttachment) => {
                    onActivateAttachment(nextAttachment);
                  }}
                  onRemove={() => onRemoveAttachment(attachment)}
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
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={t("ai_chat.input_placeholder")}
            disabled={
              !!disabledReason || runStatus === "cancelling" || inlineEditActive
            }
            className="scrollbar-thumb-border hover:scrollbar-thumb-foreground/30 max-h-45 min-h-0 flex-1 resize-none scrollbar-thin overflow-y-auto border-0 bg-transparent! px-1 py-1.5 shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (actionIsStop) onStop();
                else onSend();
              }
            }}
          />

          <Button
            type="button"
            size="icon"
            className="shrink-0 rounded-xl"
            variant={actionIsStop ? "outline" : "default"}
            onClick={actionIsStop ? onStop : onSend}
            disabled={actionIsStop ? runStatus === "cancelling" : !canSend}
            aria-label={
              actionIsStop ? t("common.actions.stop") : t("common.actions.send")
            }
            title={
              actionIsStop ? t("common.actions.stop") : t("common.actions.send")
            }
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

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px]">
        {showReasoningLevelSelect && (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">{t("ai_chat.reasoning_level")}</span>
            <Select
              value={reasoningLevelControl.selectedLevel}
              onValueChange={(value) => {
                const nextLevel = reasoningLevelControl.levels.find(
                  (level) => level === value,
                );
                if (nextLevel) onReasoningLevelChange(nextLevel);
              }}
              disabled={actionIsStop || !!disabledReason}
            >
              <SelectTrigger
                size="sm"
                className={cn(
                  "text-muted-foreground h-4! max-w-32 rounded-full border-0 bg-transparent px-1 text-[11px] shadow-none",
                  "hover:bg-muted/60! bg-transparent! focus-visible:ring-0",
                )}
                title={t("ai_chat.reasoning_level")}
              >
                <SelectValue>
                  {getReasoningLevelLabel(reasoningLevelControl.selectedLevel)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {reasoningLevelControl.levels.map((level) => (
                  <SelectItem
                    key={level}
                    value={level}
                    itemText={getReasoningLevelLabel(level)}
                  >
                    {getReasoningLevelLabel(level)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="ml-auto flex gap-2">
          <span>
            {t("ai_chat.token_usage_context")} {formatTokenCount(contextTokens)}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help underline decoration-dotted underline-offset-2">
                {t("ai_chat.token_usage_total")}{" "}
                {formatTokenCount(tokenUsage.totalTokens)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <div>
                {t("ai_chat.token_usage_input")}{" "}
                {formatTokenCount(tokenUsage.inputTokens)}
              </div>
              <div>
                {t("ai_chat.token_usage_output")}{" "}
                {formatTokenCount(tokenUsage.outputTokens)}
              </div>
            </TooltipContent>
          </Tooltip>
          {isContextCompressionRunning && (
            <span className="flex items-center gap-1.5">
              <Spinner size="sm" />
              <span>{t("ai_chat.context_compression_running")}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
