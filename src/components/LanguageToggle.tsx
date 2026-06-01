import { Check, Languages } from "lucide-react";

import {
  LANGUAGES,
  useLanguage,
  type Language,
} from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils/cn";

type LanguageIconProps = {
  className?: string;
};

export function LanguageIcon({ className }: LanguageIconProps) {
  return <Languages className={className} />;
}

const useLanguageOptions = () => {
  const { t } = useLanguage();

  return [
    {
      value: "system" as const,
      label: t("settings.theme_options.system"),
    },
    ...LANGUAGES,
  ] satisfies { value: Language; label: string }[];
};

type LanguageSelectProps = {
  triggerClassName?: string;
};

export function LanguageSelect({ triggerClassName }: LanguageSelectProps) {
  const { language, setLanguage, t } = useLanguage();
  const options = useLanguageOptions();

  return (
    <Select
      value={language}
      onValueChange={(value) => setLanguage(value as Language)}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={t("common.select")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={options[0].value}>{options[0].label}</SelectItem>
        <SelectSeparator />
        {options.slice(1).map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LanguageDropdownToggle() {
  const { language, setLanguage, t } = useLanguage();
  const options = useLanguageOptions();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title={t("settings.language")}>
          <LanguageIcon className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{t("settings.language")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setLanguage(options[0].value)}>
          <span className="flex-1">{options[0].label}</span>
          <Check
            className={cn(
              "ml-2 h-4 w-4",
              language === options[0].value ? "opacity-100" : "opacity-0",
            )}
          />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.slice(1).map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setLanguage(option.value)}
          >
            <span className="flex-1">{option.label}</span>
            <Check
              className={cn(
                "ml-2 h-4 w-4",
                language === option.value ? "opacity-100" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
