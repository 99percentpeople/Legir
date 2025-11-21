import React, { useState } from 'react';
import { FormField, FieldType, PDFMetadata } from '../types';
import { Trash2, X, Pin, PinOff, FileText, Plus, Minus, ArrowUp, ArrowDown, Save, Settings, Type, MousePointer2, Palette, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';

// --- Shared Layout Component ---
interface PanelLayoutProps {
  isFloating: boolean;
  onToggleFloating: () => void;
  onClose?: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const PanelLayout: React.FC<PanelLayoutProps> = ({ 
  isFloating, 
  onToggleFloating, 
  onClose, 
  title, 
  children,
  footer
}) => (
  <div className={cn(
    "w-80 bg-background border-l border-border flex flex-col h-full transition-all duration-200",
    isFloating ? 'absolute right-0 top-0 bottom-0 z-50 shadow-2xl' : 'relative z-20 shadow-none'
  )}>
    {/* Header */}
    <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
      <h3 className="font-semibold text-foreground flex items-center gap-2">
        {title}
      </h3>
      <div className="flex items-center gap-1">
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8"
          onClick={onToggleFloating}
          title={isFloating ? "Pin panel to side" : "Unpin panel (float)"}
        >
          {isFloating ? <Pin size={16} /> : <PinOff size={16} />}
        </Button>
        {onClose && (
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8"
            onClick={onClose} 
          >
            <X size={18} />
          </Button>
        )}
      </div>
    </div>

    {/* Body */}
    <div className="p-4 space-y-6 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border">
      {children}
    </div>

    {/* Footer */}
    {footer && (
      <div className="p-4 border-t border-border bg-muted/30">
        {footer}
      </div>
    )}
  </div>
);

// --- Document Properties Sub-Component ---
interface DocumentPropertiesPanelProps {
  metadata: PDFMetadata;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  filename: string;
  onFilenameChange: (name: string) => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  onTriggerHistorySave: () => void;
}

const DocumentPropertiesPanel: React.FC<DocumentPropertiesPanelProps> = ({
  metadata,
  onMetadataChange,
  filename,
  onFilenameChange,
  isFloating,
  onToggleFloating,
  onTriggerHistorySave
}) => {
  return (
    <PanelLayout
      title={<><FileText size={16} /> Document Info</>}
      isFloating={isFloating}
      onToggleFloating={onToggleFloating}
    >
       <div className="space-y-4">
         <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md text-sm text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800">
            Edit global PDF information. Select a field on the canvas to edit its properties.
         </div>

         <div className="space-y-2">
           <Label>Filename</Label>
           <Input
             type="text"
             value={filename}
             onFocus={onTriggerHistorySave}
             onChange={(e) => onFilenameChange(e.target.value)}
             placeholder="document.pdf"
           />
           <p className="text-xs text-muted-foreground">The name used when exporting the file.</p>
         </div>

         <Separator />

         <div className="space-y-2">
           <Label>Document Title</Label>
           <Input
             type="text"
             value={metadata.title || ''}
             onFocus={onTriggerHistorySave}
             onChange={(e) => onMetadataChange({ title: e.target.value })}
             placeholder="Untitled Document"
           />
         </div>

         <div className="space-y-2">
           <Label>Author</Label>
           <Input
             type="text"
             value={metadata.author || ''}
             onFocus={onTriggerHistorySave}
             onChange={(e) => onMetadataChange({ author: e.target.value })}
           />
         </div>

         <div className="space-y-2">
           <Label>Subject</Label>
           <Textarea
             rows={2}
             value={metadata.subject || ''}
             onFocus={onTriggerHistorySave}
             onChange={(e) => onMetadataChange({ subject: e.target.value })}
             className="resize-none"
           />
         </div>

         <div className="space-y-2">
           <Label>Keywords</Label>
           <Input
             type="text"
             value={metadata.keywords || ''}
             onFocus={onTriggerHistorySave}
             onChange={(e) => onMetadataChange({ keywords: e.target.value })}
             placeholder="invoice, receipt, 2024"
           />
           <p className="text-xs text-muted-foreground">Comma separated values</p>
         </div>
         
         <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
               <Label>Creator</Label>
               <Input
                 type="text"
                 value={metadata.creator || ''}
                 onFocus={onTriggerHistorySave}
                 onChange={(e) => onMetadataChange({ creator: e.target.value })}
               />
            </div>
            <div className="space-y-2">
               <Label>Producer</Label>
               <Input
                 type="text"
                 value={metadata.producer || ''}
                 onFocus={onTriggerHistorySave}
                 onChange={(e) => onMetadataChange({ producer: e.target.value })}
               />
            </div>
         </div>
       </div>
    </PanelLayout>
  );
};

// --- Field Properties Sub-Component ---
interface FieldPropertiesPanelProps {
  field: FormField;
  onChange: (updates: Partial<FormField>) => void;
  onDelete: () => void;
  onClose: () => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  onTriggerHistorySave: () => void;
}

const FieldPropertiesPanel: React.FC<FieldPropertiesPanelProps> = ({
  field,
  onChange,
  onDelete,
  onClose,
  isFloating,
  onToggleFloating,
  onTriggerHistorySave
}) => {
  const style = field.style || {};
  const [newOption, setNewOption] = useState('');
  const [isBulkEdit, setIsBulkEdit] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const handleStyleChange = (key: string, value: any) => {
    onChange({
      style: {
        ...style,
        [key]: value
      }
    });
  };

  const handleAddOption = () => {
    if (newOption.trim()) {
        onTriggerHistorySave();
        const currentOptions = field.options || [];
        onChange({ options: [...currentOptions, newOption.trim()] });
        setNewOption('');
    }
  };

  const handleRemoveOption = (idx: number) => {
      onTriggerHistorySave();
      const currentOptions = field.options || [];
      onChange({ options: currentOptions.filter((_, i) => i !== idx) });
  };

  const handleMoveOption = (index: number, direction: 'up' | 'down') => {
    onTriggerHistorySave();
    const currentOptions = [...(field.options || [])];
    if (direction === 'up' && index > 0) {
        [currentOptions[index], currentOptions[index - 1]] = [currentOptions[index - 1], currentOptions[index]];
    } else if (direction === 'down' && index < currentOptions.length - 1) {
        [currentOptions[index], currentOptions[index + 1]] = [currentOptions[index + 1], currentOptions[index]];
    }
    onChange({ options: currentOptions });
  };

  const startBulkEdit = () => {
    setBulkText((field.options || []).join('\n'));
    setIsBulkEdit(true);
  };

  const saveBulkEdit = () => {
    onTriggerHistorySave();
    const newOptions = bulkText.split('\n').map(s => s.trim()).filter(s => s !== '');
    onChange({ options: newOptions });
    setIsBulkEdit(false);
  };

  return (
    <PanelLayout
      title="Field Properties"
      isFloating={isFloating}
      onToggleFloating={onToggleFloating}
      onClose={onClose}
      footer={
        <Button
          variant="destructive"
          onClick={onDelete}
          className="w-full"
        >
          <Trash2 size={16} className="mr-2" />
          Delete Field
        </Button>
      }
    >
      {/* General Section */}
      <div>
        <h4 className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            <Settings size={12} className="mr-1.5" />
            General
        </h4>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Field Name</Label>
            <Input
              type="text"
              value={field.name}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onChange({ name: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Unique ID in the PDF form.</p>
            {field.type === FieldType.RADIO && (
                <p className="text-xs text-blue-500 dark:text-blue-400 mt-1">Same name = Same group.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={field.type}
              onValueChange={(value) => {
                  onTriggerHistorySave();
                  onChange({ type: value as FieldType })
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select field type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FieldType.TEXT}>Text Field</SelectItem>
                <SelectItem value={FieldType.CHECKBOX}>Checkbox</SelectItem>
                <SelectItem value={FieldType.RADIO}>Radio Button</SelectItem>
                <SelectItem value={FieldType.DROPDOWN}>Dropdown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
             <Label>Tooltip</Label>
             <Input
               type="text"
               value={field.toolTip || ''}
               onFocus={onTriggerHistorySave}
               onChange={(e) => onChange({ toolTip: e.target.value })}
               placeholder="Helper text on hover"
             />
          </div>
        </div>
      </div>

      <Separator />

      {/* Settings / Behavior */}
      <div>
        <h4 className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            <MousePointer2 size={12} className="mr-1.5" />
            Settings
        </h4>
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label htmlFor="required-switch" className="cursor-pointer">Required</Label>
                <Switch 
                    id="required-switch"
                    checked={field.required || false}
                    onMouseDown={onTriggerHistorySave}
                    onCheckedChange={(checked) => onChange({ required: checked })}
                />
            </div>
            
            <div className="flex items-center justify-between">
                <Label htmlFor="readonly-switch" className="cursor-pointer">Read Only</Label>
                <Switch 
                    id="readonly-switch"
                    checked={field.readOnly || false}
                    onMouseDown={onTriggerHistorySave}
                    onCheckedChange={(checked) => onChange({ readOnly: checked })}
                />
            </div>

            {field.type === FieldType.TEXT && (
                 <div className="flex items-center justify-between">
                    <Label htmlFor="multiline-switch" className="cursor-pointer">Multi-line</Label>
                    <Switch 
                        id="multiline-switch"
                        checked={field.multiline || false}
                        onMouseDown={onTriggerHistorySave}
                        onCheckedChange={(checked) => onChange({ multiline: checked })}
                    />
                </div>
            )}

            {(field.type === FieldType.CHECKBOX || field.type === FieldType.RADIO) && (
                 <div className="flex items-center justify-between">
                    <Label htmlFor="checked-switch" className="cursor-pointer">
                        {field.type === FieldType.RADIO ? 'Selected by Default' : 'Checked by Default'}
                    </Label>
                    <Switch 
                        id="checked-switch"
                        checked={field.isChecked || false}
                        onMouseDown={onTriggerHistorySave}
                        onCheckedChange={(checked) => onChange({ isChecked: checked })}
                    />
                </div>
            )}
        </div>
      </div>

      {/* Specific Properties */}
      {(field.type === FieldType.RADIO || field.type === FieldType.DROPDOWN || field.type === FieldType.TEXT) && <Separator />}
      
      <div>
         {field.type === FieldType.TEXT && (
             <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                        <Label>Max Length</Label>
                        <Input 
                            type="number"
                            min="0"
                            value={field.maxLength || ''}
                            onFocus={onTriggerHistorySave}
                            onChange={(e) => onChange({ maxLength: parseInt(e.target.value) || undefined })}
                            placeholder="Unlim."
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Alignment</Label>
                        <div className="flex bg-muted rounded-md p-1 border border-input">
                            <button 
                                onClick={() => { onTriggerHistorySave(); onChange({ alignment: 'left' }) }}
                                className={cn("flex-1 flex justify-center p-1 rounded text-foreground/50 hover:bg-background hover:text-foreground transition-colors", (field.alignment || 'left') === 'left' && "bg-background text-foreground shadow-sm")}
                                title="Left"
                            >
                                <AlignLeft size={16} />
                            </button>
                            <button 
                                onClick={() => { onTriggerHistorySave(); onChange({ alignment: 'center' }) }}
                                className={cn("flex-1 flex justify-center p-1 rounded text-foreground/50 hover:bg-background hover:text-foreground transition-colors", field.alignment === 'center' && "bg-background text-foreground shadow-sm")}
                                title="Center"
                            >
                                <AlignCenter size={16} />
                            </button>
                            <button 
                                onClick={() => { onTriggerHistorySave(); onChange({ alignment: 'right' }) }}
                                className={cn("flex-1 flex justify-center p-1 rounded text-foreground/50 hover:bg-background hover:text-foreground transition-colors", field.alignment === 'right' && "bg-background text-foreground shadow-sm")}
                                title="Right"
                            >
                                <AlignRight size={16} />
                            </button>
                        </div>
                    </div>
                </div>
             </div>
         )}

         {field.type === FieldType.RADIO && (
             <div className="space-y-2">
                <Label>Export Value</Label>
                <Input
                  type="text"
                  value={field.radioValue || ''}
                  onFocus={onTriggerHistorySave}
                  onChange={(e) => onChange({ radioValue: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Value sent when selected.</p>
             </div>
          )}

          {field.type === FieldType.DROPDOWN && (
             <div>
                <div className="flex items-center justify-between mb-2">
                    <Label>Options</Label>
                    <Button
                        variant="link"
                        size="sm"
                        onClick={isBulkEdit ? () => setIsBulkEdit(false) : startBulkEdit}
                        className="h-auto p-0 text-xs"
                    >
                        {isBulkEdit ? 'Switch to List' : 'Bulk Edit'}
                    </Button>
                </div>
                
                {isBulkEdit ? (
                    <div className="space-y-2">
                        <Textarea
                            value={bulkText}
                            onChange={(e) => setBulkText(e.target.value)}
                            className="font-mono text-xs"
                            rows={6}
                            placeholder="One option per line"
                        />
                        <Button onClick={saveBulkEdit} size="sm" className="w-full">
                            <Save size={14} className="mr-2" />
                            Save Options
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2 mb-2 max-h-40 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-border">
                            {(field.options || []).map((opt, idx) => (
                                <div key={idx} className="flex items-center gap-1 group">
                                    <div className="flex flex-col gap-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={() => handleMoveOption(idx, 'up')}
                                            disabled={idx === 0}
                                            className="hover:text-foreground disabled:opacity-30"
                                        >
                                            <ArrowUp size={10} />
                                        </button>
                                        <button 
                                            onClick={() => handleMoveOption(idx, 'down')}
                                            disabled={idx === (field.options?.length || 0) - 1}
                                            className="hover:text-foreground disabled:opacity-30"
                                        >
                                            <ArrowDown size={10} />
                                        </button>
                                    </div>
                                    <div className="flex-1 px-2 py-1.5 bg-muted/50 rounded text-sm border border-border truncate">
                                        {opt}
                                    </div>
                                    <button 
                                        onClick={() => handleRemoveOption(idx)}
                                        className="p-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Minus size={14} />
                                    </button>
                                </div>
                            ))}
                            {(field.options?.length || 0) === 0 && (
                                <div className="text-xs text-muted-foreground italic text-center py-2">No options added</div>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Input
                                type="text"
                                value={newOption}
                                onChange={(e) => setNewOption(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddOption()}
                                placeholder="Add option..."
                                className="flex-1"
                            />
                            <Button onClick={handleAddOption} size="icon" variant="secondary">
                                <Plus size={16} />
                            </Button>
                        </div>
                    </>
                )}
             </div>
          )}
      </div>

      <Separator />

      {/* Appearance Section */}
      <div>
        <h4 className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            <Palette size={12} className="mr-1.5" />
            Appearance
        </h4>
        <div className="space-y-4">
          
          {/* Background */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Background</Label>
              <div className="flex items-center gap-2">
                <Switch 
                  id="transparent"
                  checked={style.isTransparent || false}
                  onMouseDown={onTriggerHistorySave}
                  onCheckedChange={(checked) => handleStyleChange('isTransparent', checked)}
                />
                <Label htmlFor="transparent" className="text-xs font-normal">Transparent</Label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                disabled={style.isTransparent}
                value={style.backgroundColor || '#ffffff'}
                onMouseDown={onTriggerHistorySave}
                onChange={(e) => handleStyleChange('backgroundColor', e.target.value)}
                className="h-8 w-full cursor-pointer border border-input rounded disabled:opacity-50 bg-background"
              />
            </div>
          </div>

          {/* Border */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Border Color</Label>
              <input
                type="color"
                value={style.borderColor || '#000000'}
                onMouseDown={onTriggerHistorySave}
                onChange={(e) => handleStyleChange('borderColor', e.target.value)}
                className="h-8 w-full cursor-pointer border border-input rounded bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label>Border Width</Label>
              <Input
                type="number"
                min="0"
                max="10"
                value={style.borderWidth ?? 1}
                onFocus={onTriggerHistorySave}
                onChange={(e) => handleStyleChange('borderWidth', Number(e.target.value))}
              />
            </div>
          </div>

          {/* Text Settings (For Text and Dropdown) */}
          {(field.type === FieldType.TEXT || field.type === FieldType.DROPDOWN) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Text Color</Label>
                <input
                  type="color"
                  value={style.textColor || '#000000'}
                  onMouseDown={onTriggerHistorySave}
                  onChange={(e) => handleStyleChange('textColor', e.target.value)}
                  className="h-8 w-full cursor-pointer border border-input rounded bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label>Font Size</Label>
                <Input
                  type="number"
                  min="6"
                  max="72"
                  value={style.fontSize ?? 12}
                  onFocus={onTriggerHistorySave}
                  onChange={(e) => handleStyleChange('fontSize', Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Geometry Section */}
      <div>
        <h4 className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            <Type size={12} className="mr-1.5" />
            Geometry
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">X</Label>
            <Input
              type="number"
              value={Math.round(field.rect.x)}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onChange({ rect: { ...field.rect, x: Number(e.target.value) } })}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Y</Label>
            <Input
              type="number"
              value={Math.round(field.rect.y)}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onChange({ rect: { ...field.rect, y: Number(e.target.value) } })}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Width</Label>
            <Input
              type="number"
              value={Math.round(field.rect.width)}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onChange({ rect: { ...field.rect, width: Number(e.target.value) } })}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Height</Label>
            <Input
              type="number"
              value={Math.round(field.rect.height)}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onChange({ rect: { ...field.rect, height: Number(e.target.value) } })}
              className="h-8"
            />
          </div>
        </div>
      </div>
    </PanelLayout>
  );
};

// --- Main Container Component ---
interface PropertiesPanelProps {
  field: FormField | null;
  metadata: PDFMetadata;
  filename: string;
  onChange: (updates: Partial<FormField>) => void;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  onFilenameChange: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  onTriggerHistorySave: () => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  field,
  metadata,
  filename,
  onChange,
  onMetadataChange,
  onFilenameChange,
  onDelete,
  onClose,
  isFloating,
  onToggleFloating,
  onTriggerHistorySave
}) => {
  if (field) {
    return (
      <FieldPropertiesPanel
        field={field}
        onChange={onChange}
        onDelete={onDelete}
        onClose={onClose}
        isFloating={isFloating}
        onToggleFloating={onToggleFloating}
        onTriggerHistorySave={onTriggerHistorySave}
      />
    );
  }

  return (
    <DocumentPropertiesPanel
      metadata={metadata}
      onMetadataChange={onMetadataChange}
      filename={filename}
      onFilenameChange={onFilenameChange}
      isFloating={isFloating}
      onToggleFloating={onToggleFloating}
      onTriggerHistorySave={onTriggerHistorySave}
    />
  );
};