import React from 'react';
import { Settings2, Magnet, Globe } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { SnappingOptions } from '../types';
import { useLanguage, Language } from './language-provider';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  options: SnappingOptions;
  onChange: (options: SnappingOptions) => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose, options, onChange }) => {
  const { language, setLanguage, t } = useLanguage();
  
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
            {t('settings.title')}
          </DialogTitle>
          <DialogDescription>
            {t('settings.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
            {/* Language Selection */}
            <div className="flex flex-col space-y-2 bg-muted/30 p-3 rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  <Label className="font-semibold">{t('settings.language')}</Label>
                </div>
                <Select value={language} onValueChange={(val) => setLanguage(val as Language)}>
                  <SelectTrigger className="w-[120px] h-8">
                    <SelectValue placeholder={t('common.select')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="zh">中文</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Master Toggle */}
            <div className="flex flex-col space-y-2 bg-muted/30 p-3 rounded-lg border border-border">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Magnet className="h-4 w-4 text-primary" />
                        <Label htmlFor="snap-enabled" className="font-semibold">{t('settings.snapping.enabled')}</Label>
                    </div>
                    <Switch 
                        id="snap-enabled"
                        checked={options.enabled}
                        onCheckedChange={(c) => updateOption('enabled', c)}
                    />
                </div>
                <p className="text-xs text-muted-foreground px-1">
                    {t('settings.snapping.description')}
                </p>
            </div>

            <div className="space-y-4 px-1">
                <div className="flex items-center justify-between">
                    <Label htmlFor="snap-borders" className="cursor-pointer">{t('settings.borders')}</Label>
                    <Switch 
                        id="snap-borders"
                        disabled={!options.enabled}
                        checked={options.snapToBorders}
                        onCheckedChange={(c) => updateOption('snapToBorders', c)}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <Label htmlFor="snap-center" className="cursor-pointer">{t('settings.centers')}</Label>
                    <Switch 
                        id="snap-center"
                        disabled={!options.enabled}
                        checked={options.snapToCenter}
                        onCheckedChange={(c) => updateOption('snapToCenter', c)}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <Label htmlFor="snap-equal" className="cursor-pointer">{t('settings.equal')}</Label>
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
            <Button onClick={onClose}>{t('settings.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;