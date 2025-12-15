import {
  CJK_FALLBACK_SANS_FONT_KEY,
  CJK_FALLBACK_SERIF_FONT_KEY,
  FONT_FAMILY_MAP,
} from "@/constants";

export const containsNonAscii = (s: string) => {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return true;
  }
  return false;
};

export const resolveFontStack = (fontKey?: string) => {
  const key = (fontKey || "Helvetica").trim();
  return FONT_FAMILY_MAP[key] || fontKey || "Helvetica";
};

export const isKnownFontKey = (fontKey?: string) => {
  if (!fontKey) return false;
  const key = fontKey.trim();
  return Object.prototype.hasOwnProperty.call(FONT_FAMILY_MAP, key);
};

export const isSerifFontKey = (fontKey?: string) => {
  const key = (fontKey || "").toLowerCase();
  if (key.includes("sans-serif")) return false;
  return key.includes("times") || key.includes("serif");
};

export const getCjkFallbackFontKeyForBase = (baseFontKey?: string) =>
  isSerifFontKey(baseFontKey)
    ? CJK_FALLBACK_SERIF_FONT_KEY
    : CJK_FALLBACK_SANS_FONT_KEY;

export type TextRun = { text: string; isAscii: boolean };

export const splitTextRuns = (s: string): TextRun[] => {
  if (!s) return [];

  const runs: TextRun[] = [];
  let buf = "";
  let bufIsAscii: boolean | null = null;

  const flush = () => {
    if (!buf || bufIsAscii === null) return;
    runs.push({ text: buf, isAscii: bufIsAscii });
    buf = "";
    bufIsAscii = null;
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const isAscii = ch.charCodeAt(0) <= 0x7f;

    if (bufIsAscii === null) {
      bufIsAscii = isAscii;
      buf = ch;
      continue;
    }

    if (isAscii === bufIsAscii) {
      buf += ch;
    } else {
      flush();
      bufIsAscii = isAscii;
      buf = ch;
    }
  }

  flush();
  return runs;
};

export const resolveFontStackWithCjkFallback = (fontKey?: string) => {
  const base = resolveFontStack(fontKey);
  const cjkKey = getCjkFallbackFontKeyForBase(fontKey);
  const fallback = FONT_FAMILY_MAP[cjkKey];
  if (!fallback) return base;
  if (base.includes(cjkKey)) return base;
  return `${base}, ${fallback}`;
};

export const resolveFontStackForDisplay = (fontKey?: string) => {
  // For imported/custom font-family strings, preserve the original look and do not
  // force-inject our CJK fallback (which can override the PDF's intended font).
  if (fontKey && !isKnownFontKey(fontKey)) return fontKey;
  return resolveFontStackWithCjkFallback(fontKey);
};

export const resolveCjkFallbackFontStack = (baseFontKey?: string) =>
  resolveFontStack(getCjkFallbackFontKeyForBase(baseFontKey));

export const resolveFormControlFontFamilyCss = (
  fontKey: string | undefined,
  displayedValue: string | undefined,
) => {
  return resolveFontStackWithCjkFallback(fontKey);
};
