
import React from 'react';
import { MousePointer2, Type, CheckSquare, Download, Sparkles, ChevronDown, RefreshCw, LogOut, Undo2, Redo2, Keyboard, PanelLeft, List, CircleDot, Settings, Globe, Check, PenLine, Save } from 'lucide-react';
import { EditorState } from '../types';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { ModeToggle } from './mode-toggle';
import { useLanguage } from './language-provider';

interface ToolbarProps {
  editorState: EditorState;
  onToolChange: (tool: EditorState['tool']) => void;
  onExport: () => void;
  onSaveDraft: () => void;
  onSaveAndClose: () => void;
  onAutoDetect: () => void;
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
  onToolChange,
  onExport,
  onSaveDraft,
  onSaveAndClose,
  onAutoDetect,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onOpenShortcuts,
  isFieldListOpen,
  onToggleFieldList,
  onOpenSettings
}) => {
  const { t, language, setLanguage } = useLanguage();

  return (
    <div className="h-16 bg-background border-b border-border flex items-center justify-between px-4 relative text-foreground">

      {/* Left Section: Sidebar & History */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleFieldList}
          className={cn(isFieldListOpen && "bg-accent text-accent-foreground")}
          title={t('toolbar.toggle_sidebar')}
        >
          <PanelLeft size={20} />
        </Button>

        <Separator orientation="vertical" className="h-6 mx-2" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onUndo}
            disabled={!canUndo}
            title={t('toolbar.undo')}
          >
            <Undo2 size={20} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRedo}
            disabled={!canRedo}
            title={t('toolbar.redo')}
          >
            <Redo2 size={20} />
          </Button>
        </div>
      </div>

      {/* Center Section: Form Tools */}
      <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <ToggleGroup
          type="single"
          value={editorState.tool}
          onValueChange={(value) => {
            if (value) onToolChange(value as EditorState['tool']);
          }}
          className="flex items-center p-1 gap-1 bg-muted/50 rounded-lg border border-border"
          spacing={1}
        >
          <ToggleGroupItem
            value="select"
            title={t('toolbar.select')}
          >
            <MousePointer2 size={16} />
            <span className="hidden xl:inline">{t('toolbar.select')}</span>
          </ToggleGroupItem>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <ToggleGroupItem
            value="draw_text"
            title={t('toolbar.text')}
          >
            <Type size={16} />
            <span className="hidden xl:inline">{t('toolbar.text')}</span>
          </ToggleGroupItem>

          <ToggleGroupItem
            value="draw_checkbox"
            title={t('toolbar.checkbox')}
          >
            <CheckSquare size={16} />
            <span className="hidden xl:inline">{t('toolbar.checkbox')}</span>
          </ToggleGroupItem>

          <ToggleGroupItem
            value="draw_radio"
            title={t('toolbar.radio')}
          >
            <CircleDot size={16} />
            <span className="hidden xl:inline">{t('toolbar.radio')}</span>
          </ToggleGroupItem>

          <ToggleGroupItem
            value="draw_dropdown"
            title={t('toolbar.dropdown')}
          >
            <List size={16} />
            <span className="hidden xl:inline">{t('toolbar.dropdown')}</span>
          </ToggleGroupItem>

          <ToggleGroupItem
            value="draw_signature"
            title={t('toolbar.signature')}
          >
            <PenLine size={16} />
            <span className="hidden xl:inline">{t('toolbar.signature')}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Right Section: Utilities & Export */}
      <div className="flex items-center gap-3">

        {/* Utilities Group */}
        <div className="flex items-center gap-1 mr-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            title={t('toolbar.settings')}
          >
            <Settings size={20} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenShortcuts}
            title={t('toolbar.shortcuts')}
          >
            <Keyboard size={20} />
          </Button>

          <ModeToggle />
        </div>

        {editorState.pages.length > 0 && (
          <Button
            variant="secondary"
            onClick={onAutoDetect}
            disabled={editorState.isProcessing}
            className="text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-900/50"
            title={t('toolbar.ai_detect')}
          >
            <Sparkles size={16} className="mr-2" />
            <span className="hidden lg:inline">{t('toolbar.ai_detect')}</span>
          </Button>
        )}

        {/* Export Dropdown */}
        <div className="flex shadow-sm rounded-md isolate">
          <Button
            onClick={onExport}
            disabled={editorState.pages.length === 0}
            className="rounded-r-none"
          >
            <Download size={16} className="mr-2" />
            <span className="hidden sm:inline">{t('toolbar.export')}</span>
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
                <Save size={16} className="mr-2" />
                {t('toolbar.save_draft')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onSaveAndClose} variant="destructive">
                <LogOut size={16} className="mr-2" />
                {t('toolbar.save_close')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
