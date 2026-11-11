/** Reasoning preferences and display capabilities, independent of provider SDKs. */
export type AiReasoningLevel =
  "none" | "auto" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type AiReasoningActiveLevel = Exclude<AiReasoningLevel, "none" | "auto">;
export type AiReasoningReplayPolicy = "none" | "tool-calls" | "all";
export type AiReasoningDisplayPolicy =
  "hidden" | "summary" | "full-if-provider-exposes";
export type AiReasoningTextExposure = "none" | "summary" | "raw";
export type AiReasoningBudgetByLevel = Partial<
  Record<AiReasoningLevel, number>
>;

export interface AiReasoningPreference {
  level: AiReasoningLevel;
  displayPolicy: AiReasoningDisplayPolicy;
}

export interface AiReasoningCapability {
  supported: boolean;
  levels: readonly AiReasoningLevel[];
  /** Exact effort values advertised by the catalog and accepted by this transport. */
  effortValues?: Partial<Record<AiReasoningLevel, string>>;
  supportsToggle?: boolean;
  budgetTokensByLevel?: AiReasoningBudgetByLevel;
  textExposure: AiReasoningTextExposure;
  requiresReasoningReplay: AiReasoningReplayPolicy;
}

export interface AiReasoningLevelControl {
  supported: boolean;
  levels: readonly AiReasoningLevel[];
  selectedLevel: AiReasoningLevel;
  showSelect: boolean;
}
