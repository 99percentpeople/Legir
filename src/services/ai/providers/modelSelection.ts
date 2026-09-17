import {
  AI_PROVIDER_SPECS_SORTED_BY_LABEL,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import { getAiSdkModelCatalogProvider } from "@/services/ai/providers/modelCatalogRegistry";
import { isAiSdkProviderConfigured } from "@/services/ai/providers/settings";
import type {
  AiSdkProviderId,
  AiSdkTaskModelKind,
} from "@/services/ai/providers/types";
import type { AppLLMModelOption, AppOptions, EditorState } from "@/types";

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
    rank?: number;
  }>,
) => {
  const output: Array<AppLLMModelOption & { order: number }> = [];
  const seen = new Set<string>();

  for (const [order, model] of models.entries()) {
    const id = (model.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({
      id,
      label: (model.label || id).trim() || id,
      capabilities: model.capabilities,
      rank:
        typeof model.rank === "number" && Number.isFinite(model.rank)
          ? Math.trunc(model.rank)
          : 0,
      order,
    });
  }

  return output
    .sort(
      (left, right) =>
        (right.rank ?? 0) - (left.rank ?? 0) || left.order - right.order,
    )
    .map(({ order: _order, ...model }) => model);
};

export const getAiSdkProviderModelOptions = (options: {
  appOptions: AppOptions;
  modelCache: AiSdkModelCache;
  providerId: AiProviderId;
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
