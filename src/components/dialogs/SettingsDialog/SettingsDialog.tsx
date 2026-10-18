import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BrainCircuit,
  Bug,
  FileText,
  Globe,
  Languages,
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
import {
  filterModelSelectGroups,
  type ModelSelectGroup,
} from "@/components/ModelSelect";
import {
  getChatModelGroups,
  getVisionModelGroups,
  loadModels,
} from "@/services/ai";
import { createAiConnection } from "@/services/ai/providers/connections";
import type { AiProviderSpec } from "@/services/ai/providers/catalog";
import {
  getModelsDevRevision,
  subscribeModelsDev,
} from "@/services/ai/providers/modelsDev";
import { getConnectionCacheKey } from "@/services/ai/providers/modelCatalog/base";
import { translateService } from "@/services/translateService";
import {
  preferencesStore,
  usePreferencesStore,
} from "@/store/preferencesStore";
import type { AppOptions, DebugOptions, SnappingOptions } from "@/types";

import { AiChatSettingsTab } from "./AiChatSettingsTab";
import { DebugSettingsTab } from "./DebugSettingsTab";
import { EditSettingsTab } from "./EditSettingsTab";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { LlmSettingsTab } from "./LlmSettingsTab";
import { TranslationSettingsTab } from "./TranslationSettingsTab";
import {
  SETTINGS_TAB_TRIGGER_CLASS,
  SETTINGS_TABS_CONTENT_CLASS,
  SETTINGS_TABS_LIST_CLASS,
  SETTINGS_TABS_ROOT_CLASS,
} from "./styles";
import type {
  LlmProviderId,
  ProviderSyncStatus,
  SettingsDialogProps,
} from "./types";

