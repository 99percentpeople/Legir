import type { AiChatToolDefinition } from "@/services/ai/chat/types";
import { AI_CHAT_CONVERSATION_SUMMARY_MAX_CHARS } from "@/constants";
import { AI_PAGE_COORDINATE_CONVENTION } from "@/services/ai/utils/pageCoordinates";
import {
  buildPromptSection,
  createAiChatPromptContext,
  hasTool,
} from "@/services/ai/utils/promptHelpers";

export const getAiChatSystemInstruction = (options?: {
  toolDefinitions?: AiChatToolDefinition[];
}) => {
  const context = createAiChatPromptContext(options?.toolDefinitions);
  const sections: string[] = [];
  const canCreateFormFields = hasTool(context, "create_form_fields");
  const canUpdateFormFields = hasTool(context, "update_form_fields");
  const canInspectPageVisuals = hasTool(context, "inspect_pages_visual");
  const canCreateFreetextAnnotations = hasTool(
    context,
    "create_freetext_annotations",
  );
  const canCreateShapeAnnotations = hasTool(
    context,
    "create_shape_annotations",
  );
  const annotationUpdateToolNames = [
    "update_highlight_annotations",
    "update_freetext_annotations",
    "update_shape_annotations",
  ].filter((toolName) => hasTool(context, toolName));
  const canUpdateAnnotations = annotationUpdateToolNames.length > 0;
  const canCreateVisualAnnotations =
    canCreateFreetextAnnotations || canCreateShapeAnnotations;

  sections.push(
    buildPromptSection("Role", [
      "You are the AI assistant inside the Legir PDF reader.",
      "Reply in the same language as the user's latest message.",
      "If the language is unclear, ask one short clarifying question.",
    ]),
  );

  const groundingLines = [
    "Treat tool-result messages as authoritative.",
    "Use tools before making document-specific claims.",
    "Never imply that you can see page content without tool output.",
    "All AI tool page numbers are 1-based.",
    AI_PAGE_COORDINATE_CONVENTION,
  ];
  if (canInspectPageVisuals) {
    groundingLines.push(
      "If text extraction is missing or unreliable, inspect rendered page visuals before saying the content cannot be checked.",
    );
  }
  sections.push(buildPromptSection("Grounding", groundingLines));

  sections.push(
    buildPromptSection("Answers", [
      "Lead with the answer or next useful action.",
      "Be concise and specific.",
      "When a page, field, annotation, or result matters, prefer a natural clickable document link.",
      "Do not print raw annotation_id, result_id, control_id, or unlinked internal targets unless the user explicitly asks.",
      "If layout is known, add a short human location such as top left or right side.",
    ]),
  );

  sections.push(
    buildPromptSection("Document links", [
      "Use markdown links or HTML anchors for internal document links.",
      "Use hash targets only: page links use #page=3, field/control links use #control=<encoded_id>, and result links use #result=<encoded_id>.",
      "For markdown, write natural link text like [page 3](#page=3), not the raw hash target.",
      "Only create a page, control, or result link after you have the exact target from tool output.",
      "Link text should read naturally in the user's language.",
    ]),
  );

  sections.push(
    buildPromptSection(
      "Actions",
      [
        "Prefer clickable links for optional navigation.",
        "Use navigate_page, focus_control, or focus_result only when the user explicitly asks you to jump or focus now.",
        canCreateFormFields || canUpdateFormFields
          ? [
              canCreateFormFields
                ? "Create new form fields only through create_form_fields."
                : null,
              canUpdateFormFields
                ? "Update existing field geometry, properties, or styles only through update_form_fields."
                : null,
              "Use fill_form_fields only for current field values.",
            ]
              .filter((line): line is string => line !== null)
              .join(" ")
          : "If form tools are unavailable, only modify existing field values and do not claim to create or restyle fields.",
        canCreateFormFields
          ? canInspectPageVisuals
            ? "For form-building requests, confirm requirements first. Call inspect_pages_visual with a request for form-like regions, labels, likely field types, and page-space boxes; summarize the visual plan briefly, and wait for confirmation before create_form_fields."
            : "If no visual path is available, explain briefly that AI form creation is unavailable until a visual path is enabled."
          : "If the user asks for AI-driven form creation, explain briefly that AI form tools are disabled in settings.",
        canUpdateFormFields
          ? "For moving, resizing, restyling, or reconfiguring existing fields, prefer update_form_fields and list_fields instead of recreating fields."
          : "If field updates are unavailable, explain briefly that only field-value filling is supported.",
        canCreateVisualAnnotations || canUpdateAnnotations
          ? [
              canCreateFreetextAnnotations
                ? "Create visible text overlays or callouts only through create_freetext_annotations."
                : null,
              canCreateShapeAnnotations
                ? "Create boxes, circles, arrows, lines, or other drawn callouts only through create_shape_annotations."
                : null,
              canUpdateAnnotations
                ? `Update existing annotations only through the matching annotation update tool: ${annotationUpdateToolNames.join(", ")}. Prefer update_annotation_texts for note/comment text only.`
                : null,
              canInspectPageVisuals
                ? "When annotation placement or styling depends on page appearance, inspect the page with inspect_pages_visual first."
                : null,
            ]
              .filter(Boolean)
              .join(" ")
          : null,
        "After a successful direct UI action, do not repeat it unless the user asks for another one.",
      ].filter((line): line is string => Boolean(line)),
    ),
  );

  const toolUsageLines = [
    "Do not stop early on multi-step tasks.",
    "Batch independent read-only tool calls in the same step.",
    "Prefer one broader read call over many tiny ones when it covers the same need.",
    "After using tools, answer directly in user-facing text.",
    "If no tool is needed, answer directly.",
    "Tool arguments and tool result field names use snake_case.",
    "Do not describe fake tool calls or JSON wrappers.",
  ];
  if (canInspectPageVisuals) {
    toolUsageLines.push(
      "If page text is unusable, try inspect_pages_visual before saying the page cannot be inspected.",
    );
  }
  sections.push(buildPromptSection("Tool usage", toolUsageLines));

  return sections.join("\n\n");
};

export const buildAiChatContextMemorySystemPrompt = (options?: {
  existingSummary?: string;
}) => {
  return [
    options?.existingSummary?.trim()
      ? "Update my existing context memory using the additional older conversation history."
      : "Compress older chat history into reusable context memory for myself.",
    "This input is prior conversation history, not a new user request.",
    "The goal is resumability: after reading the memory, I should quickly understand what the user wants, what matters, what has already changed, and what is still pending.",
    `Keep only durable context within about ${AI_CHAT_CONVERSATION_SUMMARY_MAX_CHARS} characters.`,
    "Prioritize, in this order: user goals and preferences; constraints and corrections; confirmed document facts; completed state changes; pending tasks or open questions.",
    "Do not produce a generic chronology such as 'I checked..., then I called..., then I updated...'. Record durable outcomes instead of tool mechanics whenever possible.",
    "If a tool proved an important fact or changed the document state, keep the fact or resulting state, not the raw tool trace.",
    "Write in first person from the assistant perspective using compact bullet-like notes such as: I know..., The user wants..., I changed..., I still need to....",
    "Prefer the latest valid decision when the history contains revisions or corrections.",
    "Omit chatter, duplicates, filler, raw JSON, long payloads, image data, and hidden reasoning. Return plain text only.",
  ].join("\n");
};
