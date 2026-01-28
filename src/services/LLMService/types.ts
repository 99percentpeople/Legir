import type { FieldType, FormField } from "@/types";

export type LLMProviderId = string;

export type LLMFunctionKind = "translate" | "formDetect";

export type LLMModelOption = {
  id: string;
  label: string;
  labelKey?: string;
};

export interface LLMTranslateTextOptions {
  modelId?: string;
  targetLanguage: string;
  sourceLanguage?: string;
  prompt?: string;
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

export type LLMProviderFunctions = {
  translate?: LLMTranslateFunction;
  formDetect?: LLMFormDetectFunction;
};

export interface LLMProvider {
  id: LLMProviderId;
  label: string;
  labelKey?: string;
  unavailableMessageKey?: string;
  isAvailable: () => boolean;
  getFunctions: () => LLMProviderFunctions;
}
