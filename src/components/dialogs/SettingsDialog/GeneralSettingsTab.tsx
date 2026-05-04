import { Globe, Laptop, LayoutGrid, Moon, Sun, User } from "lucide-react";

import {
  LANGUAGES,
  useLanguage,
  type Language,
} from "@/components/language-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import type { AppOptions, ThumbnailsLayoutMode } from "@/types";

import { SETTINGS_CARD_COMPACT_CLASS } from "./styles";

interface GeneralSettingsTabProps {
  language: Language;
  setLanguage: (language: Language) => void;
  theme: "dark" | "light" | "system";
  setTheme: (theme: "dark" | "light" | "system") => void;
  options: AppOptions;
  onChange: (options: AppOptions) => void;
}

export const GeneralSettingsTab = ({
  language,
  setLanguage,
  theme,
  setTheme,
  options,
  onChange,
}: GeneralSettingsTabProps) => {
  const { t } = useLanguage();

  return (
    <TabsContent value="general">
      <div className="space-y-6">
        <div className={SETTINGS_CARD_COMPACT_CLASS}>
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
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue placeholder={t("common.select")} />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value="system">
                  {t("settings.theme_options.system")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className={SETTINGS_CARD_COMPACT_CLASS}>
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
            <Select
              value={theme}
              onValueChange={(val) =>
                setTheme(val as "dark" | "light" | "system")
              }
            >
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue placeholder={t("common.select")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">
                  {t("settings.theme_options.light")}
                </SelectItem>
                <SelectItem value="dark">
                  {t("settings.theme_options.dark")}
                </SelectItem>
                <SelectItem value="system">
                  {t("settings.theme_options.system")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className={SETTINGS_CARD_COMPACT_CLASS}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LayoutGrid className="text-primary h-4 w-4" />
              <Label className="mb-0 font-semibold">
                {t("settings.thumbnails_layout")}
              </Label>
            </div>
            <Select
              value={options.thumbnailsLayout || "single"}
              onValueChange={(val) =>
                onChange({
                  ...options,
                  thumbnailsLayout: val as ThumbnailsLayoutMode,
                })
              }
            >
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue placeholder={t("common.select")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">{t("settings.single")}</SelectItem>
                <SelectItem value="double">{t("settings.double")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className={SETTINGS_CARD_COMPACT_CLASS}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <User className="text-primary h-4 w-4" />
              <Label htmlFor="app-user-name" className="mb-0 font-semibold">
                {t("settings.user_name")}
              </Label>
            </div>
            <Input
              id="app-user-name"
              value={options.userName || ""}
              onChange={(e) =>
                onChange({ ...options, userName: e.target.value })
              }
              placeholder={t("settings.user_name_placeholder")}
              className="h-8 w-[240px]"
            />
          </div>
          <p className="text-muted-foreground px-1 text-xs">
            {t("settings.user_name_desc")}
          </p>
        </div>
      </div>
    </TabsContent>
  );
};
