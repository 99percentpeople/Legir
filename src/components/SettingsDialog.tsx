import React from "react";
import { Settings2, Magnet, Globe, Moon, Sun, Laptop } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { SnappingOptions } from "../types";
import { useLanguage, Language, LANGUAGES } from "./language-provider";
import { useTheme } from "./theme-provider";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  options: SnappingOptions;
  onChange: (options: SnappingOptions) => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  options,
  onChange,
}) => {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();

  const updateOption = (
    key: keyof SnappingOptions,
    value: boolean | number,
  ) => {
    onChange({
      ...options,
      [key]: value,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {t("settings.title")}
          </DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Language Selection */}
          <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="text-primary h-4 w-4" />
                <Label className="mb-0 font-semibold">
                  {t("settings.language")}
                </Label>
              </div>
              <Select
                value={language}
                onValueChange={(val) => setLanguage(val as Language)}
              >
                <SelectTrigger className="h-8 w-[120px]">
                  <SelectValue placeholder={t("common.select")} />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="system">
                    {t("settings.theme.system")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Theme Selection */}
          <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {theme === "dark" ? (
                  <Moon className="text-primary h-4 w-4" />
                ) : theme === "light" ? (
                  <Sun className="text-primary h-4 w-4" />
                ) : (
                  <Laptop className="text-primary h-4 w-4" />
                )}
                <Label className="mb-0 font-semibold">
                  {t("settings.theme")}
                </Label>
              </div>
              <Select value={theme} onValueChange={(val: any) => setTheme(val)}>
                <SelectTrigger className="h-8 w-[120px]">
                  <SelectValue placeholder={t("common.select")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">
                    {t("settings.theme.light")}
                  </SelectItem>
                  <SelectItem value="dark">
                    {t("settings.theme.dark")}
                  </SelectItem>
                  <SelectItem value="system">
                    {t("settings.theme.system")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Master Toggle */}
          <div className="bg-muted/30 border-border flex flex-col space-y-2 rounded-lg border p-3">
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
                onCheckedChange={(c) => updateOption("enabled", c)}
              />
            </div>
            <p className="text-muted-foreground px-1 text-xs">
              {t("settings.snapping.description")}
            </p>
          </div>

          <div className="space-y-4 px-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="snap-borders" className="mb-0 cursor-pointer">
                {t("settings.borders")}
              </Label>
              <Switch
                id="snap-borders"
                disabled={!options.enabled}
                checked={options.snapToBorders}
                onCheckedChange={(c) => updateOption("snapToBorders", c)}
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
                onCheckedChange={(c) => updateOption("snapToCenter", c)}
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
                onCheckedChange={(c) => updateOption("snapToEqualDistances", c)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>{t("settings.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;
