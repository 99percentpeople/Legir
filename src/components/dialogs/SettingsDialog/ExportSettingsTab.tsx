import { FileText } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import type { AppOptions } from "@/types";

import { SETTINGS_CARD_COMPACT_CLASS } from "./styles";

interface ExportSettingsTabProps {
  options: AppOptions;
  onChange: (options: AppOptions) => void;
}

export const ExportSettingsTab = ({
  options,
  onChange,
}: ExportSettingsTabProps) => {
  const { t } = useLanguage();

  return (
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
  );
};
