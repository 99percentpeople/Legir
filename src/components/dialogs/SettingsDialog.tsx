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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
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
  SnappingOptions,
  ThumbnailsLayoutMode,
} from "@/types";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_SPECS,
  type AiProviderId,
} from "@/services/ai/sdk/providerCatalog";
import { useLanguage, Language, LANGUAGES } from "../language-provider";
import { useTheme } from "../theme-provider";
import { Separator } from "../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useEditorStore } from "@/store/useEditorStore";
import {
  checkLlmProviderConfig,
  getChatModelGroups,
  loadModels,
} from "@/services/ai";
import { type Tag, TagInput } from "emblor";
import { ModelSelect, type ModelSelectGroup } from "@/components/ModelSelect";
import {
  AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS,
  AI_CHAT_DIGEST_SOURCE_CHARS_MAX,
  AI_CHAT_DIGEST_SOURCE_CHARS_MIN,
  AI_CHAT_DIGEST_SOURCE_CHARS_STEP,
} from "@/constants";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  options: AppOptions;
  onChange: (options: AppOptions) => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  options,
  onChange,
}) => {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();

  const llmModelCache = useEditorStore((s) => s.llmModelCache);
  type LlmProviderId = AiProviderId;
  type ProviderStatus = {
    state: "idle" | "checking" | "ok" | "error";
    message: string;
  };
  type ProviderFetchStatus = {
    state: "idle" | "fetching" | "ok" | "error";
    message: string;
  };

  const buildProviderStatusRecord = <
    T extends ProviderStatus | ProviderFetchStatus,
  >(
    initial: T,
  ) =>
    Object.fromEntries(
      AI_PROVIDER_IDS.map((providerId) => [providerId, { ...initial }]),
    ) as Record<LlmProviderId, T>;

  const [llmProviderTab, setLlmProviderTab] = useState<LlmProviderId>(
    AI_PROVIDER_IDS[0],
  );

  const [llmCheckStatus, setLlmCheckStatus] = useState<
    Record<LlmProviderId, ProviderStatus>
  >(buildProviderStatusRecord({ state: "idle", message: "" }));

  const [llmFetchStatus, setLlmFetchStatus] = useState<
    Record<LlmProviderId, ProviderFetchStatus>
  >(buildProviderStatusRecord({ state: "idle", message: "" }));

  const modelUpdateTimersRef = useRef<Partial<Record<LlmProviderId, number>>>(
    {},
  );
  const [
    activeTranslateTagIndexByProvider,
    setActiveTranslateTagIndexByProvider,
  ] = useState<Partial<Record<LlmProviderId, number | null>>>({});
  const [activeVisionTagIndexByProvider, setActiveVisionTagIndexByProvider] =
    useState<Partial<Record<LlmProviderId, number | null>>>({});

  const tagStyles = useMemo(
    () => ({
      inlineTagsContainer:
        "border-input rounded-md bg-transparent dark:bg-input/30 shadow-xs transition-[color,box-shadow] focus-within:border-ring outline-none focus-within:ring-[3px] focus-within:ring-ring/50 p-1 gap-1",
      input:
        "w-full min-w-[80px] shadow-none px-2 h-7 focus-visible:outline-none",
      tag: {
        body: "h-7 relative bg-background border border-input hover:bg-background rounded-md font-medium text-xs ps-2 pe-7 flex items-center",
        closeButton:
          "absolute -inset-y-px -end-px p-0 rounded-e-md flex size-7 transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] text-muted-foreground/80 hover:text-foreground justify-center items-center",
      },
    }),
    [],
  );

  const normalizeModelIds = (tags: Tag[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of tags) {
      const text = (t.text || "").trim();
      if (!text) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
    return out;
  };

  const toTags = (ids: string[]): Tag[] => {
    return ids.map((id) => ({ id, text: id }));
  };

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

  const updateAiChatOptions = (patch: Partial<AppOptions["aiChat"]>) => {
    onChange({
      ...options,
      aiChat: {
        ...options.aiChat,
        ...patch,
      },
    });
  };

  const aiToolModelGroups = useMemo<ModelSelectGroup[]>(() => {
    return getChatModelGroups().map((group) => ({
      id: group.providerId,
      label: group.label,
      options: group.models.map((model) => ({
        value: `${group.providerId}:${model.id}`,
        label: model.label,
        disabled: !group.isAvailable,
      })),
    }));
  }, [llmModelCache, options.llm]);

  const digestOutputRatioDenominator =
    options.aiChat.digestOutputRatioDenominator;
  const digestSourceCharsPerChunk = options.aiChat.digestSourceCharsPerChunk;

  const checkLlmProvider = async (provider: LlmProviderId) => {
    const apiKey = (options.llm[provider].apiKey || "").trim();
    if (!apiKey) {
      setLlmCheckStatus((prev) => ({
        ...prev,
        [provider]: {
          state: "error",
          message: t("settings.llm.api_key_required"),
        },
      }));
      return;
    }

    setLlmCheckStatus((prev) => ({
      ...prev,
      [provider]: { state: "checking", message: "" },
    }));

    try {
      await checkLlmProviderConfig(provider);
      setLlmCheckStatus((prev) => ({
        ...prev,
        [provider]: { state: "ok", message: t("settings.llm.check_success") },
      }));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("settings.llm.check_failed");
      setLlmCheckStatus((prev) => ({
        ...prev,
        [provider]: { state: "error", message: msg },
      }));
    }
  };

  const fetchLlmProviderModels = async (provider: LlmProviderId) => {
    const apiKey = (options.llm[provider].apiKey || "").trim();
    if (!apiKey) {
      setLlmFetchStatus((prev) => ({
        ...prev,
        [provider]: {
          state: "error",
          message: t("settings.llm.api_key_required"),
        },
      }));
      return;
    }

    setLlmFetchStatus((prev) => ({
      ...prev,
      [provider]: { state: "fetching", message: "" },
    }));

    try {
      await loadModels({
        providerIds: [provider],
        force: true,
        throwOnError: true,
      });

      setLlmFetchStatus((prev) => ({
        ...prev,
        [provider]: { state: "ok", message: t("settings.llm.fetch_success") },
      }));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("settings.llm.fetch_failed");
      setLlmFetchStatus((prev) => ({
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
      <DialogContent className="flex max-h-full min-h-3/4 flex-col sm:h-3/4 sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {t("settings.title")}
          </DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>

        <Tabs
          orientation="vertical"
          defaultValue="general"
          className="flex min-h-0 flex-1 flex-row overflow-hidden"
        >
          <TabsList className="text-foreground h-min flex-col gap-1 rounded-none bg-transparent py-1">
            <TabsTrigger
              value="general"
              className="hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:after:bg-primary relative w-full justify-start text-base after:absolute after:inset-y-0 after:start-0 after:-ms-1 after:w-0.5 data-[state=active]:rounded-l-none data-[state=active]:border-none data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Globe className="h-4 w-4" />
              {t("settings.tabs.general")}
            </TabsTrigger>
            <TabsTrigger
              value="export"
              className="hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:after:bg-primary relative w-full justify-start text-base after:absolute after:inset-y-0 after:start-0 after:-ms-1 after:w-0.5 data-[state=active]:rounded-l-none data-[state=active]:border-none data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <FileText className="h-4 w-4" />
              {t("settings.tabs.export")}
            </TabsTrigger>
            <TabsTrigger
              value="snapping"
              className="hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:after:bg-primary relative w-full justify-start text-base after:absolute after:inset-y-0 after:start-0 after:-ms-1 after:w-0.5 data-[state=active]:rounded-l-none data-[state=active]:border-none data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Magnet className="h-4 w-4" />
              {t("settings.tabs.snapping")}
            </TabsTrigger>
            <TabsTrigger
              value="llm"
              className="hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:after:bg-primary relative w-full justify-start text-base after:absolute after:inset-y-0 after:start-0 after:-ms-1 after:w-0.5 data-[state=active]:rounded-l-none data-[state=active]:border-none data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <BrainCircuit className="h-4 w-4" />
              {t("settings.tabs.llm")}
            </TabsTrigger>
            <TabsTrigger
              value="ai_chat"
              className="hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:after:bg-primary relative w-full justify-start text-base after:absolute after:inset-y-0 after:start-0 after:-ms-1 after:w-0.5 data-[state=active]:rounded-l-none data-[state=active]:border-none data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <MessageSquare className="h-4 w-4" />
              {t("settings.tabs.ai_chat")}
            </TabsTrigger>
            <TabsTrigger
              value="debug"
              className="hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:after:bg-primary relative w-full justify-start text-base after:absolute after:inset-y-0 after:start-0 after:-ms-1 after:w-0.5 data-[state=active]:rounded-l-none data-[state=active]:border-none data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Bug className="h-4 w-4" />
              {t("settings.tabs.debug")}
            </TabsTrigger>
          </TabsList>
          <div className="min-h-0 grow overflow-y-auto rounded-md border p-4 py-4 text-start">
            <TabsContent value="general">
              <div className="space-y-6">
                <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
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

                <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
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

                <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
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

                <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <User className="text-primary h-4 w-4" />
                      <Label
                        htmlFor="ff-user-name"
                        className="mb-0 font-semibold"
                      >
                        {t("settings.user_name")}
                      </Label>
                    </div>
                    <Input
                      id="ff-user-name"
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
                <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
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
                <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
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
                  <Select
                    value={llmProviderTab}
                    onValueChange={(v) => setLlmProviderTab(v as LlmProviderId)}
                  >
                    <SelectTrigger className="h-8 w-[160px]">
                      <SelectValue placeholder={t("common.select")} />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_PROVIDER_SPECS.map((spec) => (
                        <SelectItem key={spec.id} value={spec.id}>
                          {spec.labelKey ? t(spec.labelKey) : spec.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Tabs value={llmProviderTab}>
                  {AI_PROVIDER_SPECS.map((spec) => {
                    const providerOptions = options.llm[spec.id];
                    const checkStatus = llmCheckStatus[spec.id];
                    const fetchStatus = llmFetchStatus[spec.id];
                    const showApiUrl = spec.allowCustomBaseUrl;
                    return (
                      <TabsContent
                        key={spec.id}
                        value={spec.id}
                        className="space-y-4"
                      >
                        <div className="bg-muted/30 border-border flex flex-col gap-2 rounded-lg border p-3">
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
                                placeholder={
                                  spec.defaultBaseUrl ||
                                  t("settings.llm.api_url_placeholder")
                                }
                                className="h-8"
                              />
                            ) : null}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => void checkLlmProvider(spec.id)}
                              disabled={checkStatus.state === "checking"}
                            >
                              {checkStatus.state === "checking" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                              {t("settings.llm.check")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() =>
                                void fetchLlmProviderModels(spec.id)
                              }
                              disabled={fetchStatus.state === "fetching"}
                            >
                              {fetchStatus.state === "fetching" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                              {t("settings.llm.fetch_models")}
                            </Button>
                          </div>

                          {checkStatus.state === "ok" ? (
                            <div className="flex items-center gap-2 text-xs">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              <span className="text-muted-foreground">
                                {checkStatus.message}
                              </span>
                            </div>
                          ) : null}
                          {checkStatus.state === "error" ? (
                            <div className="flex items-center gap-2 text-xs">
                              <AlertCircle className="text-destructive h-4 w-4" />
                              <span className="text-destructive">
                                {checkStatus.message}
                              </span>
                            </div>
                          ) : null}

                          {fetchStatus.state === "ok" ? (
                            <div className="flex items-center gap-2 text-xs">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              <span className="text-muted-foreground">
                                {fetchStatus.message}
                              </span>
                            </div>
                          ) : null}
                          {fetchStatus.state === "error" ? (
                            <div className="flex items-center gap-2 text-xs">
                              <AlertCircle className="text-destructive h-4 w-4" />
                              <span className="text-destructive">
                                {fetchStatus.message}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className="bg-muted/30 border-border flex flex-col gap-3 rounded-lg border p-3">
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
                              <div className="flex flex-wrap gap-1.5">
                                {llmModelCache[spec.id].translateModels.map(
                                  (model) => (
                                    <span
                                      key={`${spec.id}:fetched:${model.id}`}
                                      className="bg-muted text-muted-foreground inline-flex max-w-full min-w-0 items-center rounded-md px-2 py-1 text-[11px]"
                                      title={model.id}
                                    >
                                      <span className="truncate">
                                        {model.id}
                                      </span>
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

                        <div className="bg-muted/30 border-border flex flex-col gap-3 rounded-lg border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <Label className="text-xs">
                              {t("settings.llm.custom_models_translate")}
                            </Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground h-6 px-2 text-xs"
                              disabled={
                                (providerOptions.customTranslateModels || [])
                                  .length === 0
                              }
                              onClick={() => {
                                updateLlmProviderOptions(spec.id, {
                                  customTranslateModels: [],
                                });
                                scheduleModelRegistryUpdate(spec.id);
                              }}
                            >
                              {t("settings.llm.clear_custom_models")}
                            </Button>
                          </div>
                          <TagInput
                            id={`llm-${spec.id}-translate-models`}
                            placeholder={t(
                              "settings.llm.custom_models_placeholder",
                            )}
                            tags={toTags(
                              providerOptions.customTranslateModels || [],
                            )}
                            setTags={(newTags) => {
                              const prevTags = toTags(
                                providerOptions.customTranslateModels || [],
                              );
                              const updated =
                                typeof newTags === "function"
                                  ? newTags(prevTags)
                                  : newTags;
                              updateLlmProviderOptions(spec.id, {
                                customTranslateModels:
                                  normalizeModelIds(updated),
                              });
                              scheduleModelRegistryUpdate(spec.id);
                            }}
                            activeTagIndex={
                              activeTranslateTagIndexByProvider[spec.id] ?? null
                            }
                            setActiveTagIndex={(index) =>
                              setActiveTranslateTagIndexByProvider((prev) => ({
                                ...prev,
                                [spec.id]: index,
                              }))
                            }
                            styleClasses={tagStyles}
                          />

                          <div className="flex items-center justify-between gap-2">
                            <Label className="text-xs">
                              {t("settings.llm.custom_models_vision")}
                            </Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground h-6 px-2 text-xs"
                              disabled={
                                (providerOptions.customVisionModels || [])
                                  .length === 0
                              }
                              onClick={() => {
                                updateLlmProviderOptions(spec.id, {
                                  customVisionModels: [],
                                });
                                scheduleModelRegistryUpdate(spec.id);
                              }}
                            >
                              {t("settings.llm.clear_custom_models")}
                            </Button>
                          </div>
                          <TagInput
                            id={`llm-${spec.id}-vision-models`}
                            placeholder={t(
                              "settings.llm.custom_models_placeholder",
                            )}
                            tags={toTags(
                              providerOptions.customVisionModels || [],
                            )}
                            setTags={(newTags) => {
                              const prevTags = toTags(
                                providerOptions.customVisionModels || [],
                              );
                              const updated =
                                typeof newTags === "function"
                                  ? newTags(prevTags)
                                  : newTags;
                              updateLlmProviderOptions(spec.id, {
                                customVisionModels: normalizeModelIds(updated),
                              });
                              scheduleModelRegistryUpdate(spec.id);
                            }}
                            activeTagIndex={
                              activeVisionTagIndexByProvider[spec.id] ?? null
                            }
                            setActiveTagIndex={(index) =>
                              setActiveVisionTagIndexByProvider((prev) => ({
                                ...prev,
                                [spec.id]: index,
                              }))
                            }
                            styleClasses={tagStyles}
                          />
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </div>
            </TabsContent>

            <TabsContent value="ai_chat">
              <div className="space-y-6">
                <div className="bg-muted/30 border-border flex flex-col space-y-4 rounded-lg border p-3">
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
                      disabled={aiToolModelGroups.length === 0}
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
                <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
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
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;
