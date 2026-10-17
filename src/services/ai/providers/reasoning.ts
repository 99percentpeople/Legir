import { getCatalogProviderSpec, runtimeProviderId } from "./catalog";
import { getModelsDevModel, getModelsDevProvider } from "./modelsDev";
import {
  AI_REASONING_LEVELS,
  NO_REASONING_CAPABILITY,
} from "./runtimeAdapters/shared";
import type {
  AiReasoningCapability,
  AiReasoningLevel,
} from "./runtimeAdapters/types";

export type AiReasoningProtocol =
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "google"
  | "openrouter"
  | "groq"
  | "xai"
  | "deepseek"
  | "mimo"
  | "zhipu";

export type AiModelReasoningMetadata = AiReasoningCapability;

const getCatalogProtocol = (providerId: string): AiReasoningProtocol => {
  const provider = getModelsDevProvider(providerId);
  const backend = provider && getCatalogProviderSpec(provider)?.backendKind;
  if (!backend || backend === "openai-compatible") {
    const runtime = runtimeProviderId(providerId);
    if (runtime === "deepseek" || runtime === "zhipu") return runtime;
    if (runtime === "xiaomi-mimo") return "mimo";
    return "openai-compatible";
  }
  return backend === "anthropic-compatible" ? "anthropic" : backend;
};

// These are SDK wire constraints, not model capabilities. Model choices come only
// from reasoning_options; a new model never requires a name or family rule here.
const acceptsEffort = (protocol: AiReasoningProtocol, value: string) => {
  if (protocol === "google")
    return ["minimal", "low", "medium", "high"].includes(value);
  if (protocol === "anthropic")
    return ["low", "medium", "high", "xhigh", "max"].includes(value);
  if (protocol === "groq")
    return ["none", "default", "low", "medium", "high"].includes(value);
  if (protocol === "xai")
    return ["none", "low", "medium", "high", "xhigh"].includes(value);
  return true;
};

/** Translate catalog controls into UI choices without inferring from model IDs. */
export const getCatalogReasoningMetadata = (
  providerId: string,
  modelId: string,
  protocol = getCatalogProtocol(providerId),
): AiModelReasoningMetadata => {
  const model = getModelsDevModel(providerId, modelId);
  if (!model?.reasoning) return NO_REASONING_CAPABILITY;

  const options = model.reasoning_options || [];
  const efforts =
    options.find((option) => option.type === "effort")?.values || [];
  const toggle = options.some((option) => option.type === "toggle");
  const budget = options.find((option) => option.type === "budget_tokens");
  const canSendToggle = [
    "anthropic",
    "google",
    "openrouter",
    "deepseek",
    "mimo",
    "zhipu",
  ].includes(protocol);
  const canSendBudget = ["anthropic", "google", "openrouter"].includes(
    protocol,
  );
  const effortValues: NonNullable<AiReasoningCapability["effortValues"]> = {};
  for (const level of AI_REASONING_LEVELS) {
    if (
      level !== "auto" &&
      efforts.includes(level) &&
      acceptsEffort(protocol, level)
    ) {
      effortValues[level] = level;
    }
  }
  if (efforts.includes("default") && acceptsEffort(protocol, "default"))
    effortValues.auto = "default";

  const budgetTokensByLevel: NonNullable<
    AiReasoningCapability["budgetTokensByLevel"]
  > = {};
  if (budget && canSendBudget) {
    const min = Math.max(protocol === "anthropic" ? 1024 : 1, budget.min ?? 1);
    const max = Math.min(
      budget.max ?? Infinity,
      (model.limit?.output ?? Infinity) - 1,
    );
    if (max >= min) {
      // Shared budget presets are bounded by catalog limits, never by model names.
      for (const [level, tokens] of [
        ["auto", 4096],
        ["low", 1024],
        ["medium", 4096],
        ["high", 8192],
      ] as const) {
        budgetTokensByLevel[level] = Math.min(max, Math.max(min, tokens));
      }
    }
  }
  const hasEffort = Object.keys(effortValues).some(
    (level) => level !== "none" && level !== "auto",
  );
  const canDisable =
    effortValues.none !== undefined ||
    (canSendToggle &&
      (toggle ||
        efforts.includes("none") ||
        (budget?.min === 0 && canSendBudget)));
  const levels: AiReasoningLevel[] = canDisable ? ["none", "auto"] : ["auto"];
  const seenBudgets = new Set<number>();
  for (const level of AI_REASONING_LEVELS) {
    if (level === "none" || level === "auto") continue;
    if (effortValues[level] !== undefined) levels.push(level);
    else if (!hasEffort && budgetTokensByLevel[level] !== undefined) {
      const tokens = budgetTokensByLevel[level]!;
      if (!seenBudgets.has(tokens)) {
        levels.push(level);
        seenBudgets.add(tokens);
      }
    }
  }
  return {
    supported: true,
    levels,
    effortValues,
    supportsToggle: canSendToggle && toggle,
    ...(Object.keys(budgetTokensByLevel).length ? { budgetTokensByLevel } : {}),
    textExposure:
      protocol === "openai"
        ? "none"
        : protocol === "google" ||
            (protocol === "anthropic" &&
              runtimeProviderId(providerId) === "anthropic")
          ? "summary"
          : "raw",
    requiresReasoningReplay:
      protocol === "anthropic" || protocol === "openrouter"
        ? "all"
        : protocol === "deepseek" || protocol === "mimo"
          ? "tool-calls"
          : "none",
  };
};
