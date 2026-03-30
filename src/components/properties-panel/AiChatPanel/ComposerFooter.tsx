import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { TranslateFn } from "./types";
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
  t: TranslateFn;
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
  t,
}: ComposerFooterProps) {
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
                  t={t}
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
            className="max-h-[180px] min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent! px-1 py-1.5 shadow-none focus-visible:ring-0"
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
        <span className="font-medium">{t("ai_chat.token_usage")}</span>
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
        {isContextCompressionRunning ? (
          <span className="flex items-center gap-1.5">
            <Spinner size="sm" />
            <span>{t("ai_chat.context_compression_running")}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
