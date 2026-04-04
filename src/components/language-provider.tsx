import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import en from "../locales/en";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import localizedFormat from "dayjs/plugin/localizedFormat";

dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

export interface LocaleDict {
  [key: string]: string | LocaleDict;
}

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
  dayjsLocale: string | null;
  isCjk: boolean;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
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
const dayjsLocales: Record<string, () => Promise<unknown>> = {
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

const hasLabelString = (value: unknown): value is { label: string } =>
  !!value &&
  typeof value === "object" &&
  "label" in value &&
  typeof (value as { label?: unknown }).label === "string";

const LOCALE_DICT_CACHE_PREFIX = "app-locale-dict-cache:";
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

const resolveEffectiveLanguage = (language: Language): ConcreteLanguage => {
  const resolved =
    language === "system"
      ? resolveSystemLanguage()
      : (language as ConcreteLanguage);
  const isSupported = LANGUAGES.some((l) => l.value === resolved);
  return isSupported ? resolved : "en";
};

const readCachedDict = (lang: ConcreteLanguage): LocaleDict | null => {
  if (lang === "en") return null;
  try {
    const raw = localStorage.getItem(`${LOCALE_DICT_CACHE_PREFIX}${lang}`);
    if (!raw) return null;
    return JSON.parse(raw) as LocaleDict;
  } catch {
    return null;
  }
};

const writeCachedDict = (lang: ConcreteLanguage, dict: LocaleDict) => {
  if (lang === "en") return;
  try {
    localStorage.setItem(
      `${LOCALE_DICT_CACHE_PREFIX}${lang}`,
      JSON.stringify(dict),
    );
  } catch {
    // ignore
  }
};

export function LanguageProvider({
  children,
  defaultLanguage = "system",
  storageKey = "app-ui-language",
  ...props
}: LanguageProviderProps) {
  const [language, setLanguage] = useState<Language>(() => {
    return (localStorage.getItem(storageKey) as Language) || defaultLanguage;
  });

  const [effectiveLanguage, setEffectiveLanguage] = useState<ConcreteLanguage>(
    () => {
      const initialLanguage =
        (localStorage.getItem(storageKey) as Language) || defaultLanguage;
      return resolveEffectiveLanguage(initialLanguage);
    },
  );

  const [dayjsLocale, setDayjsLocale] = useState<string | null>("en");

  const refreshedLocaleRef = useRef<Set<ConcreteLanguage>>(new Set());

  // Store loaded translations
  const [translations, setTranslations] = useState<Record<string, LocaleDict>>(
    () => {
      const initialLanguage =
        (localStorage.getItem(storageKey) as Language) || defaultLanguage;
      const initialEffective = resolveEffectiveLanguage(initialLanguage);
      const cached = readCachedDict(initialEffective);
      return cached ? { en, [initialEffective]: cached } : { en };
    },
  );

  useEffect(() => {
    const loadLocale = async (lang: ConcreteLanguage, force?: boolean) => {
      if (lang === "en") return; // en is already loaded
      if (!force && translations[lang]) return; // already loaded

      try {
        // Construct the key that matches import.meta.glob keys
        const modulePath = `../locales/${lang}.ts`;
        const loader = localeModules[modulePath];
        if (loader) {
          const mod = (await loader()) as { default: LocaleDict };
          writeCachedDict(lang, mod.default);
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
        setDayjsLocale("en");
        return;
      }
      const dayjsLocaleKey = DAYJS_LOCALE_MAP[lang];
      if (!dayjsLocaleKey) {
        setDayjsLocale("en");
        return;
      }

      setDayjsLocale(null);

      try {
        const loader = dayjsLocales[dayjsLocaleKey];
        if (loader) {
          await loader();
          setDayjsLocale(dayjsLocaleKey);
        } else {
          console.warn(`No dayjs loader found for ${dayjsLocaleKey}`);
          // Fallback to en if loader missing
          setDayjsLocale("en");
        }
      } catch (e) {
        console.warn(`Failed to load dayjs locale: ${dayjsLocaleKey}`, e);
        setDayjsLocale("en");
      }
      // apply locale
      dayjs.locale(dayjsLocaleKey || "en");
    };

    const validated = resolveEffectiveLanguage(language);

    const shouldRefreshLocale =
      validated !== "en" && !refreshedLocaleRef.current.has(validated);
    if (validated !== "en") refreshedLocaleRef.current.add(validated);

    // Load resources
    loadLocale(validated, shouldRefreshLocale).then(() => {
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

  const resolveTranslation = (dict: LocaleDict, key: string) => {
    if (!dict) return undefined;

    const direct = dict[key];
    if (typeof direct === "string") return direct;
    if (hasLabelString(direct)) return direct.label;

    const parts = key.split(".").filter(Boolean);
    if (parts.length === 0) return undefined;

    let current: unknown = dict;
    for (const part of parts) {
      if (!current || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    if (typeof current === "string") return current;
    if (hasLabelString(current)) return current.label;
    return undefined;
  };

  const t = (key: string, params?: Record<string, unknown>) => {
    const langDict = translations[effectiveLanguage] || translations["en"];
    let text =
      resolveTranslation(langDict, key) ||
      resolveTranslation(translations["en"], key) ||
      key;
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
    dayjsLocale,
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
