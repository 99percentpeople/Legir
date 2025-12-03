import React, { useState, useCallback } from "react";
import { FormField, FieldType, PDFMetadata } from "../types";
import {
  Trash2,
  X,
  Pin,
  PinOff,
  FileText,
  Plus,
  Minus,
  ArrowUp,
  ArrowDown,
  Save,
  Settings,
  Type,
  MousePointer2,
  Palette,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Database,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import { NumberInput } from "./ui/number-input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { Separator } from "./ui/separator";
import { cn, setGlobalCursor, resetGlobalCursor } from "../lib/utils";
import { useLanguage } from "./language-provider";
import { FONT_FAMILY_MAP } from "../constants";

// --- Shared Layout Component ---
interface PanelLayoutProps {
  isFloating: boolean;
  onToggleFloating: () => void;
  onClose?: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width: number;
  onResize: (width: number) => void;
}

const PanelLayout: React.FC<PanelLayoutProps> = ({
  isFloating,
  onToggleFloating,
  onClose,
  title,
  children,
  footer,
  width,
  onResize,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const resizeStateRef = React.useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const onResizeRef = React.useRef(onResize);
  onResizeRef.current = onResize;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeStateRef.current = { startX: e.clientX, startWidth: width };
      setIsResizing(true);
    },
    [width],
  );

  React.useEffect(() => {
    if (!isResizing) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const { startX, startWidth } = resizeStateRef.current;
      // Dragging left edge: moving left (decreasing X) increases width
      const newWidth = startWidth + (startX - moveEvent.clientX);
      if (onResizeRef.current) {
        onResizeRef.current(Math.max(240, Math.min(600, newWidth)));
      }
    };

    const onMouseUp = () => {
      setIsResizing(false);
      resizeStateRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    setGlobalCursor("col-resize", "properties-resize");
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      resetGlobalCursor("properties-resize");
      document.body.style.removeProperty("user-select");
    };
  }, [isResizing]);

  return (
    <div
      className={cn(
        "bg-background border-border flex h-full flex-col border-l transition-colors duration-200",
        isFloating
          ? "absolute top-0 right-0 bottom-0 shadow-2xl"
          : "relative shadow-none",
      )}
      style={{ width: width }}
    >
      {/* Resize Handle */}
      <div
        className={cn(
          "absolute top-0 bottom-0 left-0 z-50 w-1 cursor-col-resize transition-colors",
          isResizing ? "bg-primary/50" : "hover:bg-primary/50",
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Resize Overlay */}
      {isResizing && (
        <div className="fixed inset-0 z-9999 cursor-col-resize bg-transparent" />
      )}

      {/* Header */}
      <div className="border-border bg-muted/30 flex items-center justify-between border-b p-4">
        <h3 className="text-foreground flex items-center gap-2 font-semibold">
          {title}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleFloating}
            title={isFloating ? "Pin panel to side" : "Unpin panel (float)"}
          >
            {isFloating ? <Pin size={16} /> : <PinOff size={16} />}
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClose}
            >
              <X size={18} />
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="scrollbar-thin scrollbar-thumb-border flex-1 space-y-6 overflow-y-auto p-4">
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div className="border-border bg-muted/30 border-t p-4">{footer}</div>
      )}
    </div>
  );
};

// --- Document Properties Sub-Component ---
interface DocumentPropertiesPanelProps {
  metadata: PDFMetadata;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  filename: string;
  onFilenameChange: (name: string) => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  onTriggerHistorySave: () => void;
  width: number;
  onResize: (width: number) => void;
}

