
import React, { useState, useEffect } from 'react';
import { Sparkles, Settings2, Type, CheckSquare, CircleDot, List, PenLine, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Separator } from './ui/separator';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { FieldType, FieldStyle } from '../types';
import { useLanguage } from './language-provider';
import { DEFAULT_FIELD_STYLE } from '../constants';
import { cn } from '../lib/utils';

export interface AIDetectionOptions {
  pageRange: string;
  allowedTypes: FieldType[];
  extraPrompt: string;
  defaultStyle: FieldStyle;
  useCustomStyle: boolean;
}

interface AIDetectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: AIDetectionOptions) => void;
  totalPages: number;
}

const AIDetectionDialog: React.FC<AIDetectionDialogProps> = ({ isOpen, onClose, onConfirm, totalPages }) => {
  const { t } = useLanguage();
  const [pageRange, setPageRange] = useState<string>('All');
  const [allowedTypes, setAllowedTypes] = useState<FieldType[]>([
    FieldType.TEXT, FieldType.CHECKBOX, FieldType.RADIO, FieldType.DROPDOWN, FieldType.SIGNATURE
  ]);
  const [extraPrompt, setExtraPrompt] = useState<string>('');
  const [useCustomStyle, setUseCustomStyle] = useState<boolean>(false);
  const [customStyle, setCustomStyle] = useState<FieldStyle>({ ...DEFAULT_FIELD_STYLE, isTransparent: true });
  
  const [validation, setValidation] = useState<{isValid: boolean, message: string, isError: boolean}>({ isValid: true, message: '', isError: false });

  useEffect(() => {
      const input = pageRange.trim();
      if (!input || input.toLowerCase() === 'all') {
          setValidation({ 
              isValid: true, 
              message: t('ai_dialog.valid_all', { total: totalPages }),
              isError: false
          });
          return;
      }

      const parts = input.split(',');
      const pages = new Set<number>();
      let hasError = false;
      let errorMsg = '';

      for (const part of parts) {
          const p = part.trim();
          if (!p) continue;

          // Check for range "start-end"
          if (p.includes('-')) {
             const rangeParts = p.split('-');
             if (rangeParts.length !== 2) {
                 hasError = true;
                 errorMsg = t('ai_dialog.err_format');
                 break;
             }
             const start = parseInt(rangeParts[0]);
             const end = parseInt(rangeParts[1]);

             if (isNaN(start) || isNaN(end)) {
                 hasError = true;
                 errorMsg = t('ai_dialog.err_format');
                 break;
             }
             if (start < 1 || end > totalPages) {
                 hasError = true;
                 errorMsg = t('ai_dialog.err_bounds', { total: totalPages });
                 break;
             }
             if (start > end) {
                 hasError = true;
                 errorMsg = t('ai_dialog.err_format'); // Invalid range
                 break;
             }
             for (let i = start; i <= end; i++) pages.add(i);
          } else {
             // Single number
             const num = parseInt(p);
             if (isNaN(num)) {
                 hasError = true;
                 errorMsg = t('ai_dialog.err_format');
                 break;
             }
             if (num < 1 || num > totalPages) {
                 hasError = true;
                 errorMsg = t('ai_dialog.err_bounds', { total: totalPages });
                 break;
             }
             pages.add(num);
          }
      }

      if (hasError) {
          setValidation({ isValid: false, message: errorMsg, isError: true });
      } else {
          const sorted = Array.from(pages).sort((a, b) => a - b);
          if (sorted.length === 0 && input.length > 0 && input !== 'All') {
             // Handle case where input might be just "," or empty parts
             setValidation({ isValid: false, message: t('ai_dialog.err_format'), isError: true });
          } else {
             const display = sorted.length > 10 ? sorted.slice(0, 10).join(', ') + '...' : sorted.join(', ');
             setValidation({ 
                 isValid: true, 
                 message: t('ai_dialog.valid_selected', { count: sorted.length, pages: display }),
                 isError: false
             });
          }
      }

  }, [pageRange, totalPages, t]);

  const handleTypeToggle = (value: string[]) => {
    if (value.length > 0) {
       setAllowedTypes(value as FieldType[]);
    }
  };

  const handleConfirm = () => {
    if (!validation.isValid) return;
    onConfirm({
      pageRange,
      allowedTypes,
      extraPrompt,
      defaultStyle: customStyle,
      useCustomStyle
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            {t('ai_dialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('ai_dialog.desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
           {/* Page Range */}
           <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                  <Label>{t('ai_dialog.page_range')}</Label>
                  <span className="text-xs text-muted-foreground">Total: {totalPages}</span>
              </div>
              <Input 
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                placeholder="e.g., 1-5, 8"
                className={cn(
                    validation.isError && "border-destructive focus-visible:ring-destructive/20"
                )}
              />
              
              <div className={cn(
                  "text-xs flex items-start gap-1.5 transition-colors min-h-[1.25rem]",
                  validation.isError ? "text-destructive" : "text-muted-foreground"
              )}>
                  {validation.isError ? <AlertCircle size={14} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={14} className="mt-0.5 text-green-600 dark:text-green-400 shrink-0" />}
                  <span className="leading-tight">{validation.message || t('ai_dialog.page_range_hint')}</span>
              </div>
           </div>

           <Separator />

           {/* Field Types */}
           <div className="space-y-3">
              <Label>{t('ai_dialog.types')}</Label>
              <ToggleGroup 
                type="multiple" 
                value={allowedTypes} 
                onValueChange={handleTypeToggle}
                className="flex flex-wrap gap-2 justify-start"
              >
                <ToggleGroupItem value={FieldType.TEXT} aria-label="Text" className="flex items-center gap-1.5 border border-input">
                   <Type size={14} /> {t('toolbar.text')}
                </ToggleGroupItem>
                <ToggleGroupItem value={FieldType.CHECKBOX} aria-label="Checkbox" className="flex items-center gap-1.5 border border-input">
                   <CheckSquare size={14} /> {t('toolbar.checkbox')}
                </ToggleGroupItem>
                <ToggleGroupItem value={FieldType.RADIO} aria-label="Radio" className="flex items-center gap-1.5 border border-input">
                   <CircleDot size={14} /> {t('toolbar.radio')}
                </ToggleGroupItem>
                <ToggleGroupItem value={FieldType.DROPDOWN} aria-label="Dropdown" className="flex items-center gap-1.5 border border-input">
                   <List size={14} /> {t('toolbar.dropdown')}
                </ToggleGroupItem>
                <ToggleGroupItem value={FieldType.SIGNATURE} aria-label="Signature" className="flex items-center gap-1.5 border border-input">
                   <PenLine size={14} /> {t('toolbar.signature')}
                </ToggleGroupItem>
              </ToggleGroup>
           </div>

           <Separator />

           {/* Style Adjustments */}
           <div className="space-y-3">
               <div className="flex items-center justify-between">
                   <Label>{t('ai_dialog.style_override')}</Label>
                   <Switch 
                      checked={useCustomStyle}
                      onCheckedChange={setUseCustomStyle}
                   />
               </div>
               
               {useCustomStyle && (
                   <div className="grid grid-cols-2 gap-4 p-3 bg-muted/30 rounded-md border border-border animate-in fade-in slide-in-from-top-2">
                      <div className="space-y-2">
                         <Label className="text-xs">{t('properties.background')}</Label>
                         <div className="flex items-center gap-2">
                            <input 
                                type="color" 
                                disabled={customStyle.isTransparent}
                                value={customStyle.backgroundColor || '#ffffff'}
                                onChange={(e) => setCustomStyle(s => ({...s, backgroundColor: e.target.value}))}
                                className="h-8 w-8 rounded cursor-pointer border border-input"
                            />
                            <div className="flex items-center gap-2">
                                <Switch 
                                    id="style-transparent"
                                    className="scale-75"
                                    checked={customStyle.isTransparent}
                                    onCheckedChange={(c) => setCustomStyle(s => ({...s, isTransparent: c}))}
                                />
                                <label htmlFor="style-transparent" className="text-xs cursor-pointer select-none">{t('properties.transparent')}</label>
                            </div>
                         </div>
                      </div>
                      <div className="space-y-2">
                         <Label className="text-xs">{t('properties.border_color')}</Label>
                         <input 
                            type="color" 
                            value={customStyle.borderColor || '#000000'}
                            onChange={(e) => setCustomStyle(s => ({...s, borderColor: e.target.value}))}
                            className="h-8 w-full rounded cursor-pointer border border-input"
                         />
                      </div>
                   </div>
               )}
           </div>

           <Separator />

           {/* Extra Prompt */}
           <div className="space-y-2">
              <Label>{t('ai_dialog.prompt')}</Label>
              <Textarea 
                value={extraPrompt}
                onChange={(e) => setExtraPrompt(e.target.value)}
                placeholder={t('ai_dialog.prompt_ph')}
                className="resize-none"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">{t('ai_dialog.prompt_hint')}</p>
           </div>
        </div>

        <DialogFooter>
           <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
           <Button 
             onClick={handleConfirm}
             disabled={!validation.isValid}
             className="bg-purple-600 hover:bg-purple-700 text-white"
           >
              <Sparkles size={16} className="mr-2" />
              {t('ai_dialog.start')}
           </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AIDetectionDialog;
