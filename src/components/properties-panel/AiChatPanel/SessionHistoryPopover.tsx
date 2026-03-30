import React from "react";
import { ChevronDown, GitBranch, History, Trash2 } from "lucide-react";
import { TimeAgoText } from "@/components/timeText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/utils/cn";
import type { TranslateFn } from "./types";
import { getSessionTitle } from "./utils";
import type { AiChatSessionSummary } from "@/services/ai/chat/types";

const SESSION_TREE_BASE_PADDING_PX = 8;
const SESSION_TREE_INDENT_PX = 12;
const SESSION_TREE_GUIDE_OFFSET_PX = 10;

interface SessionHistoryPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: AiChatSessionSummary[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRequestClear: () => void;
  isBusy: boolean;
  timelineLength: number;
  t: TranslateFn;
}

export function SessionHistoryPopover({
  open,
  onOpenChange,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteConversation,
  onRequestClear,
  isBusy,
  timelineLength,
  t,
}: SessionHistoryPopoverProps) {
  const [expandedSessionIds, setExpandedSessionIds] = React.useState<
    Set<string>
  >(() => new Set());

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

    return {
      roots: sortNodes(roots),
      childrenByParentId: sortedChildrenByParentId,
      sessionSummaryById: sessionById,
    };
  }, [sessions]);

  const activeExpandedAncestorIds = React.useMemo(() => {
    const ids = new Set<string>();
    let cursorId =
      sessionTree.sessionSummaryById.get(activeSessionId)?.parentSessionId;
    while (cursorId) {
      ids.add(cursorId);
      cursorId = sessionTree.sessionSummaryById.get(cursorId)?.parentSessionId;
    }
    return ids;
  }, [activeSessionId, sessionTree.sessionSummaryById]);

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

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
                    onOpenChange(false);
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
                  aria-label={t("common.actions.delete")}
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
              onOpenChange(false);
              onRequestClear();
            }}
            disabled={isBusy || timelineLength === 0}
          >
            <Trash2 size={14} />
            {t("common.actions.clear")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
