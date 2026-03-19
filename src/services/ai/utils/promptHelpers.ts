import type { AiChatToolDefinition } from "@/services/ai/chat/types";

export type AiChatPromptContext = {
  toolDefinitions: AiChatToolDefinition[];
  toolNames: Set<string>;
  readToolNames: string[];
};

export const serializePromptJson = (value: unknown) => JSON.stringify(value);

export const buildMarkdownLinkExample = (text: string, href: string) =>
  `[${text}](${href})`;

export const buildHtmlLinkExample = (text: string, href: string) =>
  `<a href="${href}">${text}</a>`;

export const dedupePromptLines = (lines: readonly string[]) => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
};

export const buildPromptSection = (title: string, lines: string[]) =>
  [`${title}:`, ...dedupePromptLines(lines)].join("\n");

export const collectReadToolNames = (
  toolDefinitions?: AiChatToolDefinition[],
) =>
  (toolDefinitions || [])
    .filter((definition) => definition.accessType === "read")
    .map((definition) => definition.name);

export const createAiChatPromptContext = (
  toolDefinitions?: AiChatToolDefinition[],
): AiChatPromptContext => {
  const normalizedToolDefinitions = toolDefinitions || [];

  return {
    toolDefinitions: normalizedToolDefinitions,
    toolNames: new Set(
      normalizedToolDefinitions.map((definition) => definition.name),
    ),
    readToolNames: collectReadToolNames(normalizedToolDefinitions),
  };
};

export const hasTool = (context: AiChatPromptContext, name: string) =>
  context.toolNames.has(name);

export const collectToolPromptInstructions = (
  toolDefinitions?: AiChatToolDefinition[],
) => {
  return dedupePromptLines(
    (toolDefinitions || []).flatMap(
      (definition) => definition.promptInstructions || [],
    ),
  );
};

export const buildPageRangeLabel = (startPage: number, endPage: number) => {
  if (startPage === endPage) {
    return `page ${startPage}`;
  }

  return `pages ${startPage}-${endPage}`;
};

export const normalizeSummaryInstructions = (summaryInstructions?: string) => {
  const trimmed = summaryInstructions?.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed;
};
