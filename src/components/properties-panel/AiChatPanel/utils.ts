import type {
  AiChatMessageAttachment,
  AiChatSessionSummary,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";
import type { MessageTimelineItem, TranslateFn } from "./types";

export const getAnnotationAttachmentTypeLabel = (
  t: TranslateFn,
  attachment: Extract<
    AiChatMessageAttachment,
    { kind: "annotation_reference" }
  >,
) => {
  switch (attachment.annotationType) {
    case "highlight":
      return t("toolbar.highlight");
    case "ink":
      return t("toolbar.ink");
    case "comment":
      return t("toolbar.comment");
    case "freetext":
      return t("toolbar.freetext");
    case "shape":
      return t("toolbar.shape");
    case "stamp":
      return t("toolbar.stamp");
    case "link":
      return t("properties.link.title");
    default:
      return attachment.annotationType;
  }
};

export const getMessageAttachmentLocationLabel = (
  t: TranslateFn,
  attachment: AiChatMessageAttachment,
) => {
  if (attachment.kind === "workspace_selection") {
    return t("ai_chat.attachment_location", {
      page: attachment.pageIndex + 1,
      start: attachment.startOffset,
      end: attachment.endOffset,
    });
  }

  return t("ai_chat.annotation_attachment_location", {
    type: getAnnotationAttachmentTypeLabel(t, attachment),
    page: attachment.pageIndex + 1,
  });
};

export const getMessageAttachmentKey = (
  attachment: AiChatMessageAttachment,
) => {
  if (attachment.kind === "workspace_selection") {
    return `${attachment.pageIndex}:${attachment.startOffset}:${attachment.endOffset}`;
  }

  return `annotation:${attachment.annotationId}`;
};

export const getMessageAttachmentCopyText = (
  attachment: AiChatMessageAttachment,
) => {
  if (attachment.kind === "workspace_selection") {
    return attachment.text.trim();
  }

  return [
    attachment.highlightedText?.trim(),
    attachment.text?.trim(),
    attachment.stampLabel?.trim(),
    attachment.linkUrl?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const getAttachmentOnlyMessage = (
  t: TranslateFn,
  attachments: AiChatMessageAttachment[],
) => {
  if (
    attachments.every((attachment) => attachment.kind === "workspace_selection")
  ) {
    return t("ai_chat.selection_only_message");
  }

  return t("ai_chat.attachment_only_message");
};

export const getMessageCopyText = (item: MessageTimelineItem) => {
  if (item.role === "assistant") {
    return item.text.trim();
  }

  const attachmentTexts =
    item.role === "user"
      ? (item.attachments ?? [])
          .map((attachment) => getMessageAttachmentCopyText(attachment))
          .filter(Boolean)
      : [];

  return [item.text.trim(), ...attachmentTexts].filter(Boolean).join("\n\n");
};

export const getMessageBranchAnchorId = (item: MessageTimelineItem) =>
  item.branchAnchorId ?? item.id;

export const getMessageBranchKind = (item: MessageTimelineItem) => {
  if (item.role === "user") return "edit" as const;
  if (item.role === "assistant") return "regenerate" as const;
  return undefined;
};

export const isLastAssistantSegmentForTurn = (
  timeline: AiChatTimelineItem[],
  item: MessageTimelineItem,
) => {
  if (item.role !== "assistant") return true;
  const turnId = item.turnId ?? item.id;
  const currentIndex = timeline.findIndex(
    (timelineItem) =>
      timelineItem.kind === "message" && timelineItem.id === item.id,
  );
  if (currentIndex < 0) return true;

  return !timeline
    .slice(currentIndex + 1)
    .some(
      (timelineItem) =>
        timelineItem.kind === "message" &&
        timelineItem.role === "assistant" &&
        (timelineItem.turnId ?? timelineItem.id) === turnId,
    );
};

export const formatThinkingDuration = (t: TranslateFn, durationMs?: number) => {
  if (typeof durationMs !== "number" || durationMs <= 0) {
    return t("ai_chat.thought_for", {
      duration: t("ai_chat.duration_seconds", { count: 0 }),
    });
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return t("ai_chat.thought_for", {
      duration: t("ai_chat.duration_hours_minutes", {
        hours,
        minutes,
      }),
    });
  }

  if (minutes > 0) {
    return t("ai_chat.thought_for", {
      duration: t("ai_chat.duration_minutes_seconds", {
        minutes,
        seconds,
      }),
    });
  }

  return t("ai_chat.thought_for", {
    duration: t("ai_chat.duration_seconds", { count: totalSeconds }),
  });
};

export const getSessionTitle = (
  t: TranslateFn,
  session: AiChatSessionSummary,
) => {
  return session.title?.trim() ? session.title : t("ai_chat.session_default");
};
