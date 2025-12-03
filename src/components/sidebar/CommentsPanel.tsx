import React, { useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { Annotation } from "../../types";
import { useLanguage } from "../language-provider";
import { Input } from "../ui/input";
import CommentCard from "./CommentCard";

interface CommentsPanelProps {
  annotations: Annotation[];
  onSelectControl: (id: string) => void;
  onDeleteAnnotation: (id: string) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  selectedId: string | null;
}

const CommentsPanel: React.FC<CommentsPanelProps> = ({
  annotations,
  onSelectControl,
  onDeleteAnnotation,
  onUpdateAnnotation,
  selectedId,
}) => {
  const { t } = useLanguage();
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
  const groupedComments = filteredComments.reduce(
    (acc, comment) => {
      const page = comment.pageIndex + 1;
      if (!acc[page]) acc[page] = [];
      acc[page].push(comment);
      return acc;
    },
    {} as Record<number, Annotation[]>,
  );

  const sortedPages = Object.keys(groupedComments)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="flex h-full flex-col">
      <div className="border-border bg-muted/30 shrink-0 border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            type="text"
            placeholder={t("sidebar.search_comments")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-background h-8 w-full pl-8 text-xs"
          />
        </div>
      </div>
      <h3 className="flex items-center gap-2 px-2 pt-2 text-sm font-semibold">
        <MessageSquare size={16} />
        {t("sidebar.comments")} ({comments.length})
      </h3>
      <div className="flex-1 overflow-auto">
        <div className="space-y-6 p-2">
          {filteredComments.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              {searchTerm ? t("sidebar.no_results") : t("sidebar.no_comments")}
            </div>
          ) : (
            sortedPages.map((page) => (
              <div key={page} className="space-y-2">
                <div className="text-muted-foreground bg-background sticky top-0 z-10 py-1 text-xs font-medium">
                  {t("sidebar.page", { page })}
                </div>
                <div className="space-y-3">
                  {groupedComments[page].map((comment) => (
                    <CommentCard
                      key={comment.id}
                      comment={comment}
                      isSelected={selectedId === comment.id}
                      onSelect={() => onSelectControl(comment.id)}
                      onDelete={() => onDeleteAnnotation(comment.id)}
                      onUpdate={(updates) =>
                        onUpdateAnnotation(comment.id, updates)
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

export default CommentsPanel;
