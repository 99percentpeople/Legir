import React from "react";
import {
  Check,
  CheckSquare,
  CircleDot,
  Edit3,
  Eraser,
  Hand,
  Highlighter,
  List,
  MessageCircle,
  MousePointer2,
  Palette,
  PenLine,
  PenTool,
  TextSelect,
  Type,
  X,
} from "lucide-react";

import { ANNOTATION_STYLES } from "@/constants";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { appEventBus, type AppEventMap } from "@/lib/eventBus";
import type { EditorCanvasState, EditorState, PenStyle, Tool } from "@/types";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";
import { ColorPickerPopover } from "./ColorPickerPopover";
import PageNumberDropdownControl from "./PageNumberDropdownControl";
import { ShapeBorderStyleSection } from "./ShapeBorderStyleSection";
import {
  getShapeToolIcon,
  getShapeToolLabel,
  isShapeTool,
  SHAPE_TOOL_GROUPS,
} from "./shapeTools";

interface MobileFloatingToolbarProps {
  currentPageIndex: number;
  editorState: EditorCanvasState;
  onNavigatePage: (pageIndex: number) => void;
  onToolChange: (tool: Tool) => void;
  onModeChange: (mode: EditorState["mode"]) => void;
  onPenStyleChange: (style: Partial<PenStyle>) => void;
  onHighlightStyleChange?: (style: Partial<PenStyle>) => void;
  onCommentStyleChange?: (style: { color: string }) => void;
  onFreetextStyleChange?: (style: { color: string }) => void;
  onShapeStyleChange?: (
    style: Partial<NonNullable<EditorState["shapeStyle"]>>,
  ) => void;
}

const isMovementTool = (tool: Tool): tool is "select" | "pan" =>
  tool === "select" || tool === "pan";

const isAnnotationTool = (
  tool: Tool,
): tool is
  | "select_text"
  | "draw_highlight"
  | "draw_ink"
  | "draw_comment"
  | "draw_freetext"
  | "draw_shape_rect"
  | "draw_shape_ellipse"
  | "draw_shape_line"
  | "draw_shape_polyline"
  | "draw_shape_polygon"
  | "draw_shape_cloud_polygon"
  | "draw_shape_arrow"
  | "draw_shape_cloud"
  | "eraser" =>
  tool === "select_text" ||
  tool === "draw_highlight" ||
  tool === "draw_ink" ||
  tool === "draw_comment" ||
  tool === "draw_freetext" ||
  isShapeTool(tool) ||
  tool === "eraser";

const isFormTool = (
  tool: Tool,
): tool is
  | "draw_text"
  | "draw_checkbox"
  | "draw_radio"
  | "draw_dropdown"
  | "draw_signature" =>
  tool === "draw_text" ||
  tool === "draw_checkbox" ||
  tool === "draw_radio" ||
  tool === "draw_dropdown" ||
  tool === "draw_signature";

type ShapeDraftState = AppEventMap["workspace:shapeDraftStateChange"];