const DocumentPropertiesPanel: React.FC<DocumentPropertiesPanelProps> = ({
  metadata,
  onMetadataChange,
  filename,
  onFilenameChange,
  isFloating,
  onToggleFloating,
  onTriggerHistorySave,
  width,
  onResize,
}) => {
  const { t } = useLanguage();
  return (
    <PanelLayout
      title={
        <>
          <FileText size={16} /> {t("properties.document.title")}
        </>
      }
      isFloating={isFloating}
      onToggleFloating={onToggleFloating}
      width={width}
      onResize={onResize}
    >
      <div className="space-y-4">
        <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          {t("properties.document.hint")}
        </div>

        <div className="space-y-2">
          <Label>{t("properties.filename")}</Label>
          <Input
            type="text"
            value={filename}
            onFocus={onTriggerHistorySave}
            onChange={(e) => onFilenameChange(e.target.value)}
            placeholder="document.pdf"
          />
          <p className="text-muted-foreground text-xs">
            {t("properties.filename.desc")}
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>{t("properties.doc_title")}</Label>
          <Input
            type="text"
            value={metadata.title || ""}
            onFocus={onTriggerHistorySave}
            onChange={(e) => onMetadataChange({ title: e.target.value })}
            placeholder="Untitled Document"
          />
        </div>

        <div className="space-y-2">
          <Label>{t("properties.author")}</Label>
          <Input
            type="text"
            value={metadata.author || ""}
            onFocus={onTriggerHistorySave}
            onChange={(e) => onMetadataChange({ author: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>{t("properties.subject")}</Label>
          <Textarea
            rows={2}
            value={metadata.subject || ""}
            onFocus={onTriggerHistorySave}
            onChange={(e) => onMetadataChange({ subject: e.target.value })}
            className="resize-none"
          />
        </div>

        <div className="space-y-2">
          <Label>{t("properties.keywords")}</Label>
          <Input
            type="text"
            value={metadata.keywords || ""}
            onFocus={onTriggerHistorySave}
            onChange={(e) => onMetadataChange({ keywords: e.target.value })}
            placeholder="invoice, receipt, 2024"
          />
          <p className="text-muted-foreground text-xs">
            {t("properties.keywords.desc")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t("properties.creator")}</Label>
            <Input
              type="text"
              value={metadata.creator || ""}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onMetadataChange({ creator: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("properties.producer")}</Label>
            <Input
              type="text"
              value={metadata.producer || ""}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onMetadataChange({ producer: e.target.value })}
            />
          </div>
        </div>
      </div>
    </PanelLayout>
  );
};

// --- Field Properties Sub-Component ---
interface FieldPropertiesPanelProps {
  field: FormField;
  onChange: (updates: Partial<FormField>) => void;
  onDelete: () => void;
  onClose: () => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  onTriggerHistorySave: () => void;
  width: number;
  onResize: (width: number) => void;
}

const FieldPropertiesPanel: React.FC<FieldPropertiesPanelProps> = ({
  field,
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
  const style = field.style || {};
  const [newOption, setNewOption] = useState("");
  const [isBulkEdit, setIsBulkEdit] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const handleStyleChange = (key: string, value: any) => {
    onChange({
      style: {
        ...style,
        [key]: value,
      },
    });
  };

  const handleAddOption = () => {
    if (newOption.trim()) {
      onTriggerHistorySave();
      const currentOptions = field.options || [];
      onChange({ options: [...currentOptions, newOption.trim()] });
      setNewOption("");
    }
  };

  const handleRemoveOption = (idx: number) => {
    onTriggerHistorySave();
    const currentOptions = field.options || [];
    onChange({ options: currentOptions.filter((_, i) => i !== idx) });
  };

  const handleMoveOption = (index: number, direction: "up" | "down") => {
    onTriggerHistorySave();
    const currentOptions = [...(field.options || [])];
    if (direction === "up" && index > 0) {
      [currentOptions[index], currentOptions[index - 1]] = [
        currentOptions[index - 1],
        currentOptions[index],
      ];
    } else if (direction === "down" && index < currentOptions.length - 1) {
      [currentOptions[index], currentOptions[index + 1]] = [
        currentOptions[index + 1],
        currentOptions[index],
      ];
    }
    onChange({ options: currentOptions });
  };

  const startBulkEdit = () => {
    setBulkText((field.options || []).join("\n"));
    setIsBulkEdit(true);
  };

  const saveBulkEdit = () => {
    onTriggerHistorySave();
    const newOptions = bulkText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    onChange({ options: newOptions });
    setIsBulkEdit(false);
  };

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onTriggerHistorySave();
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          onChange({ signatureData: ev.target.result as string });
        }
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  return (
    <PanelLayout
      title={t("properties.field.title")}
      isFloating={isFloating}
      onToggleFloating={onToggleFloating}
      onClose={onClose}
      width={width}
      onResize={onResize}
      footer={
        <Button variant="destructive" onClick={onDelete} className="w-full">
          <Trash2 size={16} className="mr-2" />
          {t("properties.delete_field")}
        </Button>
      }
    >
      {/* General Section */}
      <div>
        <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
          <Settings size={12} className="mr-1.5" />
          {t("properties.general")}
        </h4>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>{t("properties.field_name")}</Label>
            <Input
              type="text"
              value={field.name}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onChange({ name: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">
              {t("properties.field_name.desc")}
            </p>
            {field.type === FieldType.RADIO && (
              <p className="mt-1 text-xs text-blue-500 dark:text-blue-400">
                {t("properties.radio_group.desc")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("properties.type")}</Label>
            <Select
              value={field.type}
              onValueChange={(value) => {
                onTriggerHistorySave();
                onChange({ type: value as FieldType });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("common.select")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FieldType.TEXT}>
                  {t("properties.type.text")}
                </SelectItem>
                <SelectItem value={FieldType.CHECKBOX}>
                  {t("properties.type.checkbox")}
                </SelectItem>
                <SelectItem value={FieldType.RADIO}>
                  {t("properties.type.radio")}
                </SelectItem>
                <SelectItem value={FieldType.DROPDOWN}>
                  {t("properties.type.dropdown")}
                </SelectItem>
                <SelectItem value={FieldType.SIGNATURE}>
                  {t("properties.type.signature")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("properties.tooltip")}</Label>
            <Input
              type="text"
              value={field.toolTip || ""}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onChange({ toolTip: e.target.value })}
              placeholder={t("properties.tooltip.ph")}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Values & Defaults Section */}
      <div>
        <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
          <Database size={12} className="mr-1.5" />
          {t("properties.values_defaults")}
        </h4>
        <div className="space-y-3">
          {/* Text */}
          {field.type === FieldType.TEXT && (
            <>
              <div className="space-y-2">
                <Label>{t("properties.value")}</Label>
                {field.multiline ? (
                  <Textarea
                    value={field.value || ""}
                    onFocus={onTriggerHistorySave}
                    onChange={(e) => onChange({ value: e.target.value })}
                    className="min-h-16 resize-y"
                  />
                ) : (
                  <Input
                    type="text"
                    value={field.value || ""}
                    onFocus={onTriggerHistorySave}
                    onChange={(e) => onChange({ value: e.target.value })}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>{t("properties.default_value")}</Label>
                {field.multiline ? (
                  <Textarea
                    value={field.defaultValue || ""}
                    onFocus={onTriggerHistorySave}
                    onChange={(e) => onChange({ defaultValue: e.target.value })}
                    className="min-h-16 resize-y"
                  />
                ) : (
                  <Input
                    type="text"
                    value={field.defaultValue || ""}
                    onFocus={onTriggerHistorySave}
                    onChange={(e) => onChange({ defaultValue: e.target.value })}
                  />
                )}
              </div>
            </>
          )}

          {/* Signature */}
          {field.type === FieldType.SIGNATURE && (
            <>
              <div className="space-y-3">
                <Label>{t("properties.signature_image")}</Label>
                <div className="border-input bg-muted/20 flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4">
                  {field.signatureData ? (
                    <div className="border-border relative flex aspect-video w-full items-center justify-center overflow-hidden rounded border bg-white">
                      <img
                        src={field.signatureData}
                        alt="Signature"
                        className={cn(
                          "max-h-full max-w-full",
                          field.imageScaleMode === "fill"
                            ? "h-full w-full object-fill"
                            : "object-contain",
                        )}
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => {
                          onTriggerHistorySave();
                          onChange({ signatureData: undefined });
                        }}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-center text-xs">
                      {t("properties.no_signature")}
                    </div>
                  )}

                  <label className="cursor-pointer">
                    <Input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleSignatureUpload}
                    />
                    <div
                      className={cn(
                        buttonVariants({ variant: "secondary", size: "sm" }),
                      )}
                    >
                      <Upload size={14} className="mr-2" />
                      {t("properties.upload_signature")}
                    </div>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("properties.scale_mode")}</Label>
                <Select
                  value={field.imageScaleMode || "contain"}
                  onValueChange={(val) => {
                    onTriggerHistorySave();
                    onChange({ imageScaleMode: val as "contain" | "fill" });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contain">
                      {t("properties.scale_mode.contain")}
                    </SelectItem>
                    <SelectItem value="fill">
                      {t("properties.scale_mode.fill")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Dropdown */}
          {field.type === FieldType.DROPDOWN && (
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="multiselect-switch" className="cursor-pointer">
                  {t("properties.multiselect")}
                </Label>
                <Switch
                  id="multiselect-switch"
                  checked={field.isMultiSelect || false}
                  onMouseDown={onTriggerHistorySave}
                  onCheckedChange={(checked) =>
                    onChange({
                      isMultiSelect: checked,
                      value: "",
                      defaultValue: "",
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>{t("properties.value")}</Label>
                {!field.isMultiSelect ? (
                  <Select
                    value={field.value || ""}
                    onValueChange={(val) => {
                      onTriggerHistorySave();
                      onChange({ value: val });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("common.select")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options || []).map((opt, i) => (
                        <SelectItem key={i} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="bg-background max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                    {(field.options || []).map((opt, i) => {
                      const selected = (field.value || "")
                        .split("\n")
                        .includes(opt);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(e) => {
                              onTriggerHistorySave();
                              const current = (field.value || "")
                                .split("\n")
                                .filter((v) => v && v !== "");
                              let newVals;
                              if (e.target.checked) {
                                newVals = [...current, opt];
                              } else {
                                newVals = current.filter((v) => v !== opt);
                              }
                              onChange({ value: newVals.join("\n") });
                            }}
                            className="border-input accent-primary h-4 w-4 rounded"
                          />
                          <span className="text-sm">{opt}</span>
                        </div>
                      );
                    })}
                    {(field.options?.length || 0) === 0 && (
                      <div className="text-muted-foreground text-xs">
                        {t("properties.no_options")}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t("properties.default_value")}</Label>
                {!field.isMultiSelect ? (
                  <Select
                    value={field.defaultValue || ""}
                    onValueChange={(val) => {
                      onTriggerHistorySave();
                      onChange({ defaultValue: val });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("common.select")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options || []).map((opt, i) => (
                        <SelectItem key={i} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="bg-background max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                    {(field.options || []).map((opt, i) => {
                      const selected = (field.defaultValue || "")
                        .split("\n")
                        .includes(opt);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(e) => {
                              onTriggerHistorySave();
                              const current = (field.defaultValue || "")
                                .split("\n")
                                .filter((v) => v && v !== "");
                              let newVals;
                              if (e.target.checked) {
                                newVals = [...current, opt];
                              } else {
                                newVals = current.filter((v) => v !== opt);
                              }
                              onChange({ defaultValue: newVals.join("\n") });
                            }}
                            className="border-input accent-primary h-4 w-4 rounded"
                          />
                          <span className="text-sm">{opt}</span>
                        </div>
                      );
                    })}
                    {(field.options?.length || 0) === 0 && (
                      <div className="text-muted-foreground text-xs">
                        {t("properties.no_options")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Checkbox */}
          {field.type === FieldType.CHECKBOX && (
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="check-val">{t("properties.checked")}</Label>
                <Switch
                  id="check-val"
                  checked={field.isChecked || false}
                  onCheckedChange={(checked) => {
                    onTriggerHistorySave();
                    onChange({ isChecked: checked });
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="check-def">
                  {t("properties.default_checked")}
                </Label>
                <Switch
                  id="check-def"
                  checked={field.isDefaultChecked || false}
                  onCheckedChange={(checked) => {
                    onTriggerHistorySave();
                    onChange({ isDefaultChecked: checked });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("properties.export_value")}</Label>
                <Input
                  type="text"
                  value={field.exportValue || "Yes"}
                  onFocus={onTriggerHistorySave}
                  onChange={(e) => onChange({ exportValue: e.target.value })}
                  placeholder="Yes"
                />
                <p className="text-muted-foreground text-xs">
                  {t("properties.export_value.desc")}
                </p>
              </div>
            </>
          )}

          {/* Radio */}
          {field.type === FieldType.RADIO && (
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="radio-val">{t("properties.selected")}</Label>
                <Switch
                  id="radio-val"
                  checked={field.isChecked || false}
                  onCheckedChange={(checked) => {
                    onTriggerHistorySave();
                    onChange({ isChecked: checked });
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="radio-def">
                  {t("properties.default_selected")}
                </Label>
                <Switch
                  id="radio-def"
                  checked={field.isDefaultChecked || false}
                  onCheckedChange={(checked) => {
                    onTriggerHistorySave();
                    onChange({ isDefaultChecked: checked });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("properties.export_value")}</Label>
                <Input
                  type="text"
                  value={field.radioValue || field.exportValue || ""}
                  onFocus={onTriggerHistorySave}
                  onChange={(e) =>
                    onChange({
                      radioValue: e.target.value,
                      exportValue: e.target.value,
                    })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  {t("properties.export_value.desc")}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <Separator />

      {/* Settings / Behavior */}
      <div>
        <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
          <MousePointer2 size={12} className="mr-1.5" />
          {t("properties.settings")}
        </h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="required-switch" className="cursor-pointer">
              {t("properties.required")}
            </Label>
            <Switch
              id="required-switch"
              checked={field.required || false}
              onMouseDown={onTriggerHistorySave}
              onCheckedChange={(checked) => onChange({ required: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="readonly-switch" className="cursor-pointer">
              {t("properties.readonly")}
            </Label>
            <Switch
              id="readonly-switch"
              checked={field.readOnly || false}
              onMouseDown={onTriggerHistorySave}
              onCheckedChange={(checked) => onChange({ readOnly: checked })}
            />
          </div>

          {field.type === FieldType.TEXT && (
            <div className="flex items-center justify-between">
              <Label htmlFor="multiline-switch" className="cursor-pointer">
                {t("properties.multiline")}
              </Label>
              <Switch
                id="multiline-switch"
                checked={field.multiline || false}
                onMouseDown={onTriggerHistorySave}
                onCheckedChange={(checked) => onChange({ multiline: checked })}
              />
            </div>
          )}
        </div>
      </div>

      {/* Specific Properties */}
      {(field.type === FieldType.DROPDOWN || field.type === FieldType.TEXT) && (
        <Separator />
      )}

      <div>
        {field.type === FieldType.TEXT && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("properties.max_length")}</Label>
                <NumberInput
                  minValue={0}
                  formatOptions={{ maximumFractionDigits: 0 }}
                  value={field.maxLength || NaN}
                  onFocus={onTriggerHistorySave}
                  onChange={(val) =>
                    onChange({ maxLength: isNaN(val) ? undefined : val })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("properties.alignment")}</Label>
                <div className="bg-muted border-input flex rounded-md border p-1">
                  <button
                    onClick={() => {
                      onTriggerHistorySave();
                      onChange({ alignment: "left" });
                    }}
                    className={cn(
                      "text-foreground/50 hover:bg-background hover:text-foreground flex flex-1 justify-center rounded p-1 transition-colors",
                      (field.alignment || "left") === "left" &&
                        "bg-background text-foreground shadow-sm",
                    )}
                    title={t("properties.alignment.left")}
                  >
                    <AlignLeft size={16} />
                  </button>
                  <button
                    onClick={() => {
                      onTriggerHistorySave();
                      onChange({ alignment: "center" });
                    }}
                    className={cn(
                      "text-foreground/50 hover:bg-background hover:text-foreground flex flex-1 justify-center rounded p-1 transition-colors",
                      field.alignment === "center" &&
                        "bg-background text-foreground shadow-sm",
                    )}
                    title={t("properties.alignment.center")}
                  >
                    <AlignCenter size={16} />
                  </button>
                  <button
                    onClick={() => {
                      onTriggerHistorySave();
                      onChange({ alignment: "right" });
                    }}
                    className={cn(
                      "text-foreground/50 hover:bg-background hover:text-foreground flex flex-1 justify-center rounded p-1 transition-colors",
                      field.alignment === "right" &&
                        "bg-background text-foreground shadow-sm",
                    )}
                    title={t("properties.alignment.right")}
                  >
                    <AlignRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {field.type === FieldType.DROPDOWN && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>{t("properties.options")}</Label>
              <Button
                variant="link"
                size="sm"
                onClick={
                  isBulkEdit ? () => setIsBulkEdit(false) : startBulkEdit
                }
                className="h-auto p-0 text-xs"
              >
                {isBulkEdit
                  ? t("properties.switch_list")
                  : t("properties.bulk_edit")}
              </Button>
            </div>

            {isBulkEdit ? (
              <div className="space-y-2">
                <Textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  className="font-mono text-xs"
                  rows={6}
                  placeholder="One option per line"
                />
                <Button onClick={saveBulkEdit} size="sm" className="w-full">
                  <Save size={14} className="mr-2" />
                  {t("properties.save_options")}
                </Button>
              </div>
            ) : (
              <>
                <div className="scrollbar-thin scrollbar-thumb-border mb-2 max-h-40 space-y-2 overflow-y-auto pr-1">
                  {(field.options || []).map((opt, idx) => (
                    <div key={idx} className="group flex items-center gap-1">
                      <div className="text-muted-foreground flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleMoveOption(idx, "up")}
                          disabled={idx === 0}
                          className="hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowUp size={10} />
                        </button>
                        <button
                          onClick={() => handleMoveOption(idx, "down")}
                          disabled={idx === (field.options?.length || 0) - 1}
                          className="hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowDown size={10} />
                        </button>
                      </div>
                      <div className="bg-muted/50 border-border flex-1 truncate rounded border px-2 py-1.5 text-sm">
                        {opt}
                      </div>
                      <button
                        onClick={() => handleRemoveOption(idx)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Minus size={14} />
                      </button>
                    </div>
                  ))}
                  {(field.options?.length || 0) === 0 && (
                    <div className="text-muted-foreground py-2 text-center text-xs italic">
                      {t("properties.no_options")}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newOption}
                    onChange={(e) => setNewOption(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddOption()}
                    placeholder={t("properties.add_option")}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleAddOption}
                    size="icon"
                    variant="secondary"
                  >
                    <Plus size={16} />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <Separator />

      {/* Appearance Section */}
      <div>
        <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
          <Palette size={12} className="mr-1.5" />
          {t("properties.appearance")}
        </h4>
        <div className="space-y-4">
          {/* Background */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>{t("properties.background")}</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="transparent"
                  checked={style.isTransparent || false}
                  onMouseDown={onTriggerHistorySave}
                  onCheckedChange={(checked) =>
                    handleStyleChange("isTransparent", checked)
                  }
                />
                <Label htmlFor="transparent" className="text-xs font-normal">
                  {t("properties.transparent")}
                </Label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                disabled={style.isTransparent}
                value={style.backgroundColor || "#ffffff"}
                onMouseDown={onTriggerHistorySave}
                onChange={(e) =>
                  handleStyleChange("backgroundColor", e.target.value)
                }
                className="border-input bg-background h-8 w-full cursor-pointer rounded border disabled:opacity-50"
              />
            </div>
          </div>

          {/* Border */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("properties.border_color")}</Label>
              <input
                type="color"
                value={style.borderColor || "#000000"}
                onMouseDown={onTriggerHistorySave}
                onChange={(e) =>
                  handleStyleChange("borderColor", e.target.value)
                }
                className="border-input bg-background h-8 w-full cursor-pointer rounded border"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("properties.border_width")}</Label>
              <NumberInput
                minValue={0}
                maxValue={10}
                value={style.borderWidth ?? 1}
                onFocus={onTriggerHistorySave}
                onChange={(val) => handleStyleChange("borderWidth", val)}
              />
            </div>
          </div>

          {/* Text Settings (For Text and Dropdown) */}
          {(field.type === FieldType.TEXT ||
            field.type === FieldType.DROPDOWN) && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t("properties.text_color")}</Label>
                  <input
                    type="color"
                    value={style.textColor || "#000000"}
                    onMouseDown={onTriggerHistorySave}
                    onChange={(e) =>
                      handleStyleChange("textColor", e.target.value)
                    }
                    className="border-input bg-background h-8 w-full cursor-pointer rounded border"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("properties.font_size")}</Label>
                  <NumberInput
                    minValue={6}
                    maxValue={72}
                    value={style.fontSize ?? 12}
                    onFocus={onTriggerHistorySave}
                    onChange={(val) => handleStyleChange("fontSize", val)}
                  />
                </div>
              </div>

              {/* Font Family Selector */}
              <div className="space-y-2">
                <Label>Font Family</Label>
                <Select
                  value={style.fontFamily || "Helvetica"}
                  onValueChange={(val) => {
                    onTriggerHistorySave();
                    handleStyleChange("fontFamily", val);
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    style={{
                      fontFamily:
                        FONT_FAMILY_MAP[style.fontFamily || "Helvetica"],
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="Helvetica"
                      style={{ fontFamily: FONT_FAMILY_MAP["Helvetica"] }}
                    >
                      Helvetica
                    </SelectItem>
                    <SelectItem
                      value="Times Roman"
                      style={{ fontFamily: FONT_FAMILY_MAP["Times Roman"] }}
                    >
                      Times Roman
                    </SelectItem>
                    <SelectItem
                      value="Courier"
                      style={{ fontFamily: FONT_FAMILY_MAP["Courier"] }}
                    >
                      Courier
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      </div>

      <Separator />

      {/* Geometry Section */}
      <div>
        <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
          <Type size={12} className="mr-1.5" />
          {t("properties.geometry")}
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">{t("properties.x")}</Label>
            <NumberInput
              value={Math.round(field.rect.x)}
              formatOptions={{ maximumFractionDigits: 0 }}
              onFocus={onTriggerHistorySave}
              onChange={(val) => onChange({ rect: { ...field.rect, x: val } })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("properties.y")}</Label>
            <NumberInput
              value={Math.round(field.rect.y)}
              formatOptions={{ maximumFractionDigits: 0 }}
              onFocus={onTriggerHistorySave}
              onChange={(val) => onChange({ rect: { ...field.rect, y: val } })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("properties.width")}</Label>
            <NumberInput
              value={Math.round(field.rect.width)}
              formatOptions={{ maximumFractionDigits: 0 }}
              onFocus={onTriggerHistorySave}
              onChange={(val) =>
                onChange({ rect: { ...field.rect, width: val } })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("properties.height")}</Label>
            <NumberInput
              value={Math.round(field.rect.height)}
              formatOptions={{ maximumFractionDigits: 0 }}
              onFocus={onTriggerHistorySave}
              onChange={(val) =>
                onChange({ rect: { ...field.rect, height: val } })
              }
            />
          </div>
        </div>
      </div>
    </PanelLayout>
  );
};

// --- Main Container Component ---
interface PropertiesPanelProps {
  field: FormField | null;
  metadata: PDFMetadata;
  filename: string;
  onChange: (updates: Partial<FormField>) => void;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  onFilenameChange: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  onTriggerHistorySave: () => void;
  width: number;
  onResize: (width: number) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  field,
  metadata,
  filename,
  onChange,
  onMetadataChange,
  onFilenameChange,
  onDelete,
  onClose,
  isFloating,
  onToggleFloating,
  onTriggerHistorySave,
  width,
  onResize,
}) => {
  if (field) {
    return (
      <FieldPropertiesPanel
        field={field}
        onChange={onChange}
        onDelete={onDelete}
        onClose={onClose}
        isFloating={isFloating}
        onToggleFloating={onToggleFloating}
        onTriggerHistorySave={onTriggerHistorySave}
        width={width}
        onResize={onResize}
      />
    );
  }

  return (
    <DocumentPropertiesPanel
      metadata={metadata}
      onMetadataChange={onMetadataChange}
      filename={filename}
      onFilenameChange={onFilenameChange}
      isFloating={isFloating}
      onToggleFloating={onToggleFloating}
      onTriggerHistorySave={onTriggerHistorySave}
      width={width}
      onResize={onResize}
    />
  );
};
