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
  StickyNote,
  FileText,
  Edit3,
  Eraser,
} from "lucide-react";
import { EditorState, Tool, PenStyle } from "../types";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { ModeToggle } from "./mode-toggle";
import { useLanguage } from "./language-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { GEMINI_API_AVAILABLE } from "@/services/geminiService";
import { InkPropertiesPopover } from "./InkPropertiesPopover";
import { SaveStatusIndicator } from "./SaveStatusIndicator";

interface ToolbarProps {
  editorState: EditorState;
  isSaving?: boolean;
  onToolChange: (tool: Tool) => void;
  onModeChange: (mode: EditorState["mode"]) => void;
  onPenStyleChange: (style: Partial<PenStyle>) => void;
  onExport: () => Promise<boolean>;
  onSaveDraft: () => void;
  onSaveAs: () => Promise<boolean>;
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
  onOpenSettings: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  editorState,
  isSaving = false,
  onToolChange,
  onModeChange,
  onPenStyleChange,
  onExport,
  onSaveDraft,
  onSaveAs,
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
  onOpenSettings,
}) => {
  const { t } = useLanguage();
  const { mode, tool } = editorState;
  const hasFileSystemAccess = "showSaveFilePicker" in window;

  return (
    <div className="h-16 bg-background border-b border-border flex items-center justify-between px-4 relative text-foreground z-50">
      {/* Left Section: Mode Selection & History */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleFieldList}
            className={cn(
              isFieldListOpen && "bg-accent text-accent-foreground"
            )}
            title={t("toolbar.toggle_sidebar")}
          >
            <PanelLeft size={20} />
          </Button>

          {/* Mode Selector */}
          <Select
            value={mode}
            onValueChange={(val) => onModeChange(val as any)}
          >
            <SelectTrigger className="h-9 ml-2">
              <SelectValue placeholder="Mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="annotation">
                <div className="flex items-center gap-2">
                  <PenTool size={14} />
                  <span>{t("mode.annotation")}</span>
                </div>
              </SelectItem>
              <SelectItem value="form">
                <div className="flex items-center gap-2">
                  <Edit3 size={14} />
                  <span>{t("mode.form")}</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
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
      <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
        {mode === "form" ? (
          <ToggleGroup
            type="single"
            value={tool}
            onValueChange={(value) => {
              if (value) onToolChange(value as Tool);
            }}
            className="flex items-center p-1 gap-1 bg-muted/20 rounded-lg border border-border shadow-sm"
            spacing={1}
          >
            <ToggleGroupItem value="select" title={t("toolbar.select")}>
              <MousePointer2 size={18} />
            </ToggleGroupItem>
            <Separator orientation="vertical" className="h-5 mx-1" />
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
            value={tool}
            onValueChange={(value) => {
              if (value) onToolChange(value as Tool);
            }}
            className="flex items-center p-1 gap-1 bg-muted/20 rounded-lg border border-border shadow-sm"
            spacing={1}
          >
            <ToggleGroupItem value="select" title={t("toolbar.select")}>
              <MousePointer2 size={18} />
            </ToggleGroupItem>
            <ToggleGroupItem value="eraser" title={t("toolbar.eraser")}>
              <Eraser size={18} />
            </ToggleGroupItem>
            <Separator orientation="vertical" className="h-5 mx-1" />
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
              className="rounded-r-none pr-1.5 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
            >
              <PenTool size={18} style={{ color: editorState.penStyle.color }} />
            </ToggleGroupItem>
            <InkPropertiesPopover 
              penStyle={editorState.penStyle}
              onPenStyleChange={onPenStyleChange}
              isActive={tool === 'draw_ink'}
            />
            </div>
            <ToggleGroupItem value="draw_note" title={t("toolbar.note")}>
              <StickyNote size={18} />
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {/* Right Section: Utilities & Export */}
      <div className="flex items-center gap-3">
        <SaveStatusIndicator
          isSaving={isSaving}
          lastSavedAt={editorState.lastSavedAt}
          className="mr-2 hidden md:flex"
        />

        {/* Utilities Group */}
        <div className="flex items-center gap-1 mr-2">
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

          <ModeToggle />
        </div>

        {editorState.pages.length > 0 && mode === "form" && (
          <div className="flex shadow-sm rounded-md isolate mr-2">
            <Button
              onClick={onAutoDetect}
              disabled={!GEMINI_API_AVAILABLE || editorState.isProcessing}
              className="rounded-r-none text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-900/50"
              title={t("toolbar.ai_detect")}
            >
              <Sparkles size={16} />
              <span className="hidden lg:inline">{t("toolbar.ai_detect")}</span>
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={!GEMINI_API_AVAILABLE || editorState.isProcessing}
                  className="rounded-l-none -ml-px px-2 border-l border-l-purple-200 dark:border-l-purple-800 text-purple-700 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
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
        <div className="flex shadow-sm rounded-md isolate">
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
                className="rounded-l-none -ml-px px-2 border-l border-l-border"
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
