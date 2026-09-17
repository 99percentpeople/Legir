import type { LanguageModel } from "ai";

import {
  AI_PROVIDER_IDS,
  getAiProviderSpec,
  isAiProviderId,
} from "@/services/ai/providers/catalog";
import { getAiRuntimeAdapter } from "@/services/ai/providers/registry";
import { getAiSdkModelCatalogProvider } from "@/services/ai/providers/modelCatalogRegistry";
import { getAiSdkProviderModelOptions } from "@/services/ai/providers/modelSelection";
import { useEditorStore } from "@/store/useEditorStore";
import type { AppOptions, EditorState } from "@/types";
import { createApiProxyFetch } from "@/services/platform/apiProxy";
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

export type { AiSdkModelGroup } from "@/services/ai/providers/modelSelection";
export {
  getAiSdkModelGroups,
  getAiSdkProviderModelOptions,
} from "@/services/ai/providers/modelSelection";

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

const createLanguageModel = async (options: {
  appOptions: AppOptions;
  config: NonNullable<ReturnType<typeof getConfiguredAiSdkProvider>>;
  adapter: ReturnType<typeof getAiRuntimeAdapter>;
  modelId: string;
}): Promise<LanguageModel> => {
  const provider = await options.adapter.createSdkProvider({
    ...options.config,
    fetch: createApiProxyFetch(options.appOptions),
  });
  return provider.languageModel(options.modelId);
};

export const resolveAiSdkLanguageModel = async (
  options: AppOptions,
  specifier: AiSdkModelSpecifier,
): Promise<LanguageModel> => {
  const config = getConfiguredAiSdkProvider(options, specifier.providerId);
  if (!config) {
    throw new Error(
      `${specifier.providerId} is not configured for AI SDK runtime.`,
    );
  }
  const adapter = getAiRuntimeAdapter(config);
  return await createLanguageModel({
    appOptions: options,
    config,
    adapter,
    modelId: specifier.modelId,
  });
};

export const resolveAiSdkLanguageModelDetailed = async (
  options: AppOptions,
  specifier: AiSdkModelSpecifier,
  kind: AiSdkTaskModelKind,
): Promise<AiSdkResolvedLanguageModel> => {
  const provider = getAiSdkModelCatalogProvider(specifier.providerId);
  return {
    specifier,
    model: await resolveAiSdkLanguageModel(options, specifier),
    callOptions: provider.resolveCallOptions?.({
      modelId: specifier.modelId,
      kind,
    }),
  };
};

export const resolveAiSdkRuntime = async (options: {
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  kind: AiSdkTaskModelKind;
  reasoning?: "chat-settings" | "none";
}): Promise<AiSdkResolvedRuntime> => {
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
    model: await createLanguageModel({
      appOptions: options.appOptions,
      config,
      adapter,
      modelId: options.specifier.modelId,
    }),
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

const getPreferredProviderIdForTask = (options: {
  appOptions: AppOptions;
  modelCache: AiSdkModelCache;
  kind: AiSdkTaskModelKind;
  requestedProviderId?: string;
  preferredProviderId?: string;
}) => {
  if (options.requestedProviderId) {
    return getPreferredProviderId(options);
  }

  if (
    options.preferredProviderId &&
    isAiProviderId(options.preferredProviderId) &&
    isAiSdkProviderConfigured(
      options.appOptions,
      options.preferredProviderId,
    ) &&
    getAiSdkProviderModelOptions({
      appOptions: options.appOptions,
      modelCache: options.modelCache,
      providerId: options.preferredProviderId,
      kind: options.kind,
    }).length > 0
  ) {
    return options.preferredProviderId;
  }

  const configuredProviderWithTaskModel = getConfiguredAiSdkProviderIds(
    options.appOptions,
  ).find(
    (providerId) =>
      getAiSdkProviderModelOptions({
        appOptions: options.appOptions,
        modelCache: options.modelCache,
        providerId,
        kind: options.kind,
      }).length > 0,
  );
  if (configuredProviderWithTaskModel) return configuredProviderWithTaskModel;

  return getPreferredProviderId(options);
};

export const resolveAiSdkModelSpecifierForTask = (options: {
  appOptions: AppOptions;
  modelCache: AiSdkModelCache;
  kind: AiSdkTaskModelKind;
  modelKey?: string;
  providerId?: string;
  preferredProviderId?: string;
  modelId?: string;
}): AiSdkModelSpecifier => {
  const explicitSpecifier = parseAiSdkModelSpecifier(options.modelKey);
  if (
    explicitSpecifier &&
    isAiSdkProviderConfigured(options.appOptions, explicitSpecifier.providerId)
  ) {
    return explicitSpecifier;
  }

  const providerId = getPreferredProviderIdForTask({
    appOptions: options.appOptions,
    modelCache: options.modelCache,
    kind: options.kind,
    requestedProviderId: options.providerId,
    preferredProviderId: options.preferredProviderId,
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
