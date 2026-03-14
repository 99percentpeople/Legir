import type { FieldType, FormField } from "@/types";
import type { ZodTypeAny } from "zod";

export type LLMProviderId = string;

export type LLMFunctionKind =
  | "translate"
  | "formDetect"
  | "chatAgent"
  | "summarize";

export type LLMModelOption = {
  id: string;
  label: string;
  labelKey?: string;
};

export interface LLMChatToolDefinition {
  name: string;
  description: string;
  accessType: "read" | "write";
  inputSchema: ZodTypeAny;
}

export interface LLMChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface LLMChatToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LLMChatTurnResult {
  reasoningText: string;
  assistantMessage: string;
  toolCalls: LLMChatToolCall[];
  finishReason: "stop" | "tool_calls";
}

export type LLMChatTurnStreamEvent =
  | { type: "reasoning_delta"; delta: string }
  | { type: "assistant_delta"; delta: string }
  | { type: "result"; result: LLMChatTurnResult };

export interface LLMRunChatTurnOptions {
  modelId?: string;
  messages: LLMChatMessage[];
  tools: LLMChatToolDefinition[];
  signal?: AbortSignal;
}

export interface LLMTranslateTextOptions {
  modelId?: string;
  targetLanguage: string;
  sourceLanguage?: string;
  prompt?: string;
  signal?: AbortSignal;
}

export interface LLMSummarizeTextOptions {
  modelId?: string;
  prompt?: string;
  signal?: AbortSignal;
}

export interface LLMTranslateFunction {
  kind: "translate";
  getModels: () => LLMModelOption[];
  refreshModels?: () => Promise<void>;

  translateText: (
    text: string,
    opts: LLMTranslateTextOptions,
  ) => Promise<string>;
  translateTextStream?: (
    text: string,
    opts: LLMTranslateTextOptions,
  ) => AsyncGenerator<string>;
}

export type LLMAnalyzePageForFieldsOptions = {
  allowedTypes?: FieldType[];
  extraPrompt?: string;
  providerId?: LLMProviderId;
  modelId?: string;
};

export interface LLMFormDetectFunction {
  kind: "formDetect";
  getModels: () => LLMModelOption[];
  refreshModels?: () => Promise<void>;

  analyzePageForFields: (
    base64Image: string,
    pageIndex: number,
    pageWidth: number,
    pageHeight: number,
    existingFields?: FormField[],
    options?: LLMAnalyzePageForFieldsOptions,
  ) => Promise<FormField[]>;
}

export interface LLMChatAgentFunction {
  kind: "chatAgent";
  getModels: () => LLMModelOption[];
  refreshModels?: () => Promise<void>;
  runTurn: (options: LLMRunChatTurnOptions) => Promise<LLMChatTurnResult>;
  runTurnStream?: (
    options: LLMRunChatTurnOptions,
  ) => AsyncGenerator<LLMChatTurnStreamEvent>;
}

export interface LLMSummarizeFunction {
  kind: "summarize";
  getModels: () => LLMModelOption[];
  refreshModels?: () => Promise<void>;
  summarizeText: (
    text: string,
    opts: LLMSummarizeTextOptions,
  ) => Promise<string>;
}

export type LLMProviderFunctions = {
  translate?: LLMTranslateFunction;
  formDetect?: LLMFormDetectFunction;
  chatAgent?: LLMChatAgentFunction;
  summarize?: LLMSummarizeFunction;
};

export interface LLMProvider {
  id: LLMProviderId;
  label: string;
  labelKey?: string;
  unavailableMessageKey?: string;
  isAvailable: () => boolean;
  getFunctions: () => LLMProviderFunctions;
}
