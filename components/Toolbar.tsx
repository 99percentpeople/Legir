
import React, { useState, useRef, useEffect } from 'react';
import { MousePointer2, Type, CheckSquare, Download, Sparkles, Moon, Sun, ChevronDown, RefreshCw, LogOut, Undo2, Redo2, Keyboard, PanelLeft, List, CircleDot, Settings } from 'lucide-react';
import { EditorState } from '../types';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';

interface ToolbarProps {
  editorState: EditorState;
  onToolChange: (tool: EditorState['tool']) => void;
  onExport: () => void;
  onSaveAndReopen: () => void;
  onSaveAndClose: () => void;
  onAutoDetect: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
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
  onSaveAndReopen,
  onSaveAndClose,
  onAutoDetect, 
  isDarkMode, 
  onToggleTheme,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onOpenShortcuts,
  isFieldListOpen,
  onToggleFieldList,
  onOpenSettings
}) => {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="h-16 bg-background border-b border-border flex items-center justify-between px-4 z-[60] relative text-foreground">
      
      {/* Left Section: Sidebar & History */}
      <div className="flex items-center gap-2">
        <Button
            variant="ghost"
            size="icon"
            onClick={onToggleFieldList}
            className={cn(isFieldListOpen && "bg-accent text-accent-foreground")}
            title="Toggle Sidebar"
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
                title="Undo (Ctrl+Z)"
              >
                <Undo2 size={20} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo (Ctrl+Shift+Z)"
              >
                <Redo2 size={20} />
              </Button>
        </div>
      </div>

      {/* Center Section: Form Tools */}
      <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <div className="flex items-center p-1 gap-1 bg-muted/50 rounded-lg border border-border">
          <Button
            variant={editorState.tool === 'select' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onToolChange('select')}
            title="Select"
            className="px-3"
          >
            <MousePointer2 size={16} className="mr-2" />
            <span className="hidden xl:inline">Select</span>
          </Button>
          
          <Separator orientation="vertical" className="h-5 mx-1" />
          
          <Button
            variant={editorState.tool === 'draw_text' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onToolChange('draw_text')}
            title="Text Field"
             className="px-3"
          >
            <Type size={16} className="mr-2" />
             <span className="hidden xl:inline">Text</span>
          </Button>

          <Button
            variant={editorState.tool === 'draw_checkbox' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onToolChange('draw_checkbox')}
            title="Checkbox"
             className="px-3"
          >
            <CheckSquare size={16} className="mr-2" />
             <span className="hidden xl:inline">Checkbox</span>
          </Button>

          <Button
            variant={editorState.tool === 'draw_radio' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onToolChange('draw_radio')}
            title="Radio Button"
             className="px-3"
          >
            <CircleDot size={16} className="mr-2" />
             <span className="hidden xl:inline">Radio</span>
          </Button>

          <Button
            variant={editorState.tool === 'draw_dropdown' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onToolChange('draw_dropdown')}
            title="Dropdown"
             className="px-3"
          >
            <List size={16} className="mr-2" />
             <span className="hidden xl:inline">Dropdown</span>
          </Button>
        </div>
      </div>

      {/* Right Section: Utilities & Export */}
      <div className="flex items-center gap-3">
        
        {/* Utilities Group */}
        <div className="flex items-center gap-1 mr-2">
             <Button
                variant="ghost"
                size="icon"
                onClick={onOpenSettings}
                title="Settings"
            >
                <Settings size={20} />
            </Button>
            
            <Button
                variant="ghost"
                size="icon"
                onClick={onOpenShortcuts}
                title="Keyboard Shortcuts (?)"
            >
                <Keyboard size={20} />
            </Button>

            <Button
                variant="ghost"
                size="icon"
                onClick={onToggleTheme}
                title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </Button>
        </div>

        {editorState.pages.length > 0 && (
          <Button
            variant="secondary"
            onClick={onAutoDetect}
            disabled={editorState.isProcessing}
            className="text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-900/50"
            title="AI Form Recognition"
          >
            <Sparkles size={16} className="mr-2" />
            <span className="hidden lg:inline">AI Detect</span>
          </Button>
        )}
        
        {/* Export Dropdown */}
        <div className="relative" ref={dropdownRef}>
            <div className="flex shadow-sm rounded-md isolate">
                <Button
                    onClick={onExport}
                    disabled={editorState.pages.length === 0}
                    className="rounded-r-none focus:z-10"
                >
                    <Download size={16} className="mr-2" />
                    <span className="hidden sm:inline">Export</span>
                </Button>
                <Button
                    onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                    disabled={editorState.pages.length === 0}
                    className="rounded-l-none -ml-px px-2 focus:z-10 border-l border-primary-foreground/20"
                >
                    <ChevronDown size={16} />
                </Button>
            </div>

            {isExportMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-black ring-opacity-5 focus:outline-none z-50 border border-border">
                    <div className="p-1 space-y-1">
                        <Button
                            variant="ghost"
                            onClick={() => { onSaveAndReopen(); setIsExportMenuOpen(false); }}
                            className="w-full justify-start"
                        >
                            <RefreshCw size={16} className="mr-2 text-muted-foreground" />
                            Save and Reopen
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={() => { onSaveAndClose(); setIsExportMenuOpen(false); }}
                            className="w-full justify-start hover:text-destructive hover:bg-destructive/10"
                        >
                            <LogOut size={16} className="mr-2 text-muted-foreground" />
                            Save and Close
                        </Button>
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
