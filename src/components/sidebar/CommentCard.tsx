import React, { useEffect, useRef } from "react";
import { MessageSquare, Trash2, Calendar } from "lucide-react";
import { Annotation } from "../../types";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

interface CommentCardProps {
  comment: Annotation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<Annotation>) => void;
}

const CommentCard: React.FC<CommentCardProps> = ({
  comment,
  isSelected,
  onSelect,
  onDelete,
  onUpdate,
}) => {
  const { dayjsLocale } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected) {
      if (cardRef.current) {
        cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLTextAreaElement &&
        activeElement !== textareaRef.current
      ) {
        activeElement.blur();
      }
    }
  }, [isSelected]);

  return (
    <div
      ref={cardRef}
      id={`comment-card-${comment.id}`}
      className={cn(
        "group relative space-y-1 rounded-md border px-2 py-1 transition-all",
        isSelected
          ? "border-primary/80 bg-muted/50 shadow-md"
          : "border-border hover:border-primary/50 hover:shadow-sm",
      )}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
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
          className="h-6 w-6 px-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={12} className="text-destructive" />
        </Button>
      </div>

      <Textarea
        id={`comment-input-${comment.id}`}
        ref={textareaRef}
        className="text-foreground placeholder:text-muted-foreground/50 min-h-[60px] w-full resize-none border-none bg-transparent px-1.5 text-sm shadow-none dark:bg-transparent"
        value={comment.text || ""}
        placeholder="Add a comment..."
        onChange={(e) =>
          onUpdate({
            text: e.target.value,
          })
        }
        onClick={(e) => e.stopPropagation()}
      />

      <div className="border-border/50 text-muted-foreground mt-2 flex items-center justify-between border-t pt-2 text-[10px]">
        <span className="flex items-center gap-1">
          <Calendar size={10} />
          {dayjs(new Date()).locale(dayjsLocale).format("MMM D, YYYY")}
        </span>
      </div>
    </div>
  );
};

export default CommentCard;
