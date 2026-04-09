import React from "react";
import { Stamp } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { StampStyleEditor } from "@/components/stamps/StampStyleEditor";
import type { Annotation } from "@/types";
import type { PropertyPanelProps } from "./types";

export const StampProperties: React.FC<PropertyPanelProps<Annotation>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();
  const stamp = data.stamp;
  const stampKind = stamp?.kind ?? "preset";
  const stampPresetId = stamp?.presetId;
  const stampImage = stamp?.image;
  const stampAppearance = stamp?.appearance;
  const stampLabel = stamp?.label;

  return (
    <div>
      <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
        <Stamp size={12} className="mr-1.5" />
        {t("toolbar.stamp_properties")}
      </h4>
      <StampStyleEditor
        value={{
          kind: stampKind,
          presetId: stampPresetId,
          image: stampImage,
          imageAppearance: stampAppearance,
          opacity: data.opacity,
        }}
        onInteractionStart={onTriggerHistorySave}
        onChange={(updates) => {
          const next: Partial<Annotation> = {
            appearanceStreamContent: undefined,
          };
          const nextStamp = {
            kind: stampKind,
            presetId: stampPresetId,
            label: stampLabel,
            image: stampImage,
            appearance: stampAppearance,
          };

          if (updates.kind === "preset") {
            nextStamp.kind = "preset";
            nextStamp.label = undefined;
            nextStamp.image = undefined;
            nextStamp.appearance = undefined;
          } else if (updates.kind === "image") {
            nextStamp.kind = "image";
          }

          if (updates.presetId !== undefined) {
            nextStamp.presetId = updates.presetId;
            nextStamp.label = undefined;
          }
          if (updates.image !== undefined) {
            nextStamp.image = updates.image;
          }
          if (updates.imageAppearance !== undefined) {
            nextStamp.appearance = updates.imageAppearance;
          }
          if (updates.opacity !== undefined) {
            next.opacity = updates.opacity;
          }
          next.stamp = nextStamp;

          onChange(next);
        }}
      />
    </div>
  );
};
