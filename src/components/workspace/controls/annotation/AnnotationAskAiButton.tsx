import React from "react";
import { Sparkles } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import type { Annotation } from "@/types";

const getAnnotationAskAiPreview = (
  t: (key: string, params?: Record<string, string | number>) => string,
  annotation: Annotation,
) => {
  const highlightedText = annotation.highlightedText?.trim();
  if (highlightedText) return highlightedText;

  const annotationText = annotation.text?.trim();
  if (annotationText) return annotationText;

  const linkUrl = annotation.linkUrl?.trim();
  if (linkUrl) return linkUrl;

  if (typeof annotation.linkDestPageIndex === "number") {
    return t("properties.link.go_to_page", {
      page: annotation.linkDestPageIndex + 1,
    });
  }

  switch (annotation.type) {
    case "highlight":
      return t("toolbar.highlight");
    case "ink":
      return t("toolbar.ink");
    case "comment":
      return t("toolbar.comment");
    case "freetext":
      return t("toolbar.freetext");
    case "link":
      return t("properties.link.title");
    default:
      return t("right_panel.tabs.ai_chat");
  }
};

export const AnnotationAskAiButton = ({
  annotation,
  onAskAi,
}: {
  annotation: Annotation;
  onAskAi?: (id: string) => void;
}) => {
  const { t } = useLanguage();

  if (!onAskAi) return null;

  const preview = getAnnotationAskAiPreview(t, annotation);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 rounded-full"
      title={t("toolbar.ask_ai", { text: preview })}
      onClick={() => onAskAi(annotation.id)}
    >
      <Sparkles size={14} />
    </Button>
  );
};
