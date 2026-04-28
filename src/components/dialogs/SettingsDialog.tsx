import React, { useMemo, useRef, useState } from "react";
import {
  Settings2,
  Magnet,
  Globe,
  Moon,
  Sun,
  Laptop,
  Bug,
  LayoutGrid,
  User,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BrainCircuit,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  DebugOptions,
  AppOptions,
  LLMCustomModelCapability,
  SnappingOptions,
  ThumbnailsLayoutMode,
} from "@/types";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_SPECS_SORTED_BY_LABEL,
  getAiProviderSelectedApiOption,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import { useLanguage, Language, LANGUAGES } from "../language-provider";
import { useTheme } from "../theme-provider";
import { Separator } from "../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { useEditorStore } from "@/store/useEditorStore";
import {
  checkLlmProviderConfig,
  getChatModelGroups,
  getVisionModelGroups,
  loadModels,
} from "@/services/ai";
import { ModelCapabilityBadges } from "@/components/ModelCapabilityBadges";
import {
  filterModelSelectGroups,
  ModelSelect,
  type ModelSelectGroup,
} from "@/components/ModelSelect";
import { ProviderLogo } from "@/components/ProviderLogo";
import { createCustomModelCapabilities } from "@/services/ai/providers/modelCapabilities";
import {
  AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MAX,
  AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MIN,
  AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_STEP,
  AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS,
  AI_CHAT_DIGEST_SOURCE_CHARS_MAX,
  AI_CHAT_DIGEST_SOURCE_CHARS_MIN,
  AI_CHAT_DIGEST_SOURCE_CHARS_STEP,
  AI_CHAT_MAX_TOOL_ROUNDS_MAX,
  AI_CHAT_MAX_TOOL_ROUNDS_MIN,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN,
  DEV_API_PROXY_URL,
} from "@/constants";
import { cn } from "@/utils/cn";
import { isDesktopApp } from "@/services/platform/runtime";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  options: AppOptions;
  onChange: (options: AppOptions) => void;
}

const SETTINGS_TABS_ROOT_CLASS =
  "flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row";
const SETTINGS_TABS_LIST_CLASS =
  "shrink-0 text-foreground h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent py-1 sm:h-min sm:w-auto sm:flex-col sm:overflow-visible";
const SETTINGS_TABS_CONTENT_CLASS =
  "min-h-0 grow overflow-y-auto rounded-md border p-4 py-4 text-start";

const SETTINGS_TAB_TRIGGER_INDICATOR_CLASS =
  "data-[state=active]:after:bg-primary after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full sm:after:inset-y-0 sm:after:left-0 sm:after:h-full sm:after:w-0.5 sm:after:bottom-auto";

const SETTINGS_TAB_TRIGGER_CLASS = cn(
  "relative min-w-max flex-none justify-start hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:border-none data-[state=active]:bg-transparent data-[state=active]:shadow-none",
  SETTINGS_TAB_TRIGGER_INDICATOR_CLASS,
);
const SETTINGS_CARD_BASE_CLASS =
  "bg-muted/30 border-border flex flex-col rounded-lg border p-3";
const SETTINGS_CARD_COMPACT_CLASS = `${SETTINGS_CARD_BASE_CLASS} space-y-2`;
const SETTINGS_CARD_SPACIOUS_CLASS = `${SETTINGS_CARD_BASE_CLASS} space-y-4`;
const SETTINGS_CARD_GAP_CLASS = `${SETTINGS_CARD_BASE_CLASS} gap-3`;

