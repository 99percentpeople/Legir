import React from "react";
import { FormField, Annotation } from "@/types";
import { SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/components/language-provider";
import { registry } from "@/components/workspace/controls/registry/ControlRegistry";
import { CommonProperties } from "@/components/workspace/controls/properties/CommonProperties";
import { AppearanceProperties } from "@/components/workspace/controls/properties/AppearanceProperties";
import { GeometryProperties } from "@/components/workspace/controls/properties/GeometryProperties";
import { PanelLayout } from "./PanelLayout";
import { getSystemFontFamilies } from "@/lib/system-fonts";
import { cn } from "@/utils/cn";

export interface ControlPropertiesPanelProps {
  data: FormField | Annotation;
  onChange: (updates: Partial<FormField | Annotation>) => void;
  onDelete: () => void;
  onClose: () => void;
  isOpen: boolean;
  onOpen: () => void;
  onCollapse: () => void;
  isFloating: boolean;
  onTriggerHistorySave: () => void;
  canEdit: boolean;
  restrictedTitle: string;
  width: number;
  onResize: (width: number) => void;
}

export const ControlPropertiesPanel = React.memo<ControlPropertiesPanelProps>(
  ({
    data,
    onChange,
    onDelete,
    onClose,
    isOpen,
    onOpen,
    onCollapse,
    isFloating,
    onTriggerHistorySave,
    canEdit,
    restrictedTitle,
    width,
    onResize,
  }) => {
    const { t } = useLanguage();

    const controlConfig = React.useMemo(
      () => registry.get(data.type),
      [data.type],
    );
    const SpecificProperties = controlConfig?.propertiesComponent;

    const isFormField = (item: unknown): item is FormField => {
      // FormFields typically have a 'name' property and 'style' object
      if (!item || typeof item !== "object") return false;
      return "name" in item && "style" in item;
    };

    const isField = isFormField(data);
    const isHighlightAnnotation =
      !isField && (data as Annotation).type === "highlight";

    React.useEffect(() => {
      if (!isOpen) return;
      void getSystemFontFamilies();
    }, [isOpen]);

    const handleChange = React.useCallback(
      (updates: Partial<FormField | Annotation>) => {
        if (!canEdit) return;
        onChange(updates);
      },
      [canEdit, onChange],
    );

    const handleTriggerHistorySave = React.useCallback(() => {
      if (!canEdit) return;
      onTriggerHistorySave();
    }, [canEdit, onTriggerHistorySave]);

    return (
      <PanelLayout
        title={
          <>
            <SlidersHorizontal size={16} />
            {t(
              isField
                ? "properties.field.title"
                : "properties.annotation.title",
            ) || t("properties.settings")}
          </>
        }
        isFloating={isFloating}
        isOpen={isOpen}
        onOpen={onOpen}
        onClose={onClose}
        onCollapse={onCollapse}
        width={width}
        onResize={onResize}
        footer={
          <Button
            variant="destructive"
            onClick={onDelete}
            className="w-full"
            disabled={!canEdit}
            title={!canEdit ? restrictedTitle : undefined}
          >
            <Trash2 size={16} className="mr-2" />
            {t("properties.delete")}
          </Button>
        }
      >
        <fieldset
          aria-disabled={!canEdit}
          className={cn(
            "m-0 min-w-0 space-y-4 border-0 p-0",
            !canEdit && "opacity-60",
          )}
          disabled={!canEdit}
          title={!canEdit ? restrictedTitle : undefined}
        >
          {isField && (
            <>
              <CommonProperties
                data={data as FormField}
                onChange={handleChange}
                onTriggerHistorySave={handleTriggerHistorySave}
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
                onChange={handleChange}
                onTriggerHistorySave={handleTriggerHistorySave}
              />
            </React.Suspense>
          )}

          {isField && (
            <>
              <Separator />
              <AppearanceProperties
                data={data as FormField}
                onChange={handleChange}
                onTriggerHistorySave={handleTriggerHistorySave}
              />
            </>
          )}

          {/* Geometry is relevant for both if they have rect, but implementation expects FormField structure currently.
          We can enable it for Annotations if we ensure compatibility, but for now let's keep it for Fields
          or check if data has rect. 
          Highlight/Comment have rect. Ink has points (no rect).
      */}
          {"rect" in data && !isHighlightAnnotation && (
            <>
              <Separator />
              <GeometryProperties
                data={data as FormField}
                onChange={handleChange}
                onTriggerHistorySave={handleTriggerHistorySave}
              />
            </>
          )}
        </fieldset>
      </PanelLayout>
    );
  },
);
