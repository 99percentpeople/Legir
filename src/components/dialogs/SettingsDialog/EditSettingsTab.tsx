import { FileText, Magnet } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import type { AppOptions } from "@/types";

import { SETTINGS_CARD_COMPACT_CLASS } from "./styles";
import type { UpdateSnappingOption } from "./types";

interface EditSettingsTabProps {
  options: AppOptions;
  onChange: (options: AppOptions) => void;
  onUpdateSnapping: UpdateSnappingOption;
}

export const EditSettingsTab = ({
  options,
  onChange,
  onUpdateSnapping,
}: EditSettingsTabProps) => {
  const { t } = useLanguage();
  const snappingOptions = options.snappingOptions;

  return (
    <TabsContent value="edit">
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

        <div className={SETTINGS_CARD_COMPACT_CLASS}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Magnet className="text-primary h-4 w-4" />
              <Label htmlFor="snap-enabled" className="mb-0 font-semibold">
                {t("settings.snapping.enabled")}
              </Label>
            </div>
            <Switch
              id="snap-enabled"
              checked={snappingOptions.enabled}
              onCheckedChange={(checked) =>
                onUpdateSnapping("enabled", checked)
              }
            />
          </div>
          <p className="text-muted-foreground px-1 text-xs">
            {t("settings.snapping.description")}
          </p>
          <Separator />

          <div className="flex items-center justify-between">
            <Label htmlFor="snap-borders" className="mb-0 cursor-pointer">
              {t("settings.borders")}
            </Label>
            <Switch
              id="snap-borders"
              disabled={!snappingOptions.enabled}
              checked={snappingOptions.snapToBorders}
              onCheckedChange={(checked) =>
                onUpdateSnapping("snapToBorders", checked)
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="snap-center" className="mb-0 cursor-pointer">
              {t("settings.centers")}
            </Label>
            <Switch
              id="snap-center"
              disabled={!snappingOptions.enabled}
              checked={snappingOptions.snapToCenter}
              onCheckedChange={(checked) =>
                onUpdateSnapping("snapToCenter", checked)
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="snap-equal" className="mb-0 cursor-pointer">
              {t("settings.equal")}
            </Label>
            <Switch
              id="snap-equal"
              disabled={!snappingOptions.enabled}
              checked={snappingOptions.snapToEqualDistances}
              onCheckedChange={(checked) =>
                onUpdateSnapping("snapToEqualDistances", checked)
              }
            />
          </div>
        </div>
      </div>
    </TabsContent>
  );
};
