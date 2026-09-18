import { useState, type Dispatch, type ReactNode } from "react";
import {
  ChevronDown,
  CircleDot,
  Edit3,
  Eraser,
  Hand,
  Highlighter,
  Keyboard,
  List,
  MessageCircle,
  MousePointer2,
  PanelLeft,
  PanelRight,
  PenLine,
  PenTool,
  Redo2,
  Search,
  Settings,
  Shapes,
  SquareCheck,
  Stamp,
  Type,
  Undo2,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import ZoomDropdownControl from "@/components/toolbar/ZoomDropdownControl";
import PageSettingsDropdownControl from "@/components/toolbar/PageSettingsDropdownControl";
import SaveMenu from "@/components/toolbar/SaveMenu";
import { pdfViewerScaleToWorkspaceScale } from "@/lib/pdfScale";
import { ANNOTATION_STYLES } from "@/constants";
import { getContrastColor } from "@/utils/colors";
import { cn } from "@/utils/cn";
import type { DemoAction, DemoState, Tool } from "./types";

function ToolButton({
  label,
  children,
  onClick,
  active,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 w-8 sm:h-9 sm:w-9",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </Button>
  );
}
type Props = {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
  compact: boolean;
  onOpenApp: () => void;
  onToggleFullscreen: () => void;
  fullscreen: boolean;
};

/** Layout follows Toolbar.tsx. Zoom, color and save menus are the real components. */
export function DemoToolbar({
  state,
  dispatch,
  compact,
  onOpenApp,
  onToggleFullscreen,
  fullscreen,
}: Props) {
  const { t } = useLanguage();
  const [zoomOpen, setZoomOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  const [colors, setColors] = useState<Record<string, string>>({
    draw_ink: ANNOTATION_STYLES.ink.color,
    draw_comment: ANNOTATION_STYLES.comment.color,
    draw_freetext: ANNOTATION_STYLES.freetext.color,
  });
  const [widths, setWidths] = useState<Record<string, number>>({
    draw_ink: 2,
    draw_highlight: 12,
  });
  const [opacities, setOpacities] = useState<Record<string, number>>({
    draw_ink: 1,
    draw_highlight: 0.4,
  });
  const formMode = state.editorMode === "form";
  function selectTool(tool: Tool) {
    dispatch({ type: "tool", tool });
    if (tool === "draw_highlight") {
      dispatch({ type: "page", page: 1 });
      if (!state.highlighted) dispatch({ type: "highlight" });
    }
    if (tool === "eraser" && state.highlighted) dispatch({ type: "highlight" });
    if (tool === "draw_comment")
      dispatch({ type: "sidebar", view: "annotations" });
    if (tool === "draw_text") dispatch({ type: "select-field", field: "name" });
    if (tool === "draw_checkbox")
      dispatch({ type: "select-field", field: "reviewed" });
  }
  const tool = (value: Tool, label: string, icon: ReactNode) => (
    <ToggleGroupItem
      key={value}
      value={value}
      title={t(label)}
      aria-label={t(label)}
      className="h-8 w-8 p-0 sm:h-9 sm:w-9"
    >
      {icon}
    </ToggleGroupItem>
  );
  function colorTool(
    value: Tool,
    key: string,
    icon: ReactNode,
    propertyKey: string,
  ) {
    const color =
      value === "draw_highlight" ? state.highlightColor : colors[value];
    return (
      <div key={value} className="flex items-center gap-0">
        <ToggleGroupItem
          value={value}
          title={t(key)}
          aria-label={t(key)}
          className="h-8 w-8 rounded-r-none p-0 sm:h-9 sm:w-9"
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-black/10 shadow-sm dark:border-white/10"
            style={{ backgroundColor: color, color: getContrastColor(color) }}
          >
            {icon}
          </span>
        </ToggleGroupItem>
        <ColorPickerPopover
          paletteType={
            value === "draw_highlight" || value === "draw_comment"
              ? "background"
              : "foreground"
          }
          color={color}
          title={t(propertyKey)}
          isActive={state.tool === value}
          thickness={widths[value]}
          opacity={opacities[value]}
          onColorChange={(next) =>
            value === "draw_highlight"
              ? dispatch({ type: "highlight-color", color: next })
              : setColors((previous) => ({ ...previous, [value]: next }))
          }
          onThicknessChange={(next) =>
            setWidths((previous) => ({ ...previous, [value]: next }))
          }
          onOpacityChange={(next) =>
            setOpacities((previous) => ({ ...previous, [value]: next }))
          }
        />
      </div>
    );
  }
  const editTools = (
    <ToggleGroup
      type="single"
      value={state.tool}
      onValueChange={(value) => value && selectTool(value as Tool)}
      spacing={1}
      className="sm:bg-muted/20 mx-auto flex min-w-max items-center gap-1 rounded-lg p-1 sm:shadow-sm"
    >
      {tool("pan", "toolbar.pan", <Hand size={18} />)}
      {tool("select", "toolbar.select", <MousePointer2 size={18} />)}
      {!formMode && tool("eraser", "toolbar.eraser", <Eraser size={18} />)}
      <Separator orientation="vertical" className="mx-1 h-5" />
      {formMode ? (
        <>
          {tool("draw_text", "toolbar.text", <Type size={18} />)}
          {tool("draw_checkbox", "toolbar.checkbox", <SquareCheck size={18} />)}
          {tool("draw_radio", "toolbar.radio", <CircleDot size={18} />)}
          {tool("draw_dropdown", "toolbar.dropdown", <List size={18} />)}
          {tool("draw_signature", "toolbar.signature", <PenLine size={18} />)}
        </>
      ) : (
        <>
          {colorTool(
            "draw_highlight",
            "toolbar.highlight",
            <Highlighter size={14} />,
            "toolbar.highlight_free_properties",
          )}
          {colorTool(
            "draw_ink",
            "toolbar.ink",
            <PenLine size={14} />,
            "toolbar.ink_properties",
          )}
          {colorTool(
            "draw_comment",
            "toolbar.comment",
            <MessageCircle size={14} />,
            "toolbar.comment_properties",
          )}
          {colorTool(
            "draw_freetext",
            "toolbar.freetext",
            <Type size={14} />,
            "toolbar.freetext_properties",
          )}
          {tool("draw_stamp", "toolbar.stamp", <Stamp size={18} />)}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-5"
            title={t("toolbar.stamp_properties")}
            onClick={() => selectTool("draw_stamp")}
          >
            <ChevronDown size={12} />
          </Button>
          {tool("draw_shape_rect", "toolbar.shape", <Shapes size={18} />)}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-5"
            title={t("toolbar.shape_properties")}
            onClick={() => selectTool("draw_shape_rect")}
          >
            <ChevronDown size={12} />
          </Button>
        </>
      )}
    </ToggleGroup>
  );
  return (
    <div className="demo-toolbar" role="toolbar" aria-label={t("toolbar.view")}>
      <div className="flex shrink-0 items-center gap-2">
        <ToolButton
          label={t("toolbar.toggle_sidebar")}
          active={state.sidebar}
          onClick={() => dispatch({ type: "sidebar" })}
        >
          <PanelLeft size={20} />
        </ToolButton>
        <div className="flex items-center gap-1">
          <ToolButton
            label={t("toolbar.undo")}
            disabled={!state.past.length}
            onClick={() => dispatch({ type: "undo" })}
          >
            <Undo2 size={20} />
          </ToolButton>
          <ToolButton
            label={t("toolbar.redo")}
            disabled={!state.future.length}
            onClick={() => dispatch({ type: "redo" })}
          >
            <Redo2 size={20} />
          </ToolButton>
          <ToolButton
            label={t("toolbar.search_pdf")}
            active={state.sidebarView === "search" && state.sidebar}
            onClick={() => dispatch({ type: "sidebar", view: "search" })}
          >
            <Search size={20} />
          </ToolButton>
        </div>
        <Separator orientation="vertical" className="h-7" />
        <ZoomDropdownControl
          compact={compact}
          scale={pdfViewerScaleToWorkspaceScale(state.zoom / 100)}
          open={zoomOpen}
          onOpenChange={setZoomOpen}
          onZoomIn={() => dispatch({ type: "zoom", delta: state.zoom * 0.25 })}
          onZoomOut={() => dispatch({ type: "zoom", delta: -state.zoom * 0.2 })}
          onFitWidth={() => dispatch({ type: "fit", fit: "width" })}
          onFitScreen={() => dispatch({ type: "fit" })}
        />
        {!compact && (
          <DropdownMenu
            modal={false}
            open={modeOpen}
            onOpenChange={setModeOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 h-9 w-9"
                title={t("mode.select")}
                aria-label={t("mode.select")}
              >
                {formMode ? <Edit3 size={16} /> : <PenTool size={16} />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={state.editorMode}
                onValueChange={(value) =>
                  dispatch({
                    type: "editor-mode",
                    mode: value as DemoState["editorMode"],
                  })
                }
              >
                <DropdownMenuRadioItem value="annotation">
                  <PenTool size={14} />
                  {t("mode.annotation")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="form">
                  <Edit3 size={14} />
                  {t("mode.form")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {!compact && (
        <div className="demo-tools-center">
          <div className="no-scrollbar flex w-full overflow-x-auto px-1">
            {editTools}
          </div>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1">
          {compact && (
            <PageSettingsDropdownControl
              pageLayout={state.layout}
              pageFlow={state.flow}
              isFullscreen={fullscreen}
              open={pageOpen}
              onOpenChange={setPageOpen}
              onPageLayoutChange={(layout) =>
                dispatch({ type: "layout", layout })
              }
              onPageFlowChange={(flow) => dispatch({ type: "flow", flow })}
              onToggleFullscreen={onToggleFullscreen}
            />
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 sm:h-9 sm:w-9"
                title={t("toolbar.settings")}
              >
                <Settings size={20} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={onOpenApp}>
                {t("toolbar.settings")} ↗
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => dispatch({ type: "reset" })}>
                {t("common.actions.reset_to_default")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!compact && (
            <>
              <ToolButton label={t("toolbar.shortcuts")} onClick={onOpenApp}>
                <Keyboard size={20} />
              </ToolButton>
              <ToolButton
                label={t("toolbar.toggle_properties")}
                active={!!state.panel}
                onClick={() =>
                  dispatch({
                    type: "panel",
                    panel: state.panel ? null : "document",
                  })
                }
              >
                <PanelRight size={20} />
              </ToolButton>
            </>
          )}
        </div>
        <SaveMenu
          disabled={false}
          isDirty={state.dirty}
          hasSaveAs={false}
          canPrint={false}
          onPrimary={async () => {
            dispatch({ type: "save" });
            return true;
          }}
          onSaveAs={async () => false}
          onExit={onOpenApp}
          onPrint={onOpenApp}
          onClose={onOpenApp}
        />
      </div>
    </div>
  );
}