const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  options,
  onChange,
}) => {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const isDesktopRuntime = isDesktopApp();

  const llmModelCache = useEditorStore((s) => s.llmModelCache);
  type LlmProviderId = AiProviderId;
  type ProviderSyncStatus = {
    state: "idle" | "syncing" | "ok" | "error";
    message: string;
  };

  const buildProviderStatusRecord = <T extends ProviderSyncStatus>(
    initial: T,
  ) =>
    Object.fromEntries(
      AI_PROVIDER_IDS.map((providerId) => [providerId, { ...initial }]),
    ) as Record<LlmProviderId, T>;

  const [llmProviderTab, setLlmProviderTab] = useState<LlmProviderId>(
    AI_PROVIDER_SPECS_SORTED_BY_LABEL[0]?.id ?? AI_PROVIDER_IDS[0],
  );

  const [llmSyncStatus, setLlmSyncStatus] = useState<
    Record<LlmProviderId, ProviderSyncStatus>
  >(buildProviderStatusRecord({ state: "idle", message: "" }));

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
      ] satisfies Array<{
        value: LLMCustomModelCapability;
        label: string;
      }>,
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

  const getCustomModelDraftCapabilities = (provider: LlmProviderId) => {
    const values = customModelCapabilityByProvider[provider] || [
      "text",
      "tools",
    ];
    const normalized = new Set<LLMCustomModelCapability>(["text", ...values]);
    return ["text", "image", "tools"].filter((value) =>
      normalized.has(value as LLMCustomModelCapability),
    ) as LLMCustomModelCapability[];
  };

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
  const imageModelFilter = React.useCallback(
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

  const selectedLlmProviderSpec =
    AI_PROVIDER_SPECS_SORTED_BY_LABEL.find(
      (spec) => spec.id === llmProviderTab,
    ) ?? AI_PROVIDER_SPECS_SORTED_BY_LABEL[0];
  const selectedLlmProviderEnabled = isLlmProviderEnabled(llmProviderTab);

  const digestOutputRatioDenominator =
    options.aiChat.digestOutputRatioDenominator;
  const digestEnabled = options.aiChat.digestEnabled;
  const digestSourceCharsPerChunk = options.aiChat.digestSourceCharsPerChunk;
  const visualSummaryEnabled = options.aiChat.visualSummaryEnabled;
  const contextCompressionEnabled = options.aiChat.contextCompressionEnabled;
  const visualHistoryWindow = options.aiChat.visualHistoryWindow;
  const contextCompressionThresholdTokens =
    options.aiChat.contextCompressionThresholdTokens;
  const maxToolRounds = options.aiChat.maxToolRounds;
  const contextCompressionMode = options.aiChat.contextCompressionMode;
  const contextCompressionModelKey = options.aiChat.contextCompressionModelKey;

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

  const updateOption = (
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
            <TabsContent value="general">
              <div className="space-y-6">
                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="text-primary h-4 w-4" />
                      <Label className="mb-0 font-semibold">
                        {t("settings.language")}
                      </Label>
                    </div>
                    <Select
                      value={language}
                      onValueChange={(val) => setLanguage(val as Language)}
                    >
                      <SelectTrigger className="h-8 w-[160px]">
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((lang) => (
                          <SelectItem key={lang.value} value={lang.value}>
                            {lang.label}
                          </SelectItem>
                        ))}
                        <SelectSeparator />
                        <SelectItem value="system">
                          {t("settings.theme_options.system")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {theme === "dark" ? (
                        <Moon className="text-primary h-4 w-4" />
                      ) : theme === "light" ? (
                        <Sun className="text-primary h-4 w-4" />
                      ) : (
                        <Laptop className="text-primary h-4 w-4" />
                      )}
                      <Label className="mb-0 font-semibold">
                        {t("settings.theme")}
                      </Label>
                    </div>
                    <Select
                      value={theme}
                      onValueChange={(val: "dark" | "light" | "system") =>
                        setTheme(val)
                      }
                    >
                      <SelectTrigger className="h-8 w-[160px]">
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">
                          {t("settings.theme_options.light")}
                        </SelectItem>
                        <SelectItem value="dark">
                          {t("settings.theme_options.dark")}
                        </SelectItem>
                        <SelectItem value="system">
                          {t("settings.theme_options.system")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="text-primary h-4 w-4" />
                      <Label className="mb-0 font-semibold">
                        {t("settings.thumbnails_layout")}
                      </Label>
                    </div>
                    <Select
                      value={options.thumbnailsLayout || "single"}
                      onValueChange={(val) =>
                        onChange({
                          ...options,
                          thumbnailsLayout: val as ThumbnailsLayoutMode,
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-[160px]">
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="single">
                          {t("settings.single")}
                        </SelectItem>
                        <SelectItem value="double">
                          {t("settings.double")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <User className="text-primary h-4 w-4" />
                      <Label
                        htmlFor="app-user-name"
                        className="mb-0 font-semibold"
                      >
                        {t("settings.user_name")}
                      </Label>
                    </div>
                    <Input
                      id="app-user-name"
                      value={options.userName || ""}
                      onChange={(e) =>
                        onChange({ ...options, userName: e.target.value })
                      }
                      placeholder={t("settings.user_name_placeholder")}
                      className="h-8 w-[240px]"
                    />
                  </div>
                  <p className="text-muted-foreground px-1 text-xs">
                    {t("settings.user_name_desc")}
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="export">
              <div className="space-y-6">
                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <FileText className="text-primary h-4 w-4" />
                      <Label
                        htmlFor="remove-text-under-freetext"
                        className="mb-0 font-semibold"
                      >
                        {t("properties.remove_text_under_freetext.label")}
                      </Label>
                    </div>
                    <Switch
                      id="remove-text-under-freetext"
                      checked={!!options.removeTextUnderFlattenedFreetext}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...options,
                          removeTextUnderFlattenedFreetext: checked,
                        })
                      }
                    />
                  </div>
                  <p className="text-muted-foreground px-1 text-xs">
                    {t("properties.remove_text_under_freetext.desc")}
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="snapping">
              <div className="space-y-6">
                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Magnet className="text-primary h-4 w-4" />
                      <Label
                        htmlFor="snap-enabled"
                        className="mb-0 font-semibold"
                      >
                        {t("settings.snapping.enabled")}
                      </Label>
                    </div>
                    <Switch
                      id="snap-enabled"
                      checked={options.snappingOptions.enabled}
                      onCheckedChange={(c) => updateOption("enabled", c)}
                    />
                  </div>
                  <p className="text-muted-foreground px-1 text-xs">
                    {t("settings.snapping.description")}
                  </p>
                  <Separator />

                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="snap-borders"
                      className="mb-0 cursor-pointer"
                    >
                      {t("settings.borders")}
                    </Label>
                    <Switch
                      id="snap-borders"
                      disabled={!options.snappingOptions.enabled}
                      checked={options.snappingOptions.snapToBorders}
                      onCheckedChange={(c) => updateOption("snapToBorders", c)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="snap-center"
                      className="mb-0 cursor-pointer"
                    >
                      {t("settings.centers")}
                    </Label>
                    <Switch
                      id="snap-center"
                      disabled={!options.snappingOptions.enabled}
                      checked={options.snappingOptions.snapToCenter}
                      onCheckedChange={(c) => updateOption("snapToCenter", c)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="snap-equal" className="mb-0 cursor-pointer">
                      {t("settings.equal")}
                    </Label>
                    <Switch
                      id="snap-equal"
                      disabled={!options.snappingOptions.enabled}
                      checked={options.snappingOptions.snapToEqualDistances}
                      onCheckedChange={(c) =>
                        updateOption("snapToEqualDistances", c)
                      }
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="llm">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="mb-0 font-semibold">
                    {t("settings.llm.title")}
                  </Label>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Label className="text-xs">{t("translate.provider")}</Label>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`llm-provider-enabled-${llmProviderTab}`}
                        checked={selectedLlmProviderEnabled}
                        onCheckedChange={(checked) =>
                          setLlmProviderEnabled(llmProviderTab, checked)
                        }
                      />
                      <Label
                        htmlFor={`llm-provider-enabled-${llmProviderTab}`}
                        className="text-xs font-normal"
                      >
                        {t("settings.llm.provider_enabled")}
                      </Label>
                    </div>
                    <Select
                      value={llmProviderTab}
                      onValueChange={(v) =>
                        setLlmProviderTab(v as LlmProviderId)
                      }
                    >
                      <SelectTrigger className="h-8 w-[160px]">
                        <SelectValue placeholder={t("common.select")}>
                          <div className="flex items-center gap-1.5">
                            <ProviderLogo
                              providerId={selectedLlmProviderSpec.id}
                              size={14}
                              className="text-foreground/80"
                            />
                            <span>
                              {selectedLlmProviderSpec.labelKey
                                ? t(selectedLlmProviderSpec.labelKey)
                                : selectedLlmProviderSpec.label}
                            </span>
                          </div>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {AI_PROVIDER_SPECS_SORTED_BY_LABEL.map((spec) => (
                          <SelectItem
                            key={spec.id}
                            value={spec.id}
                            itemText={
                              spec.labelKey ? t(spec.labelKey) : spec.label
                            }
                          >
                            <div className="flex items-center gap-2">
                              <ProviderLogo
                                providerId={spec.id}
                                size={14}
                                className="text-foreground/80"
                              />
                              <span>
                                {spec.labelKey ? t(spec.labelKey) : spec.label}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Tabs value={llmProviderTab}>
                  {AI_PROVIDER_SPECS_SORTED_BY_LABEL.map((spec) => {
                    const providerOptions = options.llm[spec.id];
                    const syncStatus = llmSyncStatus[spec.id];
                    const showApiUrl = spec.allowCustomBaseUrl;
                    const providerEnabled = isLlmProviderEnabled(spec.id);
                    const selectedApiOption = getAiProviderSelectedApiOption(
                      spec.id,
                      providerOptions.apiOptionId,
                    );
                    const selectedApiUrlPlaceholder =
                      selectedApiOption?.defaultBaseUrl ||
                      spec.defaultBaseUrl ||
                      t("settings.llm.api_url_placeholder");
                    const selectedApiOptionLabel = selectedApiOption
                      ? selectedApiOption.labelKey
                        ? t(selectedApiOption.labelKey)
                        : selectedApiOption.label
                      : "";
                    return (
                      <TabsContent
                        key={spec.id}
                        value={spec.id}
                        className="space-y-4"
                      >
                        <div className="bg-muted/30 border-border flex flex-col gap-2 rounded-lg border p-3">
                          {spec.apiOptions && spec.apiOptions.length > 1 ? (
                            <div className="space-y-1">
                              <Label className="text-xs">
                                {t("settings.llm.api_option")}
                              </Label>
                              <Select
                                value={
                                  selectedApiOption?.id ||
                                  spec.defaultApiOptionId ||
                                  spec.apiOptions[0]!.id
                                }
                                onValueChange={(value) =>
                                  updateLlmApiOption(spec.id, value)
                                }
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder={t("common.select")}>
                                    {selectedApiOptionLabel}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {spec.apiOptions.map((apiOption) => (
                                    <SelectItem
                                      key={`${spec.id}:${apiOption.id}`}
                                      value={apiOption.id}
                                      itemText={
                                        apiOption.labelKey
                                          ? t(apiOption.labelKey)
                                          : apiOption.label
                                      }
                                    >
                                      {apiOption.labelKey
                                        ? t(apiOption.labelKey)
                                        : apiOption.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                          <Input
                            value={providerOptions.apiKey || ""}
                            onChange={(e) =>
                              updateLlmApiKey(spec.id, e.target.value)
                            }
                            placeholder={t("settings.llm.api_key_placeholder")}
                            className="h-8"
                            type="password"
                          />
                          <div className="flex items-center gap-2">
                            {showApiUrl ? (
                              <Input
                                value={providerOptions.apiUrl || ""}
                                onChange={(e) =>
                                  updateLlmApiUrl(spec.id, e.target.value)
                                }
                                placeholder={selectedApiUrlPlaceholder}
                                className="h-8"
                              />
                            ) : null}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() =>
                                void syncLlmProviderModels(spec.id)
                              }
                              disabled={
                                !providerEnabled ||
                                syncStatus.state === "syncing"
                              }
                            >
                              {syncStatus.state === "syncing" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                              {t("settings.llm.fetch_models")}
                            </Button>
                          </div>

                          {syncStatus.state === "ok" ? (
                            <div className="flex items-center gap-2 text-xs">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              <span className="text-muted-foreground">
                                {syncStatus.message}
                              </span>
                            </div>
                          ) : null}
                          {syncStatus.state === "error" ? (
                            <div className="flex items-center gap-2 text-xs">
                              <AlertCircle className="text-destructive h-4 w-4" />
                              <span className="text-destructive">
                                {syncStatus.message}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className={SETTINGS_CARD_GAP_CLASS}>
                          <div className="flex items-center justify-between gap-2">
                            <Label className="text-xs">
                              {t("settings.llm.fetched_models")}
                            </Label>
                            <span className="text-muted-foreground text-xs">
                              {t("settings.llm.models_loaded_count", {
                                count:
                                  llmModelCache[spec.id].translateModels.length,
                              })}
                            </span>
                          </div>
                          {llmModelCache[spec.id].translateModels.length > 0 ? (
                            <div className="bg-background/80 max-h-36 overflow-auto rounded-md border p-2">
                              <div className="flex flex-col gap-1.5">
                                {llmModelCache[spec.id].translateModels.map(
                                  (model) => (
                                    <span
                                      key={`${spec.id}:fetched:${model.id}`}
                                      className="bg-muted inline-flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1 text-[11px]"
                                      title={model.id}
                                    >
                                      <span className="min-w-0 flex-1">
                                        {model.id}
                                      </span>
                                      <ModelCapabilityBadges
                                        capabilities={model.capabilities}
                                        className="shrink-0 flex-nowrap"
                                      />
                                    </span>
                                  ),
                                )}
                              </div>
                            </div>
                          ) : (
                            <p className="text-muted-foreground text-xs">
                              {t("settings.llm.fetched_models_empty")}
                            </p>
                          )}
                        </div>

                        <div className={SETTINGS_CARD_GAP_CLASS}>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              {t("settings.llm.custom_models")}
                            </Label>
                            <p className="text-muted-foreground text-xs">
                              {t("settings.llm.custom_models_desc")}
                            </p>
                          </div>

                          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                            <Input
                              id={`llm-${spec.id}-custom-model-name`}
                              placeholder={t(
                                "settings.llm.custom_model_name_placeholder",
                              )}
                              value={customModelNameByProvider[spec.id] || ""}
                              onChange={(event) =>
                                setCustomModelNameByProvider((prev) => ({
                                  ...prev,
                                  [spec.id]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(spec.id);
                              }}
                            />
                            <Button
                              type="button"
                              onClick={() => addCustomModel(spec.id)}
                              disabled={
                                !(
                                  customModelNameByProvider[spec.id] || ""
                                ).trim()
                              }
                            >
                              <Plus className="mr-1 h-4 w-4" />
                              {t("settings.llm.custom_model_add")}
                            </Button>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs">
                              {t("settings.llm.custom_model_capability")}
                            </Label>
                            <ToggleGroup
                              type="multiple"
                              variant="outline"
                              size="sm"
                              spacing={1}
                              value={getCustomModelDraftCapabilities(spec.id)}
                              onValueChange={(value) => {
                                const nextValues =
                                  new Set<LLMCustomModelCapability>(["text"]);
                                for (const item of value) {
                                  if (
                                    item === "text" ||
                                    item === "image" ||
                                    item === "tools"
                                  ) {
                                    nextValues.add(item);
                                  }
                                }
                                setCustomModelCapabilityByProvider((prev) => ({
                                  ...prev,
                                  [spec.id]: ["text", "image", "tools"].filter(
                                    (item) =>
                                      nextValues.has(
                                        item as LLMCustomModelCapability,
                                      ),
                                  ) as LLMCustomModelCapability[],
                                }));
                              }}
                              className="w-full flex-wrap"
                            >
                              {customModelCapabilityOptions.map((option) => (
                                <ToggleGroupItem
                                  key={option.value}
                                  value={option.value}
                                  disabled={option.value === "text"}
                                  className="min-w-20"
                                >
                                  {option.label}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                          </div>

                          {(providerOptions.customModels || []).length > 0 ? (
                            <div className="bg-background/80 max-h-48 overflow-auto rounded-md border p-2">
                              <div className="flex flex-col gap-1.5">
                                {(providerOptions.customModels || []).map(
                                  (model) => (
                                    <div
                                      key={`${spec.id}:custom:${model.id}`}
                                      className="bg-muted flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1"
                                    >
                                      <span
                                        className="min-w-0 flex-1 text-[11px]"
                                        title={model.id}
                                      >
                                        {model.id}
                                      </span>
                                      <ModelCapabilityBadges
                                        capabilities={createCustomModelCapabilities(
                                          model.capabilities,
                                        )}
                                        className="shrink-0 flex-nowrap"
                                      />
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:text-foreground h-7 w-7 shrink-0"
                                        onClick={() =>
                                          removeCustomModel(spec.id, model.id)
                                        }
                                        aria-label={t("common.actions.delete")}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          ) : (
                            <p className="text-muted-foreground text-xs">
                              {t("settings.llm.custom_models_empty")}
                            </p>
                          )}
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>

                <div className={SETTINGS_CARD_GAP_CLASS}>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {t("settings.llm.proxy_title")}
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      {t("settings.llm.proxy_desc")}
                    </p>
                  </div>

                  {isDesktopRuntime ? (
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">
                          {t("settings.llm.tauri_proxy_enabled")}
                        </Label>
                        <p className="text-muted-foreground text-xs">
                          {t("settings.llm.tauri_proxy_enabled_desc")}
                        </p>
                      </div>
                      <Switch
                        checked={options.apiProxy.tauriForwardEnabled}
                        onCheckedChange={(checked) =>
                          updateApiProxyOptions({
                            tauriForwardEnabled: checked,
                          })
                        }
                      />
                    </div>
                  ) : null}

                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">
                        {t("settings.llm.proxy_url_enabled")}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {t("settings.llm.proxy_url_enabled_desc")}
                      </p>
                    </div>
                    <Switch
                      checked={options.apiProxy.proxyUrlEnabled}
                      onCheckedChange={(checked) =>
                        updateApiProxyOptions({
                          proxyUrlEnabled: checked,
                        })
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">
                      {t("settings.llm.proxy_url")}
                    </Label>
                    <Input
                      value={options.apiProxy.proxyUrl || ""}
                      onChange={(event) =>
                        updateApiProxyOptions({
                          proxyUrl: event.target.value,
                        })
                      }
                      placeholder={
                        import.meta.env.DEV
                          ? DEV_API_PROXY_URL
                          : t("settings.llm.proxy_url_placeholder")
                      }
                      className="h-8"
                    />
                    <p className="text-muted-foreground text-xs">
                      {t("settings.llm.proxy_url_desc")}
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="ai_chat">
              <div className="space-y-6">
                <div className={SETTINGS_CARD_SPACIOUS_CLASS}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label
                        htmlFor="ai-chat-max-tool-rounds"
                        className="font-semibold"
                      >
                        {t("settings.ai_chat.max_tool_rounds")}
                      </Label>
                      <span className="text-muted-foreground text-xs">
                        {maxToolRounds}
                      </span>
                    </div>
                    <Slider
                      value={[maxToolRounds]}
                      min={AI_CHAT_MAX_TOOL_ROUNDS_MIN}
                      max={AI_CHAT_MAX_TOOL_ROUNDS_MAX}
                      step={1}
                      onValueChange={(values) => {
                        const next = values[0];
                        if (!Number.isFinite(next)) return;
                        updateAiChatOptions({
                          maxToolRounds: next,
                        });
                      }}
                    />
                    <div className="text-muted-foreground flex justify-between text-xs">
                      <span>{AI_CHAT_MAX_TOOL_ROUNDS_MIN}</span>
                      <span>{AI_CHAT_MAX_TOOL_ROUNDS_MAX}</span>
                    </div>
                  </div>
                </div>

                <div className={SETTINGS_CARD_SPACIOUS_CLASS}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Label
                        htmlFor="ai-chat-context-pruning-enabled"
                        className="font-semibold"
                      >
                        {t("settings.ai_chat.context_pruning_enabled")}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {t("settings.ai_chat.context_pruning_enabled_desc")}
                      </p>
                    </div>
                    <Switch
                      id="ai-chat-context-pruning-enabled"
                      checked={contextCompressionEnabled}
                      onCheckedChange={(checked) =>
                        updateAiChatOptions({
                          contextCompressionEnabled: checked,
                        })
                      }
                    />
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="ai-chat-context-pruning-threshold">
                        {t(
                          "settings.ai_chat.context_pruning_trigger_context_tokens",
                        )}
                      </Label>
                      <span className="text-muted-foreground text-xs">
                        {contextCompressionThresholdTokens.toLocaleString()}
                      </span>
                    </div>
                    <Slider
                      value={[contextCompressionThresholdTokens]}
                      disabled={!contextCompressionEnabled}
                      min={AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MIN}
                      max={AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MAX}
                      step={AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_STEP}
                      onValueChange={(values) => {
                        const next = values[0];
                        if (!Number.isFinite(next)) return;
                        updateAiChatOptions({
                          contextCompressionThresholdTokens: next,
                        });
                      }}
                    />
                    <div className="text-muted-foreground flex justify-between text-xs">
                      <span>
                        {AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MIN.toLocaleString()}
                      </span>
                      <span>
                        {AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MAX.toLocaleString()}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t(
                        "settings.ai_chat.context_pruning_trigger_context_tokens_desc",
                      )}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="ai-chat-visual-tool-history-window">
                        {t("settings.ai_chat.visual_tool_history_window")}
                      </Label>
                      <span className="text-muted-foreground text-xs">
                        {visualHistoryWindow}
                      </span>
                    </div>
                    <Slider
                      value={[visualHistoryWindow]}
                      min={AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN}
                      max={AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX}
                      step={1}
                      onValueChange={(values) => {
                        const next = values[0];
                        if (!Number.isFinite(next)) return;
                        updateAiChatOptions({
                          visualHistoryWindow: next,
                        });
                      }}
                    />
                    <div className="text-muted-foreground flex justify-between text-xs">
                      <span>{AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN}</span>
                      <span>{AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX}</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label className="font-semibold">
                      {t("settings.ai_chat.context_compression_mode")}
                    </Label>
                    <Select
                      value={contextCompressionMode}
                      disabled={!contextCompressionEnabled}
                      onValueChange={(value) => {
                        if (value !== "algorithmic" && value !== "ai") return;
                        updateAiChatOptions({
                          contextCompressionMode: value,
                        });
                      }}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue
                          placeholder={t(
                            "settings.ai_chat.context_compression_mode",
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="algorithmic">
                          {t(
                            "settings.ai_chat.context_compression_mode_algorithmic",
                          )}
                        </SelectItem>
                        <SelectItem value="ai">
                          {t("settings.ai_chat.context_compression_mode_ai")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs">
                      {t("settings.ai_chat.context_compression_mode_desc")}
                    </p>
                  </div>

                  {contextCompressionMode === "ai" ? (
                    <div className="space-y-2">
                      <Label className="font-semibold">
                        {t("settings.ai_chat.context_compression_model")}
                      </Label>
                      <ModelSelect
                        value={contextCompressionModelKey || undefined}
                        onValueChange={(value) =>
                          updateAiChatOptions({
                            contextCompressionModelKey: value,
                          })
                        }
                        placeholder={
                          aiToolModelGroups.length > 0
                            ? t(
                                "settings.ai_chat.context_compression_model_placeholder",
                              )
                            : t("settings.ai_chat.no_models")
                        }
                        groups={aiToolModelGroups}
                        disabled={
                          !contextCompressionEnabled ||
                          aiToolModelGroups.length === 0
                        }
                        showSeparators
                      />
                      <p className="text-muted-foreground text-xs">
                        {t("settings.ai_chat.context_compression_model_desc")}
                      </p>
                    </div>
                  ) : null}

                  <p className="text-muted-foreground text-xs">
                    {t("settings.ai_chat.context_pruning_desc")}
                  </p>
                </div>

                <div className={SETTINGS_CARD_SPACIOUS_CLASS}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Label
                        htmlFor="ai-chat-form-tools-enabled"
                        className="font-semibold"
                      >
                        {t("settings.ai_chat.form_tools_enabled")}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {t("settings.ai_chat.form_tools_enabled_desc")}
                      </p>
                    </div>
                    <Switch
                      id="ai-chat-form-tools-enabled"
                      checked={options.aiChat.formToolsEnabled}
                      onCheckedChange={(checked) =>
                        updateAiChatOptions({
                          formToolsEnabled: checked,
                        })
                      }
                    />
                  </div>

                  <Separator />

                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Label
                        htmlFor="ai-chat-detect-form-fields-enabled"
                        className="font-semibold"
                      >
                        {t("settings.ai_chat.detect_form_fields_enabled")}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {t("settings.ai_chat.detect_form_fields_enabled_desc")}
                      </p>
                    </div>
                    <Switch
                      id="ai-chat-detect-form-fields-enabled"
                      checked={options.aiChat.detectFormFieldsEnabled}
                      onCheckedChange={(checked) =>
                        updateAiChatOptions({
                          detectFormFieldsEnabled: checked,
                        })
                      }
                      disabled={!options.aiChat.formToolsEnabled}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label className="font-semibold">
                      {t("settings.ai_chat.form_tools_vision_model")}
                    </Label>
                    <ModelSelect
                      value={
                        options.aiChat.formToolsVisionModelKey || undefined
                      }
                      onValueChange={(value) =>
                        updateAiChatOptions({
                          formToolsVisionModelKey: value,
                        })
                      }
                      placeholder={
                        aiVisionModelGroups.length > 0
                          ? t(
                              "settings.ai_chat.form_tools_vision_model_placeholder",
                            )
                          : t("settings.ai_chat.no_models")
                      }
                      groups={aiVisionModelGroups}
                      disabled={
                        !options.aiChat.formToolsEnabled ||
                        !options.aiChat.detectFormFieldsEnabled ||
                        aiVisionModelGroups.length === 0
                      }
                      showSeparators
                    />
                    <p className="text-muted-foreground text-xs">
                      {t("settings.ai_chat.form_tools_vision_model_desc")}
                    </p>
                  </div>
                </div>

                <div className={SETTINGS_CARD_SPACIOUS_CLASS}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Label
                        htmlFor="ai-chat-visual-summary-enabled"
                        className="font-semibold"
                      >
                        {t("settings.ai_chat.visual_summary_enabled")}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {t("settings.ai_chat.visual_summary_enabled_desc")}
                      </p>
                    </div>
                    <Switch
                      id="ai-chat-visual-summary-enabled"
                      checked={visualSummaryEnabled}
                      onCheckedChange={(checked) =>
                        updateAiChatOptions({
                          visualSummaryEnabled: checked,
                        })
                      }
                    />
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label className="font-semibold">
                      {t("settings.ai_chat.visual_summary_model")}
                    </Label>
                    <ModelSelect
                      value={options.aiChat.visualSummaryModelKey || undefined}
                      onValueChange={(value) =>
                        updateAiChatOptions({
                          visualSummaryModelKey: value,
                        })
                      }
                      placeholder={
                        aiVisionModelGroups.length > 0
                          ? t(
                              "settings.ai_chat.visual_summary_model_placeholder",
                            )
                          : t("settings.ai_chat.no_models")
                      }
                      groups={aiVisionModelGroups}
                      disabled={
                        !visualSummaryEnabled ||
                        aiVisionModelGroups.length === 0
                      }
                      showSeparators
                    />
                    <p className="text-muted-foreground text-xs">
                      {t("settings.ai_chat.visual_summary_model_desc")}
                    </p>
                  </div>
                </div>

                <div className={SETTINGS_CARD_SPACIOUS_CLASS}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Label
                        htmlFor="ai-chat-digest-enabled"
                        className="font-semibold"
                      >
                        {t("settings.ai_chat.digest_enabled")}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {t("settings.ai_chat.digest_enabled_desc")}
                      </p>
                    </div>
                    <Switch
                      id="ai-chat-digest-enabled"
                      checked={digestEnabled}
                      onCheckedChange={(checked) =>
                        updateAiChatOptions({
                          digestEnabled: checked,
                        })
                      }
                    />
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label className="font-semibold">
                      {t("settings.ai_chat.summary_model")}
                    </Label>
                    <ModelSelect
                      value={options.aiChat.digestSummaryModelKey || undefined}
                      onValueChange={(value) =>
                        updateAiChatOptions({
                          digestSummaryModelKey: value,
                        })
                      }
                      placeholder={
                        aiToolModelGroups.length > 0
                          ? t("settings.ai_chat.summary_model_placeholder")
                          : t("settings.ai_chat.no_models")
                      }
                      groups={aiToolModelGroups}
                      disabled={
                        !digestEnabled || aiToolModelGroups.length === 0
                      }
                      showSeparators
                    />
                    <p className="text-muted-foreground text-xs">
                      {t("settings.ai_chat.summary_model_desc")}
                    </p>
                  </div>

                  <Separator />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="ai-chat-digest-ratio">
                          {t("settings.ai_chat.digest_chars_per_chunk")}
                        </Label>
                        <span className="text-muted-foreground text-xs">
                          1/{digestOutputRatioDenominator}
                        </span>
                      </div>
                      <Slider
                        value={[
                          AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS.indexOf(
                            digestOutputRatioDenominator,
                          ),
                        ]}
                        disabled={!digestEnabled}
                        min={0}
                        max={
                          AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS.length -
                          1
                        }
                        step={1}
                        onValueChange={(values) => {
                          const nextIndex = values[0] ?? 0;
                          const next =
                            AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS[
                              nextIndex
                            ] ??
                            AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS[1];
                          updateAiChatOptions({
                            digestOutputRatioDenominator: next,
                          });
                        }}
                      />
                      <div className="text-muted-foreground flex justify-between text-xs">
                        <span>
                          1/
                          {AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS[0]}
                        </span>
                        <span>
                          1/
                          {
                            AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS[
                              AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS.length -
                                1
                            ]
                          }
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="ai-chat-digest-source-chars">
                          {t("settings.ai_chat.digest_source_chars_per_chunk")}
                        </Label>
                        <span className="text-muted-foreground text-xs">
                          {digestSourceCharsPerChunk}
                        </span>
                      </div>
                      <Slider
                        value={[digestSourceCharsPerChunk]}
                        disabled={!digestEnabled}
                        min={AI_CHAT_DIGEST_SOURCE_CHARS_MIN}
                        max={AI_CHAT_DIGEST_SOURCE_CHARS_MAX}
                        step={AI_CHAT_DIGEST_SOURCE_CHARS_STEP}
                        onValueChange={(values) => {
                          const next = values[0];
                          if (!Number.isFinite(next)) return;
                          updateAiChatOptions({
                            digestSourceCharsPerChunk: next,
                          });
                        }}
                      />
                      <div className="text-muted-foreground flex justify-between text-xs">
                        <span>{AI_CHAT_DIGEST_SOURCE_CHARS_MIN}</span>
                        <span>{AI_CHAT_DIGEST_SOURCE_CHARS_MAX}</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-muted-foreground text-xs">
                    {t("settings.ai_chat.digest_sampling_desc")}
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="debug">
              <div className="space-y-6">
                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bug className="text-primary h-4 w-4" />
                      <Label
                        htmlFor="debug-pdf-text-layer"
                        className="mb-0 font-semibold"
                      >
                        {t("settings.debug.pdf_text_layer_debug")}
                      </Label>
                    </div>
                    <Switch
                      id="debug-pdf-text-layer"
                      checked={options.debugOptions.pdfTextLayer}
                      onCheckedChange={(c) =>
                        updateDebugOption("pdfTextLayer", c)
                      }
                    />
                  </div>
                  <p className="text-muted-foreground px-1 text-xs">
                    {t("settings.debug.pdf_text_layer_debug_desc")}
                  </p>
                </div>
                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bug className="text-primary h-4 w-4" />
                      <Label
                        htmlFor="debug-disable-pdf-text-layer"
                        className="mb-0 font-semibold"
                      >
                        {t("settings.debug.disable_pdf_text_layer")}
                      </Label>
                    </div>
                    <Switch
                      id="debug-disable-pdf-text-layer"
                      checked={options.debugOptions.disablePdfTextLayer}
                      onCheckedChange={(c) =>
                        updateDebugOption("disablePdfTextLayer", c)
                      }
                    />
                  </div>
                  <p className="text-muted-foreground px-1 text-xs">
                    {t("settings.debug.disable_pdf_text_layer_desc")}
                  </p>
                </div>
                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bug className="text-primary h-4 w-4" />
                      <div className="flex items-center gap-1.5">
                        <Label
                          htmlFor="debug-pdf-zoom-render-timing"
                          className="mb-0 font-semibold"
                        >
                          {t("settings.debug.pdf_zoom_render_timing")}
                        </Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground inline-flex items-center transition-colors"
                              aria-label={t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_label",
                              )}
                            >
                              <AlertCircle className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            align="start"
                            className="max-w-sm space-y-1 text-left"
                          >
                            <div className="font-medium">
                              {t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_title",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.page_waiting")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_waiting",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.page_current_waiting")} /{" "}
                                {t("debug_overlay.page_current_partial")} /{" "}
                                {t("debug_overlay.page_current_ready")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_current",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.page_first_rendering")} /{" "}
                                {t("debug_overlay.page_first_partial")} /{" "}
                                {t("debug_overlay.page_first_ready")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_initial",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.page_zoom_rendering")} /{" "}
                                {t("debug_overlay.page_zoom_partial")} /{" "}
                                {t("debug_overlay.page_zoom_ready")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_zoom",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.zoom")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_scale",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.canvas")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_canvas",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.text")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_text",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.total")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.pdf_zoom_render_timing_tooltip_total",
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    <Switch
                      id="debug-pdf-zoom-render-timing"
                      checked={options.debugOptions.pdfZoomRenderTiming}
                      onCheckedChange={(c) =>
                        updateDebugOption("pdfZoomRenderTiming", c)
                      }
                    />
                  </div>
                  <p className="text-muted-foreground px-1 text-xs">
                    {t("settings.debug.pdf_zoom_render_timing_desc")}
                  </p>
                </div>
                <div className={SETTINGS_CARD_COMPACT_CLASS}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bug className="text-primary h-4 w-4" />
                      <div className="flex items-center gap-1.5">
                        <Label
                          htmlFor="debug-workspace-zoom-jank"
                          className="mb-0 font-semibold"
                        >
                          {t("settings.debug.workspace_zoom_jank")}
                        </Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground inline-flex items-center transition-colors"
                              aria-label={t(
                                "settings.debug.workspace_zoom_jank_tooltip_label",
                              )}
                            >
                              <AlertCircle className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            align="start"
                            className="max-w-sm space-y-1 text-left"
                          >
                            <div className="font-medium">
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_title",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.workspace_zooming")} /{" "}
                                {t("debug_overlay.workspace_last")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_status",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.scale")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_scale",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.duration")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_duration",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.response")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_response",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.stall")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_stall",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.avg")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_avg",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.worst")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_worst",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.jank")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_jank",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.dropped")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_dropped",
                              )}
                            </div>
                            <div>
                              <span className="font-mono">
                                {t("debug_overlay.steps")}
                              </span>
                              :{" "}
                              {t(
                                "settings.debug.workspace_zoom_jank_tooltip_steps",
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    <Switch
                      id="debug-workspace-zoom-jank"
                      checked={options.debugOptions.workspaceZoomJank}
                      onCheckedChange={(c) =>
                        updateDebugOption("workspaceZoomJank", c)
                      }
                    />
                  </div>
                  <p className="text-muted-foreground px-1 text-xs">
                    {t("settings.debug.workspace_zoom_jank_desc")}
                  </p>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;
