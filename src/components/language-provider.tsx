
import React, { createContext, useContext, useEffect, useState } from "react"
import en from '../locales/en';
import zh from '../locales/zh';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);

export type Language = "en" | "zh"

type LanguageProviderProps = {
  children: React.ReactNode
  defaultLanguage?: Language
  storageKey?: string
}

type LanguageProviderState = {
  language: Language
  dayjsLocale: string
  setLanguage: (language: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const initialState: LanguageProviderState = {
  language: "en",
  dayjsLocale: "en",
  setLanguage: () => null,
  t: (key: string) => key,
}

const translations: Record<Language, Record<string, string>> = {
  en,
  zh
}

const DAYJS_LOCALE_MAP: Record<Language, string> = {
  en: 'en',
  zh: 'zh-cn'
}

const LanguageProviderContext = createContext<LanguageProviderState>(initialState)

export function LanguageProvider({
  children,
  defaultLanguage = "en",
  storageKey = "vite-ui-language",
  ...props
}: LanguageProviderProps) {
  const [language, setLanguage] = useState<Language>(
    () => (localStorage.getItem(storageKey) as Language) || defaultLanguage
  )

  const dayjsLocale = DAYJS_LOCALE_MAP[language];

  useEffect(() => {
    localStorage.setItem(storageKey, language);
    dayjs.locale(dayjsLocale);
  }, [language, storageKey, dayjsLocale])

  const t = (key: string, params?: Record<string, string | number>) => {
    let text = translations[language][key] || key;
    if (params) {
        Object.entries(params).forEach(([k, v]) => {
            text = text.replace(`{${k}}`, String(v));
        });
    }
    return text;
  }

  const value = {
    language,
    dayjsLocale,
    setLanguage,
    t,
  }

  return (
    <LanguageProviderContext.Provider {...props} value={value}>
      {children}
    </LanguageProviderContext.Provider>
  )
}

export const useLanguage = () => {
  const context = useContext(LanguageProviderContext)

  if (context === undefined)
    throw new Error("useLanguage must be used within a LanguageProvider")

  return context
}