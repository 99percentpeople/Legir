import { useCallback, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  Bug,
  FileText,
  Globe,
  Magnet,
  MessageSquare,
  Settings2,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/components/language-provider";
import { useTheme } from "@/components/theme-provider";
import {
  filterModelSelectGroups,
  type ModelSelectGroup,
} from "@/components/ModelSelect";
import {
  checkLlmProviderConfig,
  getChatModelGroups,
  getVisionModelGroups,
  loadModels,
} from "@/services/ai";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_SPECS_SORTED_BY_LABEL,
} from "@/services/ai/providers/catalog";
import { isDesktopApp } from "@/services/platform/runtime";
import { useEditorStore } from "@/store/useEditorStore";
import type {
  AppOptions,
  DebugOptions,
  LLMCustomModelCapability,
  SnappingOptions,
} from "@/types";

import { AiChatSettingsTab } from "./AiChatSettingsTab";
import { DebugSettingsTab } from "./DebugSettingsTab";
import { ExportSettingsTab } from "./ExportSettingsTab";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { LlmSettingsTab } from "./LlmSettingsTab";
import { SnappingSettingsTab } from "./SnappingSettingsTab";
import {
  SETTINGS_TAB_TRIGGER_CLASS,
  SETTINGS_TABS_CONTENT_CLASS,
  SETTINGS_TABS_LIST_CLASS,
  SETTINGS_TABS_ROOT_CLASS,
} from "./styles";
import type {
  CustomModelCapabilityOption,
  LlmProviderId,
  ProviderSyncStatus,
  SettingsDialogProps,
} from "./types";
import {
  createProviderSyncStatusRecord,
  normalizeCustomModelCapabilities,
} from "./utils";

