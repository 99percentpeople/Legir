
import React, { useState, useEffect, useCallback } from 'react';
import Toolbar from './components/Toolbar';
import Workspace from './components/Workspace';
import { PropertiesPanel } from './components/PropertiesPanel';
import LandingPage from './components/LandingPage';
import ZoomControls from './components/ZoomControls';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';
import SettingsDialog from './components/SettingsDialog';
import Sidebar from './components/Sidebar';
import { Dialog, DialogContent, DialogTitle } from './components/ui/dialog';
import { EditorState, FormField, PDFMetadata, HistorySnapshot, PDFOutlineItem, PageData, SnappingOptions } from './types';
import { loadPDF, exportPDF } from './services/pdfService';
import { analyzePageForFields } from './services/geminiService';
import { DEFAULT_FIELD_STYLE } from './constants';
import { useLanguage } from './components/language-provider';

const App: React.FC = () => {
  const { t } = useLanguage();
  const [state, setState] = useState<EditorState>({
    pdfFile: null,
    pdfBytes: null,
    metadata: {},
    filename: 'document.pdf',
    pages: [],
    fields: [],
    outline: [],
    selectedFieldId: null,
    scale: 1.0,
    tool: 'select',
    isProcessing: false,
    past: [],
    future: [],
    clipboard: null,
    snappingOptions: {
      enabled: true,
      snapToBorders: true,
      snapToCenter: true,
      snapToEqualDistances: false,
      threshold: 8
    }
  });
  
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [isPanelFloating, setIsPanelFloating] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // Default open
  
  // --- Zoom & Layout Calculations ---

  const calculateFitScale = useCallback((pagesList: PageData[]) => {
    if (!pagesList || pagesList.length === 0) return 1.0;
    const page = pagesList[0];
    if (!page.width) return 1.0;

    // Layout constants
    // w-64 = 256px (Sidebar)
    // w-80 = 320px (PropertiesPanel)
    // p-8 = 32px (x2 = 64px padding)
    // We add a bit more safety margin (e.g., 32px) = 96px total horizontal buffer
    
    const SIDEBAR_WIDTH = isSidebarOpen ? 256 : 0;
    // Panel is visible if we have pages, unless floating
    const PANEL_WIDTH = !isPanelFloating ? 320 : 0;
    const PADDING = 96; 

    const availableWidth = window.innerWidth - SIDEBAR_WIDTH - PANEL_WIDTH - PADDING;
    const scale = availableWidth / page.width;
    
    // Clamp between 0.25 and 4.0, standardizing to 2 decimals
    return Math.max(0.25, Math.min(4.0, Number(scale.toFixed(2))));
  }, [isSidebarOpen, isPanelFloating]);

  const updateScale = (newScale: number) => {
     const clamped = Math.max(0.25, Math.min(4.0, newScale));
     setState(prev => ({ ...prev, scale: clamped }));
  };

  // --- History Management ---

  const saveCheckpoint = useCallback(() => {
    setState(prev => {
      const snapshot: HistorySnapshot = {
        fields: prev.fields,
        metadata: prev.metadata
      };
      // Limit history size if needed, e.g., 50 steps
      const newPast = [...prev.past, snapshot].slice(-50);
      return {
        ...prev,
        past: newPast,
        future: [] // Clear future on new action
      };
    });
  }, []);

  const handleUndo = useCallback(() => {
    setState(prev => {
      if (prev.past.length === 0) return prev;
      
      const previous = prev.past[prev.past.length - 1];
      const newPast = prev.past.slice(0, -1);
      
      const currentSnapshot: HistorySnapshot = {
        fields: prev.fields,
        metadata: prev.metadata
      };

      return {
        ...prev,
        fields: previous.fields,
        metadata: previous.metadata,
        past: newPast,
        future: [currentSnapshot, ...prev.future],
        selectedFieldId: null
      };
    });
  }, []);

  const handleRedo = useCallback(() => {
    setState(prev => {
      if (prev.future.length === 0) return prev;

      const next = prev.future[0];
      const newFuture = prev.future.slice(1);

      const currentSnapshot: HistorySnapshot = {
        fields: prev.fields,
        metadata: prev.metadata
      };

      return {
        ...prev,
        fields: next.fields,
        metadata: next.metadata,
        past: [...prev.past, currentSnapshot],
        future: newFuture,
        selectedFieldId: null
      };
    });
  }, []);

  const handleDeleteField = useCallback(() => {
    setState(prev => {
        if (!prev.selectedFieldId) return prev;
        
        // Manual checkpoint logic duplicated here to access "prev" directly
        const snapshot: HistorySnapshot = {
            fields: prev.fields,
            metadata: prev.metadata
        };
        const newPast = [...prev.past, snapshot].slice(-50);

        return {
            ...prev,
            fields: prev.fields.filter(f => f.id !== prev.selectedFieldId),
            selectedFieldId: null,
            past: newPast,
            future: []
        };
    });
  }, []);

  const handleCopy = useCallback(() => {
    setState(prev => {
        if (!prev.selectedFieldId) return prev;
        const fieldToCopy = prev.fields.find(f => f.id === prev.selectedFieldId);
        return fieldToCopy ? { ...prev, clipboard: { ...fieldToCopy } } : prev;
    });
  }, []);

  const handlePaste = useCallback(() => {
    setState(prev => {
        if (!prev.clipboard) return prev;

        // Save history before paste
        const snapshot: HistorySnapshot = { fields: prev.fields, metadata: prev.metadata };
        const newPast = [...prev.past, snapshot].slice(-50);

        const newField: FormField = {
            ...prev.clipboard,
            id: `field_copy_${Date.now()}`,
            name: `${prev.clipboard.name}_copy`,
            rect: {
                ...prev.clipboard.rect,
                x: prev.clipboard.rect.x + 20,
                y: prev.clipboard.rect.y + 20
            }
        };

        return {
            ...prev,
            fields: [...prev.fields, newField],
            selectedFieldId: newField.id,
            past: newPast,
            future: []
        };
    });
  }, []);

  const handleCut = useCallback(() => {
    setState(prev => {
        if (!prev.selectedFieldId) return prev;
        const fieldToCut = prev.fields.find(f => f.id === prev.selectedFieldId);
        if (!fieldToCut) return prev;

        const snapshot: HistorySnapshot = { fields: prev.fields, metadata: prev.metadata };
        const newPast = [...prev.past, snapshot].slice(-50);

        return {
            ...prev,
            clipboard: { ...fieldToCut },
            fields: prev.fields.filter(f => f.id !== prev.selectedFieldId),
            selectedFieldId: null,
            past: newPast,
            future: []
        };
    });
  }, []);

  const handleMoveSelected = useCallback((dx: number, dy: number) => {
    setState(prev => {
        if (!prev.selectedFieldId) return prev;
        
        return {
            ...prev,
            fields: prev.fields.map(f => {
                if (f.id === prev.selectedFieldId) {
                    return {
                        ...f,
                        rect: {
                            ...f.rect,
                            x: f.rect.x + dx,
                            y: f.rect.y + dy
                        }
                    };
                }
                return f;
            })
        };
    });
  }, []);

  const handleNavigatePage = (pageIndex: number) => {
      setTimeout(() => {
          const el = document.getElementById(`page-${pageIndex}`);
          if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
      }, 0);
  };

  // Keyboard shortcuts effect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          if (e.key === 'Escape') {
              target.blur();
          }
          return;
      }

      // Help
      if (e.key === '?' && e.shiftKey) {
        e.preventDefault();
        setIsShortcutsHelpOpen(prev => !prev);
        return;
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteField();
        return;
      }

      // Deselect
      if (e.key === 'Escape') {
        e.preventDefault();
        setState(prev => ({ ...prev, selectedFieldId: null }));
        return;
      }

      // Arrow Keys (Move)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const multiplier = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        switch (e.key) {
            case 'ArrowUp': dy = -1 * multiplier; break;
            case 'ArrowDown': dy = 1 * multiplier; break;
            case 'ArrowLeft': dx = -1 * multiplier; break;
            case 'ArrowRight': dx = 1 * multiplier; break;
        }
        handleMoveSelected(dx, dy);
        return;
      }

      // Ctrl+S (Save/Export)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const btn = document.querySelector('button[aria-label="Export PDF"]');
        if(btn instanceof HTMLElement) btn.click();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
          switch (e.key.toLowerCase()) {
              case 'z':
                  e.preventDefault();
                  if (e.shiftKey) handleRedo();
                  else handleUndo();
                  break;
              case 'c':
                  e.preventDefault();
                  handleCopy();
                  break;
              case 'v':
                  e.preventDefault();
                  handlePaste();
                  break;
              case 'x':
                  e.preventDefault();
                  handleCut();
                  break;
          }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDeleteField, handleUndo, handleRedo, handleCopy, handlePaste, handleCut, handleMoveSelected]);


  // --- Actions ---

  const handleUpload = async (file: File) => {
    setState(prev => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t('app.parsing'));
    try {
      const { pdfBytes, pages, fields, metadata, outline } = await loadPDF(file);
      
      const fitScale = calculateFitScale(pages);

      setState(prev => ({
        ...prev,
        pdfFile: file,
        pdfBytes,
        metadata,
        filename: file.name,
        pages,
        fields: fields,
        outline: outline, // Store outline
        scale: fitScale, // Set initial scale to fit width
        past: [], // Reset history on new file
        future: [],
        isProcessing: false,
      }));
      
      if (fields.length > 0) {
          console.log(`Imported ${fields.length} existing form fields.`);
      }
    } catch (error) {
      console.error("Error loading PDF:", error);
      alert(t('app.load_error'));
      setState(prev => ({ ...prev, isProcessing: false }));
    } finally {
      setProcessingStatus(null);
    }
  };

  const handleAddField = (field: FormField) => {
    saveCheckpoint(); // Save before adding
    setState(prev => ({
      ...prev,
      fields: [...prev.fields, field],
      selectedFieldId: field.id,
      tool: 'select'
    }));
  };

  const handleUpdateField = (id: string, updates: Partial<FormField>) => {
    setState(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === id ? { ...f, ...updates } : f)
    }));
  };

  const handleMetadataChange = (updates: Partial<PDFMetadata>) => {
    setState(prev => ({
      ...prev,
      metadata: { ...prev.metadata, ...updates }
    }));
  };
  
  const handleSnappingOptionsChange = (newOptions: SnappingOptions) => {
      setState(prev => ({
          ...prev,
          snappingOptions: newOptions
      }));
  };

  const handleAutoDetect = async () => {
    if (state.pages.length === 0) return;

    setState(prev => ({ ...prev, isProcessing: true }));
    
    try {
        const newFields: FormField[] = [];
        const totalPages = state.pages.length;

        for (let i = 0; i < totalPages; i++) {
           const page = state.pages[i];
           setProcessingStatus(t('app.analyzing', { current: i + 1, total: totalPages }));
           
           // Filter fields already on this page to provide context to the AI
           const pageExistingFields = state.fields.filter(f => f.pageIndex === page.pageIndex);

           const fields = await analyzePageForFields(
               page.imageData, 
               page.pageIndex, 
               page.width, 
               page.height,
               pageExistingFields
            );
            
            const styledFields = fields.map(f => ({
                ...f,
                style: { 
                    ...DEFAULT_FIELD_STYLE,
                    ...(f.style || {})
                }
            }));

            newFields.push(...styledFields);
        }

        if (newFields.length > 0) {
            saveCheckpoint(); // Save before applying auto-detected fields
            setState(prev => ({
                ...prev,
                fields: [...prev.fields, ...newFields],
                isProcessing: false
            }));
        } else {
            alert(t('app.no_new_fields'));
            setState(prev => ({ ...prev, isProcessing: false }));
        }

    } catch (e) {
        console.error(e);
        alert(t('app.auto_detect_fail'));
        setState(prev => ({ ...prev, isProcessing: false }));
    } finally {
      setProcessingStatus(null);
    }
  };

  const generatePDF = async () => {
    if (!state.pdfBytes) return null;
    return await exportPDF(state.pdfBytes, state.fields, state.metadata);
  };

  const getDownloadName = () => {
    const name = state.filename || 'form.pdf';
    return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
  };

  const downloadPDF = (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    setState(prev => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t('app.generating'));

    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const modifiedBytes = await generatePDF();
      if (modifiedBytes) {
        downloadPDF(modifiedBytes, getDownloadName());
      }
    } catch (error) {
      console.error("Export failed:", error);
      alert(t('app.export_fail'));
    } finally {
      setState(prev => ({ ...prev, isProcessing: false }));
      setProcessingStatus(null);
    }
  };

  const handleSaveAndReopen = async () => {
    setState(prev => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t('app.saving_reloading'));

    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const modifiedBytes = await generatePDF();
      
      if (modifiedBytes) {
        const finalName = getDownloadName();
        downloadPDF(modifiedBytes, finalName);

        const newFile = new File([modifiedBytes], finalName, { type: 'application/pdf' });
        const { pdfBytes, pages, fields, metadata, outline } = await loadPDF(newFile);
        
        const fitScale = calculateFitScale(pages);

        setState(prev => ({
          ...prev,
          pdfFile: newFile,
          pdfBytes,
          pages,
          fields,
          metadata,
          outline,
          filename: finalName,
          selectedFieldId: null,
          isProcessing: false,
          scale: fitScale,
          past: [], 
          future: []
        }));
      }
    } catch (error) {
      console.error("Save and Reopen failed:", error);
      alert(t('app.save_reopen_fail'));
      setState(prev => ({ ...prev, isProcessing: false }));
    } finally {
      setProcessingStatus(null);
    }
  };

  const handleSaveAndClose = async () => {
    setState(prev => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t('app.saving_closing'));

    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const modifiedBytes = await generatePDF();
      
      if (modifiedBytes) {
        downloadPDF(modifiedBytes, getDownloadName());
        
        setState(prev => ({
            ...prev,
            pdfFile: null,
            pdfBytes: null,
            metadata: {},
            filename: 'document.pdf',
            pages: [],
            fields: [],
            outline: [],
            selectedFieldId: null,
            scale: 1.0,
            tool: 'select',
            isProcessing: false,
            past: [],
            future: [],
            clipboard: null
        }));
      }
    } catch (error) {
      console.error("Save and Close failed:", error);
      alert(t('app.save_close_fail'));
      setState(prev => ({ ...prev, isProcessing: false }));
    } finally {
      setProcessingStatus(null);
    }
  };

  const selectedField = state.fields.find(f => f.id === state.selectedFieldId) || null;

  return (
    <div className="h-full w-full flex flex-col">
      {state.pages.length === 0 ? (
        <LandingPage 
          onUpload={handleUpload}
        />
      ) : (
        <>
          <Toolbar 
            editorState={state}
            onToolChange={(tool) => setState(prev => ({ ...prev, tool, selectedFieldId: null }))}
            onExport={handleExport}
            onSaveAndReopen={handleSaveAndReopen}
            onSaveAndClose={handleSaveAndClose}
            onAutoDetect={handleAutoDetect}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={state.past.length > 0}
            canRedo={state.future.length > 0}
            onOpenShortcuts={() => setIsShortcutsHelpOpen(true)}
            isFieldListOpen={isSidebarOpen}
            onToggleFieldList={() => setIsSidebarOpen(!isSidebarOpen)}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          <div className="flex-1 flex overflow-hidden relative">
              <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                pages={state.pages}
                fields={state.fields}
                outline={state.outline}
                selectedFieldId={state.selectedFieldId}
                onSelectField={(id) => setState(prev => ({ ...prev, selectedFieldId: id }))}
                onNavigatePage={handleNavigatePage}
              />

              <div className="flex-1 relative flex flex-col min-w-0 overflow-hidden">
                  <Workspace
                    editorState={state}
                    onAddField={handleAddField}
                    onSelectField={(id) => setState(prev => ({ ...prev, selectedFieldId: id }))}
                    onUpdateField={handleUpdateField}
                    onScaleChange={updateScale}
                    onTriggerHistorySave={saveCheckpoint}
                  />
                  
                  <ZoomControls 
                      scale={state.scale}
                      onZoomIn={() => updateScale(state.scale + 0.25)}
                      onZoomOut={() => updateScale(state.scale - 0.25)}
                      onReset={() => updateScale(calculateFitScale(state.pages))}
                  />
              </div>

              <PropertiesPanel
                field={selectedField}
                metadata={state.metadata}
                filename={state.filename}
                onChange={(updates) => selectedField && handleUpdateField(selectedField.id, updates)}
                onMetadataChange={handleMetadataChange}
                onFilenameChange={(name) => setState(prev => ({ ...prev, filename: name }))}
                onDelete={handleDeleteField}
                onClose={() => setState(prev => ({ ...prev, selectedFieldId: null }))}
                isFloating={isPanelFloating}
                onToggleFloating={() => setIsPanelFloating(!isPanelFloating)}
                onTriggerHistorySave={saveCheckpoint}
              />
          </div>
        </>
      )}
      
      <KeyboardShortcutsHelp 
        isOpen={isShortcutsHelpOpen} 
        onClose={() => setIsShortcutsHelpOpen(false)} 
      />
      
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        options={state.snappingOptions}
        onChange={handleSnappingOptionsChange}
      />
      
      <Dialog open={state.isProcessing}>
        <DialogContent 
          showCloseButton={false} 
          className="sm:max-w-[300px] flex flex-col items-center justify-center text-center outline-none"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">{t('common.processing')}</DialogTitle>
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-foreground font-medium text-lg">{processingStatus || t('common.processing')}</p>
          <p className="text-muted-foreground text-sm mt-2">{t('app.wait')}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default App;
