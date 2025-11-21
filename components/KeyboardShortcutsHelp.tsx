
import React from 'react';
import { Keyboard } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Badge } from './ui/badge';

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({ isOpen, onClose }) => {
  const shortcuts = [
    { key: 'Shift + Drag (Create)', action: 'Draw Square (Aspect Ratio 1:1)' },
    { key: 'Shift + Drag (Move)', action: 'Lock Movement Axis (X or Y)' },
    { key: 'Shift + Resize', action: 'Maintain Aspect Ratio' },
    { key: 'Alt + Drag', action: 'Disable Snapping Temporarily' },
    { key: 'Arrow Keys', action: 'Move selected field (1px)' },
    { key: 'Shift + Arrow Keys', action: 'Move selected field (10px)' },
    { key: 'Ctrl + Z', action: 'Undo' },
    { key: 'Ctrl + Shift + Z', action: 'Redo' },
    { key: 'Ctrl + C', action: 'Copy selected field' },
    { key: 'Ctrl + V', action: 'Paste field' },
    { key: 'Ctrl + X', action: 'Cut selected field' },
    { key: 'Delete / Backspace', action: 'Delete selected field' },
    { key: 'Escape', action: 'Deselect field' },
    { key: 'Ctrl + S', action: 'Export PDF' },
    { key: 'Ctrl + Scroll', action: 'Zoom In / Out' },
    { key: 'Shift + ?', action: 'Open this help menu' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Essential shortcuts for faster editing.
          </DialogDescription>
        </DialogHeader>
        
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
              <tr>
                <th className="px-4 py-2 font-medium rounded-tl-md">Shortcut</th>
                <th className="px-4 py-2 font-medium rounded-tr-md">Action</th>
              </tr>
            </thead>
            <tbody>
              {shortcuts.map((s, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="font-mono text-xs whitespace-nowrap">
                        {s.key}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {s.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KeyboardShortcutsHelp;
