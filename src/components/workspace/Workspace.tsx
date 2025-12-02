import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { EditorState, FormField, FieldType, Annotation } from '../../types';
import { DEFAULT_FIELD_STYLE, ANNOTATION_STYLES, FONT_FAMILY_MAP, ZOOM_BASE } from '../../constants';
import { Check, ChevronDown, CircleDot, PenLine, StickyNote, Trash2, Eraser, Image as ImageIcon } from 'lucide-react';
import { cn, setGlobalCursor, resetGlobalCursor } from '../../lib/utils';
import { useLanguage } from '../language-provider';
import AnnotationToolbar from './AnnotationToolbar';
import PDFPage from './PDFPage';

interface WorkspaceProps {
  editorState: EditorState;
  onAddField: (field: FormField) => void;
  onAddAnnotation: (annotation: Annotation) => void;
  onSelectField: (id: string | null) => void;
  onSelectAnnotation: (id: string | null) => void;
  onUpdateField: (id: string, updates: Partial<FormField>) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onScaleChange: (newScale: number) => void;
  onTriggerHistorySave: () => void;
  onPageIndexChange?: (index: number) => void;
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
  onAddAnnotation,
  onSelectField, 
  onSelectAnnotation,
  onUpdateField, 
  onUpdateAnnotation,
  onDeleteAnnotation,
  onScaleChange,
  onTriggerHistorySave,
  onPageIndexChange
}) => {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);
  
  // Ink specific state
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const currentPathRef = useRef<{ x: number; y: number }[]>([]);
  const [currentPathState, setCurrentPathState] = useState<{ x: number; y: number }[]>([]); // For forcing re-render of current line
  
  const [movingFieldId, setMovingFieldId] = useState<string | null>(null);
  const [movingAnnotationId, setMovingAnnotationId] = useState<string | null>(null);
  const [moveOffset, setMoveOffset] = useState<{ x: number; y: number } | null>(null);
  const [moveStartRaw, setMoveStartRaw] = useState<{ x: number; y: number, originalRect: { x: number, y: number } } | null>(null);

  const [resizingFieldId, setResizingFieldId] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{
      originalRect: { x: number, y: number, width: number, height: number },
      mouseX: number,
      mouseY: number
  } | null>(null);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);

  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);

  const zoomAnchorRef = useRef<{ targetX: number; targetY: number; mouseX: number; mouseY: number; } | null>(null);
  const prevScaleRef = useRef(editorState.scale);
  const scrollPosRef = useRef({ x: 0, y: 0 });

  // Track if any interactive operation is in progress
  const isInteracting = !!(dragStart || isDrawing || isErasing || movingFieldId || movingAnnotationId || resizingFieldId);

  const handleScroll = () => {
    const container = containerRef.current;
    if (container) {
        scrollPosRef.current = {
            x: container.scrollLeft,
            y: container.scrollTop
        };

        if (onPageIndexChange) {
          // Find visible page
          const scrollTop = container.scrollTop;
          const viewportHeight = container.clientHeight;
          const middleY = scrollTop + viewportHeight / 2;
          
          let currentY = 32; // Top padding
          const gap = 32;
          const scale = editorState.scale;

          for (let i = 0; i < editorState.pages.length; i++) {
            const page = editorState.pages[i];
            const pageHeight = page.height * scale;
            
            // Check if middleY is within this page (including half gap before and after?)
            // Let's simpler: if middleY < currentY + pageHeight + gap, it's this page.
            // Or rather, finding the page that contains the middle point.
            if (middleY >= currentY && middleY <= currentY + pageHeight) {
              onPageIndexChange(i);
              return;
            }
            
            // Also check if we are in the gap after this page, maybe still count as this page or next?
            // If in gap, usually associate with the nearest page.
            if (middleY > currentY + pageHeight && middleY < currentY + pageHeight + gap) {
               // In gap, decide based on proximity. simpler to just keep previous or next.
               // Let's say if passed half gap, it's next. 
               if (middleY < currentY + pageHeight + gap / 2) {
                 onPageIndexChange(i);
                 return;
               }
            }

            currentY += pageHeight + gap;
          }
          
          // If we are past everything (shouldn't happen with correct math but just in case)
          if (editorState.pages.length > 0 && middleY >= currentY) {
             onPageIndexChange(editorState.pages.length - 1);
          }
        }
    }
  };

  // --- Zoom Effect (Same as before) ---
  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    if (zoomAnchorRef.current) {
      const { targetX, targetY, mouseX, mouseY } = zoomAnchorRef.current;
      container.scrollLeft = targetX - mouseX;
      container.scrollTop = targetY - mouseY;
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
    scrollPosRef.current = { x: container.scrollLeft, y: container.scrollTop };
  }, [editorState.scale]);

  // --- Wheel Zoom ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const content = contentRef.current;
        if (!content) return;

        const currentScale = editorState.scale;
        const steps = -e.deltaY / 100;
        let newScale = currentScale * Math.pow(ZOOM_BASE, steps);
        newScale = Math.max(0.25, Math.min(5.0, newScale));
        newScale = Number(newScale.toFixed(3));
        
        if (Math.abs(newScale - currentScale) < 0.001) return;

        const containerRect = container.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        
        // Relative mouse position to the content box
        const relX = e.clientX - contentRect.left;
        const relY = e.clientY - contentRect.top;

        // Decompose Y coordinate into Fixed (padding/gap) and Scaled (pages) parts
        let accumulatedH = 32; // Top padding (p-8 = 32px)
        let fixedY = 32;
        let scaledY = 0;
        
        if (relY < 32) {
             // Mouse in top padding
             fixedY = relY;
             scaledY = 0;
        } else {
             let found = false;
             for (let i = 0; i < editorState.pages.length; i++) {
                 const page = editorState.pages[i];
                 const pageH = page.height * currentScale;
                 
                 // Check if mouse is on this page
                 if (relY < accumulatedH + pageH) {
                     scaledY += (relY - accumulatedH);
                     found = true;
                     break;
                 }
                 accumulatedH += pageH;
                 scaledY += pageH;

                 // Check if mouse is in gap (only if not last page)
                 if (i < editorState.pages.length - 1) {
                     const gap = 32; // gap-8 = 32px
                     if (relY < accumulatedH + gap) {
                         fixedY += (relY - accumulatedH);
                         found = true;
                         break;
                     }
                     accumulatedH += gap;
                     fixedY += gap;
                 }
             }
             if (!found) {
                 // Mouse is below last page (bottom padding)
                 fixedY += (relY - accumulatedH);
             }
        }

        // Decompose X coordinate (Simple assumption of fixed side padding)
        let fixedX = 32; // p-8 = 32px
        let scaledX = 0;
        if (relX < 32) {
            fixedX = relX;
            scaledX = 0;
        } else {
            fixedX = 32;
            scaledX = relX - 32;
        }

        // Calculate predicted position at new scale
        const targetX = scaledX * (newScale / currentScale) + fixedX;
        const targetY = scaledY * (newScale / currentScale) + fixedY;
        
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        zoomAnchorRef.current = { targetX, targetY, mouseX, mouseY };
        onScaleChange(newScale);
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [editorState.scale, onScaleChange, editorState.pages]);


  const getRelativeCoords = (e: React.MouseEvent | MouseEvent, pageIndex: number) => {
    // IMPORTANT: Get coords relative to the container wrapper using stable ID
    const pageEl = document.getElementById(`page-${pageIndex}`);
    if (!pageEl) return { x: 0, y: 0 };
    const rect = pageEl.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / editorState.scale,
      y: (e.clientY - rect.top) / editorState.scale,
    };
  };

  const dist2 = (p: {x: number, y: number}, v: {x: number, y: number}) => {
      return (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y);
  };

  const distToSegmentSquared = (p: {x: number, y: number}, v: {x: number, y: number}, w: {x: number, y: number}) => {
      const l2 = dist2(v, w);
      if (l2 === 0) return dist2(p, v);
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
  };

  const checkEraserCollision = (x: number, y: number, pageIndex: number) => {
    // Threshold in unscaled units. 
    // If we want 10px visual radius on screen, in unscaled coords it's 10 / scale.
    const VISUAL_RADIUS = 10;
    const threshold = VISUAL_RADIUS / editorState.scale; 
    const thresholdSq = threshold * threshold;
    
    // Check annotations on this page
    const pageAnnotations = editorState.annotations.filter(a => a.pageIndex === pageIndex);
    
    for (const annot of pageAnnotations) {
        // Ink Detection
        if (annot.type === 'ink' && annot.points) {
            for (let i = 0; i < annot.points.length - 1; i++) {
                const p1 = annot.points[i];
                const p2 = annot.points[i+1];
                const distSq = distToSegmentSquared({x, y}, p1, p2);
                if (distSq < thresholdSq) {
                    onDeleteAnnotation(annot.id);
                    return; // Delete one at a time per move event to avoid conflicts
                }
            }
        } 
        // Box Detection (Highlight/Note)
        else if (annot.rect) {
            const { x: rx, y: ry, width: rw, height: rh } = annot.rect;
            // Simple box overlap check with eraser point (expanded by radius)
            if (x >= rx - threshold && x <= rx + rw + threshold &&
                y >= ry - threshold && y <= ry + rh + threshold) {
                onDeleteAnnotation(annot.id);
                return;
            }
        }
    }
  };

  // --- Snapping Helper (Form Mode Only) ---
  const applySnapping = (rect: any, pageIndex: number, excludeId: string | null, threshold: number) => {
      // (Snapping logic reuse from original - simplified for brevity here as it is unchanged logic)
      // Only run in form mode
      if (editorState.mode !== 'form') return { x: rect.x, y: rect.y, guides: [] };
      
      const { snapToBorders, snapToCenter, snapToEqualDistances } = editorState.snappingOptions;
      const guides: SnapLine[] = [];
      let { x, y } = rect;
      const otherFields = editorState.fields.filter(f => f.pageIndex === pageIndex && f.id !== excludeId);
      
      let bestDx = Infinity; let snapX = null; let guideX = null;
      const checkSnap = (diff: number, newPos: number, guidePos: number) => {
          if (Math.abs(diff) < Math.abs(bestDx) && Math.abs(diff) < threshold) {
              bestDx = diff; snapX = newPos; guideX = guidePos;
          }
      };

      otherFields.forEach(f => {
          if (snapToBorders) {
              checkSnap(f.rect.x - x, f.rect.x, f.rect.x);
              checkSnap((f.rect.x + f.rect.width) - x, f.rect.x + f.rect.width, f.rect.x + f.rect.width);
              checkSnap(f.rect.x - (x + rect.width), f.rect.x - rect.width, f.rect.x);
              checkSnap((f.rect.x + f.rect.width) - (x + rect.width), (f.rect.x + f.rect.width) - rect.width, f.rect.x + f.rect.width);
          }
          if (snapToCenter) {
              const theirCenter = f.rect.x + f.rect.width / 2;
              const myCenter = x + rect.width / 2;
              checkSnap(theirCenter - myCenter, theirCenter - rect.width / 2, theirCenter);
          }
      });

      // Equal Distances (Horizontal)
      if (snapToEqualDistances) {
        const sameRow = otherFields.filter(f => 
             Math.max(rect.y, f.rect.y) < Math.min(rect.y + rect.height, f.rect.y + f.rect.height)
        ).sort((a, b) => a.rect.x - b.rect.x);

        for (let i = 0; i < sameRow.length - 1; i++) {
           const A = sameRow[i].rect;
           const B = sameRow[i+1].rect;
           const gap = B.x - (A.x + A.width);
           
           // 1. Snap to Right: A ... B ... [Me]
           const targetRight = B.x + B.width + gap;
           checkSnap(targetRight - x, targetRight, targetRight);

           // 2. Snap to Left: [Me] ... A ... B
           const targetLeft = A.x - gap - rect.width;
           checkSnap(targetLeft - x, targetLeft, targetLeft);

           // 3. Snap Between: A ... [Me] ... B
           const targetMid = (A.x + A.width + B.x - rect.width) / 2;
           checkSnap(targetMid - x, targetMid, targetMid);
        }
      }

      if (snapX !== null && guideX !== null) { x = snapX; guides.push({ type: 'vertical', pos: guideX as number, start: 0, end: 2000 }); }

      let bestDy = Infinity; let snapY = null; let guideY = null;
      const checkSnapY = (diff: number, newPos: number, guidePos: number) => {
          if (Math.abs(diff) < Math.abs(bestDy) && Math.abs(diff) < threshold) {
              bestDy = diff; snapY = newPos; guideY = guidePos;
          }
      };
      otherFields.forEach(f => {
          if (snapToBorders) {
              checkSnapY(f.rect.y - y, f.rect.y, f.rect.y);
              checkSnapY((f.rect.y + f.rect.height) - y, f.rect.y + f.rect.height, f.rect.y + f.rect.height);
              checkSnapY(f.rect.y - (y + rect.height), f.rect.y - rect.height, f.rect.y);
              checkSnapY((f.rect.y + f.rect.height) - (y + rect.height), (f.rect.y + f.rect.height) - rect.height, f.rect.y + f.rect.height);
          }
          if (snapToCenter) {
            const theirCenter = f.rect.y + f.rect.height / 2;
            const myCenter = y + rect.height / 2;
            checkSnapY(theirCenter - myCenter, theirCenter - rect.height / 2, theirCenter);
          }
      });

      // Equal Distances (Vertical)
      if (snapToEqualDistances) {
        const sameCol = otherFields.filter(f => 
             Math.max(rect.x, f.rect.x) < Math.min(rect.x + rect.width, f.rect.x + f.rect.width)
        ).sort((a, b) => a.rect.y - b.rect.y);

        for (let i = 0; i < sameCol.length - 1; i++) {
           const A = sameCol[i].rect;
           const B = sameCol[i+1].rect;
           const gap = B.y - (A.y + A.height);
           
           // 1. Snap to Bottom: A
           //                    B
           //                   [Me]
           const targetBottom = B.y + B.height + gap;
           checkSnapY(targetBottom - y, targetBottom, targetBottom);

           // 2. Snap to Top:   [Me]
           //                    A
           //                    B
           const targetTop = A.y - gap - rect.height;
           checkSnapY(targetTop - y, targetTop, targetTop);

           // 3. Snap Between:   A
           //                   [Me]
           //                    B
           const targetMid = (A.y + A.height + B.y - rect.height) / 2;
           checkSnapY(targetMid - y, targetMid, targetMid);
        }
      }

      if (snapY !== null && guideY !== null) { y = snapY; guides.push({ type: 'horizontal', pos: guideY as number, start: 0, end: 2000 }); }
      
      return { x, y, guides };
  };

  // --- Handlers ---
  const handleMouseDown = (e: React.MouseEvent, pageIndex: number) => {
    if (e.button === 1) return;

    if (editorState.tool === 'select') {
       if (e.target === e.currentTarget) {
         onSelectField(null);
         onSelectAnnotation(null);
       }
       return;
    }

    // Ink Drawing Start
    if (editorState.tool === 'draw_ink') {
        setGlobalCursor('crosshair');
        setActivePageIndex(pageIndex);
        const coords = getRelativeCoords(e, pageIndex);
        setIsDrawing(true);
        currentPathRef.current = [coords];
        setCurrentPathState([coords]);
        return;
    }

    // Eraser Start
    if (editorState.tool === 'eraser') {
        setGlobalCursor('cell');
        setActivePageIndex(pageIndex);
        setIsErasing(true);
        const coords = getRelativeCoords(e, pageIndex);
        checkEraserCollision(coords.x, coords.y, pageIndex);
        return;
    }

    // Drag Drawing Start (Form Fields & Highlights)
    setGlobalCursor('crosshair');
    setActivePageIndex(pageIndex);
    const coords = getRelativeCoords(e, pageIndex);
    setDragStart(coords);
    setDragCurrent(coords);
  };

  const handleMouseMove = (e: React.MouseEvent | MouseEvent) => {
    if (activePageIndex === null) return;
    
    setSnapLines([]);

    const coords = getRelativeCoords(e, activePageIndex);
    const { enabled, threshold: baseThreshold } = editorState.snappingOptions;
    const threshold = baseThreshold / editorState.scale;
    const shouldSnap = enabled && !editorState.keys.alt && editorState.mode === 'form';

    // --- INK DRAWING ---
    if (isDrawing && editorState.tool === 'draw_ink') {
        currentPathRef.current.push(coords);
        // Optimization: Throttle state updates? For now, raw update
        setCurrentPathState([...currentPathRef.current]);
        return;
    }

    // --- ERASER ---
    if (isErasing && editorState.tool === 'eraser') {
        checkEraserCollision(coords.x, coords.y, activePageIndex);
        return;
    }

    // --- DRAG CREATING ---
    if (dragStart) {
      let newX = coords.x;
      let newY = coords.y;

      if (editorState.keys.shift) {
          const dx = coords.x - dragStart.x;
          const dy = coords.y - dragStart.y;
          const maxDim = Math.max(Math.abs(dx), Math.abs(dy));
          newX = dragStart.x + (dx < 0 ? -maxDim : maxDim);
          newY = dragStart.y + (dy < 0 ? -maxDim : maxDim);
      }
      
      setDragCurrent({ x: newX, y: newY });
    } 
    // --- MOVING FIELD ---
    else if (movingFieldId && moveOffset && moveStartRaw) {
      const field = editorState.fields.find(f => f.id === movingFieldId);
      if (field) {
          let newX = coords.x - moveOffset.x;
          let newY = coords.y - moveOffset.y;
          
          if (editorState.keys.shift) {
              const totalDx = coords.x - moveStartRaw.x;
              const totalDy = coords.y - moveStartRaw.y;
              if (Math.abs(totalDx) > Math.abs(totalDy)) newY = moveStartRaw.originalRect.y;
              else newX = moveStartRaw.originalRect.x;
          }

          if (shouldSnap) {
              const snapResult = applySnapping({ x: newX, y: newY, width: field.rect.width, height: field.rect.height }, activePageIndex, movingFieldId, threshold);
              newX = snapResult.x;
              newY = snapResult.y;
              setSnapLines(snapResult.guides);
          }

          onUpdateField(movingFieldId, { rect: { ...field.rect, x: newX, y: newY } });
      }
    } 
    // --- MOVING ANNOTATION ---
    else if (movingAnnotationId && moveOffset) {
        const annot = editorState.annotations.find(a => a.id === movingAnnotationId);
        if (annot && annot.rect) {
            let newX = coords.x - moveOffset.x;
            let newY = coords.y - moveOffset.y;
            
            const updates: Partial<Annotation> = { rect: { ...annot.rect, x: newX, y: newY } };
            
            // If we have multiple rects (e.g. multi-line highlight), move them too
            if (annot.rects) {
                const dx = newX - annot.rect.x;
                const dy = newY - annot.rect.y;
                updates.rects = annot.rects.map(r => ({ ...r, x: r.x + dx, y: r.y + dy }));
            }
            
            onUpdateAnnotation(movingAnnotationId, updates);
        }
    }
    // --- RESIZING ---
    else if (resizingFieldId && resizeStart && resizeHandle) {
        const dx = coords.x - resizeStart.mouseX;
        const dy = coords.y - resizeStart.mouseY;
        let newX = resizeStart.originalRect.x;
        let newY = resizeStart.originalRect.y;
        let newW = resizeStart.originalRect.width;
        let newH = resizeStart.originalRect.height;
        
        // 1. Calculate rough dimensions
        if (resizeHandle.includes('e')) newW = Math.max(10, resizeStart.originalRect.width + dx);
        if (resizeHandle.includes('w')) {
            const effDx = Math.min(dx, resizeStart.originalRect.width - 10);
            newX += effDx; newW -= effDx;
        }
        if (resizeHandle.includes('s')) newH = Math.max(10, resizeStart.originalRect.height + dy);
        if (resizeHandle.includes('n')) {
             const effDy = Math.min(dy, resizeStart.originalRect.height - 10);
             newY += effDy; newH -= effDy;
        }

        // 2. Aspect Ratio (Shift) - Only for corner resizing
        if (editorState.keys.shift && resizeHandle.length === 2) {
             const aspect = resizeStart.originalRect.width / resizeStart.originalRect.height;
             const absDx = Math.abs(newW - resizeStart.originalRect.width);
             const absDy = Math.abs(newH - resizeStart.originalRect.height);

             // Use the larger delta to drive the size
             if (absDx > absDy * aspect) {
                 // Width changed more (relative to aspect), adjust Height
                 const targetH = newW / aspect;
                 if (resizeHandle.includes('n')) {
                     newY += (newH - targetH);
                 }
                 newH = targetH;
             } else {
                 // Height changed more, adjust Width
                 const targetW = newH * aspect;
                 if (resizeHandle.includes('w')) {
                     newX += (newW - targetW);
                 }
                 newW = targetW;
             }
        }

        // 3. Snapping
        const guides: SnapLine[] = [];
        if (shouldSnap) {
             const otherFields = editorState.fields.filter(f => f.pageIndex === activePageIndex && f.id !== resizingFieldId);
             
             // Helper to find snap
             const findSnap = (val: number, type: 'vertical'|'horizontal') => {
                 let best = Infinity;
                 let snapTo = null;
                 let guide = null;
                 
                 otherFields.forEach(f => {
                     const targets = type === 'vertical' 
                         ? [f.rect.x, f.rect.x + f.rect.width]
                         : [f.rect.y, f.rect.y + f.rect.height];
                     
                     targets.forEach(t => {
                         const dist = t - val;
                         if (Math.abs(dist) < threshold && Math.abs(dist) < Math.abs(best)) {
                             best = dist;
                             snapTo = t;
                             guide = t;
                         }
                     });
                 });
                 return { snapTo, guide };
             };

             if (editorState.keys.shift && resizeHandle.length === 2) {
                 // Aspect Ratio Preserving Snapping Logic
                 // If Shift is held, we prioritize keeping aspect ratio. 
                 // We find the BEST snap (if any) and then recalculate the other dimension to match the aspect ratio.
                 const aspect = resizeStart.originalRect.width / resizeStart.originalRect.height;
                 let bestSnapDist = Infinity;
                 let bestSnapType: 'w' | 'e' | 'n' | 's' | null = null;
                 let bestSnapVal = null;
                 let bestGuide = null;

                 // Check all relevant sides for nearest snap
                 if (resizeHandle.includes('w')) {
                     const { snapTo, guide } = findSnap(newX, 'vertical');
                     if (snapTo !== null) {
                         const dist = Math.abs(snapTo - newX);
                         if (dist < bestSnapDist) { bestSnapDist = dist; bestSnapType = 'w'; bestSnapVal = snapTo; bestGuide = guide; }
                     }
                 }
                 if (resizeHandle.includes('e')) {
                     const { snapTo, guide } = findSnap(newX + newW, 'vertical');
                     if (snapTo !== null) {
                         const dist = Math.abs(snapTo - (newX + newW));
                         if (dist < bestSnapDist) { bestSnapDist = dist; bestSnapType = 'e'; bestSnapVal = snapTo; bestGuide = guide; }
                     }
                 }
                 if (resizeHandle.includes('n')) {
                     const { snapTo, guide } = findSnap(newY, 'horizontal');
                     if (snapTo !== null) {
                         const dist = Math.abs(snapTo - newY);
                         if (dist < bestSnapDist) { bestSnapDist = dist; bestSnapType = 'n'; bestSnapVal = snapTo; bestGuide = guide; }
                     }
                 }
                 if (resizeHandle.includes('s')) {
                     const { snapTo, guide } = findSnap(newY + newH, 'horizontal');
                     if (snapTo !== null) {
                         const dist = Math.abs(snapTo - (newY + newH));
                         if (dist < bestSnapDist) { bestSnapDist = dist; bestSnapType = 's'; bestSnapVal = snapTo; bestGuide = guide; }
                     }
                 }

                 // Apply only the BEST snap to preserve aspect ratio
                 if (bestSnapType && bestSnapVal !== null) {
                     if (bestSnapType === 'w') {
                         const diff = bestSnapVal - newX;
                         newX = bestSnapVal;
                         newW -= diff;
                         // Recalc Height
                         const targetH = newW / aspect;
                         if (resizeHandle.includes('n')) newY += (newH - targetH);
                         newH = targetH;
                         guides.push({ type: 'vertical', pos: bestGuide as number, start: 0, end: 2000 });
                     } else if (bestSnapType === 'e') {
                         newW = bestSnapVal - newX;
                         // Recalc Height
                         const targetH = newW / aspect;
                         if (resizeHandle.includes('n')) newY += (newH - targetH);
                         newH = targetH;
                         guides.push({ type: 'vertical', pos: bestGuide as number, start: 0, end: 2000 });
                     } else if (bestSnapType === 'n') {
                         const diff = bestSnapVal - newY;
                         newY = bestSnapVal;
                         newH -= diff;
                         // Recalc Width
                         const targetW = newH * aspect;
                         if (resizeHandle.includes('w')) newX += (newW - targetW);
                         newW = targetW;
                         guides.push({ type: 'horizontal', pos: bestGuide as number, start: 0, end: 2000 });
                     } else if (bestSnapType === 's') {
                         newH = bestSnapVal - newY;
                         // Recalc Width
                         const targetW = newH * aspect;
                         if (resizeHandle.includes('w')) newX += (newW - targetW);
                         newW = targetW;
                         guides.push({ type: 'horizontal', pos: bestGuide as number, start: 0, end: 2000 });
                     }
                 }

             } else {
                 // Standard Independent Snapping (No Shift or Side Handle)
                 // Snap Left
                 if (resizeHandle.includes('w')) {
                     const { snapTo, guide } = findSnap(newX, 'vertical');
                     if (snapTo !== null) {
                         const diff = snapTo - newX;
                         newX = snapTo;
                         newW -= diff;
                         guides.push({ type: 'vertical', pos: guide as number, start: 0, end: 2000 });
                     }
                 }
                 // Snap Right
                 if (resizeHandle.includes('e')) {
                     const { snapTo, guide } = findSnap(newX + newW, 'vertical');
                     if (snapTo !== null) {
                         newW = snapTo - newX;
                         guides.push({ type: 'vertical', pos: guide as number, start: 0, end: 2000 });
                     }
                 }
                 // Snap Top
                 if (resizeHandle.includes('n')) {
                     const { snapTo, guide } = findSnap(newY, 'horizontal');
                     if (snapTo !== null) {
                         const diff = snapTo - newY;
                         newY = snapTo;
                         newH -= diff;
                         guides.push({ type: 'horizontal', pos: guide as number, start: 0, end: 2000 });
                     }
                 }
                 // Snap Bottom
                 if (resizeHandle.includes('s')) {
                     const { snapTo, guide } = findSnap(newY + newH, 'horizontal');
                     if (snapTo !== null) {
                         newH = snapTo - newY;
                         guides.push({ type: 'horizontal', pos: guide as number, start: 0, end: 2000 });
                     }
                 }
             }
        }
        setSnapLines(guides);
        onUpdateField(resizingFieldId, { rect: { x: newX, y: newY, width: newW, height: newH } });
    }
  };

  const handleMouseUp = (e?: MouseEvent | React.MouseEvent) => {
    // Reset Global Cursor
    resetGlobalCursor();

    // Finish Ink Drawing
    if (isDrawing && editorState.tool === 'draw_ink' && activePageIndex !== null) {
        setIsDrawing(false);
        if (currentPathRef.current.length > 2) {
            onAddAnnotation({
                id: `ink_${Date.now()}`,
                pageIndex: activePageIndex,
                type: 'ink',
                points: currentPathRef.current,
                color: editorState.penStyle.color,
                thickness: editorState.penStyle.thickness,
                opacity: editorState.penStyle.opacity
            });
        }
        currentPathRef.current = [];
        setCurrentPathState([]);
    }

    // Finish Eraser
    if (isErasing) {
        setIsErasing(false);
    }

    // Finish Drag Creation
    if (dragStart && dragCurrent && activePageIndex !== null) {
      const width = Math.abs(dragCurrent.x - dragStart.x);
      const height = Math.abs(dragCurrent.y - dragStart.y);
      const x = Math.min(dragStart.x, dragCurrent.x);
      const y = Math.min(dragStart.y, dragCurrent.y);

      if (width > 5 && height > 5) {
        if (editorState.mode === 'form') {
            let type = FieldType.TEXT;
            if (editorState.tool === 'draw_checkbox') type = FieldType.CHECKBOX;
            else if (editorState.tool === 'draw_radio') type = FieldType.RADIO;
            else if (editorState.tool === 'draw_dropdown') type = FieldType.DROPDOWN;
            else if (editorState.tool === 'draw_signature') type = FieldType.SIGNATURE;
            else if (editorState.tool === 'draw_text') type = FieldType.TEXT;

            if (editorState.tool !== 'select') {
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
        } else if (editorState.mode === 'annotation') {
            if (editorState.tool === 'draw_highlight') {
                onAddAnnotation({
                    id: `highlight_${Date.now()}`,
                    pageIndex: activePageIndex,
                    type: 'highlight',
                    rect: { x, y, width, height },
                    color: ANNOTATION_STYLES.highlight.color,
                    opacity: ANNOTATION_STYLES.highlight.opacity
                });
            } else if (editorState.tool === 'draw_note') {
                onAddAnnotation({
                    id: `note_${Date.now()}`,
                    pageIndex: activePageIndex,
                    type: 'note',
                    rect: { x, y, width, height }, // Initial box
                    text: 'New Note',
                    color: ANNOTATION_STYLES.note.color,
                    size: ANNOTATION_STYLES.note.fontSize,
                    alignment: 'left'
                });
            }
        }
      }
    }

    setDragStart(null); setDragCurrent(null);
    setActivePageIndex(null);
    setMovingFieldId(null); setMoveStartRaw(null);
    setMovingAnnotationId(null);
    setResizingFieldId(null); setResizeStart(null); setResizeHandle(null);
    setSnapLines([]);
    setIsDrawing(false);
    setIsErasing(false);
  };

  const handleFieldMouseDown = (e: React.MouseEvent, field: FormField) => {
    // If we are in Annotation mode, we allow selection but prevent drag logic.
    // Instead we likely want to fill them out.
    if (editorState.mode === 'annotation') {
        e.stopPropagation();
        onSelectField(field.id); // Sync selection with sidebar
        return;
    }

    // If not using Select tool, we might be trying to draw a new field ON TOP of this one.
    // In that case, we want the event to bubble up to the workspace to trigger 'handleMouseDown'.
    if (editorState.tool !== 'select') return;

    e.stopPropagation();
    e.preventDefault();
    onTriggerHistorySave();

    // Set Global Cursor
    setGlobalCursor('move');

    let targetFieldId = field.id;
    let targetFieldRect = field.rect;
    let targetPageIndex = field.pageIndex;

    // Check for Duplicate shortcut (Ctrl/Meta + Drag)
    if (e.ctrlKey || e.metaKey) {
        const newId = `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        // If Radio, keep name to maintain group. For others, increment suffix number or append _1
        let newName = field.name;
        if (field.type !== FieldType.RADIO) {
            const match = field.name.match(/^(.*)_(\d+)$/);
            if (match) {
                const prefix = match[1];
                const num = parseInt(match[2], 10);
                newName = `${prefix}_${num + 1}`;
            } else {
                newName = `${field.name}_1`;
            }
        }

        const newField: FormField = {
            ...field,
            id: newId,
            name: newName,
            // Fix: If duplicating a Radio button in the same group, ensure it starts unchecked
            // and not default checked to preserve single-selection logic.
            isChecked: field.type === FieldType.RADIO ? false : field.isChecked,
            isDefaultChecked: field.type === FieldType.RADIO ? false : field.isDefaultChecked,
        };

        // Add the new field
        onAddField(newField);
        
        // Target the new field for the drag operation
        targetFieldId = newId;
        // Rect and Page are same as original
    }

    onSelectField(targetFieldId);
    setActivePageIndex(targetPageIndex);
    const coords = getRelativeCoords(e, targetPageIndex);
    
    setMovingFieldId(targetFieldId);
    setMoveOffset({ x: coords.x - targetFieldRect.x, y: coords.y - targetFieldRect.y });
    setMoveStartRaw({ x: coords.x, y: coords.y, originalRect: { ...targetFieldRect } });
  };

  const handleAnnotationMouseDown = (e: React.MouseEvent, annotation: Annotation) => {
      // Don't swallow event if erasing
      if (editorState.tool === 'eraser') return;
      e.stopPropagation();
      e.preventDefault();
      if (editorState.tool !== 'select') return;
      
      onTriggerHistorySave();
      onSelectAnnotation(annotation.id);
      // App handles clearing the selectedFieldId when selectedAnnotationId is set.
      
      setActivePageIndex(annotation.pageIndex);
      const coords = getRelativeCoords(e, annotation.pageIndex);
      
      // Setup Move (Disable for Highlight to match Pen behavior)
      if (annotation.rect && annotation.type !== 'highlight') {
          setGlobalCursor('move');
          setMovingAnnotationId(annotation.id);
          setMoveOffset({ x: coords.x - annotation.rect.x, y: coords.y - annotation.rect.y });
      }
  };

  const handleResizeMouseDown = (e: React.MouseEvent, field: FormField, handle: string) => {
      e.stopPropagation();
      if (editorState.tool !== 'select') return;
      
      onTriggerHistorySave();
      setActivePageIndex(field.pageIndex);
      const coords = getRelativeCoords(e, field.pageIndex);
      setResizingFieldId(field.id);
      setResizeHandle(handle);
      setResizeStart({ originalRect: { ...field.rect }, mouseX: coords.x, mouseY: coords.y });

      // Set Global Cursor based on handle
      let cursor = 'default';
      if (['nw', 'se'].includes(handle)) cursor = 'nwse-resize';
      else if (['ne', 'sw'].includes(handle)) cursor = 'nesw-resize';
      else if (['n', 's'].includes(handle)) cursor = 'ns-resize';
      else if (['e', 'w'].includes(handle)) cursor = 'ew-resize';
      
      setGlobalCursor(cursor);
  }

  // --- Global Event Listeners Setup with Ref to avoid Stale Closures ---
  // Store the latest handlers in a ref so the effect always calls the current version
  const handlersRef = useRef({ handleMouseMove, handleMouseUp });
  
  useLayoutEffect(() => {
    handlersRef.current = { handleMouseMove, handleMouseUp };
  });

  useEffect(() => {
    if (isInteracting) {
      const handleGlobalMove = (e: MouseEvent) => {
        // Access via ref to get the closure from the latest render
        handlersRef.current.handleMouseMove(e as unknown as React.MouseEvent);
      };

      const handleGlobalUp = (e: MouseEvent) => {
         // Access via ref to get the closure from the latest render
        handlersRef.current.handleMouseUp(e);
      };

      window.addEventListener('mousemove', handleGlobalMove);
      window.addEventListener('mouseup', handleGlobalUp);
      
      return () => {
        window.removeEventListener('mousemove', handleGlobalMove);
        window.removeEventListener('mouseup', handleGlobalUp);
      };
    }
  }, [isInteracting]);


  // --- Render Helpers ---

  // Convert points array to SVG path
  const pointsToPath = (points: { x: number, y: number }[]) => {
      if (points.length === 0) return '';
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      return d;
  };

  const getCursor = () => {
      if (movingFieldId || movingAnnotationId) return 'move';
      if (resizingFieldId && resizeHandle) {
          if (['nw', 'se'].includes(resizeHandle)) return 'nwse-resize';
          if (['ne', 'sw'].includes(resizeHandle)) return 'nesw-resize';
          if (['n', 's'].includes(resizeHandle)) return 'ns-resize';
          if (['e', 'w'].includes(resizeHandle)) return 'ew-resize';
      }
      
      switch(editorState.tool) {
          case 'draw_ink': return 'crosshair';
          case 'eraser': return 'cell'; // Or a custom cursor in future
          case 'select': return 'default';
          case 'draw_highlight': 
          case 'draw_note': return 'crosshair';
          default: return 'crosshair';
      }
  }

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900 relative transition-colors duration-200"
      onMouseMove={isInteracting ? undefined : handleMouseMove}
      onMouseUp={isInteracting ? undefined : handleMouseUp}
      onMouseLeave={isInteracting ? undefined : handleMouseUp}
      onScroll={handleScroll}
    >
      <div ref={contentRef} className="flex flex-col items-center gap-8 min-h-full p-8 pb-20 w-fit mx-auto">
        {editorState.pages.map((page) => (
          <div 
            id={`page-${page.pageIndex}`}
            key={page.pageIndex} 
            className="relative bg-white shadow-lg transition-shadow hover:shadow-xl origin-top"
          >
            {/* 
                Lazy Loaded PDF Page Rendering 
                Note: Container size is now controlled by PDFPage but we wrap it here for annotations layer relative positioning
            */}
            <PDFPage 
                pageIndex={page.pageIndex}
                pdfDocument={editorState.pdfDocument}
                scale={editorState.scale}
                width={page.width}
                height={page.height}
                placeholderImage={page.imageData}
            />
            
            
            {/* DOM Layer for Highlights, Notes, Form Fields */}
            <div 
              className="absolute inset-0"
              style={{ cursor: getCursor() }}
              onMouseDown={(e) => handleMouseDown(e, page.pageIndex)}
            >
              {/* Annotations: Highlight & Note */}
              {editorState.annotations
                .filter(a => a.pageIndex === page.pageIndex && a.type !== 'ink')
                .map(annot => {
                    const isSelected = editorState.selectedAnnotationId === annot.id;
                    
                    if (annot.type === 'highlight' && annot.rect) {
                        const renderBox = (r: {x: number, y: number, width: number, height: number}, keySuffix: string = '') => (
                             <div
                                key={annot.id + keySuffix}
                                className={cn("absolute transition-colors")}
                                style={{
                                    left: r.x * editorState.scale,
                                    top: r.y * editorState.scale,
                                    width: r.width * editorState.scale,
                                    height: r.height * editorState.scale,
                                    backgroundColor: annot.color,
                                    opacity: annot.opacity !== undefined ? annot.opacity : 0.4, // Use parsed opacity or default
                                    cursor: 'inherit',
                                    mixBlendMode: 'multiply' // Ensure highlights blend like real markers
                                }}
                                onMouseDown={(e) => handleAnnotationMouseDown(e, annot)}
                            />
                        );

                        if (annot.rects && annot.rects.length > 0) {
                             return (
                                <React.Fragment key={annot.id}>
                                    {annot.rects.map((r, idx) => renderBox(r, `_part_${idx}`))}
                                </React.Fragment>
                             );
                        } else {
                            return renderBox(annot.rect);
                        }
                    } else if (annot.type === 'note' && annot.rect) {
                        const fontSize = (annot.size || 12) * editorState.scale;
                        return (
                            <React.Fragment key={annot.id}>
                                {isSelected && (
                                    <AnnotationToolbar 
                                        annotation={annot} 
                                        onUpdate={(updates) => onUpdateAnnotation(annot.id, updates)} 
                                        onDelete={() => onDeleteAnnotation(annot.id)}
                                        scale={editorState.scale}
                                    />
                                )}
                                <div
                                    className={cn("absolute p-1 group", isSelected ? "z-50" : "")}
                                    style={{
                                        left: annot.rect.x * editorState.scale,
                                        top: annot.rect.y * editorState.scale,
                                        width: annot.rect.width * editorState.scale,
                                        height: annot.rect.height * editorState.scale,
                                        cursor: editorState.tool === 'select' ? 'move' : 'inherit',
                                    }}
                                    onMouseDown={(e) => handleAnnotationMouseDown(e, annot)}
                                >
                                    {isSelected ? (
                                        <textarea
                                            autoFocus
                                            className="w-full h-full bg-yellow-100 text-black p-1 resize-none border border-yellow-300 shadow-sm focus:outline-none leading-tight"
                                            style={{ fontSize: `${fontSize}px`, color: annot.color, textAlign: annot.alignment || 'left' }}
                                            value={annot.text}
                                            onChange={(e) => onUpdateAnnotation(annot.id, { text: e.target.value })}
                                            onMouseDown={(e) => e.stopPropagation()} 
                                            onFocus={(e) => {
                                                if (annot.text === 'New Note') {
                                                    e.target.select();
                                                }
                                            }}
                                        />
                                    ) : (
                                        <div 
                                            className="w-full h-full bg-yellow-100/80 text-black p-1 border border-yellow-300/50 overflow-hidden whitespace-pre-wrap wrap-break-word leading-tight"
                                            style={{ fontSize: `${fontSize}px`, color: annot.color, textAlign: annot.alignment || 'left' }}
                                        >
                                            {annot.text}
                                        </div>
                                    )}
                                </div>
                            </React.Fragment>
                        )
                    }
                    return null;
                })
              }

              {/* Form Fields */}
              {editorState.fields
                .filter(f => f.pageIndex === page.pageIndex)
                .map(field => {
                  const isSelected = editorState.selectedFieldId === field.id;
                  const style = field.style || {};
                  const isRadio = field.type === FieldType.RADIO;
                  const isFormMode = editorState.mode === 'form';
                  const isAnnotationMode = editorState.mode === 'annotation';
                  const isInteractive = field.type === FieldType.CHECKBOX || field.type === FieldType.RADIO || field.type === FieldType.DROPDOWN || field.type === FieldType.SIGNATURE;
                  const showAnnotationFocus = isAnnotationMode && isSelected;

                  // Visibility logic
                  const showHelperBorder = ((style.borderWidth ?? 1) === 0) && !isSelected;
                  const showHelperBg = (style.isTransparent) && !isSelected;
                  const applyStylesToContainer = !isRadio;

                  const handleInteraction = () => {
                       if (isAnnotationMode) {
                           if (field.type === FieldType.CHECKBOX) {
                               onUpdateField(field.id, { isChecked: !field.isChecked });
                           } else if (field.type === FieldType.RADIO) {
                               onUpdateField(field.id, { isChecked: true });
                           } else if (field.type === FieldType.SIGNATURE) {
                               // Open File Dialog
                               const input = document.createElement('input');
                               input.type = 'file';
                               input.accept = 'image/*';
                               input.onchange = (e) => {
                                   const file = (e.target as HTMLInputElement).files?.[0];
                                   if (file) {
                                       const reader = new FileReader();
                                       reader.onload = () => {
                                           if (reader.result) {
                                                onUpdateField(field.id, { signatureData: reader.result as string });
                                           }
                                       };
                                       reader.readAsDataURL(file);
                                   }
                               };
                               input.click();
                           }
                       }
                  }
                  
                  return (
                    <div
                      key={field.id}
                      id={`field-element-${field.id}`}
                      onMouseDown={(e) => handleFieldMouseDown(e, field)}
                      onClick={handleInteraction}
                      onFocus={() => { if (isFormMode) onSelectField(field.id); }}
                      tabIndex={isFormMode ? 0 : -1} // Make container focusable in Form Mode for navigation
                      className={cn(
                        "absolute group select-none pointer-events-auto outline-none", // outline-none to handle custom focus ring
                        isSelected ? 'z-50' : 'hover:z-50'
                      )}
                      style={{
                        left: field.rect.x * editorState.scale,
                        top: field.rect.y * editorState.scale,
                        width: field.rect.width * editorState.scale,
                        height: field.rect.height * editorState.scale,
                        // Fix 2: Explicit cursor logic for interactive fields in annotation mode
                        cursor: isFormMode 
                          ? (editorState.tool === 'select' ? 'move' : 'inherit') 
                          : (isInteractive ? 'pointer' : (field.type === FieldType.TEXT ? 'text' : 'default')),
                      }}
                    >
                      <div 
                        className={cn(
                          "w-full h-full relative transition-colors flex",
                          (field.type === FieldType.TEXT && field.multiline) ? "items-start" : "items-center",
                          !isRadio && "overflow-hidden",
                          isRadio && "justify-center",
                          showHelperBg && isFormMode && "bg-blue-500/10 dark:bg-blue-400/10 hover:bg-blue-500/20",
                          // Removed border helper class from here to avoid box-model shift
                          isAnnotationMode && "hover:bg-black/5" 
                        )}
                        style={{
                          backgroundColor: (applyStylesToContainer && !style.isTransparent) ? style.backgroundColor : undefined,
                          borderWidth: applyStylesToContainer ? style.borderWidth : undefined,
                          borderColor: applyStylesToContainer ? style.borderColor : undefined,
                          borderStyle: applyStylesToContainer ? 'solid' : undefined,
                          color: style.textColor,
                          fontSize: `${(style.fontSize || 12) * editorState.scale}px`,
                          fontFamily: FONT_FAMILY_MAP[style.fontFamily || 'Helvetica'] || 'Helvetica', // Apply Font Family
                          boxSizing: 'border-box',
                        }}
                      >
                         {/* Helper Border Overlay - Absolute to prevent layout shift */}
                         {showHelperBorder && isFormMode && applyStylesToContainer && (
                             <div className="absolute inset-0 border border-dashed border-blue-400/50 pointer-events-none" style={{ zIndex: 1 }} />
                         )}

                         {/* Text Field Logic: Unified Input/Textarea to prevent layout shift */}
                         {field.type === FieldType.TEXT && (
                             field.multiline ? (
                                <textarea 
                                    readOnly={isFormMode || field.readOnly}
                                    tabIndex={isFormMode ? -1 : undefined} // Prevent focus in Form Mode
                                    className={cn(
                                        "w-full h-full bg-transparent resize-none border-none outline-none p-1 font-inherit text-inherit leading-tight block",
                                        isFormMode && "pointer-events-none"
                                    )}
                                    style={{ textAlign: field.alignment }}
                                    value={isFormMode ? (field.value || field.defaultValue || field.name) : (field.value || '')}
                                    placeholder={isAnnotationMode ? field.name : undefined}
                                    onChange={(e) => onUpdateField(field.id, { value: e.target.value })}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onFocus={() => { if(isAnnotationMode) onSelectField(field.id); }}
                                />
                             ) : (
                                <input 
                                    type="text"
                                    readOnly={isFormMode || field.readOnly}
                                    tabIndex={isFormMode ? -1 : undefined} // Prevent focus in Form Mode
                                    className={cn(
                                        "w-full h-full bg-transparent border-none outline-none px-1 font-inherit text-inherit leading-tight",
                                        isFormMode && "pointer-events-none"
                                    )}
                                    style={{ textAlign: field.alignment }}
                                    value={isFormMode ? (field.value || field.defaultValue || field.name) : (field.value || '')}
                                    placeholder={isAnnotationMode ? field.name : undefined}
                                    onChange={(e) => onUpdateField(field.id, { value: e.target.value })}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onFocus={() => { if(isAnnotationMode) onSelectField(field.id); }}
                                />
                             )
                         )}

                         {/* Checkbox Logic */}
                         {field.type === FieldType.CHECKBOX && (
                             <div className="flex items-center justify-center w-full h-full">
                                 {field.isChecked && <Check size="80%" />}
                             </div>
                         )}

                         {/* Dropdown Logic */}
                         {field.type === FieldType.DROPDOWN && (
                             <>
                                <div className="w-full flex justify-between items-center px-1">
                                    <span className="truncate">{field.value || 'Select...'}</span>
                                    <ChevronDown size={12} className="shrink-0" />
                                </div>
                                <div className={cn("absolute inset-0 w-full h-full flex items-center", isAnnotationMode ? "z-10" : "hidden")}>
                                   {isAnnotationMode && (
                                     <select 
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        value={field.value || ''}
                                        onChange={(e) => onUpdateField(field.id, { value: e.target.value })}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onFocus={() => { if(isAnnotationMode) onSelectField(field.id); }}
                                        title={field.toolTip}
                                     >
                                        <option value="" disabled>Select...</option>
                                        {(field.options || []).map((opt, i) => (
                                            <option key={i} value={opt}>{opt}</option>
                                        ))}
                                     </select>
                                   )}
                                </div>
                             </>
                         )}

                         {/* Radio Logic */}
                         {field.type === FieldType.RADIO && (
                             <div className="flex items-center justify-center w-full h-full">
                                <div 
                                    className="rounded-full flex items-center justify-center relative border border-black box-border" 
                                    style={{ 
                                        width: `${(Math.min(field.rect.width, field.rect.height) / field.rect.width) * 100}%`,
                                        height: `${(Math.min(field.rect.width, field.rect.height) / field.rect.height) * 100}%`,
                                        backgroundColor: !style.isTransparent ? style.backgroundColor : 'white'
                                    }}
                                >
                                    {field.isChecked && <div className="w-1/2 h-1/2 rounded-full bg-black"></div>}
                                </div>
                             </div>
                         )}

                         {/* Signature Logic */}
                         {field.type === FieldType.SIGNATURE && (
                             <div className="w-full h-full flex justify-center items-center overflow-hidden relative">
                                 {field.signatureData ? (
                                     <>
                                        <img 
                                            src={field.signatureData} 
                                            alt="Signature" 
                                            className={cn("max-w-full max-h-full", field.imageScaleMode === 'fill' ? 'object-fill w-full h-full' : 'object-contain')} 
                                        />
                                        {isAnnotationMode && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onUpdateField(field.id, { signatureData: undefined });
                                                }}
                                                className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-sm shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90 z-20"
                                                title={t('common.delete')}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                     </>
                                 ) : (
                                     <div className={cn("flex flex-col items-center justify-center text-muted-foreground/50", isAnnotationMode ? "cursor-pointer" : "")}>
                                         {isAnnotationMode ? <ImageIcon size={16} /> : <PenLine size={16} />}
                                         {isAnnotationMode && <span className="text-[10px] opacity-70">Click to Sign</span>}
                                     </div>
                                 )}
                             </div>
                         )}
                      </div>

                      {/* Selection Overlay (Form Mode Only) */}
                      {isSelected && isFormMode && editorState.tool === 'select' && (
                        <div className="absolute inset-0 pointer-events-none">
                            <div className="absolute -inset-[2px] border-2 border-blue-500 border-dashed" />
                            <span className="absolute -top-6 left-0 bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap z-30">{field.name}</span>
                            {/* Resize Handles */}
                            {['nw', 'ne', 'sw', 'se'].map(h => (
                                <div key={h} className={cn("absolute w-3 h-3 bg-white border border-blue-500 pointer-events-auto z-30", 
                                    h==='nw' && "-top-1.5 -left-1.5 cursor-nwse-resize",
                                    h==='ne' && "-top-1.5 -right-1.5 cursor-nesw-resize",
                                    h==='sw' && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                                    h==='se' && "-bottom-1.5 -right-1.5 cursor-nwse-resize"
                                )} onMouseDown={(e) => handleResizeMouseDown(e, field, h)} />
                            ))}
                        </div>
                      )}

                      {/* NEW: Annotation Mode Selection Overlay - Moved OUTSIDE overflow-hidden container */}
                      {showAnnotationFocus && (
                          <div className="absolute inset-0 border border-dashed border-blue-500 pointer-events-none z-50 animate-in fade-in duration-200" />
                      )}
                    </div>
                  );
                })}

              {/* Drag Guide */}
              {dragStart && dragCurrent && activePageIndex === page.pageIndex && (
                <div
                  className={cn("absolute border-2 pointer-events-none", editorState.mode === 'form' ? "border-blue-500 bg-blue-500/20" : "border-yellow-500 bg-yellow-500/20")}
                  style={{
                    left: Math.min(dragStart.x, dragCurrent.x) * editorState.scale,
                    top: Math.min(dragStart.y, dragCurrent.y) * editorState.scale,
                    width: Math.abs(dragCurrent.x - dragStart.x) * editorState.scale,
                    height: Math.abs(dragCurrent.y - dragStart.y) * editorState.scale,
                  }}
                />
              )}
            </div>

            {/* SVG Layer for Ink Annotations */}
            {/* Added viewBox to match unscaled page dimensions, ensuring proper scaling behavior for ink paths */}
            <svg 
                className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" 
                viewBox={`0 0 ${page.width} ${page.height}`}
                preserveAspectRatio="none"
            >
                {editorState.annotations
                    .filter(a => a.pageIndex === page.pageIndex && a.type === 'ink' && a.points)
                    .map(a => (
                        <path 
                            key={a.id}
                            d={pointsToPath(a.points!)}
                            stroke={a.color || 'red'}
                            strokeWidth={(a.thickness || 2)} 
                            fill="none"
                            strokeLinecap={a.intent === 'InkHighlight' ? 'butt' : (a.subtype === 'ink' || !a.subtype ? 'round' : 'butt')}
                            strokeLinejoin="round"
                            opacity={a.opacity ?? 1}
                            style={{ 
                                pointerEvents: editorState.tool === 'select' ? 'auto' : 'none', 
                                cursor: 'inherit',
                                mixBlendMode: a.intent === 'InkHighlight' ? 'multiply' : 'normal'
                            }}
                            onMouseDown={(e) => handleAnnotationMouseDown(e as any, a)}
                        />
                    ))
                }
                {/* Current Drawing Path */}
                {isDrawing && activePageIndex === page.pageIndex && (
                    <path 
                        d={pointsToPath(currentPathState)}
                        stroke={editorState.penStyle.color}
                        strokeWidth={editorState.penStyle.thickness}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={editorState.penStyle.opacity}
                    />
                )}
            </svg>
            
            {/* Snap Guides Layer */}
            {activePageIndex === page.pageIndex && snapLines.length > 0 && (
                <div className="absolute inset-0 pointer-events-none z-50">
                    {snapLines.map((line, idx) => (
                        <div key={idx} className="absolute border-red-500 border-dashed opacity-70"
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
          </div>
        ))}
      </div>
    </div>
  );
};

export default Workspace;
