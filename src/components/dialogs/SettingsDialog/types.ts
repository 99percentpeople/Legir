import type {
  AppOptions,
  DebugOptions,
  EditorState,
  LLMCustomModelCapability,
  SnappingOptions,
} from "@/types";
import type { AiProviderId } from "@/services/ai/providers/catalog";

export interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  options: AppOptions;
  onChange: (options: AppOptions) => void;
}

export type LlmProviderId = AiProviderId;

export type ProviderSyncStatus = {
  state: "idle" | "syncing" | "ok" | "error";
  message: string;
};

export type LlmModelCache = EditorState["llmModelCache"];

export type CustomModelCapabilityOption = {
  value: LLMCustomModelCapability;
  label: string;
};

export type UpdateApiProxyOptions = (
  patch: Partial<AppOptions["apiProxy"]>,
) => void;

export type UpdateAiChatOptions = (
  patch: Partial<AppOptions["aiChat"]>,
) => void;

export type UpdateSnappingOption = (
  key: keyof SnappingOptions,
  value: boolean | number,
) => void;

export type UpdateDebugOption = (
  key: keyof DebugOptions,
  value: boolean,
) => void;
