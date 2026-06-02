/**
 * Shared AI service contracts outside the chat runtime.
 *
 * This file holds provider-agnostic capability interfaces that can be reused by
 * translation, summarization, or older AI integrations.
 * Chat-specific tool/runtime/message contracts live under `src/services/ai/chat`.
 */
import type { AppLLMModelOption } from "@/types";

export type LLMModelOption = AppLLMModelOption;

export interface LLMTranslateTextOptions {
  modelId?: string;
  targetLanguage: string;
  sourceLanguage?: string;
  prompt?: string;
  signal?: AbortSignal;
}

export interface LLMSummarizeTextOptions {
  modelId?: string;
  prompt?: string;
  system?: string;
  signal?: AbortSignal;
}

export interface LLMTranslateFunction {
  kind: "translate";
  getModels: () => LLMModelOption[];
  refreshModels?: () => Promise<void>;

  translateText: (
    text: string,
    opts: LLMTranslateTextOptions,
  ) => Promise<string>;
  translateTextStream?: (
    text: string,
    opts: LLMTranslateTextOptions,
  ) => AsyncGenerator<string>;
}

export interface LLMSummarizeFunction {
  kind: "summarize";
  getModels: () => LLMModelOption[];
  refreshModels?: () => Promise<void>;
  summarizeText: (
    text: string,
    opts: LLMSummarizeTextOptions,
  ) => Promise<string>;
}
