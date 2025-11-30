import React, { useState, useEffect, useCallback } from 'react';
import Toolbar from './components/Toolbar';
import Workspace from './components/Workspace';
import { PropertiesPanel } from './components/PropertiesPanel';
import LandingPage from './components/LandingPage';
import ZoomControls from './components/ZoomControls';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';
import SettingsDialog from './components/SettingsDialog';
import AIDetectionDialog, { AIDetectionOptions } from './components/AIDetectionDialog';
import Sidebar from './components/Sidebar';
import { Dialog, DialogContent, DialogTitle } from './components/ui/dialog';
import { EditorState, FormField, PDFMetadata, HistorySnapshot, PageData, SnappingOptions, Annotation, FieldType } from './types';
import { loadPDF, exportPDF, renderPageToDataURL } from './services/pdfService';
import { analyzePageForFields } from './services/geminiService';
import { saveDraft, getDraft, clearDraft } from './services/storageService';
import { DEFAULT_FIELD_STYLE } from './constants';
import { useLanguage } from './components/language-provider';

const App: React.FC = () => {
  const { t } = useLanguage();
  const [state, setState] = useState<EditorState>({
    pdfFile: null,
    pdfBytes: null,
    pdfDocument: null,
    metadata: {},
    filename: 'document.pdf',
    pages: [],
    fields: [],
    annotations: [],
    outline: [],
    selectedFieldId: null,
    selectedAnnotationId: null,
    scale: 1.0,
    mode: 'annotation',
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
  const [isAIDetectOpen, setIsAIDetectOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); 
  const [hasSavedSession, setHasSavedSession] = useState(false);
  
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);

  useEffect(() => {
    getDraft().then(draft => {
      if (draft) setHasSavedSession(true);
    });
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.pages.length > 0) {
        e.preventDefault();
        e.returnValue = ''; 
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.pages.length]);

  useEffect(() => {
    if (state.pages.length > 0 && state.pdfBytes) {
      const timer = setTimeout(() => {
        handleSaveDraft(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state.fields, state.annotations, state.metadata, state.filename]);

  const calculateFitScale = useCallback((pagesList: PageData[]) => {
    if (!pagesList || pagesList.length === 0) return 1.0;
    const page = pagesList[0];
    if (!page.width) return 1.0;
    const SIDEBAR_WIDTH = isSidebarOpen ? sidebarWidth : 0;
    const PANEL_WIDTH = !isPanelFloating ? rightPanelWidth : 0;
    const PADDING = 96; 
    const availableWidth = window.innerWidth - SIDEBAR_WIDTH - PANEL_WIDTH - PADDING;
    const scale = availableWidth / page.width;
    return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
  }, [isSidebarOpen, isPanelFloating, sidebarWidth, rightPanelWidth]);

  const updateScale = (newScale: number) => {
     const clamped = Math.max(0.25, Math.min(5.0, newScale));
     setState(prev => ({ ...prev, scale: clamped }));
  };

  const saveCheckpoint = useCallback(() => {
    setState(prev => {
      const snapshot: HistorySnapshot = {
        fields: prev.fields,
        annotations: prev.annotations,
        metadata: prev.metadata
      };
      const newPast = [...prev.past, snapshot].slice(-50);
      return { ...prev, past: newPast, future: [] };
    });
  }, []);

  const handleUndo = useCallback(() => {
    setState(prev => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      const newPast = prev.past.slice(0, -1);
      const currentSnapshot: HistorySnapshot = { fields: prev.fields, annotations: prev.annotations, metadata: prev.metadata };
      return { ...prev, fields: previous.fields, annotations: previous.annotations, metadata: previous.metadata, past: newPast, future: [currentSnapshot, ...prev.future], selectedFieldId: null, selectedAnnotationId: null };
    });
  }, []);

  const handleRedo = useCallback(() => {
    setState(prev => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      const newFuture = prev.future.slice(1);
      const currentSnapshot: HistorySnapshot = { fields: prev.fields, annotations: prev.annotations, metadata: prev.metadata };
      return { ...prev, fields: next.fields, annotations: next.annotations, metadata: next.metadata, past: [...prev.past, currentSnapshot], future: newFuture, selectedFieldId: null, selectedAnnotationId: null };
    });
  }, []);

  const handleDelete = useCallback(() => {
    saveCheckpoint();
    setState(prev => {
        if (prev.selectedFieldId) {
            return { ...prev, fields: prev.fields.filter(f => f.id !== prev.selectedFieldId), selectedFieldId: null };
        }
        if (prev.selectedAnnotationId) {
            return { ...prev, annotations: prev.annotations.filter(a => a.id !== prev.selectedAnnotationId), selectedAnnotationId: null };
        }
        return prev;
    });
  }, [saveCheckpoint]);

  const handleDeleteAnnotation = (id: string) => {
      saveCheckpoint();
      setState(prev => ({
          ...prev,
          annotations: prev.annotations.filter(a => a.id !== id),
          selectedAnnotationId: null
      }));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Identify if we are inside a text editing context
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      // Handle Escape Key
      if (e.key === 'Escape') {
        if (isInput) target.blur();
        e.preventDefault();
        setState(prev => {
            if (prev.selectedFieldId || prev.selectedAnnotationId) {
                return { ...prev, selectedFieldId: null, selectedAnnotationId: null };
            }
            if (prev.tool !== 'select') {
                return { ...prev, tool: 'select' };
            }
            return prev;
        });
        return;
      }

      // Handle Delete/Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isInput && !(target as HTMLInputElement).readOnly) {
           return;
        }
        if (state.mode === 'annotation' && state.selectedFieldId) {
            return;
        }
        e.preventDefault();
        handleDelete();
        return;
      }

      // Block other shortcuts if typing in a writable input
      if (isInput && !(target as HTMLInputElement).readOnly) {
          return;
      }

      // Handle Arrow Keys for moving selected field
      if (state.selectedFieldId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
         e.preventDefault();
         const step = e.shiftKey ? 10 : 1;
         
         setState(prev => {
             const fieldIndex = prev.fields.findIndex(f => f.id === prev.selectedFieldId);
             if (fieldIndex === -1) return prev;
             
             const field = prev.fields[fieldIndex];
             let { x, y } = field.rect;
             
             switch (e.key) {
                 case 'ArrowUp': y -= step; break;
                 case 'ArrowDown': y += step; break;
                 case 'ArrowLeft': x -= step; break;
                 case 'ArrowRight': x += step; break;
             }

             const newFields = [...prev.fields];
             newFields[fieldIndex] = { ...field, rect: { ...field.rect, x, y } };
             
             return { ...prev, fields: newFields };
         });
         return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
         e.preventDefault();
         if (e.shiftKey) handleRedo(); else handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDelete, handleUndo, handleRedo, state.mode, state.selectedFieldId]);

  const handleUpload = async (file: File) => {
    setState(prev => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t('app.parsing'));
    try {
      const { pdfBytes, pdfDocument, pages, fields, metadata, outline } = await loadPDF(file);
      const fitScale = calculateFitScale(pages);
      setState(prev => ({
        ...prev,
        pdfFile: file,
        pdfBytes,
        pdfDocument,
        metadata,
        filename: file.name,
        pages,
        fields: fields,
        annotations: [],
        outline: outline,
        scale: fitScale,
        past: [],
        future: [],
        isProcessing: false,
      }));
    } catch (error) {
      console.error("Error loading PDF:", error);
      alert(t('app.load_error'));
      setState(prev => ({ ...prev, isProcessing: false }));
    } finally {
      setProcessingStatus(null);
    }
  };

  const handleResumeSession = async () => {
    const draft = await getDraft();
    if (!draft) return;
    setState(prev => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t('app.loading_draft'));
    try {
        // Re-load the PDF document from bytes as it is not serializable in DB
        const { pdfDocument, pages, outline } = await loadPDF(draft.pdfBytes);
        const fitScale = calculateFitScale(pages);
        setState(prev => ({
            ...prev,
            pdfFile: null,
            pdfBytes: draft.pdfBytes,
            pdfDocument,
            pages,
            outline,
            fields: draft.fields,
            annotations: [], // Annotations in session not fully supported yet in saving service
            metadata: draft.metadata,
            filename: draft.filename,
            scale: fitScale,
            past: [],
            future: [],
            isProcessing: false
        }));
    } catch (error) {
        console.error("Failed to resume session:", error);
        alert(t('app.load_error'));
        setState(prev => ({ ...prev, isProcessing: false }));
    } finally {
        setProcessingStatus(null);
    }
  };

  const handleAddField = (field: FormField) => {
    saveCheckpoint();
    setState(prev => ({ ...prev, fields: [...prev.fields, field], selectedFieldId: field.id }));
  };

  const handleAddAnnotation = (annotation: Annotation) => {
      saveCheckpoint();
      setState(prev => ({ ...prev, annotations: [...prev.annotations, annotation], selectedAnnotationId: annotation.id }));
  };

  const handleUpdateField = (id: string, updates: Partial<FormField>) => {
    setState(prev => {
        let newFields = prev.fields;
        
        // Handle Radio Exclusivity
        if (updates.isChecked === true) {
             const targetField = prev.fields.find(f => f.id === id);
             if (targetField && targetField.type === FieldType.RADIO) {
                 newFields = newFields.map(f => 
                    (f.name === targetField.name && f.id !== id && f.type === FieldType.RADIO)
                    ? { ...f, isChecked: false } 
                    : f
                 );
             }
        }

        newFields = newFields.map(f => f.id === id ? { ...f, ...updates } : f);
        return { ...prev, fields: newFields };
    });
  };

  const handleUpdateAnnotation = (id: string, updates: Partial<Annotation>) => {
      setState(prev => ({ ...prev, annotations: prev.annotations.map(a => a.id === id ? { ...a, ...updates } : a) }));
  };

  const handleAdvancedDetect = async (options: AIDetectionOptions) => {
    if (state.pages.length === 0 || !state.pdfDocument) return;

    // Parse the page range from options
    const targetPageIndices = (() => {
        const range = options.pageRange;
        const totalPages = state.pages.length;
        if (!range || range.toLowerCase() === 'all') {
            return Array.from({ length: totalPages }, (_, i) => i);
        }
        
        const pages = new Set<number>();
        const parts = range.split(',');
        for (const part of parts) {
            const p = part.trim();
            if (!p) continue;

            if (p.includes('-')) {
               const [start, end] = p.split('-').map(n => parseInt(n));
               if (!isNaN(start) && !isNaN(end)) {
                   for (let i = start; i <= end; i++) {
                       if (i >= 1 && i <= totalPages) pages.add(i - 1);
                   }
               }
            } else {
               const num = parseInt(p);
               if (!isNaN(num) && num >= 1 && num <= totalPages) {
                   pages.add(num - 1);
               }
            }
        }
        return Array.from(pages).sort((a, b) => a - b);
    })();

    if (targetPageIndices.length === 0) {
        alert("Invalid page range selected.");
        return;
    }

    setState(prev => ({ ...prev, isProcessing: true }));
    let allNewFields: FormField[] = [];

    try {
       for (let i = 0; i < targetPageIndices.length; i++) {
           const pageIndex = targetPageIndices[i];
           const page = state.pages[pageIndex];
           
           setProcessingStatus(t('app.analyzing', { current: i + 1, total: targetPageIndices.length }));
           
           const base64Image = await renderPageToDataURL(state.pdfDocument, pageIndex);
           
           if (base64Image) {
               const fields = await analyzePageForFields(
                   base64Image, 
                   page.pageIndex, 
                   page.width, 
                   page.height, 
                   [], 
                   { 
                       allowedTypes: options.allowedTypes.length > 0 ? options.allowedTypes : undefined,
                       extraPrompt: options.extraPrompt 
                   }
               );
               
               // Apply custom style if needed
               if (options.useCustomStyle) {
                   fields.forEach(f => {
                       f.style = { ...f.style, ...options.defaultStyle };
                   });
               }

               allNewFields = [...allNewFields, ...fields];
           }
       }

       if (allNewFields.length > 0) {
            saveCheckpoint();
            setState(prev => ({ ...prev, fields: [...prev.fields, ...allNewFields], isProcessing: false }));
       } else {
            alert(t('app.no_new_fields'));
            setState(prev => ({ ...prev, isProcessing: false }));
       }

    } catch (e) {
        console.error(e);
        setState(prev => ({ ...prev, isProcessing: false }));
        alert(t('app.auto_detect_fail'));
    } finally {
        setProcessingStatus(null);
    }
  };

  const generatePDF = async () => {
    if (!state.pdfBytes) return null;
    return await exportPDF(state.pdfBytes, state.fields, state.metadata, state.annotations);
  };

  const handleExport = async () => {
    setState(prev => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t('app.generating'));
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const modifiedBytes = await generatePDF();
      if (modifiedBytes) {
        const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = state.filename || 'document.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error("Export failed:", error);
      alert(t('app.export_fail'));
    } finally {
      setState(prev => ({ ...prev, isProcessing: false }));
      setProcessingStatus(null);
    }
  };
  
  const handleSaveDraft = async (silent = false) => {
    if (!state.pdfBytes) return;
    if (!silent) { setState(prev => ({ ...prev, isProcessing: true })); setProcessingStatus(t('app.saving_draft')); }
    try {
        await saveDraft({ pdfBytes: state.pdfBytes, fields: state.fields, metadata: state.metadata, filename: state.filename });
        setHasSavedSession(true);
    } catch (error) { if (!silent) alert("Failed to save draft."); } 
    finally { if (!silent) { setState(prev => ({ ...prev, isProcessing: false })); setProcessingStatus(null); } }
  };

  const handleSaveAndClose = async () => {
     // ... similar logic
     await handleExport();
     await clearDraft();
     window.location.reload();
  };

  const selectedField = state.fields.find(f => f.id === state.selectedFieldId) || null;

  return (
    <div className="h-full w-full flex flex-col">
      {state.pages.length === 0 ? (
        <LandingPage onUpload={handleUpload} hasSavedSession={hasSavedSession} onResume={handleResumeSession} />
      ) : (
        <>
          <Toolbar 
            editorState={state}
            onToolChange={(tool) => setState(prev => ({ ...prev, tool, selectedFieldId: null, selectedAnnotationId: null }))}
            onModeChange={(mode) => setState(prev => ({ ...prev, mode, tool: 'select' }))}
            onExport={handleExport}
            onSaveDraft={() => handleSaveDraft(false)}
            onSaveAndClose={handleSaveAndClose}
            onAutoDetect={() => handleAdvancedDetect({ pageRange: 'All', allowedTypes: [], extraPrompt: '', defaultStyle: DEFAULT_FIELD_STYLE, useCustomStyle: false })}
            onCustomAutoDetect={() => setIsAIDetectOpen(true)}
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
                onSelectField={(id) => {
                    setState(prev => ({ ...prev, selectedFieldId: id, selectedAnnotationId: null }));
                    // Scroll to field and focus input
                    setTimeout(() => {
                        const el = document.getElementById(`field-element-${id}`);
                        if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                            // Try to find an input/textarea/select to focus
                            const input = el.querySelector('input, textarea, select') as HTMLElement;
                            if (input) {
                                input.focus({ preventScroll: true });
                            }
                        }
                    }, 50);
                }}
                onNavigatePage={(idx) => { document.getElementById(`page-${idx}`)?.scrollIntoView({ behavior: 'smooth' }); }}
                width={sidebarWidth}
                onResize={setSidebarWidth}
              />

              <div className="flex-1 relative flex flex-col min-w-0 overflow-hidden">
                  <Workspace
                    editorState={state}
                    onAddField={handleAddField}
                    onAddAnnotation={handleAddAnnotation}
                    onSelectField={(id) => setState(prev => ({ ...prev, selectedFieldId: id, selectedAnnotationId: null }))}
                    onSelectAnnotation={(id) => setState(prev => ({ ...prev, selectedAnnotationId: id, selectedFieldId: null }))}
                    onUpdateField={handleUpdateField}
                    onUpdateAnnotation={handleUpdateAnnotation}
                    onDeleteAnnotation={handleDeleteAnnotation}
                    onScaleChange={updateScale}
                    onTriggerHistorySave={saveCheckpoint}
                  />
                  <ZoomControls 
                      scale={state.scale}
                      onZoomIn={() => updateScale(state.scale * 1.25)}
                      onZoomOut={() => updateScale(state.scale / 1.25)}
                      onReset={() => updateScale(calculateFitScale(state.pages))}
                  />
              </div>

              {state.mode === 'form' && (
                  <PropertiesPanel
                    field={selectedField}
                    metadata={state.metadata}
                    filename={state.filename}
                    onChange={(updates) => selectedField && handleUpdateField(selectedField.id, updates)}
                    onMetadataChange={(m) => setState(prev => ({...prev, metadata: {...prev.metadata, ...m}}))}
                    onFilenameChange={(name) => setState(prev => ({...prev, filename: name}))}
                    onDelete={handleDelete}
                    onClose={() => setState(prev => ({ ...prev, selectedFieldId: null }))}
                    isFloating={isPanelFloating}
                    onToggleFloating={() => setIsPanelFloating(!isPanelFloating)}
                    onTriggerHistorySave={saveCheckpoint}
                    width={rightPanelWidth}
                    onResize={setRightPanelWidth}
                  />
              )}
          </div>
        </>
      )}
      
      <KeyboardShortcutsHelp isOpen={isShortcutsHelpOpen} onClose={() => setIsShortcutsHelpOpen(false)} />
      <SettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} options={state.snappingOptions} onChange={(o) => setState(prev => ({...prev, snappingOptions: o}))} />
      <AIDetectionDialog isOpen={isAIDetectOpen} onClose={() => setIsAIDetectOpen(false)} onConfirm={handleAdvancedDetect} totalPages={state.pages.length} />
      
      <Dialog open={state.isProcessing}>
        <DialogContent showCloseButton={false} className="sm:max-w-[300px] flex flex-col items-center justify-center text-center">
          <DialogTitle className="sr-only">{t('common.processing')}</DialogTitle>
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-foreground font-medium text-lg">{processingStatus || t('common.processing')}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default App;