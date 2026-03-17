import type {
  AiChatMessageRecord,
  AiChatToolDefinition,
} from "@/services/ai/chat/types";
import {
  buildAiDocumentControlLink,
  buildAiDocumentPageLink,
  buildAiDocumentResultLink,
} from "@/services/ai/utils/documentLinks";

const serializePromptJson = (value: unknown) => JSON.stringify(value);
const buildMarkdownLinkExample = (text: string, href: string) =>
  `[${text}](${href})`;
const buildHtmlLinkExample = (text: string, href: string) =>
  `<a href="${href}">${text}</a>`;

const collectToolPromptInstructions = (
  toolDefinitions?: AiChatToolDefinition[],
) => {
  const unique = new Set<string>();
  const instructions: string[] = [];

  for (const definition of toolDefinitions ?? []) {
    for (const instruction of definition.promptInstructions ?? []) {
      const normalized = instruction.trim();
      if (!normalized || unique.has(normalized)) continue;
      unique.add(normalized);
      instructions.push(normalized);
    }
  }

  return instructions;
};

const collectReadToolNames = (toolDefinitions?: AiChatToolDefinition[]) =>
  (toolDefinitions ?? [])
    .filter((definition) => definition.accessType === "read")
    .map((definition) => definition.name);

export const getAiChatSystemInstruction = (options?: {
  toolDefinitions?: AiChatToolDefinition[];
}) => {
  const readToolNames = collectReadToolNames(options?.toolDefinitions);
  const documentLinkExamples = [
    `markdown page link: ${buildMarkdownLinkExample("go to page 12", buildAiDocumentPageLink(12))}`,
    `html page link: ${buildHtmlLinkExample("go to page 12", buildAiDocumentPageLink(12))}`,
    `markdown control link: ${buildMarkdownLinkExample("field on page 2", buildAiDocumentControlLink("CONTROL_ID"))}`,
    `html result link: ${buildHtmlLinkExample("match on page 5", buildAiDocumentResultLink("RESULT_ID"))}`,
  ].join("; ");
  const baseInstructions = [
    "Role:",
    "You are the AI assistant inside the FormForge PDF editor.",
    "Reply in the same language as the user's most recent message.",
    "If the language is unclear, ask one brief clarifying question in the user's most likely language.",
    "",
    "Grounding:",
    'Treat every "TOOL_RESULT" block as authoritative.',
    "Use tools before making document-specific claims, and never imply you can see page content without tool output.",
    "Prefer tools for document search, page reading, metadata, annotations, fields, form filling, highlighting, and navigation when the task depends on the open PDF.",
    "",
    "Answer style:",
    "Lead with the answer or next useful action, not status chatter.",
    "Keep answers concise but informative: include the key finding, the relevant location, and the next useful step when it helps.",
    "When a page, field, annotation, or search hit matters, prefer making it clickable with a natural link instead of plain text.",
    "When layout or geometry is available, add a short human description such as top left, right side, or lower section. Do not guess location wording without supporting data.",
    "If there are multiple relevant targets, use a short bullet list so each item says what it is, why it matters, and where to open it.",
    "After solving the immediate request, offer one concrete follow-up suggestion or question when it would help the user go deeper. Avoid generic closers.",
    "Use light markdown only when it improves scanning.",
    "",
    "Document links:",
    `When you include an internal document link, use a correct clickable format: either markdown [text](/document/...) or an HTML anchor like <a href="/document/...">text</a>. Examples: ${documentLinkExamples}.`,
    `If the answer should let the user jump to a page, write a clickable link like ${buildMarkdownLinkExample("page 3", buildAiDocumentPageLink(3))} or ${buildHtmlLinkExample("page 3", buildAiDocumentPageLink(3))}.`,
    `If you already have a control_id from list_fields or list_annotations, write a clickable link like ${buildMarkdownLinkExample("field on page 2", buildAiDocumentControlLink("CONTROL_ID"))} or ${buildHtmlLinkExample("field on page 2", buildAiDocumentControlLink("CONTROL_ID"))}.`,
    `If you already have a result_id from search_document, write a clickable link like ${buildMarkdownLinkExample("match on page 5", buildAiDocumentResultLink("RESULT_ID"))} or ${buildHtmlLinkExample("match on page 5", buildAiDocumentResultLink("RESULT_ID"))}.`,
    "Never output a bare /document/... path, a raw href, a broken <a> tag without visible text, a code fence, or a JSON wrapper when you mean a clickable document link.",
    "When linking a control or result, prefer one natural link whose text names the page and item together, instead of a generic label.",
    'Link text must read naturally in the user\'s language. Avoid boilerplate labels like "Page 3", "Open Field", or "Open Match" unless the user explicitly wants that wording.',
    "Treat /document/... hrefs as an internal detail. Use them silently inside clickable links and never expose the raw href, path pattern, or URL format unless the user explicitly asks.",
    "A /document/control/... link scrolls to and focuses that field or annotation. It does not select the control.",
    "Only create document links after you already have the exact page number, control_id, or result_id from tool output. Never invent document-link targets.",
    "",
    "Action boundaries:",
    "Prefer internal clickable links for optional navigation in explanatory answers.",
    "Use navigate_page, focus_control, or focus_result when the user explicitly asks you to jump, open, focus, or select something now.",
    "You may only modify existing form field values. Never create, delete, move, resize, restyle, or rename fields.",
    "After a successful direct UI action, do not repeat it unless the user asks for another location, more results, or verification.",
    "",
    "Tool usage:",
    "Do not stop early on multi-step tasks.",
    "When multiple read-only tool calls are independent, issue them in parallel in the same step.",
    "Prefer one broader read call over many tiny read calls when a single call can cover the same need.",
    "Tool arguments and tool result field names use snake_case.",
    "Use the available tools directly. Do not describe fake tool calls or JSON wrappers.",
    readToolNames.length > 0
      ? `Read-only tools that may be batched in parallel when independent: ${readToolNames.join(", ")}.`
      : "",
  ];
  const toolInstructions = collectToolPromptInstructions(
    options?.toolDefinitions,
  );

  return [
    baseInstructions.join("\n"),
    toolInstructions.length > 0
      ? ["Tool-specific usage rules:", ...toolInstructions].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const buildAiChatTurnPrompt = (options: {
  messages: AiChatMessageRecord[];
}) => {
  const { messages } = options;

  return [
    "Conversation so far is serialized below as JSON.",
    "Each item contains a role and content string.",
    'Any content that starts with "TOOL_RESULT" is authoritative tool output from this session.',
    "",
    "Conversation so far:",
    serializePromptJson(messages),
  ].join("\n");
};

export const buildDocumentDigestSummaryPrompt = (options: {
  startPage: number;
  endPage: number;
  maxChars: number;
  summaryInstructions?: string;
}) => {
  const { startPage, endPage, maxChars, summaryInstructions } = options;
  const pageLabel =
    startPage === endPage
      ? `page ${startPage}`
      : `pages ${startPage}-${endPage}`;
  const extraInstructions = summaryInstructions?.trim();

  return `
You summarize sampled PDF text for ${pageLabel}.

Requirements:
- This is only a summary for ${pageLabel}, not for the whole document unless the requested range actually covers the whole document.
- Never describe pages outside ${pageLabel}.
- Cover the whole sampled range, not only the beginning.
- Preserve important section names, warnings, numbers, lists, and proper nouns when present.
- Prefer the same language as the source text when obvious.
- Follow any additional focus instructions below, but do not invent facts that are not supported by the source text.
- Return plain text only. No markdown. No preamble.
- Keep the summary within about ${maxChars} characters.
${extraInstructions ? `- Additional focus instructions:\n${extraInstructions}` : ""}
`.trim();
};

export const buildDocumentDigestMergePrompt = (options: {
  startPage: number;
  endPage: number;
  maxChars: number;
  summaryInstructions?: string;
}) => {
  const { startPage, endPage, maxChars, summaryInstructions } = options;
  const pageLabel =
    startPage === endPage
      ? `page ${startPage}`
      : `pages ${startPage}-${endPage}`;
  const extraInstructions = summaryInstructions?.trim();

  return `
You merge multiple subrange summaries for ${pageLabel} into one faithful summary.

Requirements:
- The input consists of summaries for smaller contiguous page ranges inside ${pageLabel}.
- Produce one coherent summary for the whole ${pageLabel} range.
- Cover the entire range evenly instead of over-weighting the first subrange.
- Preserve important section names, warnings, numbers, lists, and proper nouns when present.
- Prefer the same language as the source text when obvious.
- Follow any additional focus instructions below, but do not invent facts that are not supported by the input summaries.
- Return plain text only. No markdown. No preamble.
- Keep the summary within about ${maxChars} characters.
${extraInstructions ? `- Additional focus instructions:\n${extraInstructions}` : ""}
`.trim();
};
