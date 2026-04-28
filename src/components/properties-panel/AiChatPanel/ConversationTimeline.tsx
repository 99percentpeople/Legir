import React from "react";
import { Send, X } from "lucide-react";
import { StreamMarkdown } from "@/components/markdown/StreamMarkdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { StreamingCursor } from "@/components/ui/streaming-cursor";
import { cn } from "@/utils/cn";
import type {
  AiChatMessageAttachment,
  AiDocumentLinkTarget,
  AiChatSessionSummary,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";
import {
  type InlineEditState,
  type MessageTimelineItem,
  type TimelineRenderEntry,
  type TranslateFn,
  type UserMessageTimelineItem,
} from "./types";
import {
  formatThinkingDuration,
  getMessageAttachmentKey,
  getMessageBranchAnchorId,
  getMessageBranchKind,
  isLastAssistantSegmentForTurn,
} from "./utils";
import {
  MessageActionBar,
  MessageAttachmentChip,
  PendingAssistantBubble,
  ThinkingMessageBubble,
} from "./MessagePrimitives";
import { ToolTimelineCall } from "./ToolTimeline";

interface ConversationTimelineProps {
  timeline: AiChatTimelineItem[];
  sessions: AiChatSessionSummary[];
  activeSessionId: string;
  inlineEditState: InlineEditState | null;
  inlineEditTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  copiedMessageId: string | null;
  isBusy: boolean;
  endRef: React.RefObject<HTMLDivElement | null>;
  onSelectSession: (sessionId: string) => void;
  onCopyMessage: (item: MessageTimelineItem) => void | Promise<void>;
  onEditUserMessage: (item: UserMessageTimelineItem) => void;
  onRegenerateMessage: (messageId: string) => void | Promise<void>;
  onOpenDocumentLink: (target: AiDocumentLinkTarget) => void;
  onActivateAttachment: (attachment: AiChatMessageAttachment) => void;
  onInlineEditChange: (value: string) => void;
  onInlineEditSubmit: () => void;
  onCancelInlineEdit: () => void;
  onRemoveInlineEditAttachment: (attachment: AiChatMessageAttachment) => void;
  t: TranslateFn;
}

export function ConversationTimeline({
  timeline,
  sessions,
  activeSessionId,
  inlineEditState,
  inlineEditTextareaRef,
  copiedMessageId,
  isBusy,
  endRef,
  onSelectSession,
  onCopyMessage,
  onEditUserMessage,
  onRegenerateMessage,
  onOpenDocumentLink,
  onActivateAttachment,
  onInlineEditChange,
  onInlineEditSubmit,
  onCancelInlineEdit,
  onRemoveInlineEditAttachment,
  t,
}: ConversationTimelineProps) {
  const sessionSummaryById = React.useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const orderedSessionIds = React.useMemo(
    () => sessions.map((session) => session.id),
    [sessions],
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
        const items = [item];
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

  return (
    <div className="space-y-2">
      {renderEntries.map((entry) => {
        if (entry.kind === "tool_batch") {
          return (
            <Card key={entry.id} className="bg-background overflow-hidden">
              <div className="divide-border/70 divide-y">
                {entry.items.map((item) => (
                  <ToolTimelineCall key={item.id} item={item} t={t} grouped />
                ))}
              </div>
            </Card>
          );
        }

        const { item } = entry;
        if (item.kind !== "message") {
          return <ToolTimelineCall key={item.id} item={item} t={t} />;
        }

        const isUser = item.role === "user";
        const isThinking = item.role === "thinking";
        const userMessage = isUser ? (item as UserMessageTimelineItem) : null;
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
        const messageAttachments = userMessage?.attachments ?? [];
        const hasMessageAttachments = messageAttachments.length > 0;

        return (
          <div
            key={item.id}
            className={cn(
              "flex",
              isThinking && item.isStreaming && "sticky top-0 z-10 items-start",
              isUser ? "justify-end" : "justify-start",
            )}
          >
            {isThinking ? (
              <ThinkingMessageBubble
                text={item.text}
                isStreaming={item.isStreaming}
                showCollapsedPreview={item.showCollapsedPreview}
                thinkingLabel={t("ai_chat.thinking")}
                completedLabel={formatThinkingDuration(t, item.durationMs)}
              />
            ) : (
              <div
                className={cn(
                  "flex min-w-0 flex-col gap-2",
                  isUser ? "max-w-[90%] items-end" : "w-full items-start",
                )}
              >
                {isUser &&
                hasMessageAttachments &&
                !isInlineEditingThisMessage ? (
                  <div className="space-y-2">
                    {messageAttachments.map((attachment, index) => (
                      <MessageAttachmentChip
                        key={`${item.id}:attachment:${index}:${getMessageAttachmentKey(attachment)}`}
                        t={t}
                        attachment={attachment}
                        onActivate={(nextAttachment) => {
                          onActivateAttachment(nextAttachment);
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                {isUser && isInlineEditingThisMessage ? (
                  <div className="bg-primary text-primary-foreground flex w-full min-w-0 flex-col gap-1.5 rounded-lg px-3 py-[7px]">
                    {inlineEditState.attachments.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {inlineEditState.attachments.map((attachment) => (
                          <MessageAttachmentChip
                            key={getMessageAttachmentKey(attachment)}
                            t={t}
                            attachment={attachment}
                            inverted
                            onActivate={(nextAttachment) => {
                              onActivateAttachment(nextAttachment);
                            }}
                            onRemove={() => {
                              onRemoveInlineEditAttachment(attachment);
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                    <Textarea
                      ref={inlineEditTextareaRef}
                      rows={1}
                      value={inlineEditState.text}
                      onChange={(event) =>
                        onInlineEditChange(event.target.value)
                      }
                      placeholder={t("ai_chat.input_placeholder")}
                      className="text-primary-foreground placeholder:text-primary-foreground/60 field-sizing-content max-h-[180px] min-h-0 resize-none overflow-y-auto border-0 bg-transparent! px-0 py-px shadow-none focus-visible:ring-0"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          onInlineEditSubmit();
                        }
                      }}
                    />
                    <div className="flex items-center justify-end gap-1 py-px">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground h-6 w-6 rounded-md"
                        onClick={onCancelInlineEdit}
                        aria-label={t("common.actions.cancel")}
                      >
                        <X size={13} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        className="bg-primary-foreground/12 text-primary-foreground hover:bg-primary-foreground/18 h-6 w-6 rounded-md"
                        onClick={onInlineEditSubmit}
                        disabled={
                          inlineEditState.text.trim().length === 0 &&
                          inlineEditState.attachments.length === 0
                        }
                        aria-label={t("common.actions.send")}
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
                          "max-w-full min-w-0 rounded-lg px-3 py-2 text-sm",
                          isUser
                            ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                            : "text-foreground w-full",
                        )}
                      >
                        {hasVisibleText ? (
                          isUser ? (
                            <p className="whitespace-pre-wrap">{item.text}</p>
                          ) : (
                            <StreamMarkdown
                              source={item.text}
                              streaming={item.isStreaming}
                              trailing={
                                item.isStreaming ? (
                                  <StreamingCursor />
                                ) : undefined
                              }
                              className="w-full"
                              onOpenDocumentLink={onOpenDocumentLink}
                            />
                          )
                        ) : null}
                        {!isUser && item.isStreaming && !hasVisibleText ? (
                          <div className="mt-1.5 flex items-center">
                            <StreamingCursor />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <MessageActionBar
                      align={isUser ? "end" : "start"}
                      copied={copiedMessageId === item.id}
                      branchOptions={
                        !isUser && !isLastAssistantSegment ? [] : branchOptions
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
                        void onCopyMessage(item);
                      }}
                      onEdit={
                        userMessage
                          ? () => {
                              onEditUserMessage(userMessage);
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
      })}
      {isAwaitingFirstResponse ? <PendingAssistantBubble /> : null}
      <div ref={endRef} />
    </div>
  );
}
