import {
  AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_DEFAULT,
  AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_MAX,
  AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_MIN,
  AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_STEP,
} from "@/constants";
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from "@/services/ai/providers/modelMetadata";
import type { AppOptions, LLMModelCapabilities } from "@/types";

export const clampAiChatCompressionThresholdPercent = (value: unknown) => {
  const next = Math.trunc(Number(value) || 0);
  if (!Number.isFinite(next) || next <= 0) {
    return AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_DEFAULT;
  }
  const stepped =
    Math.round(next / AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_STEP) *
    AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_STEP;
  return Math.max(
    AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_MIN,
    Math.min(AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_MAX, stepped),
  );
};

export const resolveAiChatCompressionContextWindowTokens = (
  modelCapabilities?: LLMModelCapabilities,
) =>
  Math.max(
    1,
    Math.trunc(
      modelCapabilities?.contextWindowTokens ||
        DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
    ),
  );

export const resolveAiChatCompressionThresholdTokens = (options: {
  aiChatOptions: Pick<
    AppOptions["aiChat"],
    "contextCompressionThresholdPercent"
  >;
  modelCapabilities?: LLMModelCapabilities;
}) => {
  const percent = clampAiChatCompressionThresholdPercent(
    options.aiChatOptions.contextCompressionThresholdPercent,
  );
  return Math.max(
    1,
    Math.floor(
      (resolveAiChatCompressionContextWindowTokens(options.modelCapabilities) *
        percent) /
        100,
    ),
  );
};
