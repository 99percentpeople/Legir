import React, { useState } from "react";
import {
  MessageSquare,
  Trash2,
  Calendar,
  Search,
  StickyNote,
} from "lucide-react";
import { Annotation } from "../../types";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Textarea } from "../ui/textarea";
import { cn } from "@/lib/utils";

dayjs.extend(relativeTime);

interface CommentsPanelProps {
  annotations: Annotation[];
  onSelectAnnotation: (id: string) => void;
  onDeleteAnnotation: (id: string) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  selectedAnnotationId: string | null;
}

const CommentsPanel: React.FC<CommentsPanelProps> = ({
  annotations,
  onSelectAnnotation,
  onDeleteAnnotation,
  onUpdateAnnotation,
  selectedAnnotationId,
}) => {
  const { t, dayjsLocale } = useLanguage();
  const [searchTerm, setSearchTerm] = useState("");

  const comments = annotations.filter((a) => a.type === "comment");

  // Filter comments based on search term
  const filteredComments = comments.filter((comment) => {
    if (!searchTerm) return true;
    return (comment.text || "")
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
  });

  // Group by page
  const groupedComments = filteredComments.reduce((acc, comment) => {
    const page = comment.pageIndex + 1;
    if (!acc[page]) acc[page] = [];
    acc[page].push(comment);
    return acc;
  }, {} as Record<number, Annotation[]>);

  const sortedPages = Object.keys(groupedComments)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border bg-muted/30 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground h-3.5 w-3.5" />
          <Input
            type="text"
            placeholder={t("sidebar.search_comments")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 pl-8 text-xs w-full bg-background"
          />
        </div>
      </div>
      <h3 className="px-2 pt-2 font-semibold text-sm flex items-center gap-2">
        <MessageSquare size={16} />
        {t("sidebar.comments")} ({comments.length})
      </h3>
      <div className="flex-1 overflow-auto">
        <div className="p-2 space-y-6">
          {filteredComments.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              {searchTerm ? t("sidebar.no_results") : t("sidebar.no_comments")}
            </div>
          ) : (
            sortedPages.map((page) => (
              <div key={page} className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground sticky top-0 bg-background py-1 z-10">
                  {t("sidebar.page", { page })}
                </div>
                <div className="space-y-3">
                  {groupedComments[page].map((comment) => (
                    <div
                      key={comment.id}
                      className={cn(
                        "group relative border rounded-md px-2 py-1 transition-all space-y-1",
                        selectedAnnotationId === comment.id
                          ? "border-primary/80 bg-muted/50 shadow-md"
                          : "border-border hover:border-primary/50 hover:shadow-sm"
                      )}
                      onClick={() => onSelectAnnotation(comment.id)}
                    >
                      <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <MessageSquare
                            style={{
                              color: comment.color || "inherit",
                              fill: comment.color || "inherit",
                            }}
                            size={12}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity px-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteAnnotation(comment.id);
                          }}
                        >
                          <Trash2 size={12} className="text-destructive" />
                        </Button>
                      </div>

                      <Textarea
                        id={`comment-input-${comment.id}`}
                        className="w-full dark:bg-transparent bg-transparent text-sm resize-none min-h-[60px] text-foreground placeholder:text-muted-foreground/50 border-none px-1.5"
                        value={comment.text || ""}
                        placeholder="Add a comment..."
                        onChange={(e) =>
                          onUpdateAnnotation(comment.id, {
                            text: e.target.value,
                          })
                        }
                        onClick={(e) => e.stopPropagation()}
                      />

                      <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar size={10} />
                          {dayjs(new Date())
                            .locale(dayjsLocale)
                            .format("MMM D, YYYY")}
                        </span>
                      </div>
                    </div>
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

export default CommentsPanel;
