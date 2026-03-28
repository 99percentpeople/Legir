/**
 * Shared AI service contracts outside the chat runtime.
 *
 * This file holds provider-agnostic capability interfaces that can be reused by
 * form detection, translation, summarization, or older AI integrations.
 * Chat-specific tool/runtime/message contracts live under `src/services/ai/chat`.
 */
import type { AppLLMModelOption, FieldType, FormField } from "@/types";

export type LLMProviderId = string;

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

export type LLMAnalyzePageForFieldsOptions = {
  allowedTypes?: FieldType[];
  extraPrompt?: string;
  providerId?: LLMProviderId;
  modelId?: string;
};

export interface LLMFormDetectFunction {
  kind: "formDetect";
  getModels: () => LLMModelOption[];
  refreshModels?: () => Promise<void>;

  analyzePageForFields: (
    base64Image: string,
    pageIndex: number,
    pageWidth: number,
    pageHeight: number,
    existingFields?: FormField[],
    options?: LLMAnalyzePageForFieldsOptions,
  ) => Promise<FormField[]>;
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
