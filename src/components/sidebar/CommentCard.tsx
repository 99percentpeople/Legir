import React, { useEffect, useRef } from "react";
import {
  Trash2,
  Calendar,
  Circle,
  Highlighter,
  Pen,
  MessageSquare,
} from "lucide-react";
import { Annotation } from "../../types";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Separator } from "../ui/separator";

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

  const getIcon = () => {
    switch (comment.type) {
      case "highlight":
        return <Highlighter size={12} className="text-muted-foreground" />;
      case "ink":
        return <Pen size={12} className="text-muted-foreground" />;
      default:
        return <MessageSquare size={12} className="text-muted-foreground" />;
    }
  };

  return (
    <div
      ref={cardRef}
      id={`comment-card-${comment.id}`}
      className={cn(
        "group relative rounded-l-lg rounded-r-lg border-none transition-all",
        isSelected
          ? "ring-primary/80 shadow-md ring-1"
          : "hover:ring-primary/50 hover:shadow-sm hover:ring-1",
      )}
      style={{
        backgroundColor: comment.color || "#000000",
      }}
      onClick={onSelect}
    >
      <div
        className={cn(
          "border-border ml-1 flex flex-col gap-1 rounded-l-md rounded-r-lg border p-2",
          "bg-background/90",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            {getIcon()}
            <span className="max-w-[120px] truncate">{comment.author}</span>
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
          className="text-foreground placeholder:text-muted-foreground/50 min-h-[60px] w-full resize-none border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          value={comment.text || ""}
          placeholder="Add a comment..."
          onChange={(e) =>
            onUpdate({
              text: e.target.value,
            })
          }
          onClick={(e) => e.stopPropagation()}
        />
        {comment.updatedAt && (
          <div className="border-border/50 text-muted-foreground mt-2 flex items-center justify-between border-t pt-2 text-[10px]">
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              {dayjs(comment.updatedAt).locale(dayjsLocale).format("LLL")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default CommentCard;
