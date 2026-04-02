import React, { useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  Type,
  CheckSquare,
  Undo2,
  Redo2,
  Keyboard,
  PanelLeft,
  PanelRight,
  List,
  CircleDot,
  Settings,
  PenLine,
  Highlighter,
  PenTool,
  Edit3,
  Eraser,
  Hand,
  Search,
  MessageCircle,
} from "lucide-react";
import {
  EditorState,
  PageFlowDirection,
  PageLayoutMode,
  PenStyle,
  Tool,
} from "@/types";
import { isToolMobileOnly } from "@/lib/tool-behavior";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { cn } from "@/utils/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { useLanguage } from "../language-provider";
import { ColorPickerPopover } from "./ColorPickerPopover";
import ZoomDropdownControl from "./ZoomDropdownControl";
import PageSettingsDropdownControl from "./PageSettingsDropdownControl";
import { ANNOTATION_STYLES } from "@/constants";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { getContrastColor } from "@/utils/colors";
import ExportMenu from "./ExportMenu";
import { canSaveAs, usePlatformUi } from "@/services/platform";
import { useEditorStore } from "@/store/useEditorStore";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  getShapeToolIcon,
  getShapeToolLabel,
  isShapeTool,
  SHAPE_TOOL_GROUPS,
  type ShapeTool,
} from "./shapeTools";

interface ToolbarProps {
  editorState: EditorState;
  isDirty?: boolean;
  hideModeSelector?: boolean;
  hideToolSection?: boolean;
  compactZoomControl?: boolean;
  showPageSettingsControl?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitScreen: () => void;
  onPageLayoutChange: (layout: PageLayoutMode) => void;
  onPageFlowChange: (flow: PageFlowDirection) => void;
  onToggleFullscreen: () => void;
  onToolChange: (tool: Tool) => void;
  onModeChange: (mode: EditorState["mode"]) => void;
  onPenStyleChange: (style: Partial<PenStyle>) => void;
  onHighlightStyleChange?: (style: Partial<PenStyle>) => void;
  onCommentStyleChange?: (style: { color: string }) => void;
  onFreetextStyleChange?: (style: { color: string }) => void;
  onShapeStyleChange?: (
    style: Partial<NonNullable<EditorState["shapeStyle"]>>,
  ) => void;
  onExport: () => Promise<boolean>;
  onSaveDraft: (silent?: boolean) => Promise<boolean>;
  onSaveAs: () => Promise<boolean>;
  onPrint: () => void;
  onExit: () => void;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onOpenShortcuts: () => void;
  onOpenSearch: () => void;
  isFieldListOpen: boolean;
  onToggleFieldList: () => void;
  isPropertiesPanelOpen: boolean;
  onTogglePropertiesPanel: () => void;
  onOpenSettings: () => void;
  isSearchOpen?: boolean;
}

