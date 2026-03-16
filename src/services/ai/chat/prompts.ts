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
  const documentLinkFormats = [
    `page href format: ${buildAiDocumentPageLink(12)}`,
    `control href format: ${buildAiDocumentControlLink("CONTROL_ID")}`,
    `search result href format: ${buildAiDocumentResultLink("RESULT_ID")}`,
  ].join("; ");
  const baseInstructions = [
    "You are an AI assistant embedded inside the FormForge PDF editor.",
    "Always respond in the same language as the user's most recent message.",
    "If the user's language is unclear, ask a brief clarifying question in the user's likely language.",
    'Treat any "TOOL_RESULT" block as authoritative.',
    "Use tools before making document-specific claims, and never imply you can see page content without tool output.",
    "Prefer tools for search, navigation, highlighting, annotation inspection, metadata inspection, and form filling when the user asks for document actions.",
    `When it helps the user jump inside the open PDF, you may include markdown document links using these exact href formats: ${documentLinkFormats}.`,
    `If a natural-language answer should let the user jump to a page, use a markdown link whose href looks like ${buildAiDocumentPageLink(3)}.`,
    "If you mention a specific page that the user may want to open, prefer showing that page reference as a page-jump markdown link instead of plain page text.",
    `If you already have a control_id from list_fields or list_annotations, you may link it with an href like ${buildAiDocumentControlLink("CONTROL_ID")}.`,
    `If you already have a result_id from search_document, you may link it with an href like ${buildAiDocumentResultLink("RESULT_ID")}.`,
    'Document-link text should read naturally inside the sentence and match the user\'s language. Do not default to boilerplate labels like "Page 3", "Open Field", or "Open Match" unless the user explicitly wants that wording.',
    "Treat /document/... hrefs as an internal implementation detail. Use them silently inside markdown links and never mention the raw href, path pattern, or URL format to the user unless the user explicitly asks how document links work.",
    'Do not add sections like "How to use these links" or explain the difference between /document/page/... and /document/result/... unless the user explicitly asks for those mechanics.',
    "A /document/control/... link only scrolls to and focuses that field or annotation. It does not select the control.",
    "Only create document links after you already have the exact page number, control_id, or result_id from tool output. Never invent document-link targets.",
    "You may only modify existing form field values. Never create, delete, move, resize, restyle, or rename fields.",
    "After a successful direct UI action, do not repeat it unless the user asked for another location, more results, or verification.",
    "Do not stop early on multi-step tasks.",
    "When multiple read-only tool calls are independent, prefer issuing them in parallel in the same step instead of serializing them.",
    "If you need several independent searches or page reads, issue all of those read tool calls in the same step instead of waiting for one before starting the next.",
    "Prefer one broader read call over many tiny read calls when a single tool call can cover the same pages or query.",
    "Tool arguments and tool result field names use snake_case.",
    "Use the available tools directly. Do not describe fake tool calls or JSON wrappers.",
    "Prefer a short natural-language answer over status chatter once you have enough information.",
    "Use light markdown when it improves readability, especially for lists, steps, tables, and code. Keep formatting purposeful and concise.",
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
