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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
import { useLanguage, Language, LANGUAGES } from "../language-provider";
import { useTheme } from "../theme-provider";
import { Separator } from "../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useEditorStore } from "@/store/useEditorStore";
import { checkLlmProviderConfig, loadModels } from "@/services/LLMService";
import { type Tag, TagInput } from "emblor";

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

  type LlmProviderId = "gemini" | "openai";

  const [llmProviderTab, setLlmProviderTab] = useState<LlmProviderId>("openai");

  const [llmCheckStatus, setLlmCheckStatus] = useState<
    Record<
      LlmProviderId,
      { state: "idle" | "checking" | "ok" | "error"; message: string }
    >
  >({
    gemini: { state: "idle", message: "" },
    openai: { state: "idle", message: "" },
  });

  const [llmFetchStatus, setLlmFetchStatus] = useState<
    Record<
      LlmProviderId,
      { state: "idle" | "fetching" | "ok" | "error"; message: string }
    >
  >({
    gemini: { state: "idle", message: "" },
    openai: { state: "idle", message: "" },
  });

  const modelUpdateTimersRef = useRef<Partial<Record<LlmProviderId, number>>>(
    {},
  );

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

  const [activeGeminiTranslateTagIndex, setActiveGeminiTranslateTagIndex] =
    useState<number | null>(null);
  const [activeGeminiVisionTagIndex, setActiveGeminiVisionTagIndex] = useState<
    number | null
  >(null);
  const [activeOpenAiTranslateTagIndex, setActiveOpenAiTranslateTagIndex] =
    useState<number | null>(null);
  const [activeOpenAiVisionTagIndex, setActiveOpenAiVisionTagIndex] = useState<
    number | null
  >(null);

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

  const updateOpenAiApiUrl = (value: string) => {
    updateLlmProviderOptions("openai", { apiUrl: value });
  };

  const mergeModelIdLists = (a: string[], b: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of [...a, ...b]) {
      const id = (raw || "").trim();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };

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

      const cache = useEditorStore.getState().llmModelCache;
      const translateModels =
        provider === "openai"
          ? cache.openaiTranslateModels
          : cache.geminiTranslateModels;
      const visionModels =
        provider === "openai"
          ? cache.openaiVisionModels
          : cache.geminiVisionModels;

      const prevTranslate = options.llm[provider].customTranslateModels || [];
      const prevVision = options.llm[provider].customVisionModels || [];

      updateLlmProviderOptions(provider, {
        customTranslateModels: mergeModelIdLists(
          prevTranslate,
          translateModels.map((m) => m.id),
        ),
        customVisionModels: mergeModelIdLists(
          prevVision,
          visionModels.map((m) => m.id),
        ),
      });
      scheduleModelRegistryUpdate(provider);

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
                      <SelectItem value="openai">
                        {t("settings.llm.openai")}
                      </SelectItem>
                      <SelectItem value="gemini">
                        {t("settings.llm.gemini")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Tabs value={llmProviderTab}>
                  <TabsContent value="gemini" className="space-y-4">
                    <div className="bg-muted/30 border-border flex flex-col gap-2 rounded-lg border p-3">
                      <Input
                        value={options.llm.gemini.apiKey || ""}
                        onChange={(e) =>
                          updateLlmApiKey("gemini", e.target.value)
                        }
                        placeholder={t("settings.llm.api_key_placeholder")}
                        className="h-8"
                        type="password"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => void checkLlmProvider("gemini")}
                          disabled={llmCheckStatus.gemini.state === "checking"}
                        >
                          {llmCheckStatus.gemini.state === "checking" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {t("settings.llm.check")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => void fetchLlmProviderModels("gemini")}
                          disabled={llmFetchStatus.gemini.state === "fetching"}
                        >
                          {llmFetchStatus.gemini.state === "fetching" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {t("settings.llm.fetch_models")}
                        </Button>
                      </div>

                      {llmCheckStatus.gemini.state === "ok" ? (
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span className="text-muted-foreground">
                            {llmCheckStatus.gemini.message}
                          </span>
                        </div>
                      ) : null}
                      {llmCheckStatus.gemini.state === "error" ? (
                        <div className="flex items-center gap-2 text-xs">
                          <AlertCircle className="text-destructive h-4 w-4" />
                          <span className="text-destructive">
                            {llmCheckStatus.gemini.message}
                          </span>
                        </div>
                      ) : null}

                      {llmFetchStatus.gemini.state === "ok" ? (
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span className="text-muted-foreground">
                            {llmFetchStatus.gemini.message}
                          </span>
                        </div>
                      ) : null}
                      {llmFetchStatus.gemini.state === "error" ? (
                        <div className="flex items-center gap-2 text-xs">
                          <AlertCircle className="text-destructive h-4 w-4" />
                          <span className="text-destructive">
                            {llmFetchStatus.gemini.message}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="bg-muted/30 border-border flex flex-col gap-3 rounded-lg border p-3">
                      <Label className="text-xs">
                        {t("settings.llm.custom_models_translate")}
                      </Label>
                      <TagInput
                        id="llm-gemini-translate-models"
                        placeholder={t(
                          "settings.llm.custom_models_placeholder",
                        )}
                        tags={toTags(
                          options.llm.gemini.customTranslateModels || [],
                        )}
                        setTags={(newTags) => {
                          const prevTags = toTags(
                            options.llm.gemini.customTranslateModels || [],
                          );
                          const updated =
                            typeof newTags === "function"
                              ? newTags(prevTags)
                              : newTags;
                          updateLlmProviderOptions("gemini", {
                            customTranslateModels: normalizeModelIds(updated),
                          });
                          scheduleModelRegistryUpdate("gemini");
                        }}
                        activeTagIndex={activeGeminiTranslateTagIndex}
                        setActiveTagIndex={setActiveGeminiTranslateTagIndex}
                        styleClasses={tagStyles}
                      />

                      <Label className="text-xs">
                        {t("settings.llm.custom_models_vision")}
                      </Label>
                      <TagInput
                        id="llm-gemini-vision-models"
                        placeholder={t(
                          "settings.llm.custom_models_placeholder",
                        )}
                        tags={toTags(
                          options.llm.gemini.customVisionModels || [],
                        )}
                        setTags={(newTags) => {
                          const prevTags = toTags(
                            options.llm.gemini.customVisionModels || [],
                          );
                          const updated =
                            typeof newTags === "function"
                              ? newTags(prevTags)
                              : newTags;
                          updateLlmProviderOptions("gemini", {
                            customVisionModels: normalizeModelIds(updated),
                          });
                          scheduleModelRegistryUpdate("gemini");
                        }}
                        activeTagIndex={activeGeminiVisionTagIndex}
                        setActiveTagIndex={setActiveGeminiVisionTagIndex}
                        styleClasses={tagStyles}
                      />

                      <p className="text-muted-foreground text-xs">
                        {t("settings.llm.models_loaded_count", {
                          count: llmModelCache.geminiTranslateModels.length,
                        })}
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="openai" className="space-y-4">
                    <div className="bg-muted/30 border-border flex flex-col gap-2 rounded-lg border p-3">
                      <Input
                        value={options.llm.openai.apiKey || ""}
                        onChange={(e) =>
                          updateLlmApiKey("openai", e.target.value)
                        }
                        placeholder={t("settings.llm.api_key_placeholder")}
                        className="h-8"
                        type="password"
                      />
                      <div className="flex items-center gap-2">
                        <Input
                          value={options.llm.openai.apiUrl || ""}
                          onChange={(e) => updateOpenAiApiUrl(e.target.value)}
                          placeholder={t("settings.llm.api_url_placeholder")}
                          className="h-8"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => void checkLlmProvider("openai")}
                          disabled={llmCheckStatus.openai.state === "checking"}
                        >
                          {llmCheckStatus.openai.state === "checking" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {t("settings.llm.check")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => void fetchLlmProviderModels("openai")}
                          disabled={llmFetchStatus.openai.state === "fetching"}
                        >
                          {llmFetchStatus.openai.state === "fetching" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {t("settings.llm.fetch_models")}
                        </Button>
                      </div>

                      {llmCheckStatus.openai.state === "ok" ? (
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span className="text-muted-foreground">
                            {llmCheckStatus.openai.message}
                          </span>
                        </div>
                      ) : null}
                      {llmCheckStatus.openai.state === "error" ? (
                        <div className="flex items-center gap-2 text-xs">
                          <AlertCircle className="text-destructive h-4 w-4" />
                          <span className="text-destructive">
                            {llmCheckStatus.openai.message}
                          </span>
                        </div>
                      ) : null}

                      {llmFetchStatus.openai.state === "ok" ? (
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span className="text-muted-foreground">
                            {llmFetchStatus.openai.message}
                          </span>
                        </div>
                      ) : null}
                      {llmFetchStatus.openai.state === "error" ? (
                        <div className="flex items-center gap-2 text-xs">
                          <AlertCircle className="text-destructive h-4 w-4" />
                          <span className="text-destructive">
                            {llmFetchStatus.openai.message}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="bg-muted/30 border-border flex flex-col gap-3 rounded-lg border p-3">
                      <Label className="text-xs">
                        {t("settings.llm.custom_models_translate")}
                      </Label>
                      <TagInput
                        id="llm-openai-translate-models"
                        placeholder={t(
                          "settings.llm.custom_models_placeholder",
                        )}
                        tags={toTags(
                          options.llm.openai.customTranslateModels || [],
                        )}
                        setTags={(newTags) => {
                          const prevTags = toTags(
                            options.llm.openai.customTranslateModels || [],
                          );
                          const updated =
                            typeof newTags === "function"
                              ? newTags(prevTags)
                              : newTags;
                          updateLlmProviderOptions("openai", {
                            customTranslateModels: normalizeModelIds(updated),
                          });
                          scheduleModelRegistryUpdate("openai");
                        }}
                        activeTagIndex={activeOpenAiTranslateTagIndex}
                        setActiveTagIndex={setActiveOpenAiTranslateTagIndex}
                        styleClasses={tagStyles}
                      />

                      <Label className="text-xs">
                        {t("settings.llm.custom_models_vision")}
                      </Label>
                      <TagInput
                        id="llm-openai-vision-models"
                        placeholder={t(
                          "settings.llm.custom_models_placeholder",
                        )}
                        tags={toTags(
                          options.llm.openai.customVisionModels || [],
                        )}
                        setTags={(newTags) => {
                          const prevTags = toTags(
                            options.llm.openai.customVisionModels || [],
                          );
                          const updated =
                            typeof newTags === "function"
                              ? newTags(prevTags)
                              : newTags;
                          updateLlmProviderOptions("openai", {
                            customVisionModels: normalizeModelIds(updated),
                          });
                          scheduleModelRegistryUpdate("openai");
                        }}
                        activeTagIndex={activeOpenAiVisionTagIndex}
                        setActiveTagIndex={setActiveOpenAiVisionTagIndex}
                        styleClasses={tagStyles}
                      />

                      <p className="text-muted-foreground text-xs">
                        {t("settings.llm.models_loaded_count", {
                          count: llmModelCache.openaiTranslateModels.length,
                        })}
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
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

        <DialogFooter>
          <Button onClick={onClose}>{t("settings.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;
