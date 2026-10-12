import type { AnnotationReply } from "@/types";

/** Clone a thread's IDs together so nested replies never target the old copy. */
export const cloneAnnotationReplies = (
  replies: AnnotationReply[] | undefined,
  parentAnnotationId: string,
  createId: () => string,
): AnnotationReply[] | undefined => {
  if (!replies) return undefined;
  const ids = new Map(replies.map((reply) => [reply.id, createId()]));
  return replies.map((reply) => ({
    ...reply,
    id: ids.get(reply.id)!,
    parentAnnotationId,
    inReplyToReplyId: reply.inReplyToReplyId
      ? ids.get(reply.inReplyToReplyId)
      : undefined,
  }));
};
