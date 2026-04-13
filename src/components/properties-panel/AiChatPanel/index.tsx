import React from "react";
import { MessageSquare, Plus, RotateCcw, Sparkles } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { ModelSelect } from "@/components/ModelSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PanelLayout } from "../PanelLayout";
import { appEventBus } from "@/lib/eventBus";
import { cn } from "@/utils/cn";
import { ComposerFooter } from "./ComposerFooter";
import { ConversationEmptyState } from "./ConversationEmptyState";
import { ConversationTimeline } from "./ConversationTimeline";
import { SessionHistoryPopover } from "./SessionHistoryPopover";
import type {
  AiChatPanelProps,
  InlineEditState,
  MessageTimelineItem,
} from "./types";
import {
  getAttachmentOnlyMessage,
  getMessageAttachmentKey,
  getMessageCopyText,
} from "./utils";
import type { AiChatMessageAttachment } from "@/services/ai/chat/types";

export type { AiChatPanelProps } from "./types";

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
  onDeleteConversation,
  canDeleteConversation,
  timeline,
  runStatus,
  lastError,
  awaitingContinue,
  isContextCompressionRunning,
  tokenUsage,
  contextTokens,
  selectedModelKey,
  onSelectModel,
  modelGroups,
  onSend,
  onContinueConversation,
  onRegenerateMessage,
  onRetryLastError,
  onEditUserMessage,
  onStop,
  onOpenDocumentLink,
  disabledReason,
  formToolsEnabled,
}: AiChatPanelProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = React.useState("");
  const [pendingAttachments, setPendingAttachments] = React.useState<
    AiChatMessageAttachment[]
  >([]);
  const [inlineEditState, setInlineEditState] =
    React.useState<InlineEditState | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [copiedMessageId, setCopiedMessageId] = React.useState<string | null>(
    null,
  );

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const inlineEditTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = React.useRef<HTMLElement | null>(null);
  const isNearBottomRef = React.useRef(true);
  const scrollRafRef = React.useRef<number | null>(null);
  const nextTimelineScrollBehaviorRef = React.useRef<ScrollBehavior | null>(
    null,
  );
  const previousSessionIdRef = React.useRef<string | null>(null);
  const draftRef = React.useRef("");
  const inlineEditStateRef = React.useRef<InlineEditState | null>(null);
  const copiedTimeoutRef = React.useRef<number | null>(null);
  const tokenNumberFormatter = React.useMemo(() => new Intl.NumberFormat(), []);

  const formatTokenCount = React.useCallback(
    (value: number) =>
      tokenNumberFormatter.format(Math.max(0, Math.trunc(value))),
    [tokenNumberFormatter],
  );

  const scheduleScrollToBottom = React.useCallback(
    (force = false, behavior: ScrollBehavior = "auto") => {
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
        if (behavior === "smooth") {
          scrollEl.scrollTo({
            top: scrollEl.scrollHeight,
            behavior: "smooth",
          });
        } else {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
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
        const nextFocusTarget =
          inlineEditStateRef.current !== null
            ? inlineEditTextareaRef
            : textareaRef;

        if (inlineEditStateRef.current) {
          setInlineEditState((prev) => {
            if (!prev) return prev;
            return prev.attachments.some(
              (item) =>
                getMessageAttachmentKey(item) ===
                getMessageAttachmentKey(attachment),
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
                getMessageAttachmentKey(item) ===
                getMessageAttachmentKey(attachment),
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
    const nextBehavior = nextTimelineScrollBehaviorRef.current;
    nextTimelineScrollBehaviorRef.current = null;
    scheduleScrollToBottom(Boolean(nextBehavior), nextBehavior ?? "auto");
  }, [runStatus, scheduleScrollToBottom, timeline]);

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

  const handleActivateAttachment = React.useCallback(
    (attachment: AiChatMessageAttachment) => {
      if (attachment.kind === "workspace_selection") {
        appEventBus.emit(
          "workspace:focusTextRange",
          {
            pageIndex: attachment.pageIndex,
            startOffset: attachment.startOffset,
            endOffset: attachment.endOffset,
            rect: attachment.rect,
            behavior: "smooth",
          },
          { sticky: true },
        );
        return;
      }

      appEventBus.emit(
        "workspace:focusControl",
        {
          id: attachment.annotationId,
          behavior: "smooth",
        },
        { sticky: true },
      );
    },
    [],
  );

  const handleSend = React.useCallback(() => {
    const text = draft.trim();
    if (!text && pendingAttachments.length === 0) return;

    nextTimelineScrollBehaviorRef.current = "smooth";
    onSend({
      text: text || getAttachmentOnlyMessage(t, pendingAttachments),
      displayText: text,
      attachments:
        pendingAttachments.length > 0 ? pendingAttachments : undefined,
    });
    setDraft("");
    setPendingAttachments([]);
  }, [draft, onSend, pendingAttachments, t]);

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
    (item: MessageTimelineItem & { role: "user" }) => {
      const restored = onEditUserMessage(item.id);
      if (!restored) return;

      setInlineEditState({
        messageId: item.id,
        text: restored.text,
        attachments: restored.attachments ?? [],
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

    nextTimelineScrollBehaviorRef.current = "smooth";
    onSend({
      text: text || getAttachmentOnlyMessage(t, inlineEditState.attachments),
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
    (attachment: AiChatMessageAttachment) => {
      setInlineEditState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          attachments: prev.attachments.filter(
            (item) =>
              getMessageAttachmentKey(item) !==
              getMessageAttachmentKey(attachment),
          ),
        };
      });
    },
    [],
  );

  const canSend =
    !disabledReason &&
    !inlineEditState &&
    (draft.trim().length > 0 || pendingAttachments.length > 0) &&
    runStatus !== "running" &&
    runStatus !== "cancelling";
  const actionIsStop = runStatus === "running" || runStatus === "cancelling";
  const isBusy = actionIsStop;
  const showHeaderBadges = disabledReason === "no_document";
  const modelSelectPlaceholder =
    disabledReason === "no_model"
      ? t("ai_chat.disabled.no_model")
      : t("common.select");

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
          disabled={
            modelGroups.length === 0 ||
            disabledReason === "no_model" ||
            actionIsStop
          }
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

  const headerActions = (
    <>
      <SessionHistoryPopover
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={onSelectSession}
        onDeleteConversation={onDeleteConversation}
        canDeleteConversation={canDeleteConversation}
        isBusy={isBusy}
        t={t}
      />

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

  const footer = (
    <ComposerFooter
      draft={draft}
      onDraftChange={setDraft}
      textareaRef={textareaRef}
      pendingAttachments={pendingAttachments}
      onActivateAttachment={handleActivateAttachment}
      onRemoveAttachment={(attachment) =>
        setPendingAttachments((prev) =>
          prev.filter(
            (item) =>
              getMessageAttachmentKey(item) !==
              getMessageAttachmentKey(attachment),
          ),
        )
      }
      onSend={handleSend}
      onStop={onStop}
      canSend={canSend}
      actionIsStop={actionIsStop}
      runStatus={runStatus}
      disabledReason={disabledReason}
      inlineEditActive={!!inlineEditState}
      formatTokenCount={formatTokenCount}
      contextTokens={contextTokens}
      tokenUsage={tokenUsage}
      isContextCompressionRunning={isContextCompressionRunning}
      t={t}
    />
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
            <Badge variant="destructive">
              {t("ai_chat.disabled.no_document")}
            </Badge>
          </div>
        ) : null}

        {timeline.length === 0 ? (
          <ConversationEmptyState
            disabledReason={disabledReason}
            formToolsEnabled={formToolsEnabled}
            onSelectPrompt={(prompt) => {
              setDraft(prompt);
              setInlineEditState(null);
              textareaRef.current?.focus();
            }}
            t={t}
          />
        ) : (
          <ConversationTimeline
            timeline={timeline}
            sessions={sessions}
            activeSessionId={activeSessionId}
            inlineEditState={inlineEditState}
            inlineEditTextareaRef={inlineEditTextareaRef}
            copiedMessageId={copiedMessageId}
            isBusy={isBusy}
            endRef={endRef}
            onSelectSession={onSelectSession}
            onCopyMessage={handleCopyMessage}
            onEditUserMessage={handleEditUserMessage}
            onRegenerateMessage={onRegenerateMessage}
            onOpenDocumentLink={onOpenDocumentLink}
            onActivateAttachment={handleActivateAttachment}
            onInlineEditChange={(value) =>
              setInlineEditState((prev) =>
                prev
                  ? {
                      ...prev,
                      text: value,
                    }
                  : prev,
              )
            }
            onInlineEditSubmit={handleInlineEditSubmit}
            onCancelInlineEdit={handleCancelInlineEdit}
            onRemoveInlineEditAttachment={handleRemoveInlineEditAttachment}
            t={t}
          />
        )}

        {lastError ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-3">
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
                  {t("common.actions.retry")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {awaitingContinue ? (
          <Card className="bg-muted/15 border-dashed">
            <CardContent className="flex items-center justify-between gap-3 p-3">
              <div className="text-sm font-medium">
                {t("ai_chat.continue_reason_tool_limit")}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={runStatus === "running" || runStatus === "cancelling"}
                onClick={() => {
                  void onContinueConversation();
                }}
              >
                <Sparkles size={14} />
                {t("common.actions.continue")}
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PanelLayout>
  );
}
