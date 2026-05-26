import {
  AI_PROVIDER_IDS,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import { useEditorStore } from "@/store/useEditorStore";

export type SupportedLlmProviderId = AiProviderId;

export const getCurrentOptions = () => useEditorStore.getState().options;

export const getCurrentModelCache = () =>
  useEditorStore.getState().llmModelCache;

export const trimProviderOptions = () => {
  const snapshot = useEditorStore.getState();
  const nextOptions = snapshot.options;
  const nextLlm = Object.fromEntries(
    AI_PROVIDER_IDS.map((providerId) => [
      providerId,
      {
        ...nextOptions.llm[providerId],
        apiKey: (nextOptions.llm[providerId].apiKey || "").trim(),
        apiUrl: (nextOptions.llm[providerId].apiUrl || "").trim(),
        apiOptionId: (nextOptions.llm[providerId].apiOptionId || "").trim(),
      },
    ]),
  ) as typeof nextOptions.llm;

  const isChanged = AI_PROVIDER_IDS.some((providerId) => {
    const previous = nextOptions.llm[providerId];
    const normalized = nextLlm[providerId];
    return (
      previous.apiKey !== normalized.apiKey ||
      previous.apiUrl !== normalized.apiUrl ||
      previous.apiOptionId !== normalized.apiOptionId
    );
  });

  if (!isChanged) {
    return snapshot.options;
  }

  snapshot.setOptions((options) => ({
    ...options,
    llm: nextLlm,
  }));

  return useEditorStore.getState().options;
};
