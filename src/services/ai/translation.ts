import { translateService } from "@/services/translateService";
import {
  getAiSdkModelGroups,
  isAiSdkProviderConfigured,
} from "@/services/ai/providers";
import {
  translateTextStreamWithAiSdk,
  translateTextWithAiSdk,
} from "@/services/ai/tasks";
import {
  getCurrentModelCache,
  getCurrentOptions,
} from "@/services/ai/editorState";

export const registerTranslateOptionsFromProviders = () => {
  const appOptions = getCurrentOptions();
  const modelCache = getCurrentModelCache();
  const groups = getAiSdkModelGroups({
    appOptions,
    modelCache,
    kind: "translate",
  });

  for (const group of groups) {
    translateService.registerOptionGroup({
      id: group.providerId,
      label: group.label,
      labelKey: group.labelKey,
      options: group.models.map((model) => ({
        id: model.id,
        label: model.label,
        labelKey: model.labelKey,
        capabilities: model.capabilities,
      })),
      isLLM: true,
      isAvailable: () =>
        isAiSdkProviderConfigured(getCurrentOptions(), group.providerId),
      unavailableMessageKey: group.unavailableMessageKey,
      translate: async (text, optionId, translateOptions) => {
        return await translateTextWithAiSdk({
          text,
          appOptions: getCurrentOptions(),
          specifier: {
            providerId: group.providerId,
            modelId: optionId,
          },
          targetLanguage: translateOptions.targetLanguage,
          sourceLanguage: translateOptions.sourceLanguage,
          prompt: translateOptions.prompt,
          signal: translateOptions.signal,
        });
      },
      translateStream: (text, optionId, translateOptions) => {
        return translateTextStreamWithAiSdk({
          text,
          appOptions: getCurrentOptions(),
          specifier: {
            providerId: group.providerId,
            modelId: optionId,
          },
          targetLanguage: translateOptions.targetLanguage,
          sourceLanguage: translateOptions.sourceLanguage,
          prompt: translateOptions.prompt,
          signal: translateOptions.signal,
        });
      },
    });
  }
};
