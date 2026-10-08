import React from "react";
import { Check, Edit3, PenTool, Undo2, X } from "lucide-react";
import {
  useEditorEventBus,
  useEditorTabIsActive,
} from "@/app/editorTabs/context";
import { useAppEvent } from "@/hooks/useAppEventBus";
import type { AppEventMap } from "@/lib/eventBus";
import { canUseModeWithPdfPermissions } from "@/lib/pdfPermissions";
import type { EditorState, PageFlowDirection, PageLayoutMode } from "@/types";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import PageNumberDropdownControl from "./PageNumberDropdownControl";
import PageSettingsDropdownControl from "./PageSettingsDropdownControl";
import { useToolOptions } from "./ToolOptions";
import type {
  ToolOptionsState,
  FloatingToolbarCommands,
  ResponsiveToolbarItem,
} from "./types";
import { ResponsiveToolbar } from "./ResponsiveToolbar";
import { ToolPicker } from "./ToolPicker";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import { isShapeTool } from "./shapeTools";

interface FloatingBarProps {
  commands: FloatingToolbarCommands;
  state: ToolOptionsState &
    Pick<
      EditorState,
      "mode" | "documentLoadState" | "documentPermissions" | "keys"
    >;
  isMobile: boolean;
  currentPageIndex: number;
  pageCount: number;
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
  isFullscreen: boolean;
  onNavigatePage: (pageIndex: number) => void;
  onPageLayoutChange: (layout: PageLayoutMode) => void;
  onPageFlowChange: (flow: PageFlowDirection) => void;
  onToggleFullscreen: () => void;
  onOverlayInsetChange?: (inset: number) => void;
}

