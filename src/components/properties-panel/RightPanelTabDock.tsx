import React from "react";
import {
  BookA,
  FileText,
  Form,
  Languages,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useScrollbarWidthOffset } from "@/hooks/useScrollbarWidthOffset";
import { useLanguage } from "@/components/language-provider";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { appEventBus } from "@/lib/eventBus";

export type RightPanelTabId =
  | "document"
  | "properties"
  | "form_detect"
  | "translate"
  | "page_translate"
  | (string & {});

export interface RightPanelDockTab {
  id: RightPanelTabId;
  title: string;
  disabled?: boolean;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

export interface RightPanelTabDockProps {
  tabs?: RightPanelDockTab[];
  activeTabs: RightPanelTabId[];
  isRightPanelOpen: boolean;
  isFloating: boolean;
  rightOffsetPx: number;
  canOpenProperties: boolean;
  onSelectTab: (tab: RightPanelTabId) => void;
}

export function RightPanelTabDock({
  tabs,
  activeTabs,
  isRightPanelOpen: _isRightPanelOpen,
  isFloating,
  rightOffsetPx,
  canOpenProperties,
  onSelectTab,
}: RightPanelTabDockProps) {
  const { t, isCjk } = useLanguage();
  const [isSwitching, setIsSwitching] = React.useState(false);
  const switchingTimerRef = React.useRef<number | null>(null);
  const [scrollElement, setScrollElement] = React.useState<HTMLElement | null>(
    null,
  );

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      setScrollElement(element);
    },
    { replayLast: true },
  );

  const { scrollbarWidthPx } = useScrollbarWidthOffset({
    scrollElement,
    enabled: !isFloating,
  });

  React.useEffect(() => {
    return () => {
      if (switchingTimerRef.current != null) {
        window.clearTimeout(switchingTimerRef.current);
        switchingTimerRef.current = null;
      }
    };
  }, []);

  const handleSelectTab = React.useCallback(
    (tab: RightPanelTabId) => {
      if (tab === "translate") {
        appEventBus.emit("workspace:openTranslate", {
          sourceText: "",
          autoTranslate: false,
        });
        return;
      }

      onSelectTab(tab);

      setIsSwitching(true);
      if (switchingTimerRef.current != null) {
        window.clearTimeout(switchingTimerRef.current);
        switchingTimerRef.current = null;
      }
      switchingTimerRef.current = window.setTimeout(() => {
        setIsSwitching(false);
        switchingTimerRef.current = null;
      }, 150);
    },
    [onSelectTab],
  );

  const defaultTabs: RightPanelDockTab[] = [
    { id: "document", title: t("properties.document.title"), Icon: FileText },
    {
      id: "form_detect",
      title: t("right_panel.tabs.form_detect"),
      Icon: Form,
    },
    { id: "translate", title: t("translate.title"), Icon: Languages },
    {
      id: "page_translate",
      title: t("right_panel.tabs.page_translate"),
      Icon: BookA,
    },
    {
      id: "properties",
      title: t("right_panel.tabs.properties"),
      Icon: SlidersHorizontal,
      disabled: !canOpenProperties,
    },
  ];

  const resolvedTabs = (tabs ?? defaultTabs).map((t) =>
    t.id === "properties" ? { ...t, disabled: !canOpenProperties } : t,
  );

  const visibleTabs = resolvedTabs.filter((t) => {
    if (t.id === "properties" && !canOpenProperties) return false;
    return true;
  });

  return (
    <div
      className={cn(
        "bg-background/95 absolute top-3 z-30 flex flex-col gap-0.5 rounded-l-lg rounded-r-none border border-r-0 p-0.5 pr-0 shadow-lg backdrop-blur",
      )}
      style={{ right: rightOffsetPx + (isFloating ? 0 : scrollbarWidthPx) }}
    >
      {visibleTabs.map(({ id, title, disabled, Icon }) => {
        const isActive = activeTabs.includes(id);
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            title={title}
            onClick={() => handleSelectTab(id)}
            className={cn(
              "group grid w-8 grid-rows-[auto_auto] place-items-center rounded-l-md rounded-r-none py-2 transition-all duration-300",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              disabled ? "cursor-not-allowed opacity-40" : "hover:bg-muted",
              isActive ? "bg-muted text-foreground" : "text-muted-foreground",
            )}
          >
            <div
              className={cn(
                "grid self-start overflow-hidden transition-[grid-template-rows,opacity] duration-300",
                isActive
                  ? "grid-rows-[1fr] opacity-100"
                  : cn(
                      "grid-rows-[0fr] opacity-0",
                      !isSwitching &&
                        "group-hover:grid-rows-[1fr] group-hover:opacity-100",
                    ),
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <span
                  className={cn(
                    "block text-xs leading-none font-medium whitespace-nowrap",
                    isCjk ? null : "rotate-180",
                  )}
                  style={{
                    writingMode: "vertical-rl",
                    textOrientation: isCjk ? "mixed" : "sideways",
                  }}
                >
                  {title}
                </span>
                <div className="h-2"></div>
              </div>
            </div>
            <Icon
              size={18}
              className={cn("shrink-0 transition-transform duration-300")}
            />
          </button>
        );
      })}
    </div>
  );
}
