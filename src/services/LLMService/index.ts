import { llmService } from "./llmService";
import type {
  LLMAnalyzePageForFieldsOptions,
  LLMModelOption,
  LLMTranslateTextOptions,
  LLMProvider,
} from "./types";
import type { FormField } from "@/types";
import { translateService } from "@/services/translateService";

import {
  geminiProvider,
  resetGeminiModelCache,
  checkGeminiConfig,
} from "./providers/geminiProvider";

import {
  openaiProvider,
  resetOpenAiModelCache,
  checkOpenAiConfig,
} from "./providers/openaiProvider";
import { useEditorStore } from "@/store/useEditorStore";

llmService.registerProvider(geminiProvider);
llmService.registerProvider(openaiProvider);

const resolveDefaultProviderId = () => {
  if (llmService.isProviderAvailable(openaiProvider.id))
    return openaiProvider.id;
  if (llmService.isProviderAvailable(geminiProvider.id))
    return geminiProvider.id;
  return geminiProvider.id;
};

llmService.setDefaultProviderId(resolveDefaultProviderId());

const getAnyAvailableProviderWithFunction = (
  kind: "translate" | "formDetect",
): LLMProvider | null => {
  for (const p of llmService.getProviders()) {
    if (!p.isAvailable()) continue;
    const fn =
      kind === "translate"
        ? p.getFunctions().translate
        : p.getFunctions().formDetect;
    if (fn) return p;
  }
  return null;
};

const registerTranslateOptionsFromProviders = () => {
  for (const provider of llmService.getProviders()) {
    const fn = provider.getFunctions().translate;
    if (!fn) continue;

    const models = fn.getModels();
    translateService.registerOptionGroup({
      id: provider.id,
      label: provider.label,
      labelKey: provider.labelKey,
      options: models.map((m) => ({
        id: m.id,
        label: m.label,
        labelKey: m.labelKey,
      })),
      isLLM: true,
      isAvailable: () => provider.isAvailable(),
      unavailableMessageKey: provider.unavailableMessageKey,
      translate: async (text, optionId, opts) => {
        return await fn.translateText(text, {
          modelId: optionId,
          targetLanguage: opts.targetLanguage,
          sourceLanguage: opts.sourceLanguage,
          prompt: opts.prompt,
          signal: opts.signal,
        });
      },
      translateStream: fn.translateTextStream
        ? (text, optionId, opts) => {
            return fn.translateTextStream!(text, {
              modelId: optionId,
              targetLanguage: opts.targetLanguage,
              sourceLanguage: opts.sourceLanguage,
              prompt: opts.prompt,
              signal: opts.signal,
            });
          }
        : undefined,
    });
  }
};

registerTranslateOptionsFromProviders();

const llmModelRegistryListeners = new Set<() => void>();

export const subscribeLLMModelRegistry = (listener: () => void) => {
  llmModelRegistryListeners.add(listener);
  return () => {
    llmModelRegistryListeners.delete(listener);
  };
};

export type LoadModelsOptions = {
  providerIds?: string[];
  force?: boolean;
  throwOnError?: boolean;
};

export const checkLlmProviderConfig = async (providerId: string) => {
  if (providerId === geminiProvider.id) {
    await checkGeminiConfig();
    return;
  }
  if (providerId === openaiProvider.id) {
    await checkOpenAiConfig();
    return;
  }
  throw new Error(`Unknown LLM provider: ${providerId}`);
};

