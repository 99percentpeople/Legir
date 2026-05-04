import { cn } from "@/utils/cn";

export const SETTINGS_TABS_ROOT_CLASS =
  "flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row";
export const SETTINGS_TABS_LIST_CLASS =
  "shrink-0 text-foreground h-auto w-full items-start justify-start gap-1 overflow-x-auto rounded-none bg-transparent py-1 sm:h-min sm:w-auto sm:flex-col sm:overflow-visible";
export const SETTINGS_TABS_CONTENT_CLASS =
  "min-h-0 grow overflow-y-auto rounded-md border p-4 py-4 text-start";

export const SETTINGS_TAB_TRIGGER_INDICATOR_CLASS =
  "data-[state=active]:after:bg-primary after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full sm:after:inset-y-0 sm:after:left-0 sm:after:h-full sm:after:w-0.5 sm:after:bottom-auto";

export const SETTINGS_TAB_TRIGGER_CLASS = cn(
  "relative min-w-max flex-none justify-start hover:bg-accent hover:text-foreground data-[state=active]:hover:bg-accent data-[state=active]:border-none data-[state=active]:bg-transparent data-[state=active]:shadow-none",
  SETTINGS_TAB_TRIGGER_INDICATOR_CLASS,
);

const SETTINGS_CARD_BASE_CLASS =
  "bg-muted/30 border-border flex flex-col rounded-lg border p-3";

export const SETTINGS_CARD_COMPACT_CLASS = `${SETTINGS_CARD_BASE_CLASS} space-y-2`;
export const SETTINGS_CARD_SPACIOUS_CLASS = `${SETTINGS_CARD_BASE_CLASS} space-y-4`;
export const SETTINGS_CARD_GAP_CLASS = `${SETTINGS_CARD_BASE_CLASS} gap-3`;
