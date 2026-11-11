import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorView } from "@/store/useEditorView";
import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import { Palette, Type, Settings2 } from "lucide-react";
import { HorizontalAlignmentProperty } from "@/components/workspace/controls/properties/HorizontalAlignmentProperty";
import { VerticalAlignmentProperty } from "@/components/workspace/controls/properties/VerticalAlignmentProperty";
import type { HorizontalAlignment, VerticalAlignment } from "@legir/pdf-model";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPropertyInput } from "@/components/workspace/controls/properties/ColorPropertyInput";
import { FONT_FAMILY_MAP } from "@/constants";
import { FieldType } from "@/types";
import { getSystemFontFamilies } from "@/lib/system-fonts";
import { canPerformPdfPermissionOperation } from "@legir/pdf-model/pdfPermissions";
import {
  getCommonControlProperties,
  getCommonPropertyValue,
  isFormControl,
} from "@/lib/controlProperties";
import type {
  ControlProperty,
  ControlPropertyValue,
} from "@/lib/controlProperties/types";

function BatchNumberInput({
  id,
  property,
  value,
  label,
  mixed,
  onCommit,
}: {
  id: string;
  property: ControlProperty;
  value: ControlPropertyValue | undefined;
  label: string;
  mixed: string;
  onCommit: (value: number, checkpoint: boolean) => boolean;
}) {
  const saved = React.useRef(false);
  return (
    <NumberInput
      id={id}
      aria-label={label}
      minValue={property.min}
      maxValue={property.max}
      value={typeof value === "number" ? value : NaN}
      placeholder={mixed}
      onFocus={() => {
        saved.current = false;
      }}
      onChange={(number) => {
        if (Number.isFinite(number) && onCommit(number, !saved.current))
          saved.current = true;
      }}
    />
  );
}

