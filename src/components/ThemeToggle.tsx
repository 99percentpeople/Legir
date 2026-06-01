import { Check, Moon, Sun, SunMoon } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { useLanguage } from "@/components/language-provider";
import { useTheme, type Theme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils/cn";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const THEME_OPTIONS = [
  "light",
  "dark",
  "system",
] as const satisfies readonly Theme[];

const THEME_OPTION_LABEL_KEYS: Record<Theme, string> = {
  light: "settings.theme_options.light",
  dark: "settings.theme_options.dark",
  system: "settings.theme_options.system",
};

const THEME_OPTION_ICONS: Record<Theme, IconComponent> = {
  light: Sun,
  dark: Moon,
  system: SunMoon,
};

type ThemeIconProps = {
  theme: Theme;
  className?: string;
};

export function ThemeIcon({ theme, className }: ThemeIconProps) {
  const Icon = THEME_OPTION_ICONS[theme];
  return <Icon className={className} />;
}

type CurrentThemeIconProps = {
  className?: string;
};

export function CurrentThemeIcon({ className }: CurrentThemeIconProps) {
  const { theme } = useTheme();
  return <ThemeIcon theme={theme} className={className} />;
}

const useThemeOptions = () => {
  const { t } = useLanguage();

  return THEME_OPTIONS.map((value) => ({
    value,
    label: t(THEME_OPTION_LABEL_KEYS[value]),
  }));
};

type ThemeSelectProps = {
  triggerClassName?: string;
};

export function ThemeSelect({ triggerClassName }: ThemeSelectProps) {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const options = useThemeOptions();

  return (
    <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={t("common.select")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ThemeDropdownToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const options = useThemeOptions();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title={t("settings.theme")}>
          <ThemeIcon theme={theme} className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{t("settings.theme")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
          >
            <ThemeIcon
              theme={option.value}
              className="text-muted-foreground h-4 w-4"
            />
            <span className="flex-1">{option.label}</span>
            <Check
              className={cn(
                "ml-2 h-4 w-4",
                theme === option.value ? "opacity-100" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
