import { Magnet } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import type { SnappingOptions } from "@/types";

import { SETTINGS_CARD_COMPACT_CLASS } from "./styles";
import type { SettingsTranslate, UpdateSnappingOption } from "./types";

interface SnappingSettingsTabProps {
  t: SettingsTranslate;
  options: SnappingOptions;
  onUpdate: UpdateSnappingOption;
}

export const SnappingSettingsTab = ({
  t,
  options,
  onUpdate,
}: SnappingSettingsTabProps) => {
  return (
    <TabsContent value="snapping">
      <div className="space-y-6">
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
              checked={options.enabled}
              onCheckedChange={(checked) => onUpdate("enabled", checked)}
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
              disabled={!options.enabled}
              checked={options.snapToBorders}
              onCheckedChange={(checked) => onUpdate("snapToBorders", checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="snap-center" className="mb-0 cursor-pointer">
              {t("settings.centers")}
            </Label>
            <Switch
              id="snap-center"
              disabled={!options.enabled}
              checked={options.snapToCenter}
              onCheckedChange={(checked) => onUpdate("snapToCenter", checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="snap-equal" className="mb-0 cursor-pointer">
              {t("settings.equal")}
            </Label>
            <Switch
              id="snap-equal"
              disabled={!options.enabled}
              checked={options.snapToEqualDistances}
              onCheckedChange={(checked) =>
                onUpdate("snapToEqualDistances", checked)
              }
            />
          </div>
        </div>
      </div>
    </TabsContent>
  );
};
