import {
  BACKGROUND_COMMON_COLORS,
  FOREGROUND_COMMON_COLORS,
  PEN_COLORS,
} from "@/constants";

const COLOR_PALETTE_STORAGE_KEY = "app-color-palette-history";
const COLOR_PALETTE_CHANGE_EVENT = "app-color-palette-history-change";
const MAX_RECENT_COLORS = 24;
export const COLOR_PALETTE_COMMON_ROW_SIZE = 6;
export const COLOR_PALETTE_RECENT_ROW_SIZE = 6;

export type ColorPaletteType = "foreground" | "background";

type StoredColorPaletteState = {
  recentColors: string[];
};

export type ColorPaletteRows = {
  commonColors: string[];
  recentColors: string[];
  expandedColors: string[];
  customColor: string;
};

const FALLBACK_CUSTOM_COLOR = "#000000";
const DEFAULT_PALETTE_COLORS = PEN_COLORS.map((color) =>
  normalizePaletteColor(color),
).filter((color): color is string => Boolean(color));

const DEFAULT_COMMON_COLORS: Record<ColorPaletteType, readonly string[]> = {
  foreground: FOREGROUND_COMMON_COLORS,
  background: BACKGROUND_COMMON_COLORS,
};

const createEmptyState = (): StoredColorPaletteState => ({
  recentColors: [],
});

export function normalizePaletteColor(color: string | null | undefined) {
  if (typeof color !== "string") return null;

  const trimmed = color.trim().toLowerCase();
  const shortHexMatch = /^#([0-9a-f]{3})$/.exec(trimmed);
  if (shortHexMatch) {
    return `#${shortHexMatch[1]
      .split("")
      .map((segment) => `${segment}${segment}`)
      .join("")}`;
  }

  if (/^#([0-9a-f]{6})$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

const dedupeColors = (colors: ReadonlyArray<string | null | undefined>) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const color of colors) {
    const next = normalizePaletteColor(color);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    normalized.push(next);
  }

  return normalized;
};

const normalizeStoredState = (value: unknown): StoredColorPaletteState => {
  if (!value || typeof value !== "object") return createEmptyState();

  const state = value as Partial<StoredColorPaletteState> & {
    recentColorsByType?: Partial<Record<ColorPaletteType, string[]>>;
  };
  const legacyRecentColors = dedupeColors([
    ...(state.recentColorsByType?.foreground ?? []),
    ...(state.recentColorsByType?.background ?? []),
  ]);

  return {
    recentColors: dedupeColors(state.recentColors ?? legacyRecentColors).slice(
      0,
      MAX_RECENT_COLORS,
    ),
  };
};

export const readColorPaletteState = (): StoredColorPaletteState => {
  if (typeof window === "undefined") return createEmptyState();

  try {
    const raw = window.localStorage.getItem(COLOR_PALETTE_STORAGE_KEY);
    if (!raw) return createEmptyState();
    return normalizeStoredState(JSON.parse(raw));
  } catch {
    return createEmptyState();
  }
};

const writeColorPaletteState = (state: StoredColorPaletteState) => {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(COLOR_PALETTE_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(COLOR_PALETTE_CHANGE_EVENT));
};

export const recordPaletteColorSelection = (color: string) => {
  const normalizedColor = normalizePaletteColor(color);
  if (!normalizedColor) return;

  const current = readColorPaletteState();
  const recentColors = [
    normalizedColor,
    ...current.recentColors.filter((item) => item !== normalizedColor),
  ].slice(0, MAX_RECENT_COLORS);

  writeColorPaletteState({
    recentColors,
  });
};

export const subscribeToColorPaletteState = (listener: () => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === COLOR_PALETTE_STORAGE_KEY) {
      listener();
    }
  };

  window.addEventListener(
    COLOR_PALETTE_CHANGE_EVENT,
    listener as EventListener,
  );
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(
      COLOR_PALETTE_CHANGE_EVENT,
      listener as EventListener,
    );
    window.removeEventListener("storage", handleStorage);
  };
};

export const getColorPaletteRows = (
  currentColor: string | null | undefined,
  paletteType: ColorPaletteType,
): ColorPaletteRows => {
  const state = readColorPaletteState();
  const commonColors = dedupeColors(DEFAULT_COMMON_COLORS[paletteType]).slice(
    0,
    COLOR_PALETTE_COMMON_ROW_SIZE,
  );

  const commonColorSet = new Set(commonColors);
  const recentColors = dedupeColors(state.recentColors)
    .filter((color) => !commonColorSet.has(color))
    .slice(0, COLOR_PALETTE_RECENT_ROW_SIZE);

  const collapsedColors = new Set([...commonColors, ...recentColors]);
  const expandedColors = DEFAULT_PALETTE_COLORS.filter(
    (color) => !collapsedColors.has(color),
  );

  return {
    commonColors,
    recentColors,
    expandedColors,
    customColor:
      normalizePaletteColor(currentColor) ??
      recentColors[0] ??
      commonColors[0] ??
      FALLBACK_CUSTOM_COLOR,
  };
};
