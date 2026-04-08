import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle,
  Search,
  Filter,
  Calendar,
  Check,
  Trash2,
  MoreHorizontal,
  Pencil,
  Highlighter,
  Pen,
  Type,
  Shapes,
  CornerDownRight,
  Send,
  X,
} from "lucide-react";
import { Annotation, AnnotationReply } from "@/types";
import { useLanguage } from "../language-provider";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { TimeText } from "../timeText";
import { Textarea } from "../ui/textarea";
import { cn } from "@/utils/cn";
import type { AppEventMap } from "@/lib/eventBus";
import { appEventBus } from "@/lib/eventBus";
import { useAppEvent } from "@/hooks/useAppEventBus";
import {
  ANNOTATION_LIST_TYPES,
  filterAnnotationsForList,
  sortAnnotationsForList,
  type AnnotationListType,
} from "@/lib/annotationList";

type SidebarAnnotationListType = Exclude<AnnotationListType, "link">;

const SIDEBAR_ANNOTATION_LIST_TYPES = ANNOTATION_LIST_TYPES.filter(
  (type): type is SidebarAnnotationListType => type !== "link",
);

const createReplyId = () =>
  `annotation_reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getAnnotationListTypeIcon = (
  type: SidebarAnnotationListType | Annotation,
) => {
  const iconClassName = "text-muted-foreground";

  if (typeof type !== "string") {
    if (type.type === "ink" && type.intent === "InkHighlight") {
      return <Highlighter size={12} className={iconClassName} />;
    }

    switch (type.type) {
      case "highlight":
        return <Highlighter size={12} className={iconClassName} />;
      case "ink":
        return <Pen size={12} className={iconClassName} />;
      case "freetext":
        return <Type size={12} className={iconClassName} />;
      case "shape":
        return <Shapes size={12} className={iconClassName} />;
      default:
        return <MessageCircle size={12} className={iconClassName} />;
    }
  }

  switch (type) {
    case "highlight":
      return <Highlighter size={12} className={iconClassName} />;
    case "ink":
      return <Pen size={12} className={iconClassName} />;
    case "freetext":
      return <Type size={12} className={iconClassName} />;
    case "shape":
      return <Shapes size={12} className={iconClassName} />;
    default:
      return <MessageCircle size={12} className={iconClassName} />;
  }
};

interface AnnotationReplyItemProps {
  annotationId: string;
  isSelected: boolean;
  reply: AnnotationReply;
  fallbackAuthor?: string;
  placeholder: string;
  deleteLabel: string;
  onUpdateReply: (replyId: string, updates: Partial<AnnotationReply>) => void;
  onDeleteReply: (replyId: string) => void;
}

const AnnotationReplyItem: React.FC<AnnotationReplyItemProps> = ({
  annotationId,
  isSelected,
  reply,
  fallbackAuthor,
  placeholder,
  deleteLabel,
  onUpdateReply,
  onDeleteReply,
}) => {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const author = reply.author?.trim() || fallbackAuthor?.trim() || "-";
  const text = reply.text || "";
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(text);

  const startEditing = React.useCallback(() => {
    setDraftText(text);
    setIsEditing(true);
  }, [text]);

  const handleCancelEditing = React.useCallback(() => {
    setDraftText(text);
    setIsEditing(false);
  }, [text]);

  const handleSaveEditing = React.useCallback(() => {
    if (draftText !== text) {
      onUpdateReply(reply.id, {
        text: draftText,
      });
    }
    setIsEditing(false);
  }, [draftText, onUpdateReply, reply.id, text]);

  useEffect(() => {
    setDraftText(text);
    setIsEditing(false);
  }, [reply.id, text]);

  useEffect(() => {
    if (isSelected) return;
    setIsEditing(false);
  }, [isSelected]);

  useEffect(() => {
    if (!isEditing) return;

    textareaRef.current?.focus();
    const len = textareaRef.current?.value.length ?? 0;
    textareaRef.current?.setSelectionRange(len, len);
  }, [isEditing]);

  return (
    <div
      ref={containerRef}
      tabIndex={isSelected ? 0 : -1}
      className="group/reply border-border/60 space-y-2 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-current/25"
      onClick={(event) => {
        event.stopPropagation();
        if (!isSelected || isEditing) return;
        containerRef.current?.focus();
      }}
    >
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-[10px]">
        <div className="flex min-w-0 items-center gap-1.5">
          <CornerDownRight size={10} />
          <span className="truncate" title={author}>
            {author}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {reply.updatedAt ? (
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              <TimeText time={reply.updatedAt} format="LLL" />
            </span>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-foreground h-5 w-5 px-0 opacity-0 transition-opacity group-hover/reply:opacity-100"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  startEditing();
                }}
              >
                <Pencil size={14} />
                <span>{t("common.actions.edit")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteReply(reply.id);
                }}
              >
                <Trash2 size={14} />
                <span>{deleteLabel}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isSelected && isEditing ? (
        <>
          <Textarea
            id={`annotation-reply-input-${annotationId}-${reply.id}`}
            ref={textareaRef}
            rows={1}
            className="text-foreground placeholder:text-muted-foreground/50 min-h-6 w-full resize-none border-none bg-transparent px-0 py-0 text-sm leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
            value={draftText}
            placeholder={placeholder}
            onChange={(event) => setDraftText(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                handleSaveEditing();
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                handleCancelEditing();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="destructive"
              size="icon-xs"
              title={t("common.actions.cancel")}
              aria-label={t("common.actions.cancel")}
              onClick={(event) => {
                event.stopPropagation();
                handleCancelEditing();
              }}
            >
              <X size={12} />
            </Button>
            <Button
              variant="secondary"
              size="icon-xs"
              title={t("common.actions.save")}
              aria-label={t("common.actions.save")}
              disabled={draftText === text}
              onClick={(event) => {
                event.stopPropagation();
                handleSaveEditing();
              }}
            >
              <Check size={12} />
            </Button>
          </div>
        </>
      ) : (
        <div
          className={cn(
            "text-foreground min-h-6 text-sm leading-5 whitespace-pre-wrap",
            text ? null : "text-muted-foreground/50 italic",
          )}
          title={text || placeholder}
        >
          {text || placeholder}
        </div>
      )}
    </div>
  );
};

interface AnnotationCardProps {
  annotation: Annotation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<Annotation>) => void;
  onAddReply: (reply: AnnotationReply) => void;
  onUpdateReply: (replyId: string, updates: Partial<AnnotationReply>) => void;
  onDeleteReply: (replyId: string) => void;
}

const AnnotationCard: React.FC<AnnotationCardProps> = ({
  annotation,
  isSelected,
  onSelect,
  onDelete,
  onUpdate,
  onAddReply,
  onUpdateReply,
  onDeleteReply,
}) => {
  const { t } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef(false);
  const isSelectedRef = useRef(isSelected);
  const [draftReply, setDraftReply] = useState("");
  const [isEditingMain, setIsEditingMain] = useState(false);
  const [mainDraft, setMainDraft] = useState(annotation.text || "");
  const replies = annotation.replies ?? [];
  const replyPlaceholder = t("sidebar.add_remark");

  const startEditingMain = React.useCallback(() => {
    setMainDraft(annotation.text || "");
    pendingFocusRef.current = true;
    setIsEditingMain(true);
  }, [annotation.text]);

  const handleCancelMainEdit = React.useCallback(() => {
    setMainDraft(annotation.text || "");
    pendingFocusRef.current = false;
    setIsEditingMain(false);
  }, [annotation.text]);

  const handleSaveMainEdit = React.useCallback(() => {
    if (mainDraft !== (annotation.text || "")) {
      onUpdate({
        text: mainDraft,
      });
    }
    pendingFocusRef.current = false;
    setIsEditingMain(false);
  }, [annotation.text, mainDraft, onUpdate]);

  const focusTextarea = React.useCallback(() => {
    if (cardRef.current) {
      cardRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLTextAreaElement &&
      activeElement !== textareaRef.current
    ) {
      activeElement.blur();
    }

    if (!textareaRef.current) return false;

    textareaRef.current.focus();
    const len = textareaRef.current.value.length;
    textareaRef.current.setSelectionRange(len, len);
    appEventBus.clearSticky("sidebar:focusAnnotation");
    return true;
  }, []);

  const handleAddReply = React.useCallback(() => {
    const nextText = draftReply.trim();
    if (!nextText) return;

    onAddReply({
      id: createReplyId(),
      parentAnnotationId: annotation.id,
      text: nextText,
    });
    setDraftReply("");
  }, [annotation.id, draftReply, onAddReply]);

  useEffect(() => {
    isSelectedRef.current = isSelected;
  }, [isSelected]);

  useEffect(() => {
    setDraftReply("");
    setMainDraft(annotation.text || "");
    setIsEditingMain(false);
  }, [annotation.id, annotation.text]);

  useEffect(() => {
    if (isSelected) return;
    setIsEditingMain(false);
  }, [isSelected]);

  useEffect(() => {
    if (isEditingMain) return;
    setMainDraft(annotation.text || "");
  }, [annotation.text, isEditingMain]);

  useAppEvent(
    "sidebar:focusAnnotation",
    (payload) => {
      if (payload.id !== annotation.id) return;
      startEditingMain();
      if (isSelectedRef.current && focusTextarea()) {
        pendingFocusRef.current = false;
        return;
      }
      pendingFocusRef.current = true;
    },
    { replayLast: true },
  );

  useEffect(() => {
    if (!isSelected) return;

    if (pendingFocusRef.current && isEditingMain) {
      pendingFocusRef.current = false;
      focusTextarea();
      return;
    }

    if (cardRef.current) {
      cardRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [focusTextarea, isEditingMain, isSelected]);

  return (
    <div
      ref={cardRef}
      id={`annotation-card-${annotation.id}`}
      className={cn(
        "group relative rounded-l-lg rounded-r-lg border-none transition-all",
        isSelected
          ? "ring-primary/80 shadow-md ring-1"
          : "hover:ring-primary/50 hover:shadow-sm hover:ring-1",
      )}
      style={{
        backgroundColor: annotation.color || "#000000",
      }}
      onClick={onSelect}
    >
      <div
        className={cn(
          "border-border ml-1 flex flex-col gap-2 rounded-l-md rounded-r-lg border p-2",
          "bg-background/90",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium">
            {getAnnotationListTypeIcon(annotation)}
            <span className="min-w-0 flex-1 truncate" title={annotation.author}>
              {annotation.author}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 px-0 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect();
                  startEditingMain();
                }}
              >
                <Pencil size={14} />
                <span>{t("common.actions.edit")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 size={14} />
                <span>{t("common.actions.delete")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {isSelected && isEditingMain ? (
          <>
            <Textarea
              rows={1}
              id={`annotation-input-${annotation.id}`}
              ref={textareaRef}
              className="text-foreground placeholder:text-muted-foreground/50 min-h-10 w-full resize-none border-none bg-transparent px-0 py-2 text-sm leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
              value={mainDraft}
              placeholder={t("sidebar.add_remark")}
              onChange={(event) => setMainDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  handleSaveMainEdit();
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  handleCancelMainEdit();
                }
              }}
            />
            <div
              className="flex justify-end gap-2"
              onClick={(event) => event.stopPropagation()}
            >
              <Button
                variant="destructive"
                size="icon-xs"
                title={t("common.actions.cancel")}
                aria-label={t("common.actions.cancel")}
                onClick={handleCancelMainEdit}
              >
                <X size={12} />
              </Button>
              <Button
                variant="secondary"
                size="icon-xs"
                title={t("common.actions.save")}
                aria-label={t("common.actions.save")}
                disabled={mainDraft === (annotation.text || "")}
                onClick={handleSaveMainEdit}
              >
                <Check size={12} />
              </Button>
            </div>
          </>
        ) : (
          <div
            className={cn(
              "text-foreground min-h-10 w-full py-2 text-sm leading-5 whitespace-pre-wrap",
              annotation.text
                ? isSelected
                  ? null
                  : "line-clamp-3"
                : "text-muted-foreground/50 italic",
            )}
            title={annotation.text || t("sidebar.add_remark")}
          >
            {annotation.text || t("sidebar.add_remark")}
          </div>
        )}

        {isSelected && replies.length > 0 ? (
          <div
            className="border-border/50 space-y-2 border-l-2 pl-2"
            style={{
              backgroundColor: `color-mix(in oklab, ${annotation.color} 5%, transparent)`,
            }}
          >
            {replies.map((reply) => (
              <AnnotationReplyItem
                key={reply.id}
                annotationId={annotation.id}
                isSelected={isSelected}
                reply={reply}
                fallbackAuthor={annotation.author}
                placeholder={replyPlaceholder}
                deleteLabel={t("common.actions.delete")}
                onUpdateReply={onUpdateReply}
                onDeleteReply={onDeleteReply}
              />
            ))}
          </div>
        ) : null}

        {isSelected ? (
          <div
            className="flex items-start gap-2"
            onClick={(event) => event.stopPropagation()}
          >
            <Textarea
              rows={1}
              className="text-foreground placeholder:text-muted-foreground/50 min-h-8 flex-1 resize-none border-none bg-transparent px-0 py-1 text-sm leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
              value={draftReply}
              placeholder={replyPlaceholder}
              onChange={(event) => setDraftReply(event.target.value)}
              onKeyDown={(event) => {
                if (!event.ctrlKey && !event.metaKey) return;
                if (event.key !== "Enter") return;
                event.preventDefault();
                handleAddReply();
              }}
            />
            <Button
              variant="secondary"
              size="icon"
              className="mt-1 h-7 w-7 shrink-0"
              disabled={draftReply.trim().length === 0}
              title={t("common.actions.send")}
              onClick={handleAddReply}
            >
              <Send size={12} />
            </Button>
          </div>
        ) : null}

        {annotation.updatedAt || replies.length > 0 ? (
          <div className="border-border/50 text-muted-foreground flex items-center justify-between border-t pt-2 text-[10px]">
            <div className="flex items-center gap-2">
              {annotation.updatedAt ? (
                <span className="flex items-center gap-1">
                  <Calendar size={10} />
                  <TimeText time={annotation.updatedAt} format="LLL" />
                </span>
              ) : null}
            </div>
            {replies.length > 0 ? (
              <span className="flex items-center gap-1">
                <MessageCircle size={10} />
                <span>{replies.length}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

interface AnnotationsProps {
  annotations: Annotation[];
  onSelectControl: (
    id: string,
    options?: Omit<AppEventMap["workspace:focusControl"], "id">,
  ) => void;
  onDeleteAnnotation: (id: string) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onAddAnnotationReply: (annotationId: string, reply: AnnotationReply) => void;
  onUpdateAnnotationReply: (
    annotationId: string,
    replyId: string,
    updates: Partial<AnnotationReply>,
  ) => void;
  onDeleteAnnotationReply: (annotationId: string, replyId: string) => void;
  selectedId: string | null;
}

const AnnotationsPanel: React.FC<AnnotationsProps> = ({
  annotations,
  onSelectControl,
  onDeleteAnnotation,
  onUpdateAnnotation,
  onAddAnnotationReply,
  onUpdateAnnotationReply,
  onDeleteAnnotationReply,
  selectedId,
}) => {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<
    SidebarAnnotationListType[]
  >([...SIDEBAR_ANNOTATION_LIST_TYPES]);

  const annotationTypeLabelKey: Record<SidebarAnnotationListType, string> = {
    comment: "toolbar.comment",
    highlight: "toolbar.highlight",
    ink: "toolbar.ink",
    freetext: "toolbar.freetext",
    shape: "toolbar.shape",
  };

  const allAnnotations = useMemo(
    () =>
      filterAnnotationsForList(annotations, {
        selectedTypes: SIDEBAR_ANNOTATION_LIST_TYPES,
      }),
    [annotations],
  );

  const filteredAnnotations = useMemo(() => {
    return filterAnnotationsForList(allAnnotations, {
      query: searchTerm,
      selectedTypes,
    });
  }, [allAnnotations, searchTerm, selectedTypes]);

  const sortedAnnotations = useMemo(() => {
    return sortAnnotationsForList(filteredAnnotations);
  }, [filteredAnnotations]);

  const groupedAnnotations = useMemo(() => {
    const acc: Record<number, Annotation[]> = {};
    for (const annot of sortedAnnotations) {
      const page = annot.pageIndex + 1;
      if (!acc[page]) acc[page] = [];
      acc[page].push(annot);
    }
    return acc;
  }, [sortedAnnotations]);

  const sortedPages = useMemo(() => {
    return Object.keys(groupedAnnotations)
      .map(Number)
      .sort((a, b) => a - b);
  }, [groupedAnnotations]);

  const handleSelect = (annot: Annotation) => {
    onSelectControl(annot.id, {
      behavior: "smooth",
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-border bg-muted/30 flex shrink-0 items-center gap-2 border-b p-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            type="text"
            placeholder={t("sidebar.search_annotations")}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="bg-background h-8 w-full pl-8 text-xs"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={
                selectedTypes.length !== SIDEBAR_ANNOTATION_LIST_TYPES.length
                  ? "secondary"
                  : "ghost"
              }
              size="icon"
              className="h-8 w-8"
              title={t("sidebar.filter")}
            >
              <Filter className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            {SIDEBAR_ANNOTATION_LIST_TYPES.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={selectedTypes.includes(type)}
                onCheckedChange={(checked) => {
                  setSelectedTypes((prev) =>
                    checked
                      ? prev.includes(type)
                        ? prev
                        : [...prev, type]
                      : prev.filter((item) => item !== type),
                  );
                }}
              >
                <span className="flex items-center gap-2">
                  {getAnnotationListTypeIcon(type)}
                  <span>{t(annotationTypeLabelKey[type])}</span>
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <h3 className="flex items-center gap-2 px-2 pt-2 text-sm font-semibold">
        {t(
          allAnnotations.length === filteredAnnotations.length
            ? "sidebar.all_annotations"
            : "sidebar.all_annotations_filtered",
          {
            total: allAnnotations.length,
            filtered: filteredAnnotations.length,
          },
        )}
      </h3>
      <div className="flex-1 overflow-auto">
        <div className="space-y-6 p-2">
          {filteredAnnotations.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-sm italic">
              {searchTerm ||
              selectedTypes.length < SIDEBAR_ANNOTATION_LIST_TYPES.length
                ? t("sidebar.no_results")
                : t("sidebar.no_annotations")}
            </div>
          ) : (
            sortedPages.map((page) => (
              <div key={page} className="space-y-2">
                <div className="text-muted-foreground bg-background sticky top-0 z-10 py-1 text-xs font-medium">
                  {t("sidebar.page", { page })}
                </div>
                <div className="space-y-3">
                  {groupedAnnotations[page].map((annot) => (
                    <AnnotationCard
                      key={annot.id}
                      annotation={annot}
                      isSelected={selectedId === annot.id}
                      onSelect={() => handleSelect(annot)}
                      onDelete={() => onDeleteAnnotation(annot.id)}
                      onUpdate={(updates) =>
                        onUpdateAnnotation(annot.id, updates)
                      }
                      onAddReply={(reply) =>
                        onAddAnnotationReply(annot.id, reply)
                      }
                      onUpdateReply={(replyId, updates) =>
                        onUpdateAnnotationReply(annot.id, replyId, updates)
                      }
                      onDeleteReply={(replyId) =>
                        onDeleteAnnotationReply(annot.id, replyId)
                      }
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AnnotationsPanel;
