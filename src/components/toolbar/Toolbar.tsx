import React from "react";
import {
  MousePointer2,
  Type,
  CheckSquare,
  Download,
  Sparkles,
  ChevronDown,
  Undo2,
  Redo2,
  Keyboard,
  PanelLeft,
  PanelRight,
  List,
  CircleDot,
  Settings,
  PenLine,
  Save,
  SaveAll,
  Settings2,
  XCircle,
  Highlighter,
  PenTool,
  FileText,
  Edit3,
  Eraser,
  MessageCirclePlus,
  Printer,
  Hand,
  Pen,
} from "lucide-react";
import { EditorState, Tool, PenStyle } from "../../types";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { cn } from "../../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { useLanguage } from "../language-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { GEMINI_API_AVAILABLE } from "@/services/geminiService";
import { ColorPickerPopover } from "./ColorPickerPopover";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { ANNOTATION_STYLES } from "@/constants";
import { getContrastColor } from "@/utils/colors";

interface ToolbarProps {
  editorState: EditorState;
  isSaving?: boolean;
  isDirty?: boolean;
  onToolChange: (tool: Tool) => void;
  onModeChange: (mode: EditorState["mode"]) => void;
  onPenStyleChange: (style: Partial<PenStyle>) => void;
  onCommentStyleChange?: (style: { color: string }) => void;
  onFreetextStyleChange?: (style: { color: string }) => void;
  onExport: () => Promise<boolean>;
  onSaveDraft: () => void;
  onSaveAs: () => Promise<boolean>;
  onPrint: () => void;
  onExit: () => void;
  onClose: () => void;
  onAutoDetect: () => void;
  onCustomAutoDetect: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onOpenShortcuts: () => void;
  isFieldListOpen: boolean;
  onToggleFieldList: () => void;
  isPropertiesPanelOpen: boolean;
  onTogglePropertiesPanel: () => void;
  onOpenSettings: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  editorState,
  isSaving = false,
  isDirty = false,
  onToolChange,
  onModeChange,
  onPenStyleChange,
  onCommentStyleChange: onCommentStyleChange,
  onFreetextStyleChange: onFreetextStyleChange,
  onExport,
  onSaveDraft,
  onSaveAs,
  onPrint,
  onExit,
  onClose,
  onAutoDetect,
  onCustomAutoDetect,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onOpenShortcuts,
  isFieldListOpen,
  onToggleFieldList,
  isPropertiesPanelOpen,
  onTogglePropertiesPanel,
  onOpenSettings,
}) => {
  const { t } = useLanguage();
  const { mode, tool } = editorState;
  const hasFileSystemAccess = "showSaveFilePicker" in window;

  return (
    <div className="bg-background border-border text-foreground relative z-50 flex h-12 items-center justify-between border-b px-4">
      {/* Left Section: Mode Selection & History */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleFieldList}
            className={cn(
              isFieldListOpen && "bg-accent text-accent-foreground",
            )}
            title={t("toolbar.toggle_sidebar")}
          >
            <PanelLeft size={20} />
          </Button>

          {/* Mode Selector */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 h-9 w-9"
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
              <DropdownMenuRadioGroup value={mode} onValueChange={onModeChange}>
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
        </div>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onUndo}
            disabled={!canUndo}
            title={t("toolbar.undo")}
          >
            <Undo2 size={20} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRedo}
            disabled={!canRedo}
            title={t("toolbar.redo")}
          >
            <Redo2 size={20} />
          </Button>
        </div>
      </div>

      {/* Center Section: Tools based on Mode */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transform">
        {mode === "form" ? (
          <ToggleGroup
            type="single"
            value={editorState.keys.space ? "pan" : tool}
            onValueChange={(value) => {
              if (value) onToolChange(value as Tool);
            }}
            className="bg-muted/20 border-border flex items-center gap-1 rounded-lg border p-1 shadow-sm"
            spacing={1}
          >
            <ToggleGroupItem value="pan" title={t("toolbar.pan")}>
              <Hand size={18} />
            </ToggleGroupItem>
            <ToggleGroupItem value="select" title={t("toolbar.select")}>
              <MousePointer2 size={18} />
            </ToggleGroupItem>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <ToggleGroupItem value="draw_text" title={t("toolbar.text")}>
              <Type size={18} />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="draw_checkbox"
              title={t("toolbar.checkbox")}
            >
              <CheckSquare size={18} />
            </ToggleGroupItem>
            <ToggleGroupItem value="draw_radio" title={t("toolbar.radio")}>
              <CircleDot size={18} />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="draw_dropdown"
              title={t("toolbar.dropdown")}
            >
              <List size={18} />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="draw_signature"
              title={t("toolbar.signature")}
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
            className="bg-muted/20 border-border flex items-center gap-1 rounded-lg border p-1 shadow-sm"
            spacing={1}
          >
            <ToggleGroupItem value="pan" title={t("toolbar.pan")}>
              <Hand size={18} />
            </ToggleGroupItem>
            <ToggleGroupItem value="select" title={t("toolbar.select")}>
              <MousePointer2 size={18} />
            </ToggleGroupItem>
            <ToggleGroupItem value="eraser" title={t("toolbar.eraser")}>
              <Eraser size={18} />
            </ToggleGroupItem>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <ToggleGroupItem
              value="draw_highlight"
              title={t("toolbar.highlight")}
            >
              <Highlighter size={18} />
            </ToggleGroupItem>
            <div className="flex items-center gap-0">
              <ToggleGroupItem
                value="draw_ink"
                title={t("toolbar.ink")}
                className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground rounded-r-none pr-1.5"
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
                onColorChange={(color) => onPenStyleChange({ color })}
                onThicknessChange={(thickness) =>
                  onPenStyleChange({ thickness })
                }
                isActive={tool === "draw_ink"}
                title={t("toolbar.ink_properties")}
              />
            </div>
            <div className="flex items-center gap-0">
              <ToggleGroupItem
                value="draw_comment"
                title={t("toolbar.comment")}
                className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground rounded-r-none pr-1.5"
              >
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-sm border border-black/10 shadow-sm dark:border-white/10"
                  style={{
                    backgroundColor: editorState.commentStyle?.color,
                  }}
                >
                  <MessageCirclePlus
                    size={14}
                    color={getContrastColor(editorState.commentStyle?.color)}
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
                className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground rounded-r-none pr-1.5"
              >
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-sm border border-black/10 shadow-sm dark:border-white/10"
                  style={{
                    backgroundColor: editorState.freetextStyle?.color,
                  }}
                >
                  <Type
                    size={14}
                    color={getContrastColor(editorState.freetextStyle?.color)}
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

      {/* Right Section: Utilities & Export */}
      <div className="flex items-center gap-3">
        <SaveStatusIndicator
          isSaving={isSaving}
          isDirty={isDirty}
          lastSavedAt={editorState.lastSavedAt}
          className="mr-2 hidden md:flex"
        />

        {/* Utilities Group */}
        <div className="mr-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            title={t("toolbar.settings")}
          >
            <Settings size={20} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenShortcuts}
            title={t("toolbar.shortcuts")}
          >
            <Keyboard size={20} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onTogglePropertiesPanel}
            className={cn(
              isPropertiesPanelOpen && "bg-accent text-accent-foreground",
            )}
            title={t("toolbar.toggle_properties")}
          >
            <PanelRight size={20} />
          </Button>
        </div>

        {editorState.pages.length > 0 && mode === "form" && (
          <div className="isolate mr-2 flex rounded-md shadow-sm">
            <Button
              onClick={onAutoDetect}
              disabled={!GEMINI_API_AVAILABLE || editorState.isProcessing}
              className="rounded-r-none border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
              title={t("toolbar.ai_detect")}
            >
              <Sparkles size={16} />
              <span className="hidden lg:inline">{t("toolbar.ai_detect")}</span>
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={!GEMINI_API_AVAILABLE || editorState.isProcessing}
                  className="-ml-px rounded-l-none border-l border-l-purple-200 bg-purple-50 px-2 text-purple-700 hover:bg-purple-100 dark:border-l-purple-800 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
                >
                  <ChevronDown size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onCustomAutoDetect}>
                  <Settings2 size={16} />
                  {t("toolbar.ai_custom")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Export Dropdown */}
        <div className="isolate flex rounded-md shadow-sm">
          <Button
            onClick={onExport}
            disabled={editorState.pages.length === 0}
            className="rounded-r-none"
          >
            <Download size={16} />
            <span className="hidden sm:inline">{t("toolbar.export")}</span>
          </Button>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={editorState.pages.length === 0}
                className="border-l-border -ml-px rounded-l-none border-l px-2"
              >
                <ChevronDown size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={onSaveDraft}>
                <Save size={16} />
                {t("toolbar.save_draft")}
              </DropdownMenuItem>
              {hasFileSystemAccess && (
                <DropdownMenuItem onClick={onSaveAs}>
                  <SaveAll size={16} />
                  {t("toolbar.save_as")}
                </DropdownMenuItem>
              )}

              <Separator className="my-1" />

              <DropdownMenuItem
                onClick={async () => {
                  if (await onExport()) onExit();
                }}
              >
                <FileText size={16} />
                {t("toolbar.save_close")}
              </DropdownMenuItem>
              {hasFileSystemAccess && (
                <DropdownMenuItem
                  onClick={async () => {
                    if (await onSaveAs()) onExit();
                  }}
                >
                  <FileText size={16} />
                  {t("toolbar.save_as_close")}
                </DropdownMenuItem>
              )}

              <Separator className="my-1" />

              <DropdownMenuItem onClick={onPrint}>
                <Printer size={16} />
                {t("toolbar.print")}
              </DropdownMenuItem>

              <DropdownMenuItem onClick={onClose} variant="destructive">
                <XCircle size={16} />
                {t("toolbar.close")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
