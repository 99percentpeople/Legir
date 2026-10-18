import { useSyncExternalStore } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Trash2,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { ModelCapabilityBadges } from "@/components/ModelCapabilityBadges";
import { ProviderLogo } from "@/components/ProviderLogo";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { TabsContent } from "@/components/ui/tabs";
import { DEV_API_PROXY_URL } from "@/constants";
import type { AiProviderSpec } from "@/services/ai/providers/catalog";
import {
  getAiConnectionProtocolPatch,
  getAiConnectionProtocols,
} from "@/services/ai/providers/connectionProtocols";
import {
  getModelsDevRevision,
  subscribeModelsDev,
} from "@/services/ai/providers/modelsDev";
import {
  getAiConnectionAuthMode,
  getAiConnectionAuthModes,
  getAiConnectionLabel,
} from "@/services/ai/providers/connections";
import { isDesktopApp } from "@/services/platform/runtime";
import type { AppOptions } from "@/types";
import { cn } from "@/utils/cn";
import { AddAiConnection } from "./AddAiConnection";
import { SETTINGS_CARD_GAP_CLASS } from "./styles";
import type {
  LlmModelCache,
  LlmProviderId,
  ProviderSyncStatus,
  UpdateApiProxyOptions,
} from "./types";

interface LlmSettingsTabProps {
  options: AppOptions;
  llmModelCache: LlmModelCache;
  expandedConnections: string[];
  setConnectionOpen: (id: string, open: boolean) => void;
  llmSyncStatus: Record<LlmProviderId, ProviderSyncStatus>;
  updateConnection: (
    id: string,
    patch: Partial<AppOptions["llm"][string]>,
  ) => void;
  addConnection: (spec?: AiProviderSpec) => void;
  removeConnection: (id: string) => void;
  syncLlmProviderModels: (provider: LlmProviderId) => Promise<void>;
  updateApiProxyOptions: UpdateApiProxyOptions;
}

