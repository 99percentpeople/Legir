import type { AiProviderId } from "./catalog";
import { getConfiguredAiSdkProviders } from "./settings";
import { getAiSdkModelCatalogProvider } from "@/services/ai/providers/modelCatalogRegistry";
import type {
  AiSdkProviderId,
  AiSdkTaskModelKind,
} from "@/services/ai/providers/types";
import type { AppLLMModelOption, AppOptions, EditorState } from "@/types";

type AiSdkModelCache = EditorState["llmModelCache"];

export type AiSdkModelGroup = {
  providerId: AiSdkProviderId;
  catalogId?: string;
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
  getConfiguredAiSdkProviders(options.appOptions)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(
      (config): AiSdkModelGroup => ({
        providerId: config.providerId,
        catalogId: config.catalogId || undefined,
        label: config.label,
        isAvailable: true,
        unavailableMessageKey: "properties.form_detection.api_key_missing",
        models: getAiSdkProviderModelOptions({
          ...options,
          providerId: config.providerId,
        }),
      }),
    )
    .filter((group) => group.models.length > 0);
