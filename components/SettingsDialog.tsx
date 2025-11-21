
import React from 'react';
import { Settings2, Magnet } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { SnappingOptions } from '../types';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  options: SnappingOptions;
  onChange: (options: SnappingOptions) => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose, options, onChange }) => {
  
  const updateOption = (key: keyof SnappingOptions, value: boolean | number) => {
      onChange({
          ...options,
          [key]: value
      });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Editor Settings
          </DialogTitle>
          <DialogDescription>
            Configure the workspace behavior and snapping rules.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
            {/* Master Toggle */}
            <div className="flex flex-col space-y-2 bg-muted/30 p-3 rounded-lg border border-border">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Magnet className="h-4 w-4 text-primary" />
                        <Label htmlFor="snap-enabled" className="font-semibold">Snapping Enabled</Label>
                    </div>
                    <Switch 
                        id="snap-enabled"
                        checked={options.enabled}
                        onCheckedChange={(c) => updateOption('enabled', c)}
                    />
                </div>
                <p className="text-xs text-muted-foreground px-1">
                    Align fields automatically when moving or resizing. Hold <span className="font-mono text-foreground">Alt</span> to temporarily disable.
                </p>
            </div>

            <div className="space-y-4 px-1">
                <div className="flex items-center justify-between">
                    <Label htmlFor="snap-borders" className="cursor-pointer">Snap to Borders</Label>
                    <Switch 
                        id="snap-borders"
                        disabled={!options.enabled}
                        checked={options.snapToBorders}
                        onCheckedChange={(c) => updateOption('snapToBorders', c)}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <Label htmlFor="snap-center" className="cursor-pointer">Snap to Centers</Label>
                    <Switch 
                        id="snap-center"
                        disabled={!options.enabled}
                        checked={options.snapToCenter}
                        onCheckedChange={(c) => updateOption('snapToCenter', c)}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <Label htmlFor="snap-equal" className="cursor-pointer">Equidistant Snapping</Label>
                    <Switch 
                        id="snap-equal"
                        disabled={!options.enabled}
                        checked={options.snapToEqualDistances}
                        onCheckedChange={(c) => updateOption('snapToEqualDistances', c)}
                    />
                </div>
            </div>
        </div>

        <DialogFooter>
            <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;
