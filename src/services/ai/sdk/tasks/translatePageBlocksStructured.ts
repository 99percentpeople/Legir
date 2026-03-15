import { generateText } from "ai";
import { z } from "zod";

import { parseJsonTextWithSchema } from "@/services/ai/sdk/json";
import { resolveAiSdkLanguageModel } from "@/services/ai/sdk/modelRegistry";
import type { AiSdkModelSpecifier } from "@/services/ai/sdk/types";
import type { AppOptions } from "@/types";

export type AiSdkPageTranslateBlock = {
  id: string;
  order: number;
  text: string;
  maxChars?: number;
};

export type AiSdkPageTranslateResponse = {
  translations: Array<{
    id: string;
    action: "translate" | "skip";
    translatedText?: string | null;
  }>;
};

const translationResponseSchema = z.object({
  translations: z
    .array(
      z.object({
        id: z.string(),
        action: z.enum(["translate", "skip"]),
        translatedText: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export const translatePageBlocksStructuredWithAiSdk = async (options: {
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  blocks: AiSdkPageTranslateBlock[];
  context?: Array<{ pageIndex: number; text: string }>;
  targetLanguage: string;
  sourceLanguage?: string;
  prompt?: string;
  usePositionAwarePrompt?: boolean;
  aiReflowParagraphs?: boolean;
  signal?: AbortSignal;
}): Promise<AiSdkPageTranslateResponse> => {
  const model = resolveAiSdkLanguageModel(
    options.appOptions,
    options.specifier,
  );
  const extraInstructions = (options.prompt || "").trim();
  const lineBreakRule = options.aiReflowParagraphs
    ? "- You MAY reflow paragraphs within each block: treat PDF/text-layer line breaks as layout artifacts unless they are clearly intentional paragraph breaks. Prefer natural sentences and remove unnecessary mid-sentence line breaks. Do NOT add extra line breaks; only keep or add line breaks when truly necessary."
    : "- Preserve existing line breaks within each block. Do NOT add extra line breaks.";
  const positionAware = options.usePositionAwarePrompt
    ? "\n- Each block may include a maxChars hint. Prefer translations that fit within maxChars."
    : "";

  const prompt = `
You are a professional translator.

Task:
- Translate the target page blocks to ${options.targetLanguage}.
- You may SKIP blocks that are not meaningful to translate, such as pure symbols or page numbers.
- IMPORTANT: If you choose "skip", do NOT include translatedText.
- IMPORTANT: If you want an intentional blank placeholder translation, use action "translate" with "translatedText": "".
- Preserve meaning.
${lineBreakRule}
- Output MUST be valid JSON. No markdown.
${positionAware}

Output JSON schema:
{
  "translations": [
    {
      "id": string,
      "action": "translate" | "skip",
      "translatedText"?: string | null
    }
  ]
}

${extraInstructions ? `Additional instructions:\n${extraInstructions}\n` : ""}

Input JSON:
${JSON.stringify(
  {
    source_language: options.sourceLanguage || null,
    target_language: options.targetLanguage,
    target: {
      blocks: options.blocks,
    },
    context: options.context ?? [],
  },
  null,
  2,
)}
`.trim();

  const result = await generateText({
    model,
    system:
      "Return only JSON. Do not wrap in markdown fences. Do not add commentary.",
    prompt,
    abortSignal: options.signal,
  });

  if (!result.text.trim()) {
    return { translations: [] };
  }

  const parsed = parseJsonTextWithSchema(
    result.text,
    translationResponseSchema,
    "Structured translation",
  );

  return {
    translations: (parsed.translations || []).map((translation) => ({
      id: translation.id,
      action: translation.action,
      ...(translation.translatedText !== undefined
        ? { translatedText: translation.translatedText }
        : {}),
    })),
  };
};
