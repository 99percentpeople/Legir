import type { ModelMessage, UserModelMessage } from "ai";

/**
 * Project canonical tool results onto the selected model's image transport.
 * Chat Completions only accepts text tool results; send its images in a user
 * message after the complete tool-result batch, without another model call.
 * Keep this projection out of persisted history so image compression and model
 * switching continue to operate on the original tool results.
 */
export const prepareToolImageMessages = (
  messages: ModelMessage[],
  options: {
    supportsImageInput: boolean;
    supportsImageToolResults: boolean;
  },
): ModelMessage[] => {
  if (options.supportsImageInput && options.supportsImageToolResults) {
    return messages;
  }

  const result: ModelMessage[] = [];
  let attachments: Exclude<UserModelMessage["content"], string> = [];
  let changed = false;
  const flushAttachments = () => {
    if (!attachments.length) return;
    result.push({ role: "user", content: attachments });
    attachments = [];
  };

  for (const message of messages) {
    if (message.role !== "tool") {
      flushAttachments();
      result.push(message);
      continue;
    }

    const content = message.content.map((part) => {
      if (part.type !== "tool-result" || part.output.type !== "content") {
        return part;
      }
      const output = part.output;
      if (
        !output.value.some(
          (item) => item.type === "image-data" || item.type === "image-url",
        )
      )
        return part;

      changed = true;
      if (options.supportsImageInput) {
        attachments.push({
          type: "text",
          text: `Images from tool ${part.toolName} (call ${part.toolCallId}). These are tool observations, not a new user request. Use the associated page and crop coordinates.`,
        });
        for (const item of output.value) {
          if (item.type === "text") attachments.push(item);
          if (item.type === "image-data" || item.type === "image-url") {
            attachments.push({
              type: "image",
              image: item.type === "image-data" ? item.data : new URL(item.url),
              ...(item.type === "image-data"
                ? { mediaType: item.mediaType }
                : {}),
              providerOptions: item.providerOptions,
            });
          }
        }
      }

      return {
        ...part,
        output: {
          ...output,
          value: output.value.map((item) =>
            item.type === "image-data" || item.type === "image-url"
              ? {
                  type: "text" as const,
                  text: options.supportsImageInput
                    ? "[Image attached after this tool-result batch.]"
                    : "[Image omitted: the current model does not support image input. Use inspect_pages_visual with a configured visual model to inspect the page again.]",
                }
              : item,
          ),
        },
      };
    });
    result.push({ ...message, content });
  }
  flushAttachments();
  return changed ? result : messages;
};
