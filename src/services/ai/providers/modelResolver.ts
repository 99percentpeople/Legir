import type { LanguageModel } from "ai";

import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_SPECS_SORTED_BY_LABEL,
  getAiProviderSpec,
  isAiProviderId,
} from "@/services/ai/providers/catalog";
import {
  getAiRuntimeAdapter,
  getAiSdkModelCatalogProvider,
} from "@/services/ai/providers/registry";
import { useEditorStore } from "@/store/useEditorStore";
import type { AppLLMModelOption, AppOptions, EditorState } from "@/types";
import { createAiSdkProviderRegistry } from "@/services/ai/providers/config";
import {
  getConfiguredAiSdkProvider,
  isAiSdkProviderConfigured,
} from "@/services/ai/providers/settings";
import {
  getAiChatReasoningPreference,
  mergeAiSdkModelCallOptions,
  normalizeReasoningPreference,
} from "@/services/ai/providers/runtimeAdapters";
import type {
  AiSdkModelSpecifier,
  AiSdkResolvedRuntime,
  AiSdkProviderId,
  AiSdkResolvedLanguageModel,
  AiSdkTaskModelKind,
} from "@/services/ai/providers/types";

const MODEL_SPECIFIER_SEPARATOR = ":";

type AiSdkModelCache = EditorState["llmModelCache"];

export type AiSdkModelGroup = {
  providerId: AiSdkProviderId;
  label: string;
  labelKey?: string;
  isAvailable: boolean;
  unavailableMessageKey?: string;
  models: AppLLMModelOption[];
};

const dedupeModelOptions = (
  models: Array<{
    id: string;
    label?: string;
    capabilities: AppLLMModelOption["capabilities"];
  }>,
) => {
  const output: AppLLMModelOption[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    const id = (model.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({
      id,
      label: (model.label || id).trim() || id,
      capabilities: model.capabilities,
    });
  }

  return output;
};

const getFallbackModelId = (providerId: AiSdkProviderId) =>
  getAiProviderSpec(providerId).fallbackModelId || "";

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
  AI_PROVIDER_IDS.filter((providerId) =>
    isAiSdkProviderConfigured(options, providerId),
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
  kind: AiSdkTaskModelKind,
): AiSdkResolvedLanguageModel => {
  const provider = getAiSdkModelCatalogProvider(specifier.providerId);
  return {
    specifier,
    model: resolveAiSdkLanguageModel(options, specifier),
    callOptions: provider.resolveCallOptions?.({
      modelId: specifier.modelId,
      kind,
    }),
  };
};

export const resolveAiSdkRuntime = (options: {
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  kind: AiSdkTaskModelKind;
  reasoning?: "chat-settings" | "none";
}): AiSdkResolvedRuntime => {
  const config = getConfiguredAiSdkProvider(
    options.appOptions,
    options.specifier.providerId,
  );
  if (!config) {
    throw new Error(
      `${options.specifier.providerId} is not configured for AI SDK runtime.`,
    );
  }

  const catalogProvider = getAiSdkModelCatalogProvider(
    options.specifier.providerId,
  );
  const adapter = getAiRuntimeAdapter(config);
  const runtimeRequest = {
    providerId: config.providerId,
    backendKind: config.backendKind,
    apiOptionId: config.apiOptionId,
    modelId: options.specifier.modelId,
    task: options.kind,
    appOptions: options.appOptions,
  };
  const preference =
    options.reasoning === "none"
      ? normalizeReasoningPreference({
          level: "none",
          displayPolicy: "hidden",
        })
      : getAiChatReasoningPreference(runtimeRequest);
  const reasoning = adapter.resolveReasoning({
    ...runtimeRequest,
    preference,
  });

  return {
    specifier: options.specifier,
    model: resolveAiSdkLanguageModel(options.appOptions, options.specifier),
    adapter,
    reasoning,
    request: runtimeRequest,
    callOptions: mergeAiSdkModelCallOptions(
      catalogProvider.resolveCallOptions?.({
        modelId: options.specifier.modelId,
        kind: options.kind,
      }),
      reasoning.callOptions,
    ),
  };
};

export const resolveAiSdkLanguageModelFromCurrentOptions = (
  specifier: AiSdkModelSpecifier,
) => resolveAiSdkLanguageModel(useEditorStore.getState().options, specifier);

export const getAiSdkProviderModelOptions = (options: {
  appOptions: AppOptions;
  modelCache: AiSdkModelCache;
  providerId: AiSdkProviderId;
  kind: AiSdkTaskModelKind;
}) =>
  dedupeModelOptions(
    getAiSdkModelCatalogProvider(options.providerId).getModelsForTask({
      appOptions: options.appOptions,
      modelCache: options.modelCache,
      kind: options.kind,
    }),
  );

export const getAiSdkModelGroups = (options: {
  appOptions: AppOptions;
  modelCache: AiSdkModelCache;
  kind: AiSdkTaskModelKind;
}) =>
  AI_PROVIDER_SPECS_SORTED_BY_LABEL.map(
    (spec): AiSdkModelGroup => ({
      providerId: spec.id,
      label: spec.label,
      labelKey: spec.labelKey,
      isAvailable: isAiSdkProviderConfigured(options.appOptions, spec.id),
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
  if (
    explicitSpecifier &&
    isAiSdkProviderConfigured(options.appOptions, explicitSpecifier.providerId)
  ) {
    return explicitSpecifier;
  }

  const providerId = getPreferredProviderId({
    appOptions: options.appOptions,
    requestedProviderId: options.providerId,
  });

  const requestedModelId = (options.modelId || "").trim();
  const canUseRequestedModelId =
    !!requestedModelId &&
    (!options.providerId || options.providerId === providerId);
  if (canUseRequestedModelId) {
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
  const fallbackModelId = firstKnownModel || getFallbackModelId(providerId);

  if (!fallbackModelId) {
    throw new Error(`No available ${providerId} ${options.kind} models.`);
  }

  return {
    providerId,
    modelId: fallbackModelId,
  };
};
