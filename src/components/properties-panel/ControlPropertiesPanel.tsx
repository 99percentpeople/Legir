import React from "react";
import { FormField, Annotation } from "@/types";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/components/language-provider";
import { registry } from "@/components/workspace/controls/registry/ControlRegistry";
import { CommonProperties } from "@/components/workspace/controls/properties/CommonProperties";
import { AppearanceProperties } from "@/components/workspace/controls/properties/AppearanceProperties";
import { GeometryProperties } from "@/components/workspace/controls/properties/GeometryProperties";
import { PanelLayout } from "./PanelLayout";

export interface ControlPropertiesPanelProps {
  data: FormField | Annotation;
  onChange: (updates: Partial<FormField | Annotation>) => void;
  onDelete: () => void;
  onClose: () => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  onTriggerHistorySave: () => void;
  width: number;
  onResize: (width: number) => void;
}

export const ControlPropertiesPanel = React.memo<ControlPropertiesPanelProps>(
  ({
    data,
    onChange,
    onDelete,
    onClose,
    isFloating,
    onToggleFloating,
    onTriggerHistorySave,
    width,
    onResize,
  }) => {
    const { t } = useLanguage();

    const controlConfig = React.useMemo(
      () => registry.get(data.type),
      [data.type],
    );
    const SpecificProperties = controlConfig?.propertiesComponent;

    const isFormField = (item: any): item is FormField => {
      // FormFields typically have a 'name' property and 'style' object
      return "name" in item && "style" in item;
    };

    const isField = isFormField(data);

    return (
      <PanelLayout
        title={
          t(
            isField ? "properties.field.title" : "properties.annotation.title",
          ) || t("properties.settings")
        }
        isFloating={isFloating}
        onToggleFloating={onToggleFloating}
        onClose={onClose}
        width={width}
        onResize={onResize}
        footer={
          <Button variant="destructive" onClick={onDelete} className="w-full">
            <Trash2 size={16} className="mr-2" />
            {t("properties.delete")}
          </Button>
        }
      >
        {isField && (
          <>
            <CommonProperties
              data={data as FormField}
              onChange={onChange as any}
              onTriggerHistorySave={onTriggerHistorySave}
            />
            <Separator />
          </>
        )}

        {SpecificProperties && (
          <React.Suspense
            fallback={
              <div className="text-muted-foreground p-4 text-center text-sm">
                Loading properties...
              </div>
            }
          >
            <SpecificProperties
              data={data}
              onChange={onChange}
              onTriggerHistorySave={onTriggerHistorySave}
            />
          </React.Suspense>
        )}

        {isField && (
          <>
            <Separator />
            <AppearanceProperties
              data={data as FormField}
              onChange={onChange as any}
              onTriggerHistorySave={onTriggerHistorySave}
            />
          </>
        )}

        {/* Geometry is relevant for both if they have rect, but implementation expects FormField structure currently.
          We can enable it for Annotations if we ensure compatibility, but for now let's keep it for Fields
          or check if data has rect. 
          Highlight/Comment have rect. Ink has points (no rect).
      */}
        {"rect" in data && (
          <>
            <Separator />
            <GeometryProperties
              data={data as any}
              onChange={onChange as any}
              onTriggerHistorySave={onTriggerHistorySave}
            />
          </>
        )}
      </PanelLayout>
    );
  },
);
