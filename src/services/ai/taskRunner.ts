import type { AiRenderedPageImage } from "@/services/ai/chat/types";
import { resolveAiSdkModelSpecifierForTask } from "@/services/ai/providers";
import {
  summarizePageImagesWithAiSdk,
  summarizeTextWithAiSdk,
  translateTextStreamWithAiSdk,
  translateTextWithAiSdk,
} from "@/services/ai/tasks";
import {
  getCurrentModelCache,
  getCurrentOptions,
} from "@/services/ai/editorState";
import type { LLMTranslateTextOptions } from "@/services/ai/types";

export type TranslateTextOptions = LLMTranslateTextOptions;
export type TranslateTextStreamOptions = LLMTranslateTextOptions;

export const translateText = async (
  text: string,
  options: TranslateTextOptions,
) => {
  const specifier = resolveAiSdkModelSpecifierForTask({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "translate",
    modelId: options.modelId,
  });
  return await translateTextWithAiSdk({
    text,
    appOptions: getCurrentOptions(),
    specifier,
    targetLanguage: options.targetLanguage,
    sourceLanguage: options.sourceLanguage,
    prompt: options.prompt,
    signal: options.signal,
  });
};

export async function* translateTextStream(
  text: string,
  options: TranslateTextStreamOptions,
): AsyncGenerator<string> {
  const specifier = resolveAiSdkModelSpecifierForTask({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "translate",
    modelId: options.modelId,
  });
  yield* translateTextStreamWithAiSdk({
    text,
    appOptions: getCurrentOptions(),
    specifier,
    targetLanguage: options.targetLanguage,
    sourceLanguage: options.sourceLanguage,
    prompt: options.prompt,
    signal: options.signal,
  });
}

const resolveSummarizeSpecifier = (options: {
  providerId?: string;
  modelId?: string;
}) =>
  resolveAiSdkModelSpecifierForTask({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "summarize",
    modelKey:
      options.providerId && options.modelId
        ? `${options.providerId}:${options.modelId}`
        : undefined,
    providerId: options.providerId,
    modelId: options.modelId,
  });

export type SummarizeConversationMemoryOptions = {
  providerId?: string;
  modelId?: string;
  system?: string;
  signal?: AbortSignal;
};

export const summarizeConversationMemory = async (
  text: string,
  options: SummarizeConversationMemoryOptions,
) => {
  const specifier = resolveSummarizeSpecifier(options);

  return await summarizeTextWithAiSdk({
    text,
    appOptions: getCurrentOptions(),
    specifier,
    system: options.system,
    signal: options.signal,
  });
};

export type SummarizePageImagesOptions = {
  modelKey?: string;
  providerId?: string;
  preferredProviderId?: string;
  modelId?: string;
  request?: string;
  signal?: AbortSignal;
};

export const summarizePageImages = async (
  pages: AiRenderedPageImage[],
  options: SummarizePageImagesOptions,
) => {
  const specifier = resolveAiSdkModelSpecifierForTask({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "vision",
    modelKey: options.modelKey,
    providerId: options.providerId,
    preferredProviderId: options.preferredProviderId,
    modelId: options.modelId,
  });

  return await summarizePageImagesWithAiSdk({
    appOptions: getCurrentOptions(),
    specifier,
    pages,
    request: options.request,
    signal: options.signal,
  });
};
