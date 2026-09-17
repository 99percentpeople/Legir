import { translateService } from "@/services/translateService";
import { getAiSdkModelGroups } from "@/services/ai/providers/modelSelection";
import { isAiSdkProviderConfigured } from "@/services/ai/providers/settings";
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
        getCurrentOptions().translation.aiEnabled &&
        isAiSdkProviderConfigured(getCurrentOptions(), group.providerId),
      unavailableMessageKey: group.unavailableMessageKey,
      translate: async (text, optionId, translateOptions) => {
        const { translateTextWithAiSdk } = await import("@/services/ai/tasks");
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
      translateStream: async function* (text, optionId, translateOptions) {
        const { translateTextStreamWithAiSdk } =
          await import("@/services/ai/tasks");
        yield* translateTextStreamWithAiSdk({
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
