import { generateText, streamText } from "ai";

import { resolveAiSdkLanguageModel } from "@/services/ai/providers/modelRegistry";
import type { AiSdkModelSpecifier } from "@/services/ai/providers/types";
import type { AppOptions } from "@/types";

const buildTranslationPrompt = (
  text: string,
  options: {
    targetLanguage: string;
    sourceLanguage?: string;
    prompt?: string;
  },
) => {
  return `
You are a professional translator.

Task:
- Translate the following text${options.sourceLanguage ? ` from ${options.sourceLanguage}` : ""} to ${options.targetLanguage}.
- Preserve the original meaning.
- Keep formatting and line breaks where appropriate.
- Output ONLY the translated text. No explanations.

${options.prompt ? `Additional instructions:\n${options.prompt}\n` : ""}

Text:
${text}
`.trim();
};

export const translateTextWithAiSdk = async (options: {
  text: string;
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  targetLanguage: string;
  sourceLanguage?: string;
  prompt?: string;
  signal?: AbortSignal;
}) => {
  const model = resolveAiSdkLanguageModel(
    options.appOptions,
    options.specifier,
  );

  const result = await generateText({
    model,
    system:
      "You are a professional translator. Return only the translated text.",
    prompt: buildTranslationPrompt(options.text, options),
    abortSignal: options.signal,
  });

  return result.text.trim();
};

export async function* translateTextStreamWithAiSdk(options: {
  text: string;
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  targetLanguage: string;
  sourceLanguage?: string;
  prompt?: string;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const model = resolveAiSdkLanguageModel(
    options.appOptions,
    options.specifier,
  );

  const result = streamText({
    model,
    system:
      "You are a professional translator. Stream only the translated text.",
    prompt: buildTranslationPrompt(options.text, options),
    abortSignal: options.signal,
  });

  for await (const part of result.fullStream) {
    if (part.type !== "text-delta" || !part.text) continue;
    yield part.text;
  }
}
