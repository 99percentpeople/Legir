import React, { useRef } from "react";
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
  MessageCirclePlus,
  Hand,
  Search,
} from "lucide-react";
import {
  EditorState,
  PageFlowDirection,
  PageLayoutMode,
  PenStyle,
  Tool,
} from "@/types";
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
import { canSaveAs } from "../../services/fileOps";
import { ColorPickerPopover } from "./ColorPickerPopover";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import ZoomDropdownControl from "./ZoomDropdownControl";
import PageSettingsDropdownControl from "./PageSettingsDropdownControl";
import { ANNOTATION_STYLES } from "@/constants";
import { getContrastColor } from "@/utils/colors";
import ExportMenu from "./ExportMenu";
import { isTauri } from "@tauri-apps/api/core";
import { useEditorStore } from "@/store/useEditorStore";

interface ToolbarProps {
  editorState: EditorState;
  isSaving?: boolean;
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
  onExport: () => Promise<boolean>;
  onSaveDraft: (silent?: boolean) => Promise<void>;
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
  isSaving = false,
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
  const hasSaveAs = useRef(canSaveAs());
  const tauri = isTauri();
  const liveScale = useEditorStore((state) => state.scale);
  const livePageLayout = useEditorStore((state) => state.pageLayout);
  const livePageFlow = useEditorStore((state) => state.pageFlow);
  const liveIsFullscreen = useEditorStore((state) => state.isFullscreen);

  return (
    <div
      className={cn(
        "bg-background border-border text-foreground relative z-30 flex h-12 items-center gap-2 border-b px-2 sm:px-4",
        hideToolSection ? "justify-between" : "lg:justify-between",
      )}
    >
      {/* Left Section: Mode Selection & History */}
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
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onFitWidth={onFitWidth}
            onFitScreen={onFitScreen}
          />

          {!hideModeSelector && (
            <>
              {/* Mode Selector */}
              <DropdownMenu modal={false}>
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
                <DropdownMenuContent align="start">
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
                value={editorState.keys.space ? "pan" : tool}
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
                value={editorState.keys.space ? "pan" : tool}
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
                      <MessageCirclePlus
                        size={14}
                        color={getContrastColor(
                          editorState.commentStyle?.color,
                        )}
                      />
                    </div>
                  </ToggleGroupItem>
                  <ColorPickerPopover
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
                    color={editorState.freetextStyle?.color}
                    onColorChange={(color) =>
                      onFreetextStyleChange && onFreetextStyleChange({ color })
                    }
                    isActive={tool === "draw_freetext"}
                    showThickness={false}
                    title={t("toolbar.freetext_properties")}
                  />
                </div>
              </ToggleGroup>
            )}
          </div>
        </div>
      )}

      {/* Right Section: Utilities & Export */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <SaveStatusIndicator
          isSaving={isSaving}
          isDirty={isDirty}
          lastSavedAt={editorState.lastSavedAt}
          className="flex"
        />

        {/* Utilities Group */}
        <div className="flex items-center gap-1">
          {showPageSettingsControl && (
            <PageSettingsDropdownControl
              pageLayout={livePageLayout}
              pageFlow={livePageFlow}
              isFullscreen={liveIsFullscreen}
              align="end"
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

        {/* Export Dropdown */}
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
