
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
import { useLanguage } from './language-provider';

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const shortcuts = [
    { key: t('shortcuts.shift_drag_create'), action: t('shortcuts.draw_square') },
    { key: t('shortcuts.ctrl_create'), action: t('shortcuts.continuous_mode') },
    { key: t('shortcuts.shift_drag_move'), action: t('shortcuts.lock_axis') },
    { key: t('shortcuts.ctrl_drag'), action: t('shortcuts.duplicate') },
    { key: t('shortcuts.shift_resize'), action: t('shortcuts.maintain_aspect') },
    { key: t('shortcuts.alt_drag'), action: t('shortcuts.disable_snapping') },
    { key: t('shortcuts.arrow_keys'), action: t('shortcuts.move_1px') },
    { key: t('shortcuts.shift_arrow'), action: t('shortcuts.move_10px') },
    { key: 'Ctrl + Z', action: t('toolbar.undo') },
    { key: 'Ctrl + Shift + Z', action: t('toolbar.redo') },
    { key: 'Ctrl + C', action: t('shortcuts.copy') },
    { key: 'Ctrl + V', action: t('shortcuts.paste') },
    { key: 'Ctrl + X', action: t('shortcuts.cut') },
    { key: 'Delete / Backspace', action: t('shortcuts.delete') },
    { key: 'Escape', action: t('shortcuts.deselect') },
    { key: 'Ctrl + S', action: t('shortcuts.export') },
    { key: 'Ctrl + Scroll', action: t('shortcuts.zoom') },
    { key: 'Shift + ?', action: t('shortcuts.help') },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            {t('shortcuts.title')}
          </DialogTitle>
          <DialogDescription>
            {t('shortcuts.desc')}
          </DialogDescription>
        </DialogHeader>
        
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
              <tr>
                <th className="px-4 py-2 font-medium rounded-tl-md">{t('shortcuts.header.key')}</th>
                <th className="px-4 py-2 font-medium rounded-tr-md">{t('shortcuts.header.action')}</th>
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
