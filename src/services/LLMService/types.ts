export type LLMProviderId = string;

import type { FieldType, FormField } from "@/types";

export interface LLMProvider {
  id: LLMProviderId;
  isAvailable: () => boolean;
}

export interface LLMTranslateTextOptions<TModel extends string = string> {
  model?: TModel;
  targetLanguage: string;
  sourceLanguage?: string;
  signal?: AbortSignal;
}

export interface LLMTranslateProvider<
  TModel extends string = string,
> extends LLMProvider {
  translateText: (
    text: string,
    opts: LLMTranslateTextOptions<TModel>,
  ) => Promise<string>;
  translateTextStream?: (
    text: string,
    opts: LLMTranslateTextOptions<TModel>,
  ) => AsyncGenerator<string>;
}

export type LLMAnalyzePageForFieldsOptions = {
  allowedTypes?: FieldType[];
  extraPrompt?: string;
  model?: string;
};

export interface LLMAnalyzePageForFieldsProvider extends LLMProvider {
  analyzePageForFields: (
    base64Image: string,
    pageIndex: number,
    pageWidth: number,
    pageHeight: number,
    existingFields?: FormField[],
    options?: LLMAnalyzePageForFieldsOptions,
  ) => Promise<FormField[]>;
}

export type LLMFeatureProvider =
  | LLMProvider
  | LLMTranslateProvider
  | LLMAnalyzePageForFieldsProvider;