const Toolbar: React.FC<ToolbarProps> = ({
  editorState,
  isDirty = false,
  hideModeSelector = false,
  hideToolSection = false,
  compactZoomControl = false,
  showPageSettingsControl = false,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitScreen,
  onPageLayoutChange,
  onPageFlowChange,
  onToggleFullscreen,
  onToolChange,
  onModeChange,
  onPenStyleChange,
  onHighlightStyleChange,
  onCommentStyleChange: onCommentStyleChange,
  onFreetextStyleChange: onFreetextStyleChange,
  onShapeStyleChange,
  onExport,
  onSaveDraft,
  onSaveAs,
  onPrint,
  onExit,
  onClose,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onOpenShortcuts,
  onOpenSearch,
  isFieldListOpen,
  onToggleFieldList,
  isPropertiesPanelOpen,
  onTogglePropertiesPanel,
  onOpenSettings,
  isSearchOpen = false,
}) => {
  const { t } = useLanguage();
  const { mode, tool } = editorState;
  const toolbarTool = isToolMobileOnly(tool) ? "select" : tool;
  const hasSaveAs = useRef(canSaveAs());
  const { documentSaveMode } = usePlatformUi();
  const tauri = documentSaveMode === "file";
  const liveScale = useEditorStore((state) => state.scale);
  const livePageLayout = useEditorStore((state) => state.pageLayout);
  const livePageFlow = useEditorStore((state) => state.pageFlow);
  const liveIsFullscreen = useEditorStore((state) => state.isFullscreen);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  const [shapePopoverOpen, setShapePopoverOpen] = useState(false);
  const [lastShapeTool, setLastShapeTool] = useState<ShapeTool>(() =>
    isShapeTool(tool) ? tool : "draw_shape_rect",
  );

  useEffect(() => {
    if (!isShapeTool(tool)) return;
    setLastShapeTool(tool);
  }, [tool]);

  const activeShapeTool = isShapeTool(tool) ? tool : lastShapeTool;
  const ActiveShapeIcon = getShapeToolIcon(activeShapeTool);
  const activeShapeLabel = getShapeToolLabel(t, activeShapeTool);

  const handleShapeToolSelect = (shapeTool: ShapeTool) => {
    setLastShapeTool(shapeTool);
    setShapePopoverOpen(false);
    onToolChange(shapeTool);
  };

  useAppEvent("workspace:pointerDown", () => {
    setZoomMenuOpen(false);
    setModeMenuOpen(false);
    setPageSettingsOpen(false);
    setShapePopoverOpen(false);
  });

  return (
    <div
      className={cn(
        "bg-background border-border text-foreground relative z-30 flex h-12 items-center gap-2 border-b px-2 sm:px-4",
        hideToolSection ? "justify-between" : "lg:justify-between",
      )}
      data-ff-block-modifier-wheel-zoom="1"
    >
      <div className="flex shrink-0 items-center gap-2 sm:gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleFieldList}
            className={cn(
              "h-8 w-8 sm:h-9 sm:w-9",
              isFieldListOpen && "bg-accent text-accent-foreground",
            )}
            title={t("toolbar.toggle_sidebar")}
          >
            <PanelLeft size={20} />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onUndo}
            disabled={!canUndo}
            className="h-8 w-8 sm:h-9 sm:w-9"
            title={t("toolbar.undo")}
          >
            <Undo2 size={20} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRedo}
            disabled={!canRedo}
            className="h-8 w-8 sm:h-9 sm:w-9"
            title={t("toolbar.redo")}
          >
            <Redo2 size={20} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSearch}
            disabled={editorState.pages.length === 0}
            className={cn(
              "h-8 w-8 sm:h-9 sm:w-9",
              isSearchOpen && "bg-accent text-accent-foreground",
            )}
            title={t("toolbar.search_pdf")}
          >
            <Search size={20} />
          </Button>
        </div>

        <Separator orientation="vertical" />

        <div className="flex items-center gap-1">
          <ZoomDropdownControl
            scale={liveScale}
            disabled={editorState.pages.length === 0}
            compact={compactZoomControl}
            open={zoomMenuOpen}
            onOpenChange={setZoomMenuOpen}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onFitWidth={onFitWidth}
            onFitScreen={onFitScreen}
          />

          {!hideModeSelector && (
            <>
              <DropdownMenu
                modal={false}
                open={modeMenuOpen}
                onOpenChange={setModeMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-2 h-8 w-8 sm:h-9 sm:w-9"
                    title={t("mode.select")}
                  >
                    {mode === "annotation" ? (
                      <PenTool size={16} />
                    ) : (
                      <Edit3 size={16} />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  data-ff-block-modifier-wheel-zoom="1"
                >
                  <DropdownMenuRadioGroup
                    value={mode}
                    onValueChange={onModeChange}
                  >
                    <DropdownMenuRadioItem value="annotation">
                      <div className="flex items-center gap-2">
                        <PenTool size={14} />
                        <span>{t("mode.annotation")}</span>
                      </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="form">
                      <div className="flex items-center gap-2">
                        <Edit3 size={14} />
                        <span>{t("mode.form")}</span>
                      </div>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {!hideToolSection && (
        <div className="flex min-w-0 flex-1 items-center justify-center xl:absolute xl:top-0 xl:left-1/2 xl:h-full xl:flex-none xl:-translate-x-1/2">
          <div className="no-scrollbar flex w-full overflow-x-auto px-1 xl:w-auto">
            {mode === "form" ? (
              <ToggleGroup
                type="single"
                value={editorState.keys.space ? "pan" : toolbarTool}
                onValueChange={(value) => {
                  if (value) onToolChange(value as Tool);
                }}
                className="sm:bg-muted/20 mx-auto flex min-w-max items-center gap-1 rounded-lg p-1 sm:shadow-sm"
                spacing={1}
              >
                <ToggleGroupItem
                  value="pan"
                  title={t("toolbar.pan")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <Hand size={18} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="select"
                  title={t("toolbar.select")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <MousePointer2 size={18} />
                </ToggleGroupItem>
                <Separator orientation="vertical" className="mx-1 h-5" />
                <ToggleGroupItem
                  value="draw_text"
                  title={t("toolbar.text")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <Type size={18} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="draw_checkbox"
                  title={t("toolbar.checkbox")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <CheckSquare size={18} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="draw_radio"
                  title={t("toolbar.radio")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <CircleDot size={18} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="draw_dropdown"
                  title={t("toolbar.dropdown")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <List size={18} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="draw_signature"
                  title={t("toolbar.signature")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <PenLine size={18} />
                </ToggleGroupItem>
              </ToggleGroup>
            ) : (
              <ToggleGroup
                type="single"
                value={editorState.keys.space ? "pan" : toolbarTool}
                onValueChange={(value) => {
                  if (value) onToolChange(value as Tool);
                }}
                className="sm:bg-muted/20 mx-auto flex min-w-max items-center gap-1 rounded-lg p-1 sm:shadow-sm"
                spacing={1}
              >
                <ToggleGroupItem
                  value="pan"
                  title={t("toolbar.pan")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <Hand size={18} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="select"
                  title={t("toolbar.select")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <MousePointer2 size={18} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="eraser"
                  title={t("toolbar.eraser")}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <Eraser size={18} />
                </ToggleGroupItem>
                <Separator orientation="vertical" className="mx-1 h-5" />
                <ToggleGroupItem
                  value="draw_highlight"
                  title={t("toolbar.highlight_text")}
                  className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground h-8 w-8 rounded-r-none p-0 sm:h-9 sm:w-9"
                >
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded-sm border border-black/10 shadow-sm dark:border-white/10"
                    style={{
                      backgroundColor:
                        editorState.highlightStyle?.color ||
                        ANNOTATION_STYLES.highlight.color,
                    }}
                  >
                    <Highlighter
                      size={14}
                      color={getContrastColor(
                        editorState.highlightStyle?.color ||
                          ANNOTATION_STYLES.highlight.color,
                      )}
                    />
                  </div>
                </ToggleGroupItem>
                <ColorPickerPopover
                  paletteType="background"
                  color={
                    editorState.highlightStyle?.color ||
                    ANNOTATION_STYLES.highlight.color
                  }
                  thickness={
                    editorState.highlightStyle?.thickness ||
                    ANNOTATION_STYLES.highlight.thickness
                  }
                  opacity={
                    editorState.highlightStyle?.opacity ??
                    ANNOTATION_STYLES.highlight.opacity
                  }
                  previewStrokeLinecap="butt"
                  onColorChange={(color) =>
                    onHighlightStyleChange
                      ? onHighlightStyleChange({ color })
                      : onPenStyleChange({ color })
                  }
                  onThicknessChange={(thickness) =>
                    onHighlightStyleChange
                      ? onHighlightStyleChange({ thickness })
                      : onPenStyleChange({ thickness })
                  }
                  onOpacityChange={(opacity) =>
                    onHighlightStyleChange
                      ? onHighlightStyleChange({ opacity })
                      : onPenStyleChange({ opacity })
                  }
                  isActive={tool === "draw_highlight"}
                  title={t("toolbar.highlight_free_properties")}
                />
                <div className="flex items-center gap-0">
                  <ToggleGroupItem
                    value="draw_ink"
                    title={t("toolbar.ink")}
                    className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground h-8 w-8 rounded-r-none p-0 sm:h-9 sm:w-9"
                  >
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-sm border border-black/10 shadow-sm dark:border-white/10"
                      style={{
                        backgroundColor: editorState.penStyle.color,
                      }}
                    >
                      <PenLine
                        size={14}
                        color={getContrastColor(editorState.penStyle.color)}
                      />
                    </div>
                  </ToggleGroupItem>
                  <ColorPickerPopover
                    paletteType="foreground"
                    color={editorState.penStyle.color}
                    thickness={editorState.penStyle.thickness}
                    opacity={editorState.penStyle.opacity}
                    onColorChange={(color) => onPenStyleChange({ color })}
                    onThicknessChange={(thickness) =>
                      onPenStyleChange({ thickness })
                    }
                    onOpacityChange={(opacity) => onPenStyleChange({ opacity })}
                    isActive={tool === "draw_ink"}
                    title={t("toolbar.ink_properties")}
                  />
                </div>
                <div className="flex items-center gap-0">
                  <ToggleGroupItem
                    value="draw_comment"
                    title={t("toolbar.comment")}
                    className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground h-8 w-8 rounded-r-none p-0 sm:h-9 sm:w-9"
                  >
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-sm border border-black/10 shadow-sm dark:border-white/10"
                      style={{
                        backgroundColor: editorState.commentStyle?.color,
                      }}
                    >
                      <MessageCircle
                        size={14}
                        color={getContrastColor(
                          editorState.commentStyle?.color,
                        )}
                      />
                    </div>
                  </ToggleGroupItem>
                  <ColorPickerPopover
                    paletteType="foreground"
                    color={editorState.commentStyle?.color}
                    onColorChange={(color) =>
                      onCommentStyleChange && onCommentStyleChange({ color })
                    }
                    isActive={tool === "draw_comment"}
                    showThickness={false}
                    title={t("toolbar.comment_properties")}
                  />
                </div>
                <div className="flex items-center gap-0">
                  <ToggleGroupItem
                    value="draw_freetext"
                    title={t("toolbar.freetext")}
                    className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground h-8 w-8 rounded-r-none p-0 sm:h-9 sm:w-9"
                  >
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-sm border border-black/10 shadow-sm dark:border-white/10"
                      style={{
                        backgroundColor: editorState.freetextStyle?.color,
                      }}
                    >
                      <Type
                        size={14}
                        color={getContrastColor(
                          editorState.freetextStyle?.color,
                        )}
                      />
                    </div>
                  </ToggleGroupItem>
                  <ColorPickerPopover
                    paletteType="foreground"
                    color={editorState.freetextStyle?.color}
                    onColorChange={(color) =>
                      onFreetextStyleChange && onFreetextStyleChange({ color })
                    }
                    isActive={tool === "draw_freetext"}
                    showThickness={false}
                    title={t("toolbar.freetext_properties")}
                  />
                </div>
                <div className="flex items-center gap-0">
                  <Popover
                    modal={false}
                    open={shapePopoverOpen}
                    onOpenChange={setShapePopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "h-8 w-8 rounded-r-none p-0 sm:h-9 sm:w-9",
                          isShapeTool(tool) &&
                            "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                        title={activeShapeLabel}
                      >
                        <ActiveShapeIcon size={16} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-72 p-3"
                      data-ff-block-modifier-wheel-zoom="1"
                    >
                      <div className="space-y-3">
                        {SHAPE_TOOL_GROUPS.map((group, index) => (
                          <div key={group.id} className="space-y-2">
                            {index > 0 ? <Separator /> : null}
                            <div className="text-muted-foreground px-1 text-xs font-medium">
                              {t(group.labelKey)}
                            </div>
                            {(() => {
                              const paddedTools: Array<ShapeTool | null> = [
                                ...group.tools,
                              ];
                              const slotCount =
                                group.slotCount ?? group.tools.length;

                              while (paddedTools.length < slotCount) {
                                paddedTools.push(null);
                              }

                              return (
                                <div
                                  className="grid gap-1"
                                  style={{
                                    gridTemplateColumns: `repeat(${group.columns}, minmax(0, 1fr))`,
                                  }}
                                >
                                  {paddedTools.map((shapeTool, itemIndex) => {
                                    if (!shapeTool) {
                                      return (
                                        <div
                                          key={`${group.id}-empty-${itemIndex}`}
                                          aria-hidden="true"
                                          className="min-h-16"
                                        />
                                      );
                                    }

                                    const ShapeIcon =
                                      getShapeToolIcon(shapeTool);
                                    const isActive =
                                      activeShapeTool === shapeTool;

                                    return (
                                      <Button
                                        key={shapeTool}
                                        variant="ghost"
                                        className={cn(
                                          "h-auto min-h-16 flex-col gap-2 px-2 py-2 text-xs",
                                          isActive &&
                                            "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                                        )}
                                        onClick={() =>
                                          handleShapeToolSelect(shapeTool)
                                        }
                                      >
                                        <ShapeIcon size={18} />
                                        <span className="leading-none">
                                          {getShapeToolLabel(t, shapeTool)}
                                        </span>
                                      </Button>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <ColorPickerPopover
                    paletteType="foreground"
                    color={
                      editorState.shapeStyle?.color ||
                      ANNOTATION_STYLES.shape.color
                    }
                    thickness={
                      editorState.shapeStyle?.thickness ??
                      ANNOTATION_STYLES.shape.thickness
                    }
                    minThickness={0}
                    opacity={
                      editorState.shapeStyle?.opacity ??
                      ANNOTATION_STYLES.shape.opacity
                    }
                    onColorChange={(color) =>
                      onShapeStyleChange && onShapeStyleChange({ color })
                    }
                    onThicknessChange={(thickness) =>
                      onShapeStyleChange && onShapeStyleChange({ thickness })
                    }
                    onOpacityChange={(opacity) =>
                      onShapeStyleChange && onShapeStyleChange({ opacity })
                    }
                    isActive={isShapeTool(tool)}
                    title={t("toolbar.shape_properties")}
                  />
                </div>
              </ToggleGroup>
            )}
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1">
          {showPageSettingsControl && (
            <PageSettingsDropdownControl
              pageLayout={livePageLayout}
              pageFlow={livePageFlow}
              isFullscreen={liveIsFullscreen}
              align="end"
              open={pageSettingsOpen}
              onOpenChange={setPageSettingsOpen}
              onPageLayoutChange={onPageLayoutChange}
              onPageFlowChange={onPageFlowChange}
              onToggleFullscreen={onToggleFullscreen}
            />
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            className="h-8 w-8 sm:h-9 sm:w-9"
            title={t("toolbar.settings")}
          >
            <Settings size={20} />
          </Button>

          {!compactZoomControl && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenShortcuts}
              className="h-8 w-8 sm:h-9 sm:w-9"
              title={t("toolbar.shortcuts")}
            >
              <Keyboard size={20} />
            </Button>
          )}

          {!editorState.isPanelFloating && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onTogglePropertiesPanel}
              className={cn(
                "h-8 w-8 sm:h-9 sm:w-9",
                isPropertiesPanelOpen && "bg-accent text-accent-foreground",
              )}
              title={t("toolbar.toggle_properties")}
            >
              <PanelRight size={20} />
            </Button>
          )}
        </div>

        <ExportMenu
          disabled={editorState.pages.length === 0}
          isDirty={!!isDirty}
          hasSaveAs={hasSaveAs.current}
          onPrimary={onExport}
          onSaveDraft={onSaveDraft}
          onSaveAs={onSaveAs}
          onExit={onExit}
          onPrint={onPrint}
          onClose={() => {
            if (tauri && !isDirty) {
              onExit();
              return;
            }
            onClose();
          }}
        />
      </div>
    </div>
  );
};

export default Toolbar;
