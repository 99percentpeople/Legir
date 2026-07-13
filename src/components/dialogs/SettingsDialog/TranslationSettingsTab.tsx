import { useState } from "react";
import {
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  Languages,
  Loader2,
} from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { translateService } from "@/services/translateService";
import type { TranslationOptions } from "@/types";

import { SETTINGS_CARD_COMPACT_CLASS } from "./styles";

interface TranslationSettingsTabProps {
  options: TranslationOptions;
  onChange: (options: TranslationOptions) => void;
}

type TestStatus =
  | { state: "idle" | "testing"; message: "" }
  | { state: "success" | "error"; message: string };

export const TranslationSettingsTab = ({
  options,
  onChange,
}: TranslationSettingsTabProps) => {
  const { t } = useLanguage();
  const [testStatus, setTestStatus] = useState<TestStatus>({
    state: "idle",
    message: "",
  });
  const canTest = translateService.isOptionAvailable("cloud:cloudv2");

  const testConnection = async () => {
    setTestStatus({ state: "testing", message: "" });
    try {
      await translateService.checkCloudTranslationConfig();
      setTestStatus({
        state: "success",
        message: t("settings.translation.test_success"),
      });
    } catch (error) {
      setTestStatus({
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : t("settings.translation.test_failed"),
      });
    }
  };

  return (
    <TabsContent value="translation">
      <div className="space-y-6">
        <div className={SETTINGS_CARD_COMPACT_CLASS}>
          <div className="flex items-center gap-2">
            <Languages className="text-primary h-4 w-4" />
            <Label
              htmlFor="google-cloud-translation-api-key"
              className="mb-0 font-semibold"
            >
              {t("settings.translation.google_cloud")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="google-cloud-translation-api-key"
              value={options.googleCloud.apiKey}
              onChange={(event) => {
                setTestStatus({ state: "idle", message: "" });
                onChange({
                  ...options,
                  googleCloud: {
                    ...options.googleCloud,
                    apiKey: event.target.value,
                  },
                });
              }}
              placeholder={t("settings.translation.api_key_placeholder")}
              className="h-8 min-w-0"
              type="password"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-24 shrink-0"
              disabled={!canTest || testStatus.state === "testing"}
              onClick={() => void testConnection()}
            >
              {testStatus.state === "testing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {testStatus.state === "testing"
                ? t("settings.translation.testing")
                : t("settings.translation.test_connection")}
            </Button>
          </div>
          {testStatus.state === "success" ? (
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-muted-foreground">
                {testStatus.message}
              </span>
            </div>
          ) : null}
          {testStatus.state === "error" ? (
            <div className="flex items-start gap-2 text-xs">
              <AlertCircle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
              <span className="text-destructive min-w-0 break-words">
                {testStatus.message}
              </span>
            </div>
          ) : null}
          <p className="text-muted-foreground px-1 text-xs">
            {t("settings.translation.google_cloud_desc")}
          </p>
        </div>

        <div className={SETTINGS_CARD_COMPACT_CLASS}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-start gap-2">
              <BrainCircuit className="text-primary mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1">
                <Label
                  htmlFor="ai-translation-enabled"
                  className="mb-0 font-semibold"
                >
                  {t("settings.translation.ai_enabled")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {t("settings.translation.ai_enabled_desc")}
                </p>
              </div>
            </div>
            <Switch
              id="ai-translation-enabled"
              checked={options.aiEnabled}
              onCheckedChange={(checked) =>
                onChange({ ...options, aiEnabled: checked })
              }
            />
          </div>
        </div>
      </div>
    </TabsContent>
  );
};