const SettingsDialog = ({
  isOpen,
  onClose,
  options,
  onChange,
}: SettingsDialogProps) => {
  const { t } = useLanguage();
  const llmModelCache = usePreferencesStore((s) => s.llmModelCache);
  const catalogRevision = useSyncExternalStore(
    subscribeModelsDev,
    getModelsDevRevision,
  );

  const [expandedConnections, setExpandedConnections] = useState<string[]>([]);
  const setConnectionOpen = (id: string, open: boolean) => {
    setExpandedConnections((previous) =>
      open
        ? [...new Set([...previous, id])]
        : previous.filter((value) => value !== id),
    );
  };

  const [llmSyncStatus, setLlmSyncStatus] = useState<
    Record<LlmProviderId, ProviderSyncStatus>
  >({});

  const modelUpdateTimersRef = useRef<Partial<Record<LlmProviderId, number>>>(
    {},
  );
  useEffect(
    () => () => {
      for (const timer of Object.values(modelUpdateTimersRef.current))
        window.clearTimeout(timer);
    },
    [],
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
    if (!options.llm[provider]) return;
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
    if (
      ["apiKey", "apiUrl", "backendKind", "authMode", "catalogId"].some(
        (key) => key in patch,
      )
    ) {
      clearFetchedLlmModels(provider);
    }
    setLlmSyncStatus((previous) => ({
      ...previous,
      [provider]: { state: "idle", message: "" },
    }));
    scheduleModelRegistryUpdate(provider);
  };

  const addConnection = (spec?: AiProviderSpec) => {
    const id = crypto.randomUUID();
    const connection = createAiConnection(spec);
    if (!spec) connection.name = t("settings.llm.custom_connection");
    onChange({ ...options, llm: { ...options.llm, [id]: connection } });
    setConnectionOpen(id, true);
  };
  const removeConnection = (id: string) => {
    const next = { ...options.llm };
    delete next[id];
    onChange({ ...options, llm: next });
    window.clearTimeout(modelUpdateTimersRef.current[id]);
    preferencesStore.setState((state) => {
      const cache = { ...state.llmModelCache };
      delete cache[id];
      return { llmModelCache: cache };
    });
    setConnectionOpen(id, false);
    void loadModels();
  };

  const isLlmProviderEnabled = (provider: LlmProviderId) =>
    !!options.llm[provider] && options.llm[provider].enabled !== false;

  const updateAiChatOptions = (patch: Partial<AppOptions["aiChat"]>) => {
    onChange({
      ...options,
      aiChat: {
        ...options.aiChat,
        ...patch,
      },
    });
  };

  const updateTranslationOptions = (translation: AppOptions["translation"]) => {
    onChange({
      ...options,
      translation,
    });
    translateService.notifyAvailabilityChanged();
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
    preferencesStore.setState((state) => ({
      llmModelCache: {
        ...state.llmModelCache,
        [provider]: {
          models: [],
        },
      },
    }));
  };

  const aiToolModelGroups = useMemo<ModelSelectGroup[]>(() => {
    return getChatModelGroups().map((group) => ({
      id: group.providerId,
      catalogId: group.catalogId,
      label: group.label,
      options: group.models.map((model) => ({
        value: `${group.providerId}:${model.id}`,
        label: model.label,
        capabilities: model.capabilities,
        disabled: !group.isAvailable,
      })),
    }));
  }, [llmModelCache, options.llm, catalogRevision]);

  const imageModelFilter = useCallback(
    (option: { capabilities?: { supportsImageInput?: boolean } }) =>
      option.capabilities?.supportsImageInput === true,
    [],
  );

  const aiVisionModelGroups = useMemo<ModelSelectGroup[]>(() => {
    return filterModelSelectGroups(
      getVisionModelGroups().map((group) => ({
        id: group.providerId,
        catalogId: group.catalogId,
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
  }, [imageModelFilter, llmModelCache, options.llm, t, catalogRevision]);

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
    if (!apiKey && options.llm[provider].authMode !== "none") {
      setLlmSyncStatus((prev) => ({
        ...prev,
        [provider]: {
          state: "error",
          message: t("settings.llm.api_key_required"),
        },
      }));
      return;
    }

    if (!options.llm[provider].apiUrl?.trim()) {
      setLlmSyncStatus((prev) => ({
        ...prev,
        [provider]: {
          state: "error",
          message: t("settings.llm.api_url_required"),
        },
      }));
      return;
    }

    const configurationKey = getConnectionCacheKey(options, provider);
    const isCurrent = () => {
      const current = preferencesStore.getState().options;
      return (
        current.llm[provider]?.enabled !== false &&
        !!current.llm[provider] &&
        getConnectionCacheKey(current, provider) === configurationKey
      );
    };

    setLlmSyncStatus((prev) => ({
      ...prev,
      [provider]: { state: "syncing", message: "" },
    }));

    try {
      await loadModels({
        providerIds: [provider],
        force: true,
        throwOnError: true,
      });

      if (!isCurrent()) return;

      setLlmSyncStatus((prev) => ({
        ...prev,
        [provider]: { state: "ok", message: t("settings.llm.fetch_success") },
      }));
    } catch (err) {
      if (!isCurrent()) return;
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
            <TabsTrigger value="edit" className={SETTINGS_TAB_TRIGGER_CLASS}>
              <FileText className="h-4 w-4" />
              {t("settings.tabs.edit")}
            </TabsTrigger>
            <TabsTrigger value="llm" className={SETTINGS_TAB_TRIGGER_CLASS}>
              <BrainCircuit className="h-4 w-4" />
              {t("settings.tabs.llm")}
            </TabsTrigger>
            <TabsTrigger
              value="translation"
              className={SETTINGS_TAB_TRIGGER_CLASS}
            >
              <Languages className="h-4 w-4" />
              {t("settings.tabs.translation")}
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
            <GeneralSettingsTab options={options} onChange={onChange} />
            <EditSettingsTab
              options={options}
              onChange={onChange}
              onUpdateSnapping={updateSnappingOption}
            />
            <LlmSettingsTab
              options={options}
              llmModelCache={llmModelCache}
              expandedConnections={expandedConnections}
              setConnectionOpen={setConnectionOpen}
              llmSyncStatus={llmSyncStatus}
              updateConnection={updateLlmProviderOptions}
              addConnection={addConnection}
              removeConnection={removeConnection}
              syncLlmProviderModels={syncLlmProviderModels}
              updateApiProxyOptions={updateApiProxyOptions}
            />
            <TranslationSettingsTab
              options={options.translation}
              onChange={updateTranslationOptions}
            />
            <AiChatSettingsTab
              options={options.aiChat}
              aiToolModelGroups={aiToolModelGroups}
              aiVisionModelGroups={aiVisionModelGroups}
              updateAiChatOptions={updateAiChatOptions}
            />
            <DebugSettingsTab
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
