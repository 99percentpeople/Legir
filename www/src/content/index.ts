import type { Language } from "@/components/language-provider";
import type { LandingCopy } from "./types";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { zhCN } from "./zh-CN";
import { zhTW } from "./zh-TW";

// Small, website-only dictionaries: no changes to the editor's translation keys.
export const landingCopy: Record<Exclude<Language, "system">, LandingCopy> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  fr,
  de,
  es,
};

export function getLandingCopy(language: string): LandingCopy {
  return Object.prototype.hasOwnProperty.call(landingCopy, language)
    ? landingCopy[language as keyof typeof landingCopy]
    : en;
}