const SettingsDialog = ({
  isOpen,
  onClose,
  options,
  onChange,
}: SettingsDialogProps) => {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const isDesktopRuntime = isDesktopApp();
  const llmModelCache = useEditorStore((s) => s.llmModelCache);

  const [llmProviderTab, setLlmProviderTab] = useState<LlmProviderId>(
    AI_PROVIDER_SPECS_SORTED_BY_LABEL[0]?.id ?? AI_PROVIDER_IDS[0],
  );

  const [llmSyncStatus, setLlmSyncStatus] = useState<
    Record<LlmProviderId, ProviderSyncStatus>
  >(() => createProviderSyncStatusRecord({ state: "idle", message: "" }));

  const modelUpdateTimersRef = useRef<Partial<Record<LlmProviderId, number>>>(
    {},
  );
  const [customModelNameByProvider, setCustomModelNameByProvider] = useState<
    Partial<Record<LlmProviderId, string>>
  >({});
  const [customModelCapabilityByProvider, setCustomModelCapabilityByProvider] =
    useState<Partial<Record<LlmProviderId, LLMCustomModelCapability[]>>>({});

  const customModelCapabilityOptions = useMemo(
    () =>
      [
        {
          value: "text",
          label: t("settings.llm.custom_model_capability_text"),
        },
        {
          value: "image",
          label: t("settings.llm.custom_model_capability_image"),
        },
        {
          value: "tools",
          label: t("settings.llm.custom_model_capability_tools"),
        },
      ] satisfies CustomModelCapabilityOption[],
    [t],
  );

  const scheduleModelRegistryUpdate = (provider: LlmProviderId) => {
    const prev = modelUpdateTimersRef.current[provider];
    if (typeof prev === "number") window.clearTimeout(prev);
    modelUpdateTimersRef.current[provider] = window.setTimeout(() => {
      void loadModels({ providerIds: [provider] });
    }, 400);
  };

  const updateLlmProviderOptions = <P extends LlmProviderId>(
    provider: P,
    patch: Partial<AppOptions["llm"][P]>,
  ) => {
    onChange({
      ...options,
      llm: {
        ...options.llm,
        [provider]: {
          ...options.llm[provider],
          ...patch,
        },
      },
    });
  };

  const updateLlmApiKey = (provider: LlmProviderId, value: string) => {
    updateLlmProviderOptions(provider, { apiKey: value });
  };

  const updateLlmApiUrl = (provider: LlmProviderId, value: string) => {
    updateLlmProviderOptions(provider, { apiUrl: value });
  };

  const isLlmProviderEnabled = (provider: LlmProviderId) =>
    options.llm[provider].enabled !== false;

  const setLlmProviderEnabled = (provider: LlmProviderId, enabled: boolean) => {
    updateLlmProviderOptions(provider, { enabled });
    setLlmSyncStatus((prev) => ({
      ...prev,
      [provider]: { state: "idle", message: "" },
    }));
    scheduleModelRegistryUpdate(provider);
  };

  const getCustomModelDraftCapabilities = (provider: LlmProviderId) =>
    normalizeCustomModelCapabilities(customModelCapabilityByProvider[provider]);

  const addCustomModel = (provider: LlmProviderId) => {
    const id = (customModelNameByProvider[provider] || "").trim();
    if (!id) return;

    const capabilities = getCustomModelDraftCapabilities(provider);
    const currentModels = options.llm[provider].customModels || [];
    const hasExisting = currentModels.some((model) => model.id === id);
    const nextCustomModels = hasExisting
      ? currentModels.map((model) =>
          model.id === id ? { id, capabilities } : model,
        )
      : [...currentModels, { id, capabilities }];

    updateLlmProviderOptions(provider, {
      customModels: nextCustomModels,
    });
    setCustomModelNameByProvider((prev) => ({
      ...prev,
      [provider]: "",
    }));
    scheduleModelRegistryUpdate(provider);
  };

  const removeCustomModel = (provider: LlmProviderId, id: string) => {
    updateLlmProviderOptions(provider, {
      customModels: (options.llm[provider].customModels || []).filter(
        (model) => model.id !== id,
      ),
    });
    scheduleModelRegistryUpdate(provider);
  };

  const updateAiChatOptions = (patch: Partial<AppOptions["aiChat"]>) => {
    onChange({
      ...options,
      aiChat: {
        ...options.aiChat,
        ...patch,
      },
    });
  };

  const updateApiProxyOptions = (patch: Partial<AppOptions["apiProxy"]>) => {
    onChange({
      ...options,
      apiProxy: {
        ...options.apiProxy,
        ...patch,
      },
    });
  };

  const clearFetchedLlmModels = (provider: LlmProviderId) => {
    useEditorStore.getState().setState((state) => ({
      llmModelCache: {
        ...state.llmModelCache,
        [provider]: {
          ...state.llmModelCache[provider],
          translateModels: [],
          visionModels: [],
        },
      },
    }));
  };

  const updateLlmApiOption = (provider: LlmProviderId, apiOptionId: string) => {
    updateLlmProviderOptions(provider, { apiOptionId });
    setLlmSyncStatus((prev) => ({
      ...prev,
      [provider]: { state: "idle", message: "" },
    }));
    clearFetchedLlmModels(provider);
    scheduleModelRegistryUpdate(provider);
  };

  const aiToolModelGroups = useMemo<ModelSelectGroup[]>(() => {
    return getChatModelGroups().map((group) => ({
      id: group.providerId,
      label: group.label,
      options: group.models.map((model) => ({
        value: `${group.providerId}:${model.id}`,
        label: model.label,
        capabilities: model.capabilities,
        disabled: !group.isAvailable,
      })),
    }));
  }, [llmModelCache, options.llm]);

  const imageModelFilter = useCallback(
    (option: { capabilities?: { supportsImageInput?: boolean } }) =>
      option.capabilities?.supportsImageInput === true,
    [],
  );

  const aiVisionModelGroups = useMemo<ModelSelectGroup[]>(() => {
    return filterModelSelectGroups(
      getVisionModelGroups().map((group) => ({
        id: group.providerId,
        label: group.labelKey ? t(group.labelKey) : group.label,
        options: group.models.map((model) => ({
          value: `${group.providerId}:${model.id}`,
          label: model.labelKey ? t(model.labelKey) : model.label,
          capabilities: model.capabilities,
          disabled: !group.isAvailable,
        })),
      })),
      imageModelFilter,
    );
  }, [imageModelFilter, llmModelCache, options.llm, t]);

  const syncLlmProviderModels = async (provider: LlmProviderId) => {
    if (!isLlmProviderEnabled(provider)) {
      setLlmSyncStatus((prev) => ({
        ...prev,
        [provider]: {
          state: "error",
          message: t("settings.llm.provider_enable_required"),
        },
      }));
      return;
    }

    const apiKey = (options.llm[provider].apiKey || "").trim();
    if (!apiKey) {
      setLlmSyncStatus((prev) => ({
        ...prev,
        [provider]: {
          state: "error",
          message: t("settings.llm.api_key_required"),
        },
      }));
      return;
    }

    setLlmSyncStatus((prev) => ({
      ...prev,
      [provider]: { state: "syncing", message: "" },
    }));

    try {
      await checkLlmProviderConfig(provider);
      await loadModels({
        providerIds: [provider],
        force: true,
        throwOnError: true,
      });

      setLlmSyncStatus((prev) => ({
        ...prev,
        [provider]: { state: "ok", message: t("settings.llm.fetch_success") },
      }));
    } catch (err) {
      clearFetchedLlmModels(provider);
      const msg =
        err instanceof Error ? err.message : t("settings.llm.fetch_failed");
      setLlmSyncStatus((prev) => ({
        ...prev,
        [provider]: { state: "error", message: msg },
      }));
    }
  };

  const updateSnappingOption = (
    key: keyof SnappingOptions,
    value: boolean | number,
  ) => {
    onChange({
      ...options,
      snappingOptions: {
        ...options.snappingOptions,
        [key]: value,
      },
    });
  };

  const updateDebugOption = (key: keyof DebugOptions, value: boolean) => {
    onChange({
      ...options,
      debugOptions: {
        ...options.debugOptions,
        [key]: value,
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="mx-4 flex max-h-full min-h-3/4 flex-col sm:h-3/4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {t("settings.title")}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          orientation="vertical"
          defaultValue="general"
          className={SETTINGS_TABS_ROOT_CLASS}
        >
          <TabsList className={SETTINGS_TABS_LIST_CLASS}>
            <TabsTrigger value="general" className={SETTINGS_TAB_TRIGGER_CLASS}>
              <Globe className="h-4 w-4" />
              {t("settings.tabs.general")}
            </TabsTrigger>
            <TabsTrigger value="export" className={SETTINGS_TAB_TRIGGER_CLASS}>
              <FileText className="h-4 w-4" />
              {t("settings.tabs.export")}
            </TabsTrigger>
            <TabsTrigger
              value="snapping"
              className={SETTINGS_TAB_TRIGGER_CLASS}
            >
              <Magnet className="h-4 w-4" />
              {t("settings.tabs.snapping")}
            </TabsTrigger>
            <TabsTrigger value="llm" className={SETTINGS_TAB_TRIGGER_CLASS}>
              <BrainCircuit className="h-4 w-4" />
              {t("settings.tabs.llm")}
            </TabsTrigger>
            <TabsTrigger value="ai_chat" className={SETTINGS_TAB_TRIGGER_CLASS}>
              <MessageSquare className="h-4 w-4" />
              {t("settings.tabs.ai_chat")}
            </TabsTrigger>
            <TabsTrigger value="debug" className={SETTINGS_TAB_TRIGGER_CLASS}>
              <Bug className="h-4 w-4" />
              {t("settings.tabs.debug")}
            </TabsTrigger>
          </TabsList>
          <div className={SETTINGS_TABS_CONTENT_CLASS}>
            <GeneralSettingsTab
              t={t}
              language={language}
              setLanguage={setLanguage}
              theme={theme}
              setTheme={setTheme}
              options={options}
              onChange={onChange}
            />
            <ExportSettingsTab t={t} options={options} onChange={onChange} />
            <SnappingSettingsTab
              t={t}
              options={options.snappingOptions}
              onUpdate={updateSnappingOption}
            />
            <LlmSettingsTab
              t={t}
              options={options}
              llmModelCache={llmModelCache}
              llmProviderTab={llmProviderTab}
              onLlmProviderTabChange={setLlmProviderTab}
              llmSyncStatus={llmSyncStatus}
              customModelNameByProvider={customModelNameByProvider}
              setCustomModelNameByProvider={setCustomModelNameByProvider}
              customModelCapabilityOptions={customModelCapabilityOptions}
              setCustomModelCapabilityByProvider={
                setCustomModelCapabilityByProvider
              }
              isDesktopRuntime={isDesktopRuntime}
              isLlmProviderEnabled={isLlmProviderEnabled}
              setLlmProviderEnabled={setLlmProviderEnabled}
              updateLlmApiKey={updateLlmApiKey}
              updateLlmApiUrl={updateLlmApiUrl}
              updateLlmApiOption={updateLlmApiOption}
              syncLlmProviderModels={syncLlmProviderModels}
              getCustomModelDraftCapabilities={getCustomModelDraftCapabilities}
              addCustomModel={addCustomModel}
              removeCustomModel={removeCustomModel}
              updateApiProxyOptions={updateApiProxyOptions}
            />
            <AiChatSettingsTab
              t={t}
              options={options.aiChat}
              aiToolModelGroups={aiToolModelGroups}
              aiVisionModelGroups={aiVisionModelGroups}
              updateAiChatOptions={updateAiChatOptions}
            />
            <DebugSettingsTab
              t={t}
              options={options.debugOptions}
              onUpdate={updateDebugOption}
            />
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;
