import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import { FileText, MessageSquare, Plus } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { ModelSelect } from "@/components/ModelSelect";
import { PanelLayout } from "@/components/properties-panel/PanelLayout";
import { ComposerFooter } from "@/components/properties-panel/AiChatPanel/ComposerFooter";
import { ConversationTimeline } from "@/components/properties-panel/AiChatPanel/ConversationTimeline";
import { ConversationEmptyState } from "@/components/properties-panel/AiChatPanel/ConversationEmptyState";
import { SessionHistoryPopover } from "@/components/properties-panel/AiChatPanel/SessionHistoryPopover";
import { Button } from "@/components/ui/button";
import type { InlineEditState } from "@/components/properties-panel/AiChatPanel/types";
import type {
  AiChatTimelineItem,
  AiChatMessageAttachment,
} from "@/services/ai/chat/types";
import type { AiReasoningLevel } from "@/services/ai";
import type { DemoCopy } from "./copy";
import {
  type AnswerKind,
  type DemoAction,
  type DemoState,
  type DemoTokenPlan,
} from "./types";
import { useDemoPlayback } from "./useDemoPlayback";
import {
  createDemoTokenPlan,
  getDemoTokenStats,
  simulateDemoTokenStats,
} from "./demoTokenUsage";

export const DEMO_MODELS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    options: [{ value: "demo-deepseek", label: "DeepSeek · Demo" }],
  },
];
const DATE = "2026-09-18T00:00:00Z";
export type DemoPanelProps = {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
  copy: DemoCopy;
  width: number;
  onResize: (value: number) => void;
  floating: boolean;
};

