import type {
  AiChatToolDefinition,
  AiSummaryInstructions,
} from "@/services/ai/chat/types";

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

export const normalizeSummaryInstructions = (
  summaryInstructions?: Partial<AiSummaryInstructions>,
) => {
  if (!summaryInstructions) {
    return null;
  }

  const normalized = {
    known_information: summaryInstructions.known_information?.trim() || "",
    remaining_uncertainties:
      summaryInstructions.remaining_uncertainties?.trim() || "",
    what_to_add_or_verify:
      summaryInstructions.what_to_add_or_verify?.trim() || "",
  };

  if (
    !normalized.known_information &&
    !normalized.remaining_uncertainties &&
    !normalized.what_to_add_or_verify
  ) {
    return null;
  }

  return normalized;
};

export const formatSummaryInstructionsForPrompt = (
  summaryInstructions?: Partial<AiSummaryInstructions>,
) => {
  const normalized = normalizeSummaryInstructions(summaryInstructions);
  if (!normalized) {
    return [];
  }

  return [
    "Summary instructions:",
    "Known information:",
    normalized.known_information || "(none provided)",
    "Remaining uncertainties:",
    normalized.remaining_uncertainties || "(none provided)",
    "What to add or verify:",
    normalized.what_to_add_or_verify || "(none provided)",
  ];
};