function ActiveFloatingBar({
  commands,
  state,
  isMobile,
  currentPageIndex,
  pageCount,
  pageLayout,
  pageFlow,
  isFullscreen,
  onNavigatePage,
  onPageLayoutChange,
  onPageFlowChange,
  onToggleFullscreen,
  onOverlayInsetChange,
}: FloatingBarProps) {
  const { t } = useLanguage();
  const events = useEditorEventBus();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = React.useState(Infinity);
  React.useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setAvailableWidth(width);
      onOverlayInsetChange?.(
        Math.ceil(
          element.getBoundingClientRect().height +
            (parseFloat(getComputedStyle(element).bottom) || 24),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onOverlayInsetChange]);
  const [pageMenuOpen, setPageMenuOpen] = React.useState(false);
  const [pageSettingsOpen, setPageSettingsOpen] = React.useState(false);
  const [modeMenuOpen, setModeMenuOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<
    AppEventMap["workspace:shapeDraftStateChange"]
  >({ active: false, tool: null, canFinish: false });
  useAppEvent("workspace:shapeDraftStateChange", setDraft, {
    replayLast: true,
  });
  useAppEvent("workspace:pointerDown", () => {
    setPageMenuOpen(false);
    setPageSettingsOpen(false);
    setModeMenuOpen(false);
  });
  const defaultTool = isMobile
    ? "pan"
    : state.documentLoadState === "ready"
      ? "select"
      : "select_text";
  const hasToolContext = state.tool !== defaultTool && !state.keys.space;
  const { Icon, labelKey } = TOOL_DEFINITIONS[state.tool];
  const compact = isMobile || availableWidth < 480;
  const toolOptions = useToolOptions({ state, commands });
  React.useLayoutEffect(() => {
    setPageMenuOpen(false);
    setPageSettingsOpen(false);
    setModeMenuOpen(false);
  }, [availableWidth, state.tool]);
  const items: ResponsiveToolbarItem[] = [
    {
      id: "page",
      label: t("toolbar.page"),
      pinned: true,
      content: (
        <PageNumberDropdownControl
          currentPageIndex={currentPageIndex}
          pageCount={pageCount}
          compact={compact}
          open={pageMenuOpen}
          onOpenChange={setPageMenuOpen}
          onNavigatePage={onNavigatePage}
        />
      ),
    },
    {
      id: "page-settings",
      label: t("toolbar.page_settings"),
      content: (
        <PageSettingsDropdownControl
          pageLayout={pageLayout}
          pageFlow={pageFlow}
          isFullscreen={isFullscreen}
          side="top"
          align="center"
          sideOffset={12}
          triggerClassName="sm:h-8 sm:w-8"
          open={pageSettingsOpen}
          onOpenChange={setPageSettingsOpen}
          onPageLayoutChange={onPageLayoutChange}
          onPageFlowChange={onPageFlowChange}
          onToggleFullscreen={onToggleFullscreen}
        />
      ),
    },
  ];
  if (isMobile) {
    items.push({
      id: "mode",
      label: t("mode.select"),
      content: (
        <DropdownMenu
          modal={false}
          open={modeMenuOpen}
          onOpenChange={setModeMenuOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={t("mode.select")}
              aria-label={t("mode.select")}
            >
              {state.mode === "annotation" ? (
                <PenTool size={16} />
              ) : (
                <Edit3 size={16} />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" sideOffset={12}>
            <DropdownMenuRadioGroup
              value={state.mode}
              onValueChange={(mode) =>
                commands.changeMode(mode as EditorState["mode"])
              }
            >
              {(["annotation", "form"] as const).map((mode) => (
                <DropdownMenuRadioItem
                  key={mode}
                  value={mode}
                  disabled={
                    state.documentLoadState !== "ready" ||
                    !canUseModeWithPdfPermissions(
                      mode,
                      state.documentPermissions,
                    )
                  }
                >
                  {t("mode." + mode)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    });
  }
  if (isMobile || hasToolContext) {
    items.push({
      id: "tool",
      label: t(labelKey),
      pinned: true,
      content: (
        <div className="flex items-center gap-1">
          <Separator
            orientation="vertical"
            className={
              compact
                ? "hidden"
                : "mx-1 h-5 data-[orientation=vertical]:self-center"
            }
          />
          {isMobile || isShapeTool(state.tool) ? (
            <ToolPicker
              state={state}
              compact={compact}
              shapesOnly={!isMobile}
              onToolChange={commands.changeTool}
            />
          ) : (
            <span className="flex shrink-0 items-center gap-1.5 px-2 text-sm">
              <Icon size={16} />
              {!compact && t(labelKey)}
            </span>
          )}
        </div>
      ),
    });
  }
  if (hasToolContext) {
    items.push(...toolOptions);
    if (draft.active && draft.tool === state.tool) {
      items.push({
        id: "draft",
        label: t(labelKey),
        content: (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={t("toolbar.cancel_drawing")}
              aria-label={t("toolbar.cancel_drawing")}
              onClick={() => events.emit("workspace:cancelShapeDraft", {})}
            >
              <Undo2 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!draft.canFinish}
              title={t("common.actions.done")}
              aria-label={t("common.actions.done")}
              onClick={() => events.emit("workspace:finishShapeDraft", {})}
            >
              <Check size={16} />
            </Button>
          </div>
        ),
      });
    }
    items.push({
      id: "exit",
      label: t("toolbar.exit_tool"),
      pinned: true,
      content: (
        <div className="flex items-center gap-1">
          <Separator
            orientation="vertical"
            className="mx-1 h-5 shrink-0 data-[orientation=vertical]:self-center"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title={t("toolbar.exit_tool") + " · Esc"}
            aria-label={t("toolbar.exit_tool")}
            onClick={commands.exitTool}
          >
            <X size={16} />
          </Button>
        </div>
      ),
    });
  }
  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute right-3 left-3 z-40 flex justify-center"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
      data-tool-context={hasToolContext ? state.tool : undefined}
    >
      <ResponsiveToolbar
        key={state.tool}
        items={items}
        availableWidth={availableWidth}
      />
    </div>
  );
}

// Tear down only transient toolbar popovers when a document is hidden.
// The document's store, canvas and remembered tool styles stay mounted.
export default function FloatingBar(props: FloatingBarProps) {
  return useEditorTabIsActive() ? <ActiveFloatingBar {...props} /> : null;
}