export const loadModels = async (opts?: LoadModelsOptions) => {
  const providerIdSet =
    opts?.providerIds && opts.providerIds.length > 0
      ? new Set(opts.providerIds)
      : null;
  const force = opts?.force === true;
  const throwOnError = opts?.throwOnError === true;

  const providers = llmService.getProviders();
  const refreshProviders = providerIdSet
    ? providers.filter((p) => providerIdSet.has(p.id))
    : providers;

  const snapshot = useEditorStore.getState();
  const prev = snapshot.options;
  const geminiApiKey = (prev.llm.gemini.apiKey || "").trim();
  const openaiApiKey = (prev.llm.openai.apiKey || "").trim();
  const openaiApiUrl = (prev.llm.openai.apiUrl || "").trim();

  const hasGeminiKey = geminiApiKey.length > 0;
  const hasOpenAiKey = openaiApiKey.length > 0;

  if (geminiApiKey || openaiApiKey || openaiApiUrl) {
    useEditorStore.getState().setOptions((o) => ({
      ...o,
      llm: {
        ...o.llm,
        gemini: {
          ...o.llm.gemini,
          apiKey: geminiApiKey,
        },
        openai: {
          ...o.llm.openai,
          apiKey: openaiApiKey,
          apiUrl: openaiApiUrl,
        },
      },
    }));
  }

  if (force) {
    if (!providerIdSet || providerIdSet.has(geminiProvider.id)) {
      resetGeminiModelCache();
    }
    if (!providerIdSet || providerIdSet.has(openaiProvider.id)) {
      resetOpenAiModelCache();
    }
  }

  if (
    !hasGeminiKey &&
    (!providerIdSet || providerIdSet.has(geminiProvider.id))
  ) {
    resetGeminiModelCache();
  }
  if (
    !hasOpenAiKey &&
    (!providerIdSet || providerIdSet.has(openaiProvider.id))
  ) {
    resetOpenAiModelCache();
  }

  for (const p of refreshProviders) {
    if (p.id === geminiProvider.id && !hasGeminiKey) continue;
    if (p.id === openaiProvider.id && !hasOpenAiKey) continue;

    const fns = p.getFunctions();
    const translate = fns.translate;
    const formDetect = fns.formDetect;

    try {
      await translate?.refreshModels?.();
    } catch (err) {
      if (throwOnError) throw err;
    }

    try {
      await formDetect?.refreshModels?.();
    } catch (err) {
      if (throwOnError) throw err;
    }
  }

  registerTranslateOptionsFromProviders();

  const shouldUpdate = (providerId: string) => {
    return !providerIdSet || providerIdSet.has(providerId);
  };

  const prevCache = useEditorStore.getState().llmModelCache;

  const geminiTranslateModels = shouldUpdate(geminiProvider.id)
    ? hasGeminiKey
      ? geminiProvider
          .getFunctions()
          .translate?.getModels()
          .map((m) => ({ id: m.id, label: m.label, labelKey: m.labelKey }))
      : []
    : prevCache.geminiTranslateModels;
  const geminiVisionModels = shouldUpdate(geminiProvider.id)
    ? hasGeminiKey
      ? geminiProvider
          .getFunctions()
          .formDetect?.getModels()
          .map((m) => ({ id: m.id, label: m.label, labelKey: m.labelKey }))
      : []
    : prevCache.geminiVisionModels;
  const openaiTranslateModels = shouldUpdate(openaiProvider.id)
    ? hasOpenAiKey
      ? openaiProvider
          .getFunctions()
          .translate?.getModels()
          .map((m) => ({ id: m.id, label: m.label, labelKey: m.labelKey }))
      : []
    : prevCache.openaiTranslateModels;
  const openaiVisionModels = shouldUpdate(openaiProvider.id)
    ? hasOpenAiKey
      ? openaiProvider
          .getFunctions()
          .formDetect?.getModels()
          .map((m) => ({ id: m.id, label: m.label, labelKey: m.labelKey }))
      : []
    : prevCache.openaiVisionModels;

  useEditorStore.getState().setState({
    llmModelCache: {
      geminiTranslateModels: geminiTranslateModels ?? [],
      geminiVisionModels: geminiVisionModels ?? [],
      openaiTranslateModels: openaiTranslateModels ?? [],
      openaiVisionModels: openaiVisionModels ?? [],
    },
  });

  for (const l of llmModelRegistryListeners) l();
};

void loadModels();

const getTranslateFunction = () => {
  const p = llmService.getDefaultProvider();
  const fn = p.isAvailable() ? p.getFunctions().translate : undefined;
  if (!fn) {
    const fallback = getAnyAvailableProviderWithFunction("translate");
    const fallbackFn = fallback?.getFunctions().translate;
    if (!fallbackFn) {
      throw new Error("No available LLM provider supports translation.");
    }
    return fallbackFn;
  }
  return fn;
};

const getFormDetectFunction = (providerId?: string) => {
  if (providerId) {
    const p = llmService.getProvider(providerId);
    const fn = p?.getFunctions().formDetect;
    if (!p || !fn) {
      throw new Error(`LLM provider does not support analysis: ${providerId}`);
    }
    return fn;
  }

  const p = llmService.getDefaultProvider();
  const fn = p.isAvailable() ? p.getFunctions().formDetect : undefined;
  if (!fn) {
    const fallback = getAnyAvailableProviderWithFunction("formDetect");
    const fallbackFn = fallback?.getFunctions().formDetect;
    if (!fallbackFn) {
      throw new Error("No available LLM provider supports analysis.");
    }
    return fallbackFn;
  }
  return fn;
};

export const isFormDetectAvailable = () => {
  try {
    return llmService
      .getProviders()
      .some((p) => Boolean(p.getFunctions().formDetect) && p.isAvailable());
  } catch {
    return false;
  }
};

export const getFormDetectModels = (): LLMModelOption[] => {
  try {
    return getFormDetectFunction().getModels();
  } catch {
    return [];
  }
};

export type FormDetectModelGroup = {
  providerId: string;
  label: string;
  labelKey?: string;
  isAvailable: boolean;
  unavailableMessageKey?: string;
  models: LLMModelOption[];
};

export const getFormDetectModelGroups = (): FormDetectModelGroup[] => {
  const groups: FormDetectModelGroup[] = [];
  for (const p of llmService.getProviders()) {
    const fn = p.getFunctions().formDetect;
    if (!fn) continue;
    groups.push({
      providerId: p.id,
      label: p.label,
      labelKey: p.labelKey,
      isAvailable: p.isAvailable(),
      unavailableMessageKey: p.unavailableMessageKey,
      models: fn.getModels(),
    });
  }
  return groups;
};

export type TranslateTextOptions = LLMTranslateTextOptions;
export type TranslateTextStreamOptions = LLMTranslateTextOptions;
export type AIAnalysisOptions = LLMAnalyzePageForFieldsOptions;

export const translateText = async (
  text: string,
  opts: TranslateTextOptions,
) => {
  return await getTranslateFunction().translateText(text, opts);
};

export async function* translateTextStream(
  text: string,
  opts: TranslateTextStreamOptions,
): AsyncGenerator<string> {
  const fn = getTranslateFunction();
  if (fn.translateTextStream) {
    yield* fn.translateTextStream(text, opts);
    return;
  }
  yield await fn.translateText(text, opts);
}

export const analyzePageForFields = async (
  base64Image: string,
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
  existingFields: FormField[] = [],
  options?: AIAnalysisOptions,
) => {
  return await getFormDetectFunction(options?.providerId).analyzePageForFields(
    base64Image,
    pageIndex,
    pageWidth,
    pageHeight,
    existingFields,
    options,
  );
};
