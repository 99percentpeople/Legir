import {
  NoSuchModelError,
  type EmbeddingModelV3,
  type ImageModelV3,
  type LanguageModelV3,
} from "@ai-sdk/provider";
import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible";
import {
  withoutTrailingSlash,
  withUserAgentSuffix,
} from "@ai-sdk/provider-utils";
import type { ModelMessage } from "ai";

import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type { AiRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/types";

type OpenAiCompatibleChatOnlyOptions = {
  defaultBaseUrl: string;
  providerName: string;
  userAgentSuffix: string;
  includeUsage?: boolean;
  supportsStructuredOutputs?: boolean;
};

export const createOpenAiCompatibleChatOnlyProvider = (
  config: AiSdkProviderConfig,
  options: OpenAiCompatibleChatOnlyOptions,
) => {
  const baseURL = withoutTrailingSlash(
    config.baseURL ?? options.defaultBaseUrl,
  );
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
  };
  const getHeaders = () =>
    withUserAgentSuffix(headers, options.userAgentSuffix);

  const createChatModel = (modelId: string): LanguageModelV3 =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: options.providerName,
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: config.fetch,
      includeUsage: options.includeUsage ?? true,
      ...(typeof options.supportsStructuredOutputs === "boolean"
        ? { supportsStructuredOutputs: options.supportsStructuredOutputs }
        : {}),
    });

  const createEmbeddingModel = (modelId: string): EmbeddingModelV3 => {
    throw new NoSuchModelError({ modelId, modelType: "embeddingModel" });
  };

  const createImageModel = (modelId: string): ImageModelV3 => {
    throw new NoSuchModelError({ modelId, modelType: "imageModel" });
  };

  return Object.assign((modelId: string) => createChatModel(modelId), {
    specificationVersion: "v3" as const,
    languageModel: createChatModel,
    chatModel: createChatModel,
    chat: createChatModel,
    embeddingModel: createEmbeddingModel,
    textEmbeddingModel: createEmbeddingModel,
    imageModel: createImageModel,
  });
};

const hasToolCallPart = (message: ModelMessage) =>
  message.role === "assistant" &&
  Array.isArray(message.content) &&
  message.content.some((part) => part.type === "tool-call");

const hasReasoningPart = (message: ModelMessage) =>
  message.role === "assistant" &&
  Array.isArray(message.content) &&
  message.content.some(
    (part) =>
      part.type === "reasoning" &&
      typeof part.text === "string" &&
      part.text.trim(),
  );

type ValidateMessagesRequest = Parameters<
  NonNullable<AiRuntimeAdapter["validateMessages"]>
>[1];

export const validateReasoningBeforeToolCalls = (
  messages: ModelMessage[],
  request: ValidateMessagesRequest,
  providerLabel: string,
) => {
  if (request.reasoning.replayPolicy !== "tool-calls") return;

  const missingReasoning = messages.some(
    (message) => hasToolCallPart(message) && !hasReasoningPart(message),
  );
  if (!missingReasoning) return;

  throw new Error(
    `${providerLabel} thinking mode requires reasoning content before assistant tool calls.`,
  );
};