export const LlmSettingsTab = ({
  options,
  llmModelCache,
  expandedConnections,
  setConnectionOpen,
  llmSyncStatus,
  updateConnection,
  addConnection,
  removeConnection,
  syncLlmProviderModels,
  updateApiProxyOptions,
}: LlmSettingsTabProps) => {
  const { t } = useLanguage();
  useSyncExternalStore(subscribeModelsDev, getModelsDevRevision);
  const isDesktopRuntime = isDesktopApp();
  const connections = Object.entries(options.llm);
  const authenticationLabels = {
    "api-key": t("settings.llm.default_authentication"),
    bearer: "Bearer Token",
    none: t("settings.llm.no_authentication"),
  };

  return (
    <TabsContent value="llm">
      <div className="space-y-4">
        <Label className="font-semibold">{t("settings.llm.title")}</Label>
        <AddAiConnection onAdd={addConnection} />
        {!connections.length && (
          <p className="text-muted-foreground text-sm">
            {t("settings.llm.connections_empty")}
          </p>
        )}
        <div className="space-y-2">
          {connections.map(([id, connection]) => {
            const isCustom = !connection.catalogId;
            const label = getAiConnectionLabel(
              options.llm,
              id,
              t("settings.llm.custom_connection"),
            );
            const authMode = getAiConnectionAuthMode(connection);
            const fetchedModels = llmModelCache[id]?.models ?? [];
            const syncStatus = llmSyncStatus[id] || {
              state: "idle",
              message: "",
            };
            const enabled = connection.enabled !== false;
            const protocols = getAiConnectionProtocols(connection);
            const canChangeProtocol = protocols.some(
              (protocol) =>
                protocol.available &&
                protocol.id !== (connection.backendKind || "openai-compatible"),
            );
            const hasUnlistedProtocol = protocols.some(
              (protocol) => !protocol.available,
            );
            return (
              <Collapsible
                key={id}
                open={expandedConnections.includes(id)}
                onOpenChange={(open) => setConnectionOpen(id, open)}
                className="overflow-hidden rounded-lg border"
              >
                <div className="bg-muted/30 flex items-center gap-2 pr-2">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="group hover:bg-accent/50 focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
                    >
                      <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                      <ProviderLogo
                        catalogId={connection.catalogId}
                        size={16}
                      />
                      <span className="truncate text-sm font-medium">
                        {label}
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <Switch
                    checked={enabled}
                    aria-label={`${t("settings.llm.provider_enabled")}: ${label}`}
                    onCheckedChange={(checked) =>
                      updateConnection(id, { enabled: checked })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0"
                    aria-label={`${t("settings.llm.remove_connection")}: ${label}`}
                    onClick={() => removeConnection(id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <CollapsibleContent>
                  <div className="space-y-4 border-t p-3">
                    <div className="space-y-3">
                      {isCustom && (
                        <div className="space-y-1">
                          <Label
                            htmlFor={`connection-name-${id}`}
                            className="text-xs"
                          >
                            {t("settings.llm.connection_name")}
                          </Label>
                          <Input
                            id={`connection-name-${id}`}
                            value={connection.name || ""}
                            onChange={(event) =>
                              updateConnection(id, { name: event.target.value })
                            }
                            className="h-8"
                          />
                        </div>
                      )}
                      {(canChangeProtocol || isCustom) && (
                        <div
                          className={cn(
                            "grid gap-3",
                            isCustom && "sm:grid-cols-2",
                          )}
                        >
                          {canChangeProtocol && (
                            <div className="space-y-1">
                              <Label
                                htmlFor={`connection-protocol-${id}`}
                                className="text-xs"
                              >
                                {t("settings.llm.api_option")}
                              </Label>
                              <Select
                                value={
                                  connection.backendKind || "openai-compatible"
                                }
                                onValueChange={(value) => {
                                  const patch = getAiConnectionProtocolPatch(
                                    connection,
                                    value,
                                  );
                                  if (patch) updateConnection(id, patch);
                                }}
                              >
                                <SelectTrigger
                                  id={`connection-protocol-${id}`}
                                  className="h-8 w-full"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {protocols.map((protocol) => (
                                    <SelectItem
                                      key={protocol.id}
                                      value={protocol.id}
                                      disabled={!protocol.available}
                                    >
                                      {protocol.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {hasUnlistedProtocol && (
                                <p className="text-muted-foreground text-xs">
                                  {t("settings.llm.api_option_unlisted")}
                                  {protocols.some(
                                    (protocol) => protocol.available,
                                  ) &&
                                    ` ${t("settings.llm.api_option_default_endpoint")}`}
                                </p>
                              )}
                            </div>
                          )}
                          {isCustom && (
                            <div className="space-y-1">
                              <Label
                                htmlFor={`connection-auth-${id}`}
                                className="text-xs"
                              >
                                {t("settings.llm.authentication")}
                              </Label>
                              <Select
                                value={authMode}
                                onValueChange={(value) =>
                                  updateConnection(id, {
                                    authMode: value as
                                      | "api-key"
                                      | "bearer"
                                      | "none",
                                  })
                                }
                              >
                                <SelectTrigger
                                  id={`connection-auth-${id}`}
                                  className="h-8 w-full"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {getAiConnectionAuthModes(connection).map(
                                    (mode) => (
                                      <SelectItem key={mode} value={mode}>
                                        {authenticationLabels[mode]}
                                      </SelectItem>
                                    ),
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      )}
                      {!isCustom && authMode !== "api-key" && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className="text-muted-foreground">
                            {t("settings.llm.saved_authentication", {
                              method: authenticationLabels[authMode],
                            })}
                          </span>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            onClick={() =>
                              updateConnection(id, { authMode: "api-key" })
                            }
                          >
                            {t("settings.llm.restore_default_authentication")}
                          </Button>
                        </div>
                      )}
                      <Input
                        value={connection.apiKey || ""}
                        onChange={(event) =>
                          updateConnection(id, { apiKey: event.target.value })
                        }
                        placeholder={t("settings.llm.api_key_placeholder")}
                        aria-label={`${t("settings.llm.api_key_placeholder")}: ${label}`}
                        disabled={authMode === "none"}
                        className="h-8"
                        type="password"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={connection.apiUrl || ""}
                          onChange={(event) =>
                            updateConnection(id, { apiUrl: event.target.value })
                          }
                          placeholder={t("settings.llm.api_url_placeholder")}
                          aria-label={`${t("settings.llm.api_url_placeholder")}: ${label}`}
                          className="h-8 min-w-0 flex-1"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => void syncLlmProviderModels(id)}
                          disabled={!enabled || syncStatus.state === "syncing"}
                        >
                          {syncStatus.state === "syncing" && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          {t("settings.llm.fetch_models")}
                        </Button>
                      </div>
                      {syncStatus.state === "ok" && (
                        <div
                          role="status"
                          className="text-muted-foreground flex items-center gap-2 text-xs"
                        >
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          {syncStatus.message}
                        </div>
                      )}
                      {syncStatus.state === "error" && (
                        <div
                          role="alert"
                          className="text-destructive flex items-center gap-2 text-xs"
                        >
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          {syncStatus.message}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 border-t pt-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <Label className="text-xs">
                          {t("settings.llm.fetched_models")}
                        </Label>
                        <span className="text-muted-foreground">
                          {t("settings.llm.models_loaded_count", {
                            count: fetchedModels.length,
                          })}
                        </span>
                      </div>
                      {fetchedModels.length ? (
                        <div className="max-h-36 space-y-1.5 overflow-auto">
                          {fetchedModels.map((model) => (
                            <div
                              key={model.id}
                              className="bg-muted flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1 text-[11px]"
                              title={model.id}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {model.id}
                              </span>
                              <ModelCapabilityBadges
                                capabilities={model.capabilities}
                                className="shrink-0 flex-nowrap"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-xs">
                          {t("settings.llm.fetched_models_empty")}
                        </p>
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>

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
