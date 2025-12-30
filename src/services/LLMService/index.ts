import { llmService } from "./llmService";
import type {
  LLMAnalyzePageForFieldsProvider,
  LLMTranslateProvider,
} from "./types";
import type { FormField } from "@/types";

import {
  geminiProvider,
  GEMINI_API_AVAILABLE,
  GEMINI_MODEL_OPTIONS,
  type GeminiModelId,
  type TranslateTextOptions,
  type TranslateTextStreamOptions,
  type AIAnalysisOptions,
} from "./providers/gemini/geminiProvider";

llmService.registerProvider(geminiProvider);
llmService.setDefaultProviderId(geminiProvider.id);

const getTranslateProvider = () => {
  const p = llmService.getDefaultProvider<LLMTranslateProvider>();
  if (!("translateText" in p)) {
    throw new Error("Default LLM provider does not support translation.");
  }
  return p;
};

const getAnalyzeProvider = () => {
  const p = llmService.getDefaultProvider<LLMAnalyzePageForFieldsProvider>();
  if (!("analyzePageForFields" in p)) {
    throw new Error("Default LLM provider does not support analysis.");
  }
  return p;
};

export {
  GEMINI_API_AVAILABLE,
  GEMINI_MODEL_OPTIONS,
  type GeminiModelId,
  type TranslateTextOptions,
  type TranslateTextStreamOptions,
  type AIAnalysisOptions,
};

export const translateText = async (
  text: string,
  opts: TranslateTextOptions,
) => {
  return await getTranslateProvider().translateText(text, opts);
};

export async function* translateTextStream(
  text: string,
  opts: TranslateTextStreamOptions,
): AsyncGenerator<string> {
  const provider = getTranslateProvider();
  if (provider.translateTextStream) {
    yield* provider.translateTextStream(text, opts);
    return;
  }
  yield await provider.translateText(text, opts);
}

export const analyzePageForFields = async (
  base64Image: string,
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
  existingFields: FormField[] = [],
  options?: AIAnalysisOptions,
) => {
  return await getAnalyzeProvider().analyzePageForFields(
    base64Image,
    pageIndex,
    pageWidth,
    pageHeight,
    existingFields,
    options,
  );
};
