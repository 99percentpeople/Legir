import { preferencesStore } from "@/store/preferencesStore";
export type SupportedLlmProviderId = string;
export const getCurrentOptions = () => preferencesStore.getState().options;
export const getCurrentModelCache = () =>
  preferencesStore.getState().llmModelCache;
export const trimProviderOptions = getCurrentOptions;
