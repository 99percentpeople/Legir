
import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { EditorState, FormField, FieldType } from '../types';
import { DEFAULT_FIELD_STYLE } from '../constants';
import { Check, ChevronDown, CircleDot } from 'lucide-react';
import { cn } from '../lib/utils';

interface WorkspaceProps {
  editorState: EditorState;
  onAddField: (field: FormField) => void;
  onSelectField: (id: string | null) => void;
  onUpdateField: (id: string, updates: Partial<FormField>) => void;
  onScaleChange: (newScale: number) => void;
  onTriggerHistorySave: () => void;
}

interface SnapLine {
  type: 'vertical' | 'horizontal';
  pos: number; // x or y coordinate
  start: number;
  end: number;
}

const Workspace: React.FC<WorkspaceProps> = ({ 
  editorState, 
  onAddField, 
  onSelectField, 
  onUpdateField, 
  onScaleChange,
  onTriggerHistorySave
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);
  
  const [movingFieldId, setMovingFieldId] = useState<string | null>(null);
  const [moveOffset, setMoveOffset] = useState<{ x: number; y: number } | null>(null);
  // Store initial position for Shift-axis-locking
  const [moveStartRaw, setMoveStartRaw] = useState<{ x: number; y: number, originalRect: { x: number, y: number } } | null>(null);

  const [resizingFieldId, setResizingFieldId] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{
      originalRect: { x: number, y: number, width: number, height: number },
      mouseX: number,
      mouseY: number
  } | null>(null);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);

  // Visual guides for snapping
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);

  const zoomAnchorRef = useRef<{
    xRatio: number;   
    yRatio: number;   
    mouseX: number;   
    mouseY: number;   
  } | null>(null);

  const prevScaleRef = useRef(editorState.scale);
  const scrollPosRef = useRef({ x: 0, y: 0 });

  const handleScroll = () => {
    if (containerRef.current) {
        scrollPosRef.current = {
            x: containerRef.current.scrollLeft,
            y: containerRef.current.scrollTop
        };
    }
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    
    if (!container || !content) return;

    if (zoomAnchorRef.current) {
      const { xRatio, yRatio, mouseX, mouseY } = zoomAnchorRef.current;
      const contentRect = content.getBoundingClientRect();
      
      container.scrollLeft = (xRatio * contentRect.width) - mouseX;
      container.scrollTop = (yRatio * contentRect.height) - mouseY;
      
      zoomAnchorRef.current = null;
    } else if (prevScaleRef.current !== editorState.scale) {
       const oldScale = prevScaleRef.current;
       const newScale = editorState.scale;
       const scaleRatio = newScale / oldScale;
       
       const rect = container.getBoundingClientRect();
       const viewportW = rect.width;
       const viewportH = rect.height;
       
       const oldScrollLeft = scrollPosRef.current.x;
       const oldScrollTop = scrollPosRef.current.y;
       
       const centerX_old = oldScrollLeft + (viewportW / 2);
       const centerY_old = oldScrollTop + (viewportH / 2);
       
       const centerX_new = centerX_old * scaleRatio;
       const centerY_new = centerY_old * scaleRatio;
       
       container.scrollLeft = centerX_new - (viewportW / 2);
       container.scrollTop = centerY_new - (viewportH / 2);
    }
    
    prevScaleRef.current = editorState.scale;
    scrollPosRef.current = {
        x: container.scrollLeft,
        y: container.scrollTop
    };
  }, [editorState.scale]);

  useEffect(() => {
    if (editorState.selectedFieldId) {
        const el = document.getElementById(`field-element-${editorState.selectedFieldId}`);
        if (el && containerRef.current) {
            const rect = el.getBoundingClientRect();
            const containerRect = containerRef.current.getBoundingClientRect();

            const isOutOfView = 
                rect.top < containerRect.top || 
                rect.bottom > containerRect.bottom || 
                rect.left < containerRect.left || 
                rect.right > containerRect.right;

            if (isOutOfView) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        }
    }
  }, [editorState.selectedFieldId]);


  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        
        const delta = -Math.sign(e.deltaY) * 0.1; 
        const currentScale = editorState.scale;
        let newScale = currentScale + delta;
        newScale = Math.max(0.25, Math.min(4.0, newScale));
        
        if (newScale === currentScale || !contentRef.current) return;

        const containerRect = container.getBoundingClientRect();
        const contentRect = contentRef.current.getBoundingClientRect();
        
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;
        
        const xRatio = (e.clientX - contentRect.left) / contentRect.width;
        const yRatio = (e.clientY - contentRect.top) / contentRect.height;

        zoomAnchorRef.current = { xRatio, yRatio, mouseX, mouseY };

        onScaleChange(Number(newScale.toFixed(2)));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [editorState.scale, onScaleChange]);

  const getRelativeCoords = (e: React.MouseEvent, pageIndex: number) => {
    const pageEl = document.getElementById(`page-${pageIndex}`);
    if (!pageEl) return { x: 0, y: 0 };
    const rect = pageEl.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / editorState.scale,
      y: (e.clientY - rect.top) / editorState.scale,
    };
  };

  // --- Snapping Helper ---
  const applySnapping = (
    rect: { x: number, y: number, width: number, height: number },
    pageIndex: number,
    excludeId: string | null,
    threshold: number
  ) => {
    const { snapToBorders, snapToCenter, snapToEqualDistances } = editorState.snappingOptions;
    const guides: SnapLine[] = [];
    let { x, y } = rect;
    
    const otherFields = editorState.fields.filter(f => f.pageIndex === pageIndex && f.id !== excludeId);
    
    let bestDx = Infinity;
    let snapX: number | null = null;
    let guideX: number | null = null;

    const checkSnap = (diff: number, newPos: number, guidePos: number) => {
        if (Math.abs(diff) < Math.abs(bestDx) && Math.abs(diff) < threshold) {
            bestDx = diff;
            snapX = newPos;
            guideX = guidePos;
        }
    };

    otherFields.forEach(f => {
        // X Axis - Border Snapping
        if (snapToBorders) {
            // My Left -> Their Left
            checkSnap(f.rect.x - x, f.rect.x, f.rect.x);
            // My Left -> Their Right
            checkSnap((f.rect.x + f.rect.width) - x, f.rect.x + f.rect.width, f.rect.x + f.rect.width);
            // My Right -> Their Left
            checkSnap(f.rect.x - (x + rect.width), f.rect.x - rect.width, f.rect.x);
            // My Right -> Their Right
            checkSnap((f.rect.x + f.rect.width) - (x + rect.width), (f.rect.x + f.rect.width) - rect.width, f.rect.x + f.rect.width);
        }
        // X Axis - Center Snapping
        if (snapToCenter) {
            const theirCenter = f.rect.x + f.rect.width / 2;
            const myCenter = x + rect.width / 2;
            checkSnap(theirCenter - myCenter, theirCenter - rect.width / 2, theirCenter);
        }
    });

    // Equidistant Snapping (X)
    if (snapToEqualDistances && otherFields.length >= 1) {
         const intervals = otherFields
            .map(f => ({ start: f.rect.x, end: f.rect.x + f.rect.width }))
            .sort((a, b) => a.start - b.start);
         
         for (let i = 0; i < intervals.length - 1; i++) {
             const A = intervals[i];
             const B = intervals[i+1];
             const gap = B.start - A.end;
             
             // Case 1: [A] [B] [Me] -> Snap Me.Left to B.end + gap
             const targetLeft = B.end + gap;
             checkSnap(targetLeft - x, targetLeft, targetLeft);

             // Case 2: [Me] [A] [B] -> Snap Me.Right to A.start - gap
             const targetRight = A.start - gap;
             checkSnap(targetRight - (x + rect.width), targetRight - rect.width, targetRight);

             // Case 3: [A] [Me] [B] -> Center Me between A and B
             const targetMid = (A.end + B.start - rect.width) / 2;
             checkSnap(targetMid - x, targetMid, targetMid + rect.width/2);
         }
    }

    if (snapX !== null && guideX !== null) {
        x = snapX;
        guides.push({ type: 'vertical', pos: guideX, start: 0, end: 2000 });
    }

    // --- Y Axis Snapping ---
    let bestDy = Infinity;
    let snapY: number | null = null;
    let guideY: number | null = null;

    const checkSnapY = (diff: number, newPos: number, guidePos: number) => {
        if (Math.abs(diff) < Math.abs(bestDy) && Math.abs(diff) < threshold) {
            bestDy = diff;
            snapY = newPos;
            guideY = guidePos;
        }
    };

    otherFields.forEach(f => {
        // Y Axis - Border Snapping
        if (snapToBorders) {
            // Top to Top
            checkSnapY(f.rect.y - y, f.rect.y, f.rect.y);
            // Top to Bottom
            checkSnapY((f.rect.y + f.rect.height) - y, f.rect.y + f.rect.height, f.rect.y + f.rect.height);
            // Bottom to Top
            checkSnapY(f.rect.y - (y + rect.height), f.rect.y - rect.height, f.rect.y);
            // Bottom to Bottom
            checkSnapY((f.rect.y + f.rect.height) - (y + rect.height), (f.rect.y + f.rect.height) - rect.height, f.rect.y + f.rect.height);
        }
        // Y Axis - Center Snapping
        if (snapToCenter) {
            const theirCenter = f.rect.y + f.rect.height / 2;
            const myCenter = y + rect.height / 2;
            checkSnapY(theirCenter - myCenter, theirCenter - rect.height / 2, theirCenter);
        }
    });

    // Equidistant Snapping (Y)
    if (snapToEqualDistances && otherFields.length >= 1) {
         const intervals = otherFields
            .map(f => ({ start: f.rect.y, end: f.rect.y + f.rect.height }))
            .sort((a, b) => a.start - b.start);
         
         for (let i = 0; i < intervals.length - 1; i++) {
             const A = intervals[i];
             const B = intervals[i+1];
             const gap = B.start - A.end;
             
             const targetTop = B.end + gap;
             checkSnapY(targetTop - y, targetTop, targetTop);

             const targetBottom = A.start - gap;
             checkSnapY(targetBottom - (y + rect.height), targetBottom - rect.height, targetBottom);

             const targetMid = (A.end + B.start - rect.height) / 2;
             checkSnapY(targetMid - y, targetMid, targetMid + rect.height/2);
         }
    }

    if (snapY !== null && guideY !== null) {
        y = snapY;
        guides.push({ type: 'horizontal', pos: guideY, start: 0, end: 2000 });
    }

    return { x, y, guides };
  };


  const handleMouseDown = (e: React.MouseEvent, pageIndex: number) => {
    if (e.button === 1) return; 

    if (editorState.tool === 'select') {
       if (e.target === e.currentTarget) {
         onSelectField(null);
       }
       return;
    }

    setActivePageIndex(pageIndex);
    const coords = getRelativeCoords(e, pageIndex);
    setDragStart(coords);
    setDragCurrent(coords);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (activePageIndex === null) return;
    
    setSnapLines([]); // Reset guides

    const coords = getRelativeCoords(e, activePageIndex);
    const { enabled, threshold: baseThreshold, snapToBorders, snapToCenter } = editorState.snappingOptions;
    const threshold = baseThreshold / editorState.scale;
    const shouldSnap = enabled && !e.altKey;

    // --- CREATING ---
    if (dragStart) {
      let newX = coords.x;
      let newY = coords.y;

      // 1. Shift - Square Constraint
      if (e.shiftKey) {
          const dx = coords.x - dragStart.x;
          const dy = coords.y - dragStart.y;
          const maxDim = Math.max(Math.abs(dx), Math.abs(dy));
          
          newX = dragStart.x + (dx < 0 ? -maxDim : maxDim);
          newY = dragStart.y + (dy < 0 ? -maxDim : maxDim);
      }

      // 2. Snapping (Simple point snapping for creation)
      if (shouldSnap) {
           const pointTargetsX: number[] = [];
           const pointTargetsY: number[] = [];
           const otherFields = editorState.fields.filter(f => f.pageIndex === activePageIndex);
           otherFields.forEach(f => {
               if (snapToBorders) {
                    pointTargetsX.push(f.rect.x, f.rect.x + f.rect.width);
                    pointTargetsY.push(f.rect.y, f.rect.y + f.rect.height);
               }
               if (snapToCenter) {
                    pointTargetsX.push(f.rect.x + f.rect.width/2);
                    pointTargetsY.push(f.rect.y + f.rect.height/2);
               }
           });

           let guideX = null;
           let guideY = null;

           // Snap X
           let bestDistX = threshold;
           for(const tx of pointTargetsX) {
               if (Math.abs(newX - tx) < bestDistX) {
                   bestDistX = Math.abs(newX - tx);
                   newX = tx;
                   guideX = tx;
               }
           }
           
           // Snap Y
           let bestDistY = threshold;
           for(const ty of pointTargetsY) {
               if (Math.abs(newY - ty) < bestDistY) {
                   bestDistY = Math.abs(newY - ty);
                   newY = ty;
                   guideY = ty;
               }
           }

           const lines: SnapLine[] = [];
           if (guideX !== null) lines.push({ type: 'vertical', pos: guideX, start: 0, end: 2000 });
           if (guideY !== null) lines.push({ type: 'horizontal', pos: guideY, start: 0, end: 2000 });
           setSnapLines(lines);
      }
      
      setDragCurrent({ x: newX, y: newY });

    } 
    // --- MOVING ---
    else if (movingFieldId && moveOffset && moveStartRaw) {
      const field = editorState.fields.find(f => f.id === movingFieldId);
      if (field) {
          let newX = coords.x - moveOffset.x;
          let newY = coords.y - moveOffset.y;
          
          // 1. Shift - Axis Lock
          if (e.shiftKey) {
              const totalDx = coords.x - moveStartRaw.x;
              const totalDy = coords.y - moveStartRaw.y;
              
              if (Math.abs(totalDx) > Math.abs(totalDy)) {
                  newY = moveStartRaw.originalRect.y; // Lock Y
              } else {
                  newX = moveStartRaw.originalRect.x; // Lock X
              }
          }

          // 2. Snapping
          if (shouldSnap) {
              const snapResult = applySnapping(
                  { x: newX, y: newY, width: field.rect.width, height: field.rect.height }, 
                  activePageIndex, 
                  movingFieldId, 
                  threshold
              );
              newX = snapResult.x;
              newY = snapResult.y;
              setSnapLines(snapResult.guides);
          }

          onUpdateField(movingFieldId, {
              rect: { ...field.rect, x: newX, y: newY }
          });
      }
    } 
    // --- RESIZING ---
    else if (resizingFieldId && resizeStart && resizeHandle) {
        const dx = coords.x - resizeStart.mouseX;
        const dy = coords.y - resizeStart.mouseY;
        const original = resizeStart.originalRect;
        
        let newX = original.x;
        let newY = original.y;
        let newW = original.width;
        let newH = original.height;

        // Calculate raw new dims
        if (resizeHandle.includes('e')) newW = Math.max(10, original.width + dx);
        if (resizeHandle.includes('w')) {
            const maxDx = original.width - 10;
            const effDx = Math.min(dx, maxDx);
            newX = original.x + effDx;
            newW = original.width - effDx;
        }
        if (resizeHandle.includes('s')) newH = Math.max(10, original.height + dy);
        if (resizeHandle.includes('n')) {
            const maxDy = original.height - 10;
            const effDy = Math.min(dy, maxDy);
            newY = original.y + effDy;
            newH = original.height - effDy;
        }
        
        // Apply Snapping to the moving edges
        if (shouldSnap) {
             const pointTargetsX: number[] = [];
             const pointTargetsY: number[] = [];
             editorState.fields.filter(f => f.pageIndex === activePageIndex && f.id !== resizingFieldId).forEach(f => {
                  if (snapToBorders) {
                      pointTargetsX.push(f.rect.x, f.rect.x + f.rect.width);
                      pointTargetsY.push(f.rect.y, f.rect.y + f.rect.height);
                  }
                  if (snapToCenter) {
                      pointTargetsX.push(f.rect.x + f.rect.width/2);
                      pointTargetsY.push(f.rect.y + f.rect.height/2);
                  }
             });
             
             const snapVal = (val: number, targets: number[]) => {
                 let best = val;
                 let dist = threshold;
                 for(const t of targets) {
                     if(Math.abs(val - t) < dist) { dist = Math.abs(val-t); best = t; }
                 }
                 return { val: best, snapped: best !== val };
             };
             
             const guides: SnapLine[] = [];

             if (resizeHandle.includes('e')) {
                 const s = snapVal(newX + newW, pointTargetsX);
                 if(s.snapped) { newW = s.val - newX; guides.push({type:'vertical', pos: s.val, start:0, end:2000}); }
             }
             if (resizeHandle.includes('w')) {
                 const s = snapVal(newX, pointTargetsX);
                 if(s.snapped) { 
                     const diff = s.val - newX; 
                     newX = s.val; 
                     newW -= diff; 
                     guides.push({type:'vertical', pos: s.val, start:0, end:2000}); 
                 }
             }
             if (resizeHandle.includes('s')) {
                 const s = snapVal(newY + newH, pointTargetsY);
                 if(s.snapped) { newH = s.val - newY; guides.push({type:'horizontal', pos: s.val, start:0, end:2000}); }
             }
             if (resizeHandle.includes('n')) {
                 const s = snapVal(newY, pointTargetsY);
                 if(s.snapped) { 
                     const diff = s.val - newY; 
                     newY = s.val; 
                     newH -= diff; 
                     guides.push({type:'horizontal', pos: s.val, start:0, end:2000}); 
                 }
             }
             setSnapLines(guides);
        }

        // Apply Shift Key - Square Constraint
        if (e.shiftKey) {
            const dim = Math.max(newW, newH);
            newW = dim;
            newH = dim;
            
            if (resizeHandle.includes('w')) {
                newX = (resizeStart.originalRect.x + resizeStart.originalRect.width) - newW;
            }
            if (resizeHandle.includes('n')) {
                newY = (resizeStart.originalRect.y + resizeStart.originalRect.height) - newH;
            }
        }

        onUpdateField(resizingFieldId, {
            rect: { x: newX, y: newY, width: newW, height: newH }
        });
    }
  };

  const handleMouseUp = () => {
    if (dragStart && dragCurrent && activePageIndex !== null) {
      const width = Math.abs(dragCurrent.x - dragStart.x);
      const height = Math.abs(dragCurrent.y - dragStart.y);
      const x = Math.min(dragStart.x, dragCurrent.x);
      const y = Math.min(dragStart.y, dragCurrent.y);

      if (width > 5 && height > 5) {
        let type = FieldType.TEXT;
        if (editorState.tool === 'draw_checkbox') type = FieldType.CHECKBOX;
        else if (editorState.tool === 'draw_radio') type = FieldType.RADIO;
        else if (editorState.tool === 'draw_dropdown') type = FieldType.DROPDOWN;

        const newField: FormField = {
          id: `field_${Date.now()}`,
          pageIndex: activePageIndex,
          type,
          name: `${type}_${editorState.fields.length + 1}`,
          rect: { x, y, width, height },
          style: { ...DEFAULT_FIELD_STYLE },
          options: type === FieldType.DROPDOWN ? ['Option 1', 'Option 2'] : undefined,
          radioValue: type === FieldType.RADIO ? 'Choice1' : undefined
        };
        onAddField(newField);
      }
    }

    setDragStart(null);
    setDragCurrent(null);
    setActivePageIndex(null);
    setMovingFieldId(null);
    setMoveStartRaw(null);
    setResizingFieldId(null);
    setResizeStart(null);
    setResizeHandle(null);
    setSnapLines([]);
  };

  const handleFieldMouseDown = (e: React.MouseEvent, field: FormField) => {
    e.stopPropagation();
    if (editorState.tool !== 'select') return;
    
    onTriggerHistorySave();

    onSelectField(field.id);
    setActivePageIndex(field.pageIndex);
    const coords = getRelativeCoords(e, field.pageIndex);
    setMovingFieldId(field.id);
    setMoveOffset({
      x: coords.x - field.rect.x,
      y: coords.y - field.rect.y
    });
    setMoveStartRaw({
        x: coords.x,
        y: coords.y,
        originalRect: { ...field.rect }
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent, field: FormField, handle: string) => {
      e.stopPropagation();
      if (editorState.tool !== 'select') return;
      
      onTriggerHistorySave();
      
      setActivePageIndex(field.pageIndex);
      const coords = getRelativeCoords(e, field.pageIndex);

      setResizingFieldId(field.id);
      setResizeHandle(handle);
      setResizeStart({
          originalRect: { ...field.rect },
          mouseX: coords.x,
          mouseY: coords.y
      });
  }

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900 relative transition-colors duration-200"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onScroll={handleScroll}
    >
      <div 
        ref={contentRef}
        className="flex flex-col items-center gap-8 min-h-full p-8 pb-20 w-fit mx-auto"
      >
        {editorState.pages.map((page) => (
          <div 
            key={page.pageIndex} 
            className="relative bg-white shadow-lg transition-shadow hover:shadow-xl origin-top"
            style={{ 
              width: page.width * editorState.scale, 
              height: page.height * editorState.scale 
            }}
          >
            <img
              id={`page-${page.pageIndex}`}
              src={page.imageData}
              alt={`Page ${page.pageIndex + 1}`}
              className="w-full h-full pointer-events-none select-none"
              draggable={false}
            />
            
            {/* Snap Guides Layer */}
            {activePageIndex === page.pageIndex && (
                <div className="absolute inset-0 pointer-events-none z-50">
                    {snapLines.map((line, idx) => (
                        <div
                            key={idx}
                            className="absolute border-red-500 border-dashed opacity-70"
                            style={{
                                borderWidth: 0,
                                [line.type === 'vertical' ? 'borderLeftWidth' : 'borderTopWidth']: '1px',
                                left: line.type === 'vertical' ? line.pos * editorState.scale : 0,
                                top: line.type === 'horizontal' ? line.pos * editorState.scale : 0,
                                width: line.type === 'vertical' ? '1px' : '100%',
                                height: line.type === 'horizontal' ? '1px' : '100%',
                            }}
                        />
                    ))}
                </div>
            )}

            <div 
              className={`absolute inset-0 ${editorState.tool !== 'select' ? 'cursor-crosshair' : ''}`}
              onMouseDown={(e) => handleMouseDown(e, page.pageIndex)}
            >
              {editorState.fields
                .filter(f => f.pageIndex === page.pageIndex)
                .map(field => {
                  const isSelected = editorState.selectedFieldId === field.id;
                  const style = field.style || {};
                  const isRadio = field.type === FieldType.RADIO;
                  
                  const borderWidth = style.borderWidth ?? 1;
                  const isTransparent = style.isTransparent;
                  const borderColor = style.borderColor || DEFAULT_FIELD_STYLE.borderColor;
                  const backgroundColor = style.backgroundColor || DEFAULT_FIELD_STYLE.backgroundColor;
                  
                  // Helpers for visibility in editor when controls are invisible
                  const showHelperBorder = (borderWidth === 0) && !isSelected;
                  const showHelperBg = isTransparent && !isSelected;

                  const isLandscape = field.rect.width > field.rect.height;
                  const applyStylesToContainer = !isRadio;
                  
                  return (
                    <div
                      key={field.id}
                      id={`field-element-${field.id}`}
                      onMouseDown={(e) => handleFieldMouseDown(e, field)}
                      className={cn(
                        "absolute group select-none",
                        isSelected ? 'z-20' : 'z-10 hover:z-20',
                      )}
                      style={{
                        left: field.rect.x * editorState.scale,
                        top: field.rect.y * editorState.scale,
                        width: field.rect.width * editorState.scale,
                        height: field.rect.height * editorState.scale,
                        cursor: editorState.tool === 'select' ? 'move' : 'default',
                      }}
                    >
                      {/* --- Content Container --- */}
                      <div 
                        className={cn(
                          "w-full h-full relative transition-colors flex items-center",
                          !isRadio && "overflow-hidden",
                          isRadio && "justify-center",
                          showHelperBg && "bg-blue-500/10 dark:bg-blue-400/10 hover:bg-blue-500/20 dark:hover:bg-blue-400/20",
                          showHelperBorder && "border border-dashed border-blue-400/50",
                        )}
                        style={{
                          backgroundColor: (applyStylesToContainer && !isTransparent) ? backgroundColor : undefined,
                          // Apply border only if not using helper dashed border
                          borderWidth: (applyStylesToContainer && !showHelperBorder) ? borderWidth : undefined,
                          borderColor: (applyStylesToContainer && !showHelperBorder) ? borderColor : undefined,
                          borderStyle: (applyStylesToContainer && !showHelperBorder) ? 'solid' : undefined,
                          
                          color: style.textColor || DEFAULT_FIELD_STYLE.textColor,
                          fontSize: `${style.fontSize || DEFAULT_FIELD_STYLE.fontSize}px`,
                          boxSizing: 'border-box',
                        }}
                      >
                          {field.type === FieldType.TEXT && (
                            <span 
                              className="w-full truncate select-none pointer-events-none block px-1"
                              style={{ 
                                lineHeight: 1, 
                                textAlign: field.alignment || 'left'
                              }}
                            >
                              {field.name}
                            </span>
                          )}

                          {field.type === FieldType.CHECKBOX && field.isChecked && (
                            <div className="w-full h-full flex items-center justify-center pointer-events-none">
                                <Check size={(Math.min(field.rect.width, field.rect.height) * 0.8)} strokeWidth={3} />
                            </div>
                          )}

                          {field.type === FieldType.RADIO && (
                            <div 
                              className="rounded-full flex items-center justify-center overflow-hidden relative"
                              style={{
                                  // Radio specific visual box
                                  backgroundColor: !isTransparent ? backgroundColor : undefined,
                                  borderWidth: !showHelperBorder ? borderWidth : undefined,
                                  borderColor: !showHelperBorder ? borderColor : undefined,
                                  borderStyle: !showHelperBorder ? 'solid' : undefined,
                                  // Geometry constraints for circle
                                  height: isLandscape ? '100%' : 'auto',
                                  width: !isLandscape ? '100%' : 'auto',
                                  aspectRatio: '1/1',
                                  boxSizing: 'border-box'
                              }}
                            >
                                {field.isChecked && (
                                  <div className="w-[50%] h-[50%] rounded-full bg-current"></div>
                                )}
                            </div>
                          )}

                          {field.type === FieldType.DROPDOWN && (
                            <div className="w-full h-full flex items-center justify-between pointer-events-none px-1">
                                <span className="truncate opacity-70">Select...</span>
                                <ChevronDown size={Math.min(16, field.rect.height * 0.8)} />
                            </div>
                          )}
                      </div>

                      {/* --- Selection Overlay & Resize Handles --- */}
                      {isSelected && editorState.tool === 'select' && (
                        <div className="absolute inset-0 pointer-events-none">
                             {/* Dashed Selection Border */}
                            <div className="absolute -inset-[2px] border-2 border-blue-500 border-dashed pointer-events-none" />
                            
                            {/* Label Tag */}
                            <span className="absolute -top-6 left-0 bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap z-30">
                              {field.name}
                            </span>

                            {/* Resize Handles (Corners) */}
                            <div 
                                className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-blue-500 rounded-sm cursor-nwse-resize pointer-events-auto z-30 shadow-sm hover:bg-blue-100"
                                onMouseDown={(e) => handleResizeMouseDown(e, field, 'nw')}
                            />
                            <div 
                                className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-blue-500 rounded-sm cursor-nesw-resize pointer-events-auto z-30 shadow-sm hover:bg-blue-100"
                                onMouseDown={(e) => handleResizeMouseDown(e, field, 'ne')}
                            />
                            <div 
                                className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-blue-500 rounded-sm cursor-nesw-resize pointer-events-auto z-30 shadow-sm hover:bg-blue-100"
                                onMouseDown={(e) => handleResizeMouseDown(e, field, 'sw')}
                            />
                            <div 
                                className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-blue-500 rounded-sm cursor-nwse-resize pointer-events-auto z-30 shadow-sm hover:bg-blue-100"
                                onMouseDown={(e) => handleResizeMouseDown(e, field, 'se')}
                            />
                        </div>
                      )}
                      
                      {/* Tooltip only on hover if not selected */}
                      {!isSelected && (
                         <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 px-1 rounded text-[10px] pointer-events-none select-none truncate max-w-full z-20 absolute -top-5 left-0 border border-gray-200 shadow-sm text-gray-800">
                           {field.name}
                         </span>
                      )}
                    </div>
                  );
                })}

              {dragStart && dragCurrent && activePageIndex === page.pageIndex && (
                <div
                  className="absolute border-2 border-blue-500 bg-blue-500/20 pointer-events-none"
                  style={{
                    left: Math.min(dragStart.x, dragCurrent.x) * editorState.scale,
                    top: Math.min(dragStart.y, dragCurrent.y) * editorState.scale,
                    width: Math.abs(dragCurrent.x - dragStart.x) * editorState.scale,
                    height: Math.abs(dragCurrent.y - dragStart.y) * editorState.scale,
                  }}
                />
              )}
            </div>
          </div>
        ))}
        
        {editorState.pages.length === 0 && (
            <div className="text-gray-400 dark:text-gray-500 text-lg mt-20">
                No PDF loaded. Use the upload button to start.
            </div>
        )}
      </div>
    </div>
  );
};

export default Workspace;
