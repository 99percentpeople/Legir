import type { LLMCustomModelCapability } from "@/types";
import { AI_PROVIDER_IDS } from "@/services/ai/providers/catalog";
import type { LlmProviderId, ProviderSyncStatus } from "./types";

export const createProviderSyncStatusRecord = (initial: ProviderSyncStatus) =>
  Object.fromEntries(
    AI_PROVIDER_IDS.map((providerId) => [providerId, { ...initial }]),
  ) as Record<LlmProviderId, ProviderSyncStatus>;

export const normalizeCustomModelCapabilities = (
  values: readonly LLMCustomModelCapability[] = ["text", "tools"],
) => {
  const normalized = new Set<LLMCustomModelCapability>(["text", ...values]);
  return ["text", "image", "tools"].filter((value) =>
    normalized.has(value as LLMCustomModelCapability),
  ) as LLMCustomModelCapability[];
};
