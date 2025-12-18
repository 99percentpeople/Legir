import React, { createContext, useContext, useEffect, useState } from "react";
import en from "../locales/en";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import localizedFormat from "dayjs/plugin/localizedFormat";

dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

export type Language =
  | "en"
  | "zh-CN"
  | "zh-TW"
  | "ja"
  | "fr"
  | "de"
  | "es"
  | "system";
type ConcreteLanguage = Exclude<Language, "system">;

export const LANGUAGES: { value: ConcreteLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ja", label: "日本語" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
];

type LanguageProviderProps = {
  children: React.ReactNode;
  defaultLanguage?: Language;
  storageKey?: string;
};

type LanguageProviderState = {
  language: Language;
  effectiveLanguage: ConcreteLanguage;
  dayjsLocale: string;
  isCjk: boolean;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const initialState: LanguageProviderState = {
  language: "system",
  effectiveLanguage: "en",
  dayjsLocale: "en",
  isCjk: false,
  setLanguage: () => null,
  t: (key: string) => key,
};

// Map locale codes to dayjs locale strings
const DAYJS_LOCALE_MAP: Record<ConcreteLanguage, string> = {
  en: "en",
  "zh-CN": "zh-cn",
  "zh-TW": "zh-tw",
  ja: "ja",
  fr: "fr",
  de: "de",
  es: "es",
};

// Explicitly map dayjs loaders to ensure Vite can bundle them correctly
const dayjsLocales: Record<string, () => Promise<any>> = {
  "zh-cn": () => import("dayjs/locale/zh-cn"),
  "zh-tw": () => import("dayjs/locale/zh-tw"),
  ja: () => import("dayjs/locale/ja"),
  fr: () => import("dayjs/locale/fr"),
  de: () => import("dayjs/locale/de"),
  es: () => import("dayjs/locale/es"),
};

// Use import.meta.glob to lazy load locales
const localeModules = import.meta.glob("../locales/*.ts", { eager: false });

const LanguageProviderContext =
  createContext<LanguageProviderState>(initialState);

export function LanguageProvider({
  children,
  defaultLanguage = "system",
  storageKey = "ff-ui-language",
  ...props
}: LanguageProviderProps) {
  const [language, setLanguage] = useState<Language>(
    () => (localStorage.getItem(storageKey) as Language) || defaultLanguage,
  );

  const [effectiveLanguage, setEffectiveLanguage] =
    useState<ConcreteLanguage>("en");

  // Store loaded translations
  const [translations, setTranslations] = useState<
    Record<string, Record<string, string>>
  >({ en });

  useEffect(() => {
    const resolveSystemLanguage = (): ConcreteLanguage => {
      const browserLang = navigator.language;
      if (browserLang.startsWith("zh")) {
        if (browserLang.includes("TW") || browserLang.includes("HK"))
          return "zh-TW";
        return "zh-CN";
      }
      if (browserLang.startsWith("ja")) return "ja";
      if (browserLang.startsWith("fr")) return "fr";
      if (browserLang.startsWith("de")) return "de";
      if (browserLang.startsWith("es")) return "es";
      return "en";
    };

    const loadLocale = async (lang: ConcreteLanguage) => {
      if (lang === "en") return; // en is already loaded
      if (translations[lang]) return; // already loaded

      try {
        // Construct the key that matches import.meta.glob keys
        const modulePath = `../locales/${lang}.ts`;
        const loader = localeModules[modulePath];
        if (loader) {
          const mod = (await loader()) as { default: Record<string, string> };
          setTranslations((prev) => ({ ...prev, [lang]: mod.default }));
        } else {
          console.warn(`No loader found for locale: ${lang}`);
        }
      } catch (error) {
        console.error(`Failed to load locale: ${lang}`, error);
      }
    };

    const loadDayjsLocale = async (lang: ConcreteLanguage) => {
      if (lang === "en") {
        dayjs.locale("en");
        return;
      }
      const dayjsLocaleKey = DAYJS_LOCALE_MAP[lang];
      if (!dayjsLocaleKey) return;

      try {
        const loader = dayjsLocales[dayjsLocaleKey];
        if (loader) {
          await loader();
          dayjs.locale(dayjsLocaleKey);
        } else {
          console.warn(`No dayjs loader found for ${dayjsLocaleKey}`);
          // Fallback to en if loader missing
          dayjs.locale("en");
        }
      } catch (e) {
        console.warn(`Failed to load dayjs locale: ${dayjsLocaleKey}`, e);
        dayjs.locale("en");
      }
    };

    const resolved =
      language === "system"
        ? resolveSystemLanguage()
        : (language as ConcreteLanguage);

    // Ensure we have a valid resolved language
    const isSupported = LANGUAGES.some((l) => l.value === resolved);
    const validated = isSupported ? resolved : "en";

    // Load resources
    loadLocale(validated).then(() => {
      setEffectiveLanguage(validated);

      // Update HTML lang attribute
      const root = window.document.documentElement;
      root.setAttribute("lang", validated);

      // Load Dayjs locale
      loadDayjsLocale(validated);
    });
  }, [language, translations]);

  useEffect(() => {
    localStorage.setItem(storageKey, language);
  }, [language, storageKey]);

  const t = (key: string, params?: Record<string, string | number>) => {
    const langDict = translations[effectiveLanguage] || translations["en"];
    let text = langDict[key] || translations["en"][key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };

  const value = {
    language,
    effectiveLanguage,
    dayjsLocale: DAYJS_LOCALE_MAP[effectiveLanguage],
    isCjk:
      effectiveLanguage === "zh-CN" ||
      effectiveLanguage === "zh-TW" ||
      effectiveLanguage === "ja",
    setLanguage,
    t,
  };

  return (
    <LanguageProviderContext.Provider {...props} value={value}>
      {children}
    </LanguageProviderContext.Provider>
  );
}

export const useLanguage = () => {
  const context = useContext(LanguageProviderContext);

  if (context === undefined)
    throw new Error("useLanguage must be used within a LanguageProvider");

  return context;
};
