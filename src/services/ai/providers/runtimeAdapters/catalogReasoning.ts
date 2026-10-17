import {
  getCatalogReasoningMetadata,
  type AiReasoningProtocol,
} from "../reasoning";
import {
  createNoReasoningResolution,
  getReasoningBudgetTokensForLevel,
  selectReasoningLevel,
} from "./shared";
import type { AiRuntimeAdapter, AiRuntimeRequest } from "./types";
import type { AiSdkModelCallOptions } from "../types";

/** Wire formats are code; all model support, effort values and limits are catalog data. */
export const createCatalogReasoningAdapter = (
  protocol: AiReasoningProtocol,
): Pick<AiRuntimeAdapter, "getReasoningCapability" | "resolveReasoning"> => {
  const getReasoningCapability = (request: AiRuntimeRequest) =>
    getCatalogReasoningMetadata(
      request.catalogId ?? request.providerId,
      request.modelId,
      protocol,
    );
  return {
    getReasoningCapability,
    resolveReasoning(request) {
      const capability = getReasoningCapability(request);
      if (!capability.supported)
        return createNoReasoningResolution({
          preference: request.preference,
          capability,
        });
      const level = selectReasoningLevel(capability, request.preference.level);
      const disabled = level === "none";
      const effort = capability.effortValues?.[level];
      const budget =
        getReasoningBudgetTokensForLevel(capability, level) ??
        getReasoningBudgetTokensForLevel(capability, "auto");
      const visible =
        !disabled && request.preference.displayPolicy !== "hidden";
      let callOptions: AiSdkModelCallOptions | undefined;
      const setOptions = (
        key: string,
        value: NonNullable<AiSdkModelCallOptions["providerOptions"]>[string],
      ) => {
        callOptions = { providerOptions: { [key]: value } };
      };
      switch (protocol) {
        case "openai":
          // Let cataloged model aliases use reasoning even before the SDK knows their names.
          setOptions("openai", {
            forceReasoning: true,
            ...(effort ? { reasoningEffort: effort } : {}),
          });
          break;
        case "google":
          setOptions("google", {
            thinkingConfig: {
              includeThoughts: visible,
              ...(disabled
                ? { thinkingBudget: 0 }
                : effort
                  ? { thinkingLevel: effort }
                  : budget
                    ? { thinkingBudget: budget }
                    : capability.supportsToggle
                      ? { thinkingBudget: -1 }
                      : {}),
            },
          });
          break;
        case "anthropic":
          setOptions(request.providerId, {
            sendReasoning: true,
            ...(disabled
              ? { thinking: { type: "disabled" } }
              : budget
                ? { thinking: { type: "enabled", budgetTokens: budget } }
                : Object.keys(capability.effortValues || {}).length
                  ? {
                      thinking: {
                        type: "adaptive",
                        display: visible ? "summarized" : "omitted",
                      },
                    }
                  : capability.supportsToggle
                    ? { thinking: { type: "enabled" } }
                    : {}),
            ...(!disabled && effort ? { effort } : {}),
          });
          break;
        case "openrouter":
          setOptions("openrouter", {
            reasoning: {
              ...(disabled
                ? { enabled: false }
                : capability.supportsToggle
                  ? { enabled: true }
                  : {}),
              ...(effort
                ? { effort }
                : !disabled && budget
                  ? { max_tokens: budget }
                  : {}),
              // Keep signed reasoning for subsequent tool calls; display policy belongs to the UI.
              exclude: false,
            },
          });
          break;
        case "groq":
          setOptions("groq", {
            ...(effort ? { reasoningEffort: effort } : {}),
            reasoningFormat: visible ? "parsed" : "hidden",
          });
          break;
        case "xai":
          if (effort) setOptions("xai", { reasoningEffort: effort });
          break;
        case "deepseek":
        case "mimo":
        case "zhipu":
          setOptions(protocol, {
            ...(capability.supportsToggle
              ? { thinking: { type: disabled ? "disabled" : "enabled" } }
              : {}),
            ...(effort
              ? {
                  [protocol === "zhipu"
                    ? "reasoning_effort"
                    : "reasoningEffort"]: effort,
                }
              : {}),
          });
          break;
        case "openai-compatible":
          // Compatible endpoints agree on reasoning_effort, not on custom toggle/budget fields.
          if (effort)
            setOptions(request.providerId, { reasoningEffort: effort });
          break;
      }
      return {
        capability,
        effectivePreference: {
          ...request.preference,
          level,
          displayPolicy:
            disabled || capability.textExposure === "none"
              ? "hidden"
              : request.preference.displayPolicy,
        },
        callOptions,
        replayPolicy: disabled ? "none" : capability.requiresReasoningReplay,
      };
    },
  };
};
