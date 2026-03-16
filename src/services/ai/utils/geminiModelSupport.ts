const SUPPORTED_GEMINI_TOOL_CALLING_MODEL_IDS = new Set([
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-preview-09-2025",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite-preview-09-2025",
]);

export const isSupportedGeminiToolCallingModelId = (modelId: string) => {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return false;
  return SUPPORTED_GEMINI_TOOL_CALLING_MODEL_IDS.has(normalized);
};

export const filterSupportedGeminiToolCallingModelIds = (ids: string[]) => {
  const seen = new Set<string>();
  return ids.filter((rawId) => {
    const id = rawId.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return isSupportedGeminiToolCallingModelId(id);
  });
};
