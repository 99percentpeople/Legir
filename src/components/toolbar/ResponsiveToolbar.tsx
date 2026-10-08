import React from "react";
import { Ellipsis } from "lucide-react";
import {
  EditorTabActiveContext,
  useEditorTabIsActive,
} from "@/app/editorTabs/context";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { getToolbarOverflowIds } from "./toolbarOverflow";
import type { ResponsiveToolbarItem } from "./types";

export function ResponsiveToolbar({
  items,
  availableWidth,
}: {
  items: ResponsiveToolbarItem[];
  availableWidth: number;
}) {
  const { t } = useLanguage();
  const active = useEditorTabIsActive();
  const barRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLDivElement>(null);
  const [hiddenIds, setHiddenIds] = React.useState<string[]>([]);
  const [open, setOpen] = React.useState(false);
  useAppEvent("workspace:pointerDown", () => setOpen(false));
  React.useLayoutEffect(() => setOpen(false), [availableWidth]);
  const overflow = items.filter((item) => hiddenIds.includes(item.id));
  React.useLayoutEffect(() => {
    if (!overflow.length) setOpen(false);
  }, [overflow.length]);

  React.useLayoutEffect(() => {
    const bar = barRef.current;
    const more = moreRef.current;
    if (!bar || !more) return;
    const elements = Array.from(
      bar.querySelectorAll<HTMLElement>(":scope > [data-toolbar-item]"),
    );
    const measure = () => {
      const style = getComputedStyle(bar);
      const gap = parseFloat(style.columnGap) || 0;
      const frame = [
        style.paddingLeft,
        style.paddingRight,
        style.borderLeftWidth,
        style.borderRightWidth,
      ].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
      const elementById = new Map(
        elements.map((element) => [element.dataset.toolbarItem, element]),
      );
      const widths = items.map((item) => ({
        ...item,
        width: elementById.get(item.id)?.getBoundingClientRect().width ?? 0,
      }));
      // A zero-size, hidden document (or jsdom) cannot provide useful measurements.
      if (!widths.some((item) => item.width > 0)) return;
      const next = getToolbarOverflowIds(
        widths,
        availableWidth,
        more.getBoundingClientRect().width,
        gap,
        frame,
      );
      setHiddenIds((previous) =>
        previous.join("|") === next.join("|") ? previous : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    observer.observe(more);
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [items, availableWidth]);

  const hiddenStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    visibility: "hidden",
    pointerEvents: "none",
  };
  const renderItem = (item: ResponsiveToolbarItem) => {
    const hidden = hiddenIds.includes(item.id);
    return (
      <div
        key={item.id}
        data-toolbar-item={item.id}
        className="flex w-max shrink-0 items-center"
        style={hidden ? hiddenStyle : undefined}
        aria-hidden={hidden || undefined}
        inert={hidden || undefined}
      >
        {/* Keep natural widths measurable, but never leave a hidden portal open. */}
        <EditorTabActiveContext.Provider
          key={hidden ? "measure" : "inline"}
          value={active && !hidden}
        >
          {item.content}
        </EditorTabActiveContext.Provider>
      </div>
    );
  };
  const exit = items.find((item) => item.id === "exit");
  return (
    <div
      ref={barRef}
      className="editor-floating-toolbar bg-background/95 border-border/70 pointer-events-auto relative flex w-max max-w-full flex-nowrap items-center gap-1 rounded-xl border p-1 whitespace-nowrap shadow-xl backdrop-blur-md"
      data-app-block-modifier-wheel-zoom="1"
      data-editor-floating-toolbar
    >
      {items.filter((item) => item !== exit).map(renderItem)}
      <div
        ref={moreRef}
        data-toolbar-more
        className="flex w-max shrink-0"
        style={overflow.length ? undefined : hiddenStyle}
        aria-hidden={!overflow.length || undefined}
        inert={!overflow.length || undefined}
      >
        <Popover
          modal={false}
          open={open && overflow.length > 0}
          onOpenChange={setOpen}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t("toolbar.more_options")}
              title={t("toolbar.more_options")}
            >
              <Ellipsis size={16} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={12}
            collisionPadding={12}
            className="editor-floating-toolbar max-h-(--radix-popover-content-available-height) w-72 max-w-[calc(100vw-2rem)] overflow-y-auto p-2"
            data-toolbar-overflow
            data-app-block-modifier-wheel-zoom="1"
          >
            {overflow.map((item) => (
              <div
                key={item.id}
                data-overflow-item={item.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1"
              >
                <span className="min-w-0 text-sm wrap-break-word">
                  {item.label}
                </span>
                <div className="flex shrink-0 items-center">{item.content}</div>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      {exit && renderItem(exit)}
    </div>
  );
}
