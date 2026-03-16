import type { LanguageModel } from "ai";

import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_SPECS,
  isAiProviderId,
} from "@/services/ai/sdk/providerCatalog";
import { filterSupportedGeminiToolCallingModelIds } from "@/services/ai/utils/geminiModelSupport";
import { useEditorStore } from "@/store/useEditorStore";
import type { AppLLMModelOption, AppOptions, EditorState } from "@/types";
import { createAiSdkProviderRegistry } from "@/services/ai/sdk/providers";
import { getAiSdkFallbackModelId } from "@/services/ai/sdk/modelCatalog";
import type {
  AiSdkModelSpecifier,
  AiSdkProviderId,
  AiSdkResolvedLanguageModel,
} from "@/services/ai/sdk/types";

const MODEL_SPECIFIER_SEPARATOR = ":";

type AiSdkTaskModelKind = "translate" | "vision" | "chat" | "summarize";
type AiSdkModelCache = EditorState["llmModelCache"];

export type AiSdkModelGroup = {
  providerId: AiSdkProviderId;
  label: string;
  labelKey?: string;
  isAvailable: boolean;
  unavailableMessageKey?: string;
  models: AppLLMModelOption[];
};

const dedupeModelOptions = (models: Array<{ id: string; label?: string }>) => {
  const output: AppLLMModelOption[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    const id = (model.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({
      id,
      label: (model.label || id).trim() || id,
    });
  }

  return output;
};

const getCacheBucket = (kind: AiSdkTaskModelKind) =>
  kind === "vision" ? "visionModels" : "translateModels";

export const parseAiSdkModelSpecifier = (
  value: string | null | undefined,
): AiSdkModelSpecifier | null => {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;

  const separatorIndex = trimmed.indexOf(MODEL_SPECIFIER_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }

  const providerId = trimmed.slice(0, separatorIndex).trim();
  const modelId = trimmed.slice(separatorIndex + 1).trim();

  if (!isAiProviderId(providerId) || !modelId) return null;

  return {
    providerId,
    modelId,
  };
};

export const stringifyAiSdkModelSpecifier = (specifier: AiSdkModelSpecifier) =>
  `${specifier.providerId}:${specifier.modelId}`;

export const getConfiguredAiSdkProviderIds = (options: AppOptions) =>
  AI_PROVIDER_IDS.filter(
    (providerId) => !!(options.llm[providerId].apiKey || "").trim(),
  );

export const resolveAiSdkLanguageModel = (
  options: AppOptions,
  specifier: AiSdkModelSpecifier,
): LanguageModel => {
  const registry = createAiSdkProviderRegistry(options);
  return registry.languageModel(
    stringifyAiSdkModelSpecifier(specifier) as `${string}:${string}`,
  );
};

export const resolveAiSdkLanguageModelDetailed = (
  options: AppOptions,
  specifier: AiSdkModelSpecifier,
): AiSdkResolvedLanguageModel => ({
  specifier,
  model: resolveAiSdkLanguageModel(options, specifier),
});

export const resolveAiSdkLanguageModelFromCurrentOptions = (
  specifier: AiSdkModelSpecifier,
) => resolveAiSdkLanguageModel(useEditorStore.getState().options, specifier);

export const getAiSdkProviderCustomModels = (options: {
  appOptions: AppOptions;
  modelCache: AiSdkModelCache;
  providerId: AiSdkProviderId;
  kind: AiSdkTaskModelKind;
}) => {
  const ids =
    options.kind === "vision"
      ? options.appOptions.llm[options.providerId].customVisionModels
      : options.appOptions.llm[options.providerId].customTranslateModels;

  const normalizedIds =
    options.providerId === "gemini"
      ? filterSupportedGeminiToolCallingModelIds(ids || [])
      : (ids || []).map((id) => id.trim()).filter(Boolean);
  const knownIds =
    options.providerId === "gemini"
      ? new Set(
          options.modelCache[options.providerId][
            getCacheBucket(options.kind)
          ].map((model) => model.id),
        )
      : null;

  return normalizedIds
    .filter((id, index, list) => list.indexOf(id) === index)
    .filter((id) => !knownIds || knownIds.size === 0 || knownIds.has(id))
    .map((id) => ({
      id,
      label: id,
    }));
};

export const getAiSdkProviderModelOptions = (options: {
  appOptions: AppOptions;
  modelCache: AiSdkModelCache;
  providerId: AiSdkProviderId;
  kind: AiSdkTaskModelKind;
}) =>
  dedupeModelOptions([
    ...options.modelCache[options.providerId][getCacheBucket(options.kind)],
    ...getAiSdkProviderCustomModels(options),
  ]);

export const getAiSdkModelGroups = (options: {
  appOptions: AppOptions;
  modelCache: AiSdkModelCache;
  kind: AiSdkTaskModelKind;
}) =>
  AI_PROVIDER_SPECS.map(
    (spec): AiSdkModelGroup => ({
      providerId: spec.id,
      label: spec.label,
      labelKey: spec.labelKey,
      isAvailable: !!(options.appOptions.llm[spec.id].apiKey || "").trim(),
      unavailableMessageKey: spec.unavailableMessageKey,
      models: getAiSdkProviderModelOptions({
        appOptions: options.appOptions,
        modelCache: options.modelCache,
        providerId: spec.id,
        kind: options.kind,
      }),
    }),
  );

const getPreferredProviderId = (options: {
  appOptions: AppOptions;
  requestedProviderId?: string;
}) => {
  if (
    options.requestedProviderId &&
    isAiProviderId(options.requestedProviderId) &&
    getConfiguredAiSdkProviderIds(options.appOptions).includes(
      options.requestedProviderId,
    )
  ) {
    return options.requestedProviderId;
  }

  const firstConfigured = getConfiguredAiSdkProviderIds(options.appOptions)[0];
  if (firstConfigured) return firstConfigured;

  if (
    options.requestedProviderId &&
    isAiProviderId(options.requestedProviderId)
  ) {
    return options.requestedProviderId;
  }

  return AI_PROVIDER_IDS[0];
};

export const resolveAiSdkModelSpecifierForTask = (options: {
  appOptions: AppOptions;
  modelCache: AiSdkModelCache;
  kind: AiSdkTaskModelKind;
  modelKey?: string;
  providerId?: string;
  modelId?: string;
}): AiSdkModelSpecifier => {
  const explicitSpecifier = parseAiSdkModelSpecifier(options.modelKey);
  if (explicitSpecifier) {
    return explicitSpecifier;
  }

  const providerId = getPreferredProviderId({
    appOptions: options.appOptions,
    requestedProviderId: options.providerId,
  });

  const requestedModelId = (options.modelId || "").trim();
  if (requestedModelId) {
    return {
      providerId,
      modelId: requestedModelId,
    };
  }

  const firstKnownModel = getAiSdkProviderModelOptions({
    appOptions: options.appOptions,
    modelCache: options.modelCache,
    providerId,
    kind: options.kind,
  })[0]?.id;
  const fallbackModelId =
    firstKnownModel ||
    getAiSdkFallbackModelId({
      appOptions: options.appOptions,
      providerId,
    });

  if (!fallbackModelId) {
    throw new Error(`No available ${providerId} ${options.kind} models.`);
  }

  return {
    providerId,
    modelId: fallbackModelId,
  };
};
