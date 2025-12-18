import React, { useState } from "react";
import { FormField } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Database,
  MousePointer2,
  Save,
  ArrowUp,
  ArrowDown,
  Plus,
  Minus,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";

export const DropdownProperties: React.FC<PropertyPanelProps<FormField>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();
  const [newOption, setNewOption] = useState("");
  const [isBulkEdit, setIsBulkEdit] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const handleAddOption = () => {
    if (newOption.trim()) {
      onTriggerHistorySave();
      const currentOptions = data.options || [];
      onChange({ options: [...currentOptions, newOption.trim()] });
      setNewOption("");
    }
  };

  const handleRemoveOption = (idx: number) => {
    onTriggerHistorySave();
    const currentOptions = data.options || [];
    onChange({ options: currentOptions.filter((_, i) => i !== idx) });
  };

  const handleMoveOption = (index: number, direction: "up" | "down") => {
    onTriggerHistorySave();
    const currentOptions = [...(data.options || [])];
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
    setBulkText((data.options || []).join("\n"));
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

  return (
    <>
      {/* Values & Defaults Section */}
      <div>
        <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
          <Database size={12} className="mr-1.5" />
          {t("properties.values_defaults")}
        </h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="multiselect-switch" className="cursor-pointer">
              {t("properties.multiselect")}
            </Label>
            <Switch
              id="multiselect-switch"
              checked={data.isMultiSelect || false}
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
            {!data.isMultiSelect ? (
              <Select
                value={data.value || ""}
                onValueChange={(val) => {
                  onTriggerHistorySave();
                  onChange({ value: val });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("common.select")} />
                </SelectTrigger>
                <SelectContent>
                  {(data.options || []).map((opt, i) => (
                    <SelectItem key={i} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="bg-background max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                {(data.options || []).map((opt, i) => {
                  const selected = (data.value || "").split("\n").includes(opt);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          onTriggerHistorySave();
                          const current = (data.value || "")
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
                {(data.options?.length || 0) === 0 && (
                  <div className="text-muted-foreground text-xs">
                    {t("properties.no_options")}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("properties.default_value")}</Label>
            {!data.isMultiSelect ? (
              <Select
                value={data.defaultValue || ""}
                onValueChange={(val) => {
                  onTriggerHistorySave();
                  onChange({ defaultValue: val });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("common.select")} />
                </SelectTrigger>
                <SelectContent>
                  {(data.options || []).map((opt, i) => (
                    <SelectItem key={i} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="bg-background max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                {(data.options || []).map((opt, i) => {
                  const selected = (data.defaultValue || "")
                    .split("\n")
                    .includes(opt);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          onTriggerHistorySave();
                          const current = (data.defaultValue || "")
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
                {(data.options?.length || 0) === 0 && (
                  <div className="text-muted-foreground text-xs">
                    {t("properties.no_options")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Options Management */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>{t("properties.options")}</Label>
          <Button
            variant="link"
            size="sm"
            onClick={isBulkEdit ? () => setIsBulkEdit(false) : startBulkEdit}
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
              {(data.options || []).map((opt, idx) => (
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
                      disabled={idx === (data.options?.length || 0) - 1}
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
              {(data.options?.length || 0) === 0 && (
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
              <Button onClick={handleAddOption} size="icon" variant="secondary">
                <Plus size={16} />
              </Button>
            </div>
          </>
        )}
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
              checked={data.required || false}
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
              checked={data.readOnly || false}
              onMouseDown={onTriggerHistorySave}
              onCheckedChange={(checked) => onChange({ readOnly: checked })}
            />
          </div>
        </div>
      </div>
    </>
  );
};