export function BatchControlProperties() {
  const { t } = useLanguage();
  const idPrefix = React.useId();
  const state = useEditorView(
    useShallow((s) => ({
      fields: s.fields,
      annotations: s.annotations,
      ids: s.selectedControlIds,
      documentPermissions: s.documentPermissions,
      documentLoadState: s.documentLoadState,
      update: s.updateSelectedControlProperty,
    })),
  );
  const ids = new Set(state.ids);
  const controls = [...state.fields, ...state.annotations].filter((c) =>
    ids.has(c.id),
  );
  const properties = getCommonControlProperties(controls);
  const canEdit =
    state.documentLoadState === "ready" &&
    controls.every(
      (c) =>
        !(
          isFormControl(c) &&
          c.type === FieldType.SIGNATURE &&
          c.signature?.present
        ) &&
        canPerformPdfPermissionOperation(
          isFormControl(c) ? "edit_form_structure" : "edit_annotation",
          state.documentPermissions,
        ),
    );
  const [systemFonts, setSystemFonts] = React.useState<string[]>([]);
  React.useEffect(() => {
    let active = true;
    void getSystemFontFamilies().then((fonts) => {
      if (active) setSystemFonts(fonts);
    });
    return () => {
      active = false;
    };
  }, []);
  const selectionKey = JSON.stringify(state.ids);
  const colorCheckpoint = React.useRef(false);
  React.useEffect(() => {
    colorCheckpoint.current = false;
  }, [selectionKey]);
  const mixed = t("properties.mixed_values");
  const transparencyProperty = properties.find(
    (p) => p.key === "isTransparent",
  );
  const transparency = transparencyProperty
    ? getCommonPropertyValue(controls, transparencyProperty)
    : undefined;
  const hasText = properties.some((p) => p.key === "fontSize");
  const groups = [
    {
      key: "text_style",
      Icon: Type,
      properties: properties.filter(
        (p) =>
          [
            "fontFamily",
            "fontSize",
            "horizontalAlignment",
            "verticalAlignment",
          ].includes(p.key) ||
          (p.key === "color" && hasText),
      ),
    },
    {
      key: "appearance",
      Icon: Palette,
      properties: properties.filter(
        (p) =>
          [
            "backgroundColor",
            "borderColor",
            "borderWidth",
            "opacity",
            "thickness",
          ].includes(p.key) ||
          (p.key === "color" && !hasText),
      ),
    },
    {
      key: "settings",
      Icon: Settings2,
      properties: properties.filter((p) =>
        ["required", "readOnly"].includes(p.key),
      ),
    },
  ].filter((group) => group.properties.length);
  const renderProperty = (
    property: ControlProperty,
    inline = false,
  ): React.ReactNode => {
    const value = getCommonPropertyValue(controls, property);
    const label =
      t(
        property.key === "color" && properties.some((p) => p.key === "fontSize")
          ? "properties.text_color"
          : property.label,
      ) + (property.key === "opacity" ? " (%)" : "");
    const id = `${idPrefix}-${property.key}`;
    const commit = (next: ControlPropertyValue) => {
      if (canEdit) state.update(property.key, next);
    };
    const options =
      property.kind === "font"
        ? [
            ...new Set([
              ...Object.keys(FONT_FAMILY_MAP),
              ...systemFonts,
              ...controls.map((c) => String(property.read(c))),
            ]),
          ].map((font) => ({ value: font, label: font }))
        : (property.options ?? []);
    if (property.key === "horizontalAlignment")
      return (
        <HorizontalAlignmentProperty
          key={property.key}
          value={value as HorizontalAlignment | undefined}
          onChange={commit}
        />
      );
    if (property.key === "verticalAlignment")
      return (
        <VerticalAlignmentProperty
          key={property.key}
          value={value as VerticalAlignment | undefined}
          onChange={commit}
        />
      );
    if (property.kind === "boolean") {
      const toggle = (
        <div className="flex items-center gap-2">
          {value === undefined && (
            <span className="text-muted-foreground text-xs">{mixed}</span>
          )}
          <Switch
            id={id}
            disabled={!canEdit}
            checked={!!value}
            role={value === undefined ? "checkbox" : "switch"}
            aria-checked={value === undefined ? "mixed" : !!value}
            className={
              value === undefined
                ? "[&_[data-state=unchecked]]:translate-x-2"
                : undefined
            }
            onCheckedChange={(checked) => commit(checked === true)}
          />
          {inline && (
            <Label htmlFor={id} className="text-xs font-normal">
              {label}
            </Label>
          )}
        </div>
      );
      return inline ? (
        toggle
      ) : (
        <div
          key={property.key}
          className="col-span-2 flex items-center justify-between gap-2"
        >
          <Label htmlFor={id}>{label}</Label>
          {toggle}
        </div>
      );
    }
    const isBackground = property.key === "backgroundColor";
    return (
      <div
        key={`${selectionKey}:${property.key}`}
        className={
          isBackground
            ? "col-span-2"
            : property.kind === "font"
              ? "col-span-2 space-y-2"
              : "space-y-2"
        }
      >
        {isBackground ? (
          <div className="mb-1 flex items-center justify-between gap-2">
            <Label htmlFor={id}>{label}</Label>
            {transparencyProperty && renderProperty(transparencyProperty, true)}
          </div>
        ) : (
          <Label htmlFor={id}>{label}</Label>
        )}
        {property.kind === "number" ? (
          <BatchNumberInput
            id={id}
            property={property}
            value={value}
            label={label}
            mixed={mixed}
            onCommit={(number, checkpoint) =>
              canEdit && state.update(property.key, number, checkpoint)
            }
          />
        ) : property.kind === "color" ? (
          <ColorPropertyInput
            id={id}
            title={label}
            paletteType={isBackground ? "background" : "foreground"}
            color={
              typeof value === "string"
                ? value
                : String(property.read(controls[0]))
            }
            mixedLabel={value === undefined ? mixed : undefined}
            disabled={!canEdit || (isBackground && transparency === true)}
            onInteractionStart={() => {
              colorCheckpoint.current = false;
            }}
            onColorChange={(color) => {
              if (
                canEdit &&
                state.update(property.key, color, !colorCheckpoint.current)
              )
                colorCheckpoint.current = true;
            }}
          />
        ) : (
          <Select
            value={value === undefined ? "" : String(value)}
            disabled={!canEdit}
            onValueChange={commit}
          >
            <SelectTrigger id={id} aria-label={label} className="w-full">
              <SelectValue placeholder={mixed} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {property.kind === "font" ? option.label : t(option.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  };
  return (
    <div className="space-y-4" data-batch-control-properties>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t(
          properties.length
            ? "properties.batch_edit_hint"
            : "properties.multi_selection_hint",
        )}
      </p>
      {groups.map(({ key, Icon, properties: groupProperties }) => (
        <section
          key={key}
          aria-labelledby={`${idPrefix}-group-${key}`}
          className="border-border space-y-3 border-t pt-4"
        >
          <h4
            id={`${idPrefix}-group-${key}`}
            className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase"
          >
            <Icon size={12} />
            {t(`properties.${key}`)}
          </h4>
          <fieldset
            disabled={!canEdit}
            className="grid grid-cols-2 gap-x-3 gap-y-4 disabled:opacity-50"
          >
            {groupProperties.map((property) => renderProperty(property))}
          </fieldset>
        </section>
      ))}
    </div>
  );
}
