import type { Dispatch, SetStateAction } from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { ModelCapabilityBadges } from "@/components/ModelCapabilityBadges";
import { ProviderLogo } from "@/components/ProviderLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEV_API_PROXY_URL } from "@/constants";
import {
  AI_PROVIDER_SPECS_SORTED_BY_LABEL,
  getAiProviderSelectedApiOption,
} from "@/services/ai/providers/catalog";
import { createCustomModelCapabilities } from "@/services/ai/providers/modelCapabilities";
import type { AppOptions, LLMCustomModelCapability } from "@/types";

import { SETTINGS_CARD_GAP_CLASS } from "./styles";
import type {
  CustomModelCapabilityOption,
  LlmModelCache,
  LlmProviderId,
  ProviderSyncStatus,
  UpdateApiProxyOptions,
} from "./types";

interface LlmSettingsTabProps {
  options: AppOptions;
  llmModelCache: LlmModelCache;
  llmProviderTab: LlmProviderId;
  onLlmProviderTabChange: (provider: LlmProviderId) => void;
  llmSyncStatus: Record<LlmProviderId, ProviderSyncStatus>;
  customModelNameByProvider: Partial<Record<LlmProviderId, string>>;
  setCustomModelNameByProvider: Dispatch<
    SetStateAction<Partial<Record<LlmProviderId, string>>>
  >;
  customModelCapabilityOptions: CustomModelCapabilityOption[];
  setCustomModelCapabilityByProvider: Dispatch<
    SetStateAction<Partial<Record<LlmProviderId, LLMCustomModelCapability[]>>>
  >;
  isDesktopRuntime: boolean;
  isLlmProviderEnabled: (provider: LlmProviderId) => boolean;
  setLlmProviderEnabled: (provider: LlmProviderId, enabled: boolean) => void;
  updateLlmApiKey: (provider: LlmProviderId, value: string) => void;
  updateLlmApiUrl: (provider: LlmProviderId, value: string) => void;
  updateLlmApiOption: (provider: LlmProviderId, apiOptionId: string) => void;
  syncLlmProviderModels: (provider: LlmProviderId) => Promise<void>;
  getCustomModelDraftCapabilities: (
    provider: LlmProviderId,
  ) => LLMCustomModelCapability[];
  addCustomModel: (provider: LlmProviderId) => void;
  removeCustomModel: (provider: LlmProviderId, id: string) => void;
  updateApiProxyOptions: UpdateApiProxyOptions;
}

export const LlmSettingsTab = ({
  options,
  llmModelCache,
  llmProviderTab,
  onLlmProviderTabChange,
  llmSyncStatus,
  customModelNameByProvider,
  setCustomModelNameByProvider,
  customModelCapabilityOptions,
  setCustomModelCapabilityByProvider,
  isDesktopRuntime,
  isLlmProviderEnabled,
  setLlmProviderEnabled,
  updateLlmApiKey,
  updateLlmApiUrl,
  updateLlmApiOption,
  syncLlmProviderModels,
  getCustomModelDraftCapabilities,
  addCustomModel,
  removeCustomModel,
  updateApiProxyOptions,
}: LlmSettingsTabProps) => {
  const { t } = useLanguage();
  const selectedLlmProviderSpec =
    AI_PROVIDER_SPECS_SORTED_BY_LABEL.find(
      (spec) => spec.id === llmProviderTab,
    ) ?? AI_PROVIDER_SPECS_SORTED_BY_LABEL[0];
  const selectedLlmProviderEnabled = isLlmProviderEnabled(llmProviderTab);

  return (
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
              onValueChange={(value) =>
                onLlmProviderTabChange(value as LlmProviderId)
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
                    itemText={spec.labelKey ? t(spec.labelKey) : spec.label}
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
            const providerModelCache = llmModelCache[spec.id];
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
              <TabsContent key={spec.id} value={spec.id} className="space-y-4">
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
                    onChange={(event) =>
                      updateLlmApiKey(spec.id, event.target.value)
                    }
                    placeholder={t("settings.llm.api_key_placeholder")}
                    className="h-8"
                    type="password"
                  />
                  <div className="flex items-center gap-2">
                    {showApiUrl ? (
                      <Input
                        value={providerOptions.apiUrl || ""}
                        onChange={(event) =>
                          updateLlmApiUrl(spec.id, event.target.value)
                        }
                        placeholder={selectedApiUrlPlaceholder}
                        className="h-8"
                      />
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => void syncLlmProviderModels(spec.id)}
                      disabled={
                        !providerEnabled || syncStatus.state === "syncing"
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
                        count: providerModelCache.translateModels.length,
                      })}
                    </span>
                  </div>
                  {providerModelCache.translateModels.length > 0 ? (
                    <div className="bg-background/80 max-h-36 overflow-auto rounded-md border p-2">
                      <div className="flex flex-col gap-1.5">
                        {providerModelCache.translateModels.map((model) => (
                          <span
                            key={`${spec.id}:fetched:${model.id}`}
                            className="bg-muted inline-flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1 text-[11px]"
                            title={model.id}
                          >
                            <span className="min-w-0 flex-1">{model.id}</span>
                            <ModelCapabilityBadges
                              capabilities={model.capabilities}
                              className="shrink-0 flex-nowrap"
                            />
                          </span>
                        ))}
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
                        !(customModelNameByProvider[spec.id] || "").trim()
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
                        const nextValues = new Set<LLMCustomModelCapability>([
                          "text",
                        ]);
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
                          [spec.id]: ["text", "image", "tools"].filter((item) =>
                            nextValues.has(item as LLMCustomModelCapability),
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
                        {(providerOptions.customModels || []).map((model) => (
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
                        ))}
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
            <Label className="text-xs">{t("settings.llm.proxy_title")}</Label>
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
            <Label className="text-xs">{t("settings.llm.proxy_url")}</Label>
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
  );
};