const MobileFloatingToolbar: React.FC<MobileFloatingToolbarProps> = ({
  currentPageIndex,
  editorState,
  onNavigatePage,
  onToolChange,
  onModeChange,
  onPenStyleChange,
  onHighlightStyleChange,
  onCommentStyleChange,
  onFreetextStyleChange,
  onShapeStyleChange,
}) => {
  const { t } = useLanguage();
  const [shapeDraftState, setShapeDraftState] = React.useState<ShapeDraftState>(
    {
      active: false,
      tool: null,
      canFinish: false,
    },
  );
  const [pageMenuOpen, setPageMenuOpen] = React.useState(false);
  const [modeMenuOpen, setModeMenuOpen] = React.useState(false);
  const [toolMenuOpen, setToolMenuOpen] = React.useState(false);
  const commentColor =
    editorState.commentStyle?.color ?? ANNOTATION_STYLES.comment.color;
  const freetextColor =
    editorState.freetextStyle?.color ?? ANNOTATION_STYLES.freetext.color;

  useAppEvent(
    "workspace:shapeDraftStateChange",
    (payload) => {
      setShapeDraftState(payload);
    },
    { replayLast: true },
  );
  useAppEvent("workspace:pointerDown", () => {
    setPageMenuOpen(false);
    setModeMenuOpen(false);
    setToolMenuOpen(false);
  });

  const contentTool =
    editorState.mode === "annotation"
      ? isAnnotationTool(editorState.tool)
        ? editorState.tool
        : "draw_highlight"
      : isFormTool(editorState.tool)
        ? editorState.tool
        : "draw_text";
  const activeTool = isMovementTool(editorState.tool)
    ? editorState.tool
    : contentTool;
  const showShapeDraftActions = shapeDraftState.active;

  const getToolLabel = (tool: Tool) => {
    if (isShapeTool(tool)) {
      return getShapeToolLabel(t, tool);
    }

    switch (tool) {
      case "pan":
        return t("toolbar.pan");
      case "select":
        return t("toolbar.select");
      case "draw_text":
        return t("toolbar.text");
      case "select_text":
        return t("toolbar.select_text");
      case "draw_checkbox":
        return t("toolbar.checkbox");
      case "draw_radio":
        return t("toolbar.radio");
      case "draw_dropdown":
        return t("toolbar.dropdown");
      case "draw_signature":
        return t("toolbar.signature");
      case "draw_highlight":
        return t("toolbar.highlight_text");
      case "draw_ink":
        return t("toolbar.ink");
      case "draw_comment":
        return t("toolbar.comment");
      case "draw_freetext":
        return t("toolbar.freetext");
      case "eraser":
        return t("toolbar.eraser");
    }
  };

  const getToolIcon = (tool: Tool) => {
    if (isShapeTool(tool)) {
      const ShapeIcon = getShapeToolIcon(tool);
      return <ShapeIcon size={16} />;
    }

    switch (tool) {
      case "pan":
        return <Hand size={16} />;
      case "select":
        return <MousePointer2 size={16} />;
      case "draw_text":
        return <Type size={16} />;
      case "select_text":
        return <TextSelect size={16} />;
      case "draw_checkbox":
        return <CheckSquare size={16} />;
      case "draw_radio":
        return <CircleDot size={16} />;
      case "draw_dropdown":
        return <List size={16} />;
      case "draw_signature":
        return <PenLine size={16} />;
      case "eraser":
        return <Eraser size={16} />;
      case "draw_highlight":
        return <Highlighter size={16} />;
      case "draw_ink":
        return <PenLine size={16} />;
      case "draw_comment":
        return <MessageCircle size={16} />;
      case "draw_freetext":
        return <Type size={16} />;
    }
  };

  const getStyleColor = () => {
    switch (editorState.tool) {
      case "draw_highlight":
        return (
          editorState.highlightStyle?.color || ANNOTATION_STYLES.highlight.color
        );
      case "draw_ink":
        return editorState.penStyle.color;
      case "draw_comment":
        return (
          editorState.commentStyle?.color || ANNOTATION_STYLES.comment.color
        );
      case "draw_freetext":
        return (
          editorState.freetextStyle?.color || ANNOTATION_STYLES.freetext.color
        );
      case "draw_shape_rect":
      case "draw_shape_ellipse":
      case "draw_shape_line":
      case "draw_shape_polyline":
      case "draw_shape_polygon":
      case "draw_shape_cloud_polygon":
      case "draw_shape_arrow":
      case "draw_shape_cloud":
        return editorState.shapeStyle?.color || ANNOTATION_STYLES.shape.color;
      default:
        return null;
    }
  };

  const renderStyleTrigger = (title: string, color: string) => (
    <Button variant="ghost" size="icon" className="h-8 w-8" title={title}>
      <Palette size={16} className="text-foreground" fill={color} />
    </Button>
  );

  const renderStylePopover = () => {
    switch (editorState.tool) {
      case "draw_highlight":
        return (
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
            isActive
            side="top"
            title={t("toolbar.highlight_free_properties")}
          >
            {renderStyleTrigger(
              t("toolbar.highlight_free_properties"),
              editorState.highlightStyle?.color ||
                ANNOTATION_STYLES.highlight.color,
            )}
          </ColorPickerPopover>
        );
      case "draw_ink":
        return (
          <ColorPickerPopover
            paletteType="foreground"
            color={editorState.penStyle.color}
            thickness={editorState.penStyle.thickness}
            opacity={editorState.penStyle.opacity}
            onColorChange={(color) => onPenStyleChange({ color })}
            onThicknessChange={(thickness) => onPenStyleChange({ thickness })}
            onOpacityChange={(opacity) => onPenStyleChange({ opacity })}
            isActive
            side="top"
            title={t("toolbar.ink_properties")}
          >
            {renderStyleTrigger(
              t("toolbar.ink_properties"),
              editorState.penStyle.color,
            )}
          </ColorPickerPopover>
        );
      case "draw_comment":
        return (
          <ColorPickerPopover
            paletteType="foreground"
            color={commentColor}
            onColorChange={(color) =>
              onCommentStyleChange && onCommentStyleChange({ color })
            }
            isActive
            showThickness={false}
            side="top"
            title={t("toolbar.comment_properties")}
          >
            {renderStyleTrigger(t("toolbar.comment_properties"), commentColor)}
          </ColorPickerPopover>
        );
      case "draw_freetext":
        return (
          <ColorPickerPopover
            paletteType="foreground"
            color={freetextColor}
            onColorChange={(color) =>
              onFreetextStyleChange && onFreetextStyleChange({ color })
            }
            isActive
            showThickness={false}
            side="top"
            title={t("toolbar.freetext_properties")}
          >
            {renderStyleTrigger(
              t("toolbar.freetext_properties"),
              freetextColor,
            )}
          </ColorPickerPopover>
        );
      case "draw_shape_rect":
      case "draw_shape_ellipse":
      case "draw_shape_line":
      case "draw_shape_polyline":
      case "draw_shape_polygon":
      case "draw_shape_cloud_polygon":
      case "draw_shape_arrow":
      case "draw_shape_cloud":
        return (
          <ColorPickerPopover
            paletteType="foreground"
            color={
              editorState.shapeStyle?.color || ANNOTATION_STYLES.shape.color
            }
            thickness={
              editorState.shapeStyle?.thickness ??
              ANNOTATION_STYLES.shape.thickness
            }
            minThickness={0}
            opacity={
              editorState.shapeStyle?.opacity ?? ANNOTATION_STYLES.shape.opacity
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
            extraContent={
              <ShapeBorderStyleSection
                value={
                  editorState.shapeStyle?.borderStyle ??
                  ANNOTATION_STYLES.shape.borderStyle
                }
                dashDensity={
                  editorState.shapeStyle?.dashDensity ??
                  ANNOTATION_STYLES.shape.dashDensity
                }
                onChange={(borderStyle) =>
                  onShapeStyleChange?.({ borderStyle })
                }
                onDashDensityChange={(dashDensity) =>
                  onShapeStyleChange?.({ dashDensity })
                }
              />
            }
            isActive
            side="top"
            title={t("toolbar.shape_properties")}
          >
            {renderStyleTrigger(
              t("toolbar.shape_properties"),
              editorState.shapeStyle?.color || ANNOTATION_STYLES.shape.color,
            )}
          </ColorPickerPopover>
        );
      default:
        return null;
    }
  };
  const stylePopover = renderStylePopover();
  const styleColor = getStyleColor();
  const handleCancelShapeDraft = React.useCallback(() => {
    appEventBus.emit("workspace:cancelShapeDraft", {});
  }, []);
  const handleFinishShapeDraft = React.useCallback(() => {
    appEventBus.emit("workspace:finishShapeDraft", {});
  }, []);

  return (
    <div
      className="pointer-events-none absolute left-1/2 z-40 -translate-x-1/2"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
    >
      <div
        className="pointer-events-auto max-w-[calc(100vw-1.5rem)] px-3"
        data-app-block-modifier-wheel-zoom="1"
      >
        <div className="bg-background/72 border-border/70 no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border p-1 shadow-xl backdrop-blur-md transition-colors duration-200">
          <PageNumberDropdownControl
            currentPageIndex={currentPageIndex}
            pageCount={editorState.pages.length}
            className="shrink-0"
            open={pageMenuOpen}
            onOpenChange={setPageMenuOpen}
            onNavigatePage={onNavigatePage}
          />

          <Separator orientation="vertical" className="mx-1 shrink-0" />

          <DropdownMenu
            modal={false}
            open={modeMenuOpen}
            onOpenChange={setModeMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                title={t("mode.select")}
              >
                {editorState.mode === "annotation" ? (
                  <PenTool size={16} />
                ) : (
                  <Edit3 size={16} />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              data-app-block-modifier-wheel-zoom="1"
            >
              <DropdownMenuRadioGroup
                value={editorState.mode}
                onValueChange={(nextMode) => {
                  if (nextMode === "annotation" || nextMode === "form") {
                    onModeChange(nextMode);
                  }
                }}
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

          <Separator orientation="vertical" className="mx-1 shrink-0" />

          <DropdownMenu
            modal={false}
            open={toolMenuOpen}
            onOpenChange={setToolMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1 px-2"
                title={getToolLabel(activeTool)}
              >
                {getToolIcon(activeTool)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="center"
              className="min-w-52"
              data-app-block-modifier-wheel-zoom="1"
            >
              <DropdownMenuRadioGroup
                value={activeTool}
                onValueChange={(value) => onToolChange(value as Tool)}
              >
                <DropdownMenuRadioItem value="select">
                  <MousePointer2 size={14} />
                  {t("toolbar.select")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="select_text">
                  <TextSelect size={14} />
                  {t("toolbar.select_text")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="pan">
                  <Hand size={14} />
                  {t("toolbar.pan")}
                </DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {editorState.mode === "annotation" ? (
                  <>
                    <DropdownMenuRadioItem value="draw_highlight">
                      <Highlighter size={14} />
                      {t("toolbar.highlight_text")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="draw_ink">
                      <PenLine size={14} />
                      {t("toolbar.ink")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="draw_comment">
                      <MessageCircle size={14} />
                      {t("toolbar.comment")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="draw_freetext">
                      <Type size={14} />
                      {t("toolbar.freetext")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                    {SHAPE_TOOL_GROUPS.map((group, index) => (
                      <React.Fragment key={group.id}>
                        {index > 0 ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuLabel>
                          {t(group.labelKey)}
                        </DropdownMenuLabel>
                        {group.tools.map((shapeTool) => {
                          const ShapeIcon = getShapeToolIcon(shapeTool);
                          return (
                            <DropdownMenuRadioItem
                              key={shapeTool}
                              value={shapeTool}
                            >
                              <ShapeIcon size={14} />
                              {getShapeToolLabel(t, shapeTool)}
                            </DropdownMenuRadioItem>
                          );
                        })}
                      </React.Fragment>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioItem value="eraser">
                      <Eraser size={14} />
                      {t("toolbar.eraser")}
                    </DropdownMenuRadioItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuRadioItem value="draw_text">
                      <Type size={14} />
                      {t("toolbar.text")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="draw_checkbox">
                      <CheckSquare size={14} />
                      {t("toolbar.checkbox")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="draw_radio">
                      <CircleDot size={14} />
                      {t("toolbar.radio")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="draw_dropdown">
                      <List size={14} />
                      {t("toolbar.dropdown")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="draw_signature">
                      <PenLine size={14} />
                      {t("toolbar.signature")}
                    </DropdownMenuRadioItem>
                  </>
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {stylePopover && styleColor ? (
            <div className="shrink-0">{stylePopover}</div>
          ) : null}

          {showShapeDraftActions ? (
            <>
              <Separator orientation="vertical" className="mx-1 shrink-0" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={handleCancelShapeDraft}
                title={t("common.actions.cancel")}
                aria-label={t("common.actions.cancel")}
              >
                <X size={14} />
              </Button>
              <Button
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={handleFinishShapeDraft}
                disabled={!shapeDraftState.canFinish}
                title={t("common.actions.done")}
                aria-label={t("common.actions.done")}
              >
                <Check size={14} />
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default MobileFloatingToolbar;