export function DemoAiPanel({
  state,
  dispatch,
  copy,
  selectionRequest,
  width,
  onResize,
  floating,
}: DemoPanelProps & {
  selectionRequest: { id: number; text: string; page: number } | null;
}) {
  const { t, effectiveLanguage } = useLanguage();
  const tokenFormatter = useMemo(
    () => new Intl.NumberFormat(effectiveLanguage),
    [effectiveLanguage],
  );
  const seedStats = simulateDemoTokenStats(
    createDemoTokenPlan([], copy.prompts[0]),
    copy.answers.summary,
  );
  const seeded: AiChatTimelineItem[] = [
    {
      id: "demo-user",
      kind: "message",
      role: "user",
      text: copy.prompts[0],
      createdAt: DATE,
      turnId: "demo-turn",
    },
    {
      id: "demo-assistant",
      kind: "message",
      role: "assistant",
      text: copy.answers.summary,
      createdAt: DATE,
      turnId: "demo-turn",
      turnCompleted: true,
      tokenUsageSnapshot: seedStats.tokenUsage,
      contextTokensSnapshot: seedStats.contextTokens,
    },
  ];
  const [items, setItems] = useState(seeded);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<AiChatMessageAttachment[]>([]);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionId, setSessionId] = useState("demo-session");
  const [history, setHistory] = useState([
    { id: "demo-session", title: copy.prompts[0], items: seeded },
  ]);
  const [edit, setEdit] = useState<InlineEditState | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<AiReasoningLevel>("none");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editTextarea = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const streamPlan = useRef<DemoTokenPlan | null>(null);
  const answers = useRef(new Map([["demo-assistant", copy.answers.summary]]));
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const { text, playing, start, stop } = useDemoPlayback("");
  const visible = state.panel === "ai";
  const timeline = items.map((item) => {
    if (item.id !== streamId || item.kind !== "message" || !streamPlan.current)
      return item;
    const stats = simulateDemoTokenStats(streamPlan.current, text);
    return {
      ...item,
      text,
      isStreaming: playing,
      turnCompleted: !playing,
      tokenUsageSnapshot: stats.tokenUsage,
      contextTokensSnapshot: stats.contextTokens,
    };
  });
  const { tokenUsage, contextTokens } = getDemoTokenStats(timeline);
  useEffect(() => {
    if (!visible) stop();
  }, [visible, stop]);
  useEffect(() => {
    if (!selectionRequest) return;
    setPending([
      {
        kind: "workspace_selection",
        text: selectionRequest.text,
        pageIndex: selectionRequest.page - 1,
        startOffset: 0,
        endOffset: selectionRequest.text.length,
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
    ]);
    textarea.current?.focus();
  }, [selectionRequest]);
  useEffect(() => {
    if (!playing) return;
    const body = end.current?.closest('[data-slot="panel-body"]');
    if (body) body.scrollTop = body.scrollHeight;
  }, [text, playing]);
  function ask(
    value = draft,
    selected: AnswerKind | null = null,
    attachments = pending,
    prefix = timeline,
  ) {
    if (playing || (!value.trim() && !attachments.length)) return;
    const kind: AnswerKind =
      selected ??
      (attachments.length
        ? "selection"
        : value === copy.prompts[0] ||
            value === t("ai_chat.starters.whole_document")
          ? "summary"
          : value === copy.prompts[1]
            ? "actions"
            : "fallback");
    const id = `demo-turn-${++nextId.current}`;
    const userText =
      value.trim().slice(0, 500) || t("ai_chat.selection_only_message");
    streamPlan.current = createDemoTokenPlan(
      prefix,
      userText,
      attachments,
      reasoning,
    );
    answers.current.set(`${id}-assistant`, copy.answers[kind]);
    if (!prefix.length) {
      setHistory((old) =>
        old.map((session) =>
          session.id === sessionId ? { ...session, title: userText } : session,
        ),
      );
    }
    setItems([
      ...prefix,
      {
        id: `${id}-user`,
        kind: "message",
        role: "user",
        text: userText,
        attachments,
        createdAt: DATE,
        turnId: id,
      },
      {
        id: `${id}-assistant`,
        kind: "message",
        role: "assistant",
        text: "",
        createdAt: DATE,
        turnId: id,
      },
    ]);
    setStreamId(`${id}-assistant`);
    setPending([]);
    setDraft("");
    start(copy.answers[kind]);
  }
  function switchSession(id: string, create = false) {
    const saved = history.map((session) =>
      session.id === sessionId ? { ...session, items: timeline } : session,
    );
    if (create)
      saved.push({ id, title: t("ai_chat.session_default"), items: [] });
    const next = saved.find((session) => session.id === id);
    if (!next) return;
    stop();
    setStreamId(null);
    setHistory(saved);
    setSessionId(id);
    setItems(next.items);
    setDraft("");
    setPending([]);
    setEdit(null);
    setHistoryOpen(false);
  }
  function activate(attachment: AiChatMessageAttachment) {
    dispatch({ type: "page", page: attachment.pageIndex + 1 });
  }
  return (
    <div
      className="demo-runtime-panel"
      hidden={!visible}
      data-context-tokens={contextTokens}
      data-input-tokens={tokenUsage.inputTokens}
      data-output-tokens={tokenUsage.outputTokens}
      data-total-tokens={tokenUsage.totalTokens}
    >
      <PanelLayout
        isOpen={visible}
        isFloating={floating}
        width={width}
        onResize={onResize}
        onOpen={() => dispatch({ type: "panel", panel: "ai" })}
        onCollapse={() => dispatch({ type: "panel", panel: null })}
        onClose={() => dispatch({ type: "panel", panel: null })}
        title={
          <div className="flex min-w-0 shrink flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex min-w-0 shrink items-center gap-2">
              <MessageSquare size={18} />
              <span>{t("ai_chat.title")}</span>
            </div>
            <div className="max-w-full min-w-0 shrink-0">
              <ModelSelect
                value="demo-deepseek"
                onValueChange={() => {}}
                groups={DEMO_MODELS}
                placeholder={t("common.select")}
                showSeparators={false}
                triggerSize="sm"
                disabled={playing}
                triggerClassName="text-muted-foreground bg-background/80 hover:bg-background h-7 max-w-full justify-start gap-2 rounded-full border-0 px-2.5 shadow-none backdrop-blur-sm focus-visible:border-transparent focus-visible:ring-0"
              />
            </div>
          </div>
        }
        headerActions={
          <>
            <SessionHistoryPopover
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              sessions={history.map((session) => ({
                id: session.id,
                title: session.title,
                updatedAt: DATE,
                branchDepth: 0,
              }))}
              activeSessionId={sessionId}
              onSelectSession={(id) => switchSession(id)}
              onDeleteConversation={(id) =>
                setHistory((old) => old.filter((session) => session.id !== id))
              }
              canDeleteConversation={(id) => id !== sessionId}
              isBusy={playing}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t("ai_chat.new_chat")}
              disabled={playing}
              onClick={() =>
                switchSession(`demo-session-${++nextId.current}`, true)
              }
            >
              <Plus size={18} />
            </Button>
          </>
        }
        footer={
          <ComposerFooter
            draft={draft}
            onDraftChange={(value) => setDraft(value.slice(0, 500))}
            textareaRef={textarea}
            pendingAttachments={pending}
            onActivateAttachment={activate}
            onRemoveAttachment={(attachment) =>
              setPending((old) => old.filter((item) => item !== attachment))
            }
            onSend={() => ask()}
            onStop={stop}
            canSend={
              !edit && !playing && (!!draft.trim() || pending.length > 0)
            }
            actionIsStop={playing}
            runStatus={playing ? "running" : "idle"}
            disabledReason={null}
            inlineEditActive={!!edit}
            formatTokenCount={(value) =>
              tokenFormatter.format(Math.max(0, Math.trunc(value)))
            }
            contextTokens={contextTokens}
            tokenUsage={tokenUsage}
            isContextCompressionRunning={false}
            reasoningLevelControl={{
              supported: true,
              showSelect: true,
              selectedLevel: reasoning,
              levels: ["none", "auto"],
            }}
            onReasoningLevelChange={setReasoning}
          />
        }
      >
        <div className="flex h-full flex-col gap-2">
          <p className="demo-local-notice">{copy.aiNotice}</p>
          {!timeline.length ? (
            <ConversationEmptyState
              disabledReason={null}
              onSelectPrompt={setDraft}
            />
          ) : (
            <ConversationTimeline
              timeline={timeline}
              sessions={[]}
              activeSessionId={sessionId}
              inlineEditState={edit}
              inlineEditTextareaRef={editTextarea}
              copiedMessageId={copied}
              isBusy={playing}
              endRef={end}
              onSelectSession={(id) => switchSession(id)}
              onCopyMessage={async (item) => {
                try {
                  await navigator.clipboard.writeText(item.text);
                  setCopied(item.id);
                  if (copiedTimer.current) clearTimeout(copiedTimer.current);
                  copiedTimer.current = setTimeout(() => setCopied(null), 2000);
                } catch {
                  setCopied(null);
                }
              }}
              onEditUserMessage={(item) =>
                setEdit({
                  messageId: item.id,
                  text: item.text,
                  attachments: item.attachments ?? [],
                  sourceSessionId: sessionId,
                  targetMessageId: item.id,
                })
              }
              onRegenerateMessage={(id) => {
                if (playing) return;
                const answer = answers.current.get(id);
                if (!answer) return;
                const index = timeline.findIndex((item) => item.id === id);
                const user = timeline[index - 1];
                if (!user || user.kind !== "message" || user.role !== "user")
                  return;
                // Replace this local branch, including its usage; do not retain
                // later responses or count a regenerated turn twice.
                streamPlan.current = createDemoTokenPlan(
                  timeline.slice(0, index - 1),
                  user.text,
                  user.attachments,
                  reasoning,
                );
                setItems(timeline.slice(0, index + 1));
                setStreamId(id);
                start(answer);
              }}
              onOpenDocumentLink={() => dispatch({ type: "page", page: 1 })}
              onActivateAttachment={activate}
              onInlineEditChange={(value) =>
                setEdit((old) => (old ? { ...old, text: value } : old))
              }
              onInlineEditSubmit={() => {
                if (edit && (edit.text.trim() || edit.attachments.length)) {
                  const index = timeline.findIndex(
                    (item) => item.id === edit.messageId,
                  );
                  ask(
                    edit.text,
                    null,
                    edit.attachments,
                    index < 0 ? timeline : timeline.slice(0, index),
                  );
                  setEdit(null);
                }
              }}
              onCancelInlineEdit={() => setEdit(null)}
              onRemoveInlineEditAttachment={(attachment) =>
                setEdit((old) =>
                  old
                    ? {
                        ...old,
                        attachments: old.attachments.filter(
                          (item) => item !== attachment,
                        ),
                      }
                    : old,
                )
              }
            />
          )}
          {!playing && (
            <div className="flex flex-wrap gap-2 px-3">
              {copy.prompts.map((prompt, index) => (
                <Button
                  key={prompt}
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-7 px-2 py-1 text-left text-xs whitespace-normal"
                  onClick={() =>
                    ask(prompt, index === 0 ? "summary" : "actions")
                  }
                >
                  {prompt}
                </Button>
              ))}
              <Button
                className="demo-citation h-auto text-xs"
                variant="ghost"
                onClick={() => {
                  dispatch({ type: "page", page: 1 });
                  if (!state.highlighted) dispatch({ type: "highlight" });
                }}
              >
                <FileText size={12} />
                {copy.source}
              </Button>
            </div>
          )}
        </div>
      </PanelLayout>
    </div>
  );
}
