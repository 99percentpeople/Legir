import type { LLMModelCapabilities } from "@/types";
import {
  createModelCapabilities,
  modelSupportsInputModality,
} from "@/services/ai/sdk/modelCapabilities";
import type {
  AiSdkModelCatalogProviderRequest,
  AiSdkModelCatalogProviderTaskRequest,
  AiSdkTaskModelKind,
} from "@/services/ai/sdk/types";
import { BaseAiSdkModelCatalogProvider } from "./base";
import { joinUrl } from "./shared";

const DEFAULT_ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

const CURATED_ZHIPU_MODEL_IDS = [
  "glm-5-turbo",
  "glm-5",
  "glm-4.7",
  "glm-4.7-flash",
  "glm-4.7-flashx",
  "glm-4.6",
  "glm-4.5",
  "glm-4.5-air",
  "glm-4.5-x",
  "glm-4.5-airx",
  "glm-4.5-flash",
  "glm-5v-turbo",
  "glm-4.6v",
  "glm-4.6v-flash",
  "glm-4.6v-flashx",
  "glm-4.5v",
] as const;

type ZhipuModelsResponse = {
  data?: Array<{ id?: string }>;
};

const isZhipuVisionModelId = (modelId: string) =>
  /(?:^|[-_/])glm-(?:\d+(?:\.\d+)?)v(?:[-_/]|$)/.test(
    modelId.trim().toLowerCase(),
  );

const createZhipuModelCapabilities = (modelId: string) => {
  const isVisionModel = isZhipuVisionModelId(modelId);

  return createModelCapabilities({
    inputModalities: isVisionModel
      ? ["text", "image", "file", "video"]
      : ["text"],
    outputModalities: ["text"],
    supportsToolCalls: !isVisionModel,
  });
};

const matchesZhipuTask = (
  capabilities: LLMModelCapabilities,
  kind: AiSdkTaskModelKind,
) => {
  if (kind === "vision") {
    return capabilities.supportsImageInput;
  }

  if (kind === "chat") {
    return capabilities.supportsToolCalls;
  }

  return modelSupportsInputModality(capabilities, "text");
};

const getCuratedZhipuModels = () =>
  CURATED_ZHIPU_MODEL_IDS.map((id) => ({
    id,
    capabilities: createZhipuModelCapabilities(id),
  }));

export class ZhipuModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "zhipu" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const response = await this.fetchWithProxy(
      options,
      joinUrl(
        this.getProviderBaseUrl({
          appOptions: options.appOptions,
          fallbackBaseUrl: DEFAULT_ZHIPU_BASE_URL,
        }),
        "/models",
      ),
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      },
    );

    if (response.status === 404 || response.status === 405) {
      return this.normalizeDiscoveredModels(getCuratedZhipuModels());
    }

    const json = await this.parseJsonOrThrow<ZhipuModelsResponse>({
      response,
      errorLabel: "Zhipu models request failed",
    });

    const discoveredModels = (json.data || []).flatMap((item) =>
      typeof item.id === "string"
        ? [
            {
              id: item.id,
              capabilities: createZhipuModelCapabilities(item.id),
            },
          ]
        : [],
    );

    return this.normalizeDiscoveredModels(
      discoveredModels.length > 0 ? discoveredModels : getCuratedZhipuModels(),
    );
  }

  getModelsForTask(options: AiSdkModelCatalogProviderTaskRequest) {
    return this.normalizeDiscoveredModels(
      this.getCachedAndCustomModels(options).filter((model) =>
        matchesZhipuTask(model.capabilities, options.kind),
      ),
    );
  }
}
