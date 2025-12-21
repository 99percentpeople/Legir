import React, { useEffect, useRef } from "react";
import {
  Trash2,
  Calendar,
  Highlighter,
  Pen,
  Type,
  MessageCircle,
} from "lucide-react";
import { Annotation } from "../../types";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "@/lib/utils";
import { TimeText } from "../timeText";

interface AnnotationCardProps {
  annotation: Annotation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<Annotation>) => void;
}

const AnnotationCard: React.FC<AnnotationCardProps> = ({
  annotation,
  isSelected,
  onSelect,
  onDelete,
  onUpdate,
}) => {
  const { t } = useLanguage();
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
    if (annotation.type === "ink" && annotation.intent === "InkHighlight") {
      return <Highlighter size={12} className="text-muted-foreground" />;
    }
    switch (annotation.type) {
      case "highlight":
        return <Highlighter size={12} className="text-muted-foreground" />;
      case "ink":
        return <Pen size={12} className="text-muted-foreground" />;
      case "freetext":
        return <Type size={12} className="text-muted-foreground" />;
      default:
        return <MessageCircle size={12} className="text-muted-foreground" />;
    }
  };

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
          "border-border ml-1 flex flex-col gap-1 rounded-l-md rounded-r-lg border p-2",
          "bg-background/90",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            {getIcon()}
            <span className="max-w-[120px] truncate">{annotation.author}</span>
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
          id={`annotation-input-${annotation.id}`}
          ref={textareaRef}
          className="text-foreground placeholder:text-muted-foreground/50 min-h-[60px] w-full resize-none border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          value={annotation.text || ""}
          placeholder={t("sidebar.add_remark")}
          onChange={(e) =>
            onUpdate({
              text: e.target.value,
            })
          }
          onClick={(e) => e.stopPropagation()}
        />
        {annotation.updatedAt && (
          <div className="border-border/50 text-muted-foreground mt-2 flex items-center justify-between border-t pt-2 text-[10px]">
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              <TimeText time={annotation.updatedAt} format="LLL" />
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnotationCard;
