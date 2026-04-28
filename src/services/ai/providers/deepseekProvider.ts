import {
  NoSuchModelError,
  type EmbeddingModelV3,
  type ImageModelV3,
  type LanguageModelV3,
  type ProviderV3,
} from "@ai-sdk/provider";
import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible";
import {
  type FetchFunction,
  withoutTrailingSlash,
  withUserAgentSuffix,
} from "@ai-sdk/provider-utils";

export type DeepSeekChatModelId =
  | "deepseek-chat"
  | "deepseek-reasoner"
  | (string & {});

export interface DeepSeekProviderSettings {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: FetchFunction;
}

export interface DeepSeekProvider extends ProviderV3 {
  (modelId: DeepSeekChatModelId): LanguageModelV3;
  languageModel(modelId: DeepSeekChatModelId): LanguageModelV3;
  chatModel(modelId: DeepSeekChatModelId): LanguageModelV3;
  chat(modelId: DeepSeekChatModelId): LanguageModelV3;
}

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

export const createDeepSeekProvider = (
  options: DeepSeekProviderSettings = {},
): DeepSeekProvider => {
  const baseURL = withoutTrailingSlash(
    options.baseURL ?? DEFAULT_DEEPSEEK_BASE_URL,
  );
  const headers = {
    ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    ...options.headers,
  };

  const getHeaders = () =>
    withUserAgentSuffix(headers, "legir/deepseek-openai-compatible");

  const createChatModel = (modelId: DeepSeekChatModelId): LanguageModelV3 =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: "deepseek.chat",
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: options.fetch,
      includeUsage: true,
    });

  const createEmbeddingModel = (modelId: string): EmbeddingModelV3 => {
    throw new NoSuchModelError({ modelId, modelType: "embeddingModel" });
  };

  const createImageModel = (modelId: string): ImageModelV3 => {
    throw new NoSuchModelError({ modelId, modelType: "imageModel" });
  };

  return Object.assign(
    (modelId: DeepSeekChatModelId) => createChatModel(modelId),
    {
      specificationVersion: "v3" as const,
      languageModel: createChatModel,
      chatModel: createChatModel,
      chat: createChatModel,
      embeddingModel: createEmbeddingModel,
      textEmbeddingModel: createEmbeddingModel,
      imageModel: createImageModel,
    },
  );
};
