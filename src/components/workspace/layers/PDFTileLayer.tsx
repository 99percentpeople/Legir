import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { MAX_PIXELS_PER_PAGE, TILE_MAX_DIM } from "@/constants";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { useAppEvent } from "@/hooks/useAppEventBus";

type TileInfo = {
  key: string;
  canvasId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
};

interface PDFTileLayerProps {
  pageIndex: number;
  pageProxy: pdfjsLib.PDFPageProxy | null;
  scale: number;
  isInView: boolean;
  isRendered: boolean;
  onStateChange?: (state: {
    tileMode: boolean;
    hasUsableTileBuffer: boolean;
    hasAnyTileRendered: boolean;
    hasAllTilesRendered: boolean;
  }) => void;
}

const PDFTileLayer: React.FC<PDFTileLayerProps> = ({
  pageIndex,
  pageProxy,
  scale,
  isInView,
  isRendered,
  onStateChange,
}) => {
  const [hasAnyTileRendered, setHasAnyTileRendered] = useState(false);
  const [tileProgressVersion, setTileProgressVersion] = useState(0);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [frontHasAnyRendered, setFrontHasAnyRendered] = useState(false);

  const renderEpochRef = useRef(0);
  const dprRef = useRef<number>(1);

  const [tileMode, setTileMode] = useState(false);
  const [frontTilesKey, setFrontTilesKey] = useState<string>("");
  const [frontTiles, setFrontTiles] = useState<TileInfo[]>([]);
  const [midTilesKey, setMidTilesKey] = useState<string>("");
  const [midTiles, setMidTiles] = useState<TileInfo[]>([]);
  const [backTilesKey, setBackTilesKey] = useState<string>("");
  const [backTiles, setBackTiles] = useState<TileInfo[]>([]);

  const frontTilesKeyRef = useRef<string>("");
  const midTilesKeyRef = useRef<string>("");
  const backTilesKeyRef = useRef<string>("");
  frontTilesKeyRef.current = frontTilesKey;
  midTilesKeyRef.current = midTilesKey;
  backTilesKeyRef.current = backTilesKey;

  const didInitFrontFromBackKeyRef = useRef<string>("");

  const [frontTilesPageW, setFrontTilesPageW] = useState<number>(0);
  const [frontTilesPageH, setFrontTilesPageH] = useState<number>(0);
  const [midTilesPageW, setMidTilesPageW] = useState<number>(0);
  const [midTilesPageH, setMidTilesPageH] = useState<number>(0);
  const [backTilesPageW, setBackTilesPageW] = useState<number>(0);
  const [backTilesPageH, setBackTilesPageH] = useState<number>(0);

  const tileCanvasElsRef = useRef(new Map<string, HTMLCanvasElement>());
  const tileDetachedCanvasRef = useRef(new Map<string, OffscreenCanvas>());
  const tileTransferredRef = useRef(new Set<string>());
  const tileRenderedRef = useRef(new Set<string>());
  const activeTileIdsRef = useRef<Set<string>>(new Set());

  // NOTE: Canvas lifecycle invariants (important for preventing regressions):
  // - A tile canvas starts hidden and becomes visible only after a successful worker render.
  //   This prevents a "white flash" where unrendered canvases cover the page.
  // - When page-mode has a rendered full-page fallback (isRendered=true), we must NOT
  //   switch to a partial tile buffer early. Otherwise, we'd hide the full-page canvas
  //   after only a few tiles render, creating a "blank region" until the rest completes.
  // - When leaving tile mode, release worker-side canvases (canvasMap) and clear local
  //   bookkeeping refs, otherwise re-entering tile mode may reuse stale canvasIds.

  const releaseAndForgetCanvases = (canvasIds: string[]) => {
    if (canvasIds.length === 0) return;
    void pdfWorkerService.releaseCanvas({ canvasIds });
    for (const cid of canvasIds) {
      tileCanvasElsRef.current.delete(cid);
      tileDetachedCanvasRef.current.delete(cid);
      tileTransferredRef.current.delete(cid);
      tileRenderedRef.current.delete(cid);
    }
  };

  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const [scrollContainerEl, setScrollContainerEl] =
    useState<HTMLElement | null>(null);
  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      scrollContainerRef.current = element;
      setScrollContainerEl(element);
    },
    { replayLast: true },
  );

  const reprioritizeRafRef = useRef<number | null>(null);
  const viewportCenterRef = useRef<[number, number] | null>(null);
  const viewportRectNormRef = useRef<[number, number, number, number] | null>(
    null,
  );
  const lastViewportRectNormRef = useRef<
    [number, number, number, number] | null
  >(null);
  const lastReprioritizeCenterRef = useRef<[number, number] | null>(null);
  const reprioritizeBusyRef = useRef(false);
  const reprioritizeQueuedCenterRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!scrollContainerEl) return;
    if (!tileMode) return;
    if (!backTilesKey) return;

    const schedule = () => {
      if (reprioritizeRafRef.current !== null) return;

      reprioritizeRafRef.current = requestAnimationFrame(() => {
        reprioritizeRafRef.current = null;

        const scrollContainer = scrollContainerEl;
        const pageEl = document.getElementById(`page-${pageIndex}`);
        if (!scrollContainer || !pageEl) return;

        const dpr = dprRef.current;
        const cRect = scrollContainer.getBoundingClientRect();
        const pRect = pageEl.getBoundingClientRect();
        const vcx = cRect.left + cRect.width / 2;
        const vcy = cRect.top + cRect.height / 2;
        const cssX = Math.min(Math.max(vcx - pRect.left, 0), pRect.width);
        const cssY = Math.min(Math.max(vcy - pRect.top, 0), pRect.height);
        const centerX = cssX * dpr;
        const centerY = cssY * dpr;

        // Track viewport rect in normalized (0..1) page coordinates so we can hide
        // offscreen tiles without caring about exact page pixel dimensions.
        const leftCss = Math.min(
          Math.max(cRect.left - pRect.left, 0),
          pRect.width,
        );
        const topCss = Math.min(
          Math.max(cRect.top - pRect.top, 0),
          pRect.height,
        );
        const rightCss = Math.min(
          Math.max(cRect.right - pRect.left, 0),
          pRect.width,
        );
        const bottomCss = Math.min(
          Math.max(cRect.bottom - pRect.top, 0),
          pRect.height,
        );
        const w = pRect.width || 1;
        const h = pRect.height || 1;
        const rectNorm: [number, number, number, number] = [
          leftCss / w,
          topCss / h,
          rightCss / w,
          bottomCss / h,
        ];
        viewportRectNormRef.current = rectNorm;
        const prev = lastViewportRectNormRef.current;
        if (
          !prev ||
          Math.abs(prev[0] - rectNorm[0]) > 0.01 ||
          Math.abs(prev[1] - rectNorm[1]) > 0.01 ||
          Math.abs(prev[2] - rectNorm[2]) > 0.01 ||
          Math.abs(prev[3] - rectNorm[3]) > 0.01
        ) {
          lastViewportRectNormRef.current = rectNorm;
          setViewportVersion((v) => v + 1);
        }

        viewportCenterRef.current = [centerX, centerY];

        const last = lastReprioritizeCenterRef.current;
        const dx = last ? centerX - last[0] : Infinity;
        const dy = last ? centerY - last[1] : Infinity;
        const MIN_MOVE = 64 * dpr;
        if (last && dx * dx + dy * dy < MIN_MOVE * MIN_MOVE) return;
        lastReprioritizeCenterRef.current = [centerX, centerY];

        const send = (c: [number, number]) => {
          if (reprioritizeBusyRef.current) {
            reprioritizeQueuedCenterRef.current = c;
            return;
          }
          reprioritizeBusyRef.current = true;

          void pdfWorkerService
            .reprioritize({
              pageIndex,
              scale: scale * dpr,
              viewportCenter: c,
            })
            .catch(() => {})
            .finally(() => {
              reprioritizeBusyRef.current = false;
              const queued = reprioritizeQueuedCenterRef.current;
              reprioritizeQueuedCenterRef.current = null;
              if (queued) {
                send(queued);
              }
            });
        };

        send([centerX, centerY]);
      });
    };

    const onScroll = () => schedule();
    scrollContainerEl.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    schedule();

    return () => {
      scrollContainerEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (reprioritizeRafRef.current !== null) {
        cancelAnimationFrame(reprioritizeRafRef.current);
        reprioritizeRafRef.current = null;
      }
      lastReprioritizeCenterRef.current = null;
      reprioritizeQueuedCenterRef.current = null;
      reprioritizeBusyRef.current = false;
    };
  }, [backTilesKey, pageIndex, scale, scrollContainerEl, tileMode]);

  useLayoutEffect(() => {
    renderEpochRef.current += 1;
  }, [pageProxy, pageIndex, scale, tileMode, backTilesKey]);

  const componentId = useRef(Math.random().toString(36).substr(2, 9));

  useEffect(() => {
    if (!pageProxy) {
      setTileMode(false);
      setFrontTiles([]);
      setFrontTilesKey("");
      setMidTiles([]);
      setMidTilesKey("");
      setBackTiles([]);
      setBackTilesKey("");
      setFrontTilesPageW(0);
      setFrontTilesPageH(0);
      setMidTilesPageW(0);
      setMidTilesPageH(0);
      setBackTilesPageW(0);
      setBackTilesPageH(0);
      setHasAnyTileRendered(false);
      setFrontHasAnyRendered(false);
      didInitFrontFromBackKeyRef.current = "";
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprRef.current = dpr;
    const viewport = pageProxy.getViewport({ scale: scale * dpr });
    const pageW = Math.ceil(viewport.width);
    const pageH = Math.ceil(viewport.height);
    const pixels = pageW * pageH;

    if (pixels <= MAX_PIXELS_PER_PAGE) {
      setTileMode(false);

      setBackTiles([]);
      setBackTilesKey("");
      setBackTilesPageW(0);
      setBackTilesPageH(0);
      return;
    }

    setBackTilesPageW(pageW);
    setBackTilesPageH(pageH);

    const epoch = `${pageIndex}_${scale}_${dpr}_${pageW}x${pageH}`;

    if (backTilesKey && backTilesKey !== epoch) {
      const backHasAnyRendered = backTiles.some((t) =>
        tileRenderedRef.current.has(t.canvasId),
      );

      if (backHasAnyRendered) {
        if (midTilesKey !== "") {
          setFrontTiles(midTiles);
          setFrontTilesKey(midTilesKey);
          setFrontTilesPageW(midTilesPageW);
          setFrontTilesPageH(midTilesPageH);
          setFrontHasAnyRendered(true);
        }

        setMidTiles(backTiles);
        setMidTilesKey(backTilesKey);
        setMidTilesPageW(backTilesPageW);
        setMidTilesPageH(backTilesPageH);
      }
    }

    const nextTiles: TileInfo[] = [];
    let centerX = pageW / 2;
    let centerY = pageH / 2;
    const scrollContainer = scrollContainerRef.current;
    const pageEl = scrollContainer
      ? document.getElementById(`page-${pageIndex}`)
      : null;
    if (scrollContainer && pageEl) {
      const cRect = scrollContainer.getBoundingClientRect();
      const pRect = pageEl.getBoundingClientRect();
      const vcx = cRect.left + cRect.width / 2;
      const vcy = cRect.top + cRect.height / 2;
      const cssX = Math.min(Math.max(vcx - pRect.left, 0), pRect.width);
      const cssY = Math.min(Math.max(vcy - pRect.top, 0), pRect.height);
      centerX = cssX * dpr;
      centerY = cssY * dpr;
      viewportCenterRef.current = [centerX, centerY];
    }
    for (let y = 0; y < pageH; y += TILE_MAX_DIM) {
      for (let x = 0; x < pageW; x += TILE_MAX_DIM) {
        const w = Math.min(TILE_MAX_DIM, pageW - x);
        const h = Math.min(TILE_MAX_DIM, pageH - y);
        const key = `${x}_${y}_${w}_${h}`;
        const dx = x + w / 2 - centerX;
        const dy = y + h / 2 - centerY;
        const priority = Math.hypot(dx, dy);
        nextTiles.push({
          key,
          canvasId: `${componentId.current}-T-${epoch}-${key}`,
          x,
          y,
          w,
          h,
          priority,
        });
      }
    }

    nextTiles.sort((a, b) => a.priority - b.priority);

    setTileMode(true);
    if (epoch === backTilesKey) {
      return;
    }

    setBackTiles(nextTiles);
    setBackTilesKey(epoch);
  }, [backTilesKey, frontTilesKey, pageIndex, pageProxy, scale]);

  useEffect(() => {
    if (!tileMode) return;
    if (!backTilesKey) return;

    const cleaningBackKey = backTilesKey;
    const canvasIds = backTiles.map((t) => t.canvasId);

    return () => {
      const frontKey = frontTilesKeyRef.current;
      const midKey = midTilesKeyRef.current;
      if (frontKey === cleaningBackKey || midKey === cleaningBackKey) {
        return;
      }

      if (canvasIds.length > 0) {
        const active = activeTileIdsRef.current;
        const idsToRelease = canvasIds.filter((cid) => !active.has(cid));
        if (idsToRelease.length > 0) {
          releaseAndForgetCanvases(idsToRelease);
        }
        return;
      }
    };
  }, [backTiles, backTilesKey, tileMode]);

  useEffect(() => {
    if (!tileMode) return;
    if (!midTilesKey) return;

    const cleaningMidKey = midTilesKey;
    const canvasIds = midTiles.map((t) => t.canvasId);

    return () => {
      const frontKey = frontTilesKeyRef.current;
      const backKey = backTilesKeyRef.current;
      if (frontKey === cleaningMidKey || backKey === cleaningMidKey) {
        return;
      }

      if (canvasIds.length > 0) {
        const active = activeTileIdsRef.current;
        const idsToRelease = canvasIds.filter((cid) => !active.has(cid));
        if (idsToRelease.length > 0) {
          releaseAndForgetCanvases(idsToRelease);
        }
      }
    };
  }, [midTiles, midTilesKey, tileMode]);

  useEffect(() => {
    if (!tileMode) return;
    if (!frontTilesKey) return;

    const cleaningFrontKey = frontTilesKey;
    const canvasIds = frontTiles.map((t) => t.canvasId);

    return () => {
      const midKey = midTilesKeyRef.current;
      const backKey = backTilesKeyRef.current;
      if (midKey === cleaningFrontKey || backKey === cleaningFrontKey) {
        return;
      }

      if (canvasIds.length > 0) {
        const active = activeTileIdsRef.current;
        const idsToRelease = canvasIds.filter((cid) => !active.has(cid));
        if (idsToRelease.length > 0) {
          releaseAndForgetCanvases(idsToRelease);
        }
      }
    };
  }, [frontTiles, frontTilesKey, tileMode]);

  useEffect(() => {
    if (tileMode) return;
    if (!isRendered) return;

    const allCanvasIds = [...frontTiles, ...midTiles, ...backTiles].map(
      (t) => t.canvasId,
    );

    if (
      allCanvasIds.length === 0 &&
      frontTilesKey === "" &&
      midTilesKey === "" &&
      backTilesKey === ""
    ) {
      return;
    }

    if (allCanvasIds.length > 0) {
      releaseAndForgetCanvases(allCanvasIds);
    }

    setFrontTiles([]);
    setFrontTilesKey("");
    setFrontTilesPageW(0);
    setFrontTilesPageH(0);
    setMidTiles([]);
    setMidTilesKey("");
    setMidTilesPageW(0);
    setMidTilesPageH(0);
    setBackTiles([]);
    setBackTilesKey("");
    setBackTilesPageW(0);
    setBackTilesPageH(0);
    setFrontHasAnyRendered(false);
    didInitFrontFromBackKeyRef.current = "";
    setHasAnyTileRendered(false);
  }, [
    backTiles,
    backTilesKey,
    frontTiles,
    frontTilesKey,
    isRendered,
    midTiles,
    midTilesKey,
    tileMode,
  ]);

  useEffect(() => {
    if (!pageProxy) return;
    if (!isInView) return;
    if (!tileMode) return;
    if (!backTilesKey) return;
    if (backTiles.length === 0) return;

    const epoch = renderEpochRef.current;
    let abortController: AbortController | null = null;
    let rafId: number | null = null;

    const renderTile = async (
      tile: TileInfo,
      signal: AbortSignal,
    ): Promise<boolean> => {
      const targetCanvas = tileCanvasElsRef.current.get(tile.canvasId);
      if (!targetCanvas) return false;

      if (renderEpochRef.current !== epoch) return false;

      if (
        tileRenderedRef.current.has(tile.canvasId) ||
        targetCanvas.dataset.rendered === "1"
      ) {
        return true;
      }

      const wasRendered = targetCanvas.dataset.rendered === "1";
      if (!wasRendered && !tileRenderedRef.current.has(tile.canvasId)) {
        targetCanvas.style.visibility = "hidden";
      }

      let offscreenCanvas: OffscreenCanvas | undefined;

      const alreadyTransferred = tileTransferredRef.current.has(tile.canvasId);

      try {
        if (signal.aborted) return false;

        if (!alreadyTransferred) {
          const cached = tileDetachedCanvasRef.current.get(tile.canvasId);
          if (cached) {
            offscreenCanvas = cached;
          } else {
            targetCanvas.width = tile.w;
            targetCanvas.height = tile.h;
            offscreenCanvas = targetCanvas.transferControlToOffscreen();
            tileDetachedCanvasRef.current.set(tile.canvasId, offscreenCanvas);
          }

          tileTransferredRef.current.add(tile.canvasId);
        }

        const ok = await pdfWorkerService.renderPage({
          pageIndex,
          scale: scale * dprRef.current,
          canvas: alreadyTransferred ? undefined : offscreenCanvas,
          canvasId: tile.canvasId,
          tile: [tile.x, tile.y, tile.w, tile.h],
          priority: (() => {
            const vc = viewportCenterRef.current;
            if (!vc) return tile.priority;
            const cx = tile.x + tile.w / 2;
            const cy = tile.y + tile.h / 2;
            return Math.hypot(cx - vc[0], cy - vc[1]);
          })(),
          signal,
        });

        if (offscreenCanvas) {
          tileDetachedCanvasRef.current.delete(tile.canvasId);
        }

        if (ok && !signal.aborted && renderEpochRef.current === epoch) {
          tileRenderedRef.current.add(tile.canvasId);
          const el = tileCanvasElsRef.current.get(tile.canvasId);
          if (el) {
            el.dataset.rendered = "1";
            el.style.visibility = "visible";
          }

          if (!hasAnyTileRendered) {
            setHasAnyTileRendered(true);
          }

          // Used to trigger React re-renders while tiles are progressively completing.
          // This allows the parent to keep a full-page fallback visible until all tiles
          // for the current epoch are rendered.
          setTileProgressVersion((v) => v + 1);

          if (
            !isRendered &&
            frontTilesKeyRef.current === "" &&
            midTilesKeyRef.current === "" &&
            backTilesKey &&
            didInitFrontFromBackKeyRef.current !== backTilesKey
          ) {
            didInitFrontFromBackKeyRef.current = backTilesKey;
            setFrontTiles(backTiles);
            setFrontTilesKey(backTilesKey);
            setFrontTilesPageW(backTilesPageW);
            setFrontTilesPageH(backTilesPageH);
            setFrontHasAnyRendered(true);
          }
        }

        return ok;
      } catch (error: any) {
        if (error?.phase === "pre-send") {
          if (tileDetachedCanvasRef.current.get(tile.canvasId)) {
            tileTransferredRef.current.delete(tile.canvasId);
          }
        } else {
          if (offscreenCanvas) {
            tileDetachedCanvasRef.current.delete(tile.canvasId);
          }
        }

        if (
          error?.name !== "RenderingCancelledException" &&
          error?.name !== "AbortError"
        ) {
          console.error("Render error:", error);
        }
        return false;
      }
    };

    rafId = requestAnimationFrame(() => {
      abortController = new AbortController();
      const signal = abortController.signal;

      const MAX_IN_FLIGHT = 2;
      let inFlight = 0;
      let completed = 0;

      const pendingTiles = backTiles.filter(
        (t) => !tileRenderedRef.current.has(t.canvasId),
      );
      const totalToRender = pendingTiles.length;

      const attemptCount = new Map<string, number>();

      const renderWithRetry = async (tile: TileInfo): Promise<boolean> => {
        const count = attemptCount.get(tile.canvasId) ?? 0;
        const ok = await renderTile(tile, signal);
        if (
          ok ||
          signal.aborted ||
          renderEpochRef.current !== epoch ||
          count >= 1
        ) {
          return ok;
        }
        attemptCount.set(tile.canvasId, count + 1);
        return renderTile(tile, signal);
      };

      const takeNextTile = (): TileInfo | null => {
        if (pendingTiles.length === 0) return null;
        const vc = viewportCenterRef.current;

        let bestIdx = 0;
        if (vc) {
          let bestP = Infinity;
          for (let i = 0; i < pendingTiles.length; i++) {
            const t = pendingTiles[i];
            const cx = t.x + t.w / 2;
            const cy = t.y + t.h / 2;
            const p = Math.hypot(cx - vc[0], cy - vc[1]);
            if (p < bestP) {
              bestP = p;
              bestIdx = i;
            }
          }
        } else {
          let bestP = pendingTiles[0].priority;
          for (let i = 1; i < pendingTiles.length; i++) {
            const p = pendingTiles[i].priority;
            if (p < bestP) {
              bestP = p;
              bestIdx = i;
            }
          }
        }

        const [tile] = pendingTiles.splice(bestIdx, 1);
        return tile ?? null;
      };

      const launchMore = () => {
        if (signal.aborted) return;
        if (renderEpochRef.current !== epoch) return;

        while (inFlight < MAX_IN_FLIGHT) {
          const tile = takeNextTile();
          if (!tile) break;
          inFlight += 1;

          void renderWithRetry(tile)
            .then((ok) => {
              if (signal.aborted) return;
              if (renderEpochRef.current !== epoch) return;
            })
            .finally(() => {
              inFlight -= 1;
              completed += 1;

              if (signal.aborted) return;
              if (renderEpochRef.current !== epoch) return;

              if (completed >= totalToRender) {
                return;
              }

              launchMore();
            });
        }
      };

      launchMore();
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (abortController) {
        abortController.abort();
      }
    };
  }, [
    backTiles,
    backTilesKey,
    isInView,
    pageProxy,
    pageIndex,
    scale,
    tileMode,
  ]);

  const hasUsableFrontTileBuffer =
    frontHasAnyRendered &&
    frontTilesKey !== "" &&
    frontTiles.length > 0 &&
    frontTilesPageW > 0 &&
    frontTilesPageH > 0;

  const hasUsableMidTileBuffer =
    midTilesKey !== "" &&
    midTiles.length > 0 &&
    midTilesPageW > 0 &&
    midTilesPageH > 0;

  const hasUsableTileBuffer =
    hasUsableFrontTileBuffer || hasUsableMidTileBuffer;
  const showTileCanvases =
    tileMode || (!tileMode && hasUsableTileBuffer && !isRendered);

  const hasAllTilesRendered =
    tileProgressVersion >= 0 &&
    tileMode &&
    backTilesKey !== "" &&
    backTiles.length > 0 &&
    backTiles.every((t) => tileRenderedRef.current.has(t.canvasId));

  useEffect(() => {
    onStateChange?.({
      tileMode,
      hasUsableTileBuffer,
      hasAnyTileRendered,
      hasAllTilesRendered,
    });
  }, [
    hasAllTilesRendered,
    hasAnyTileRendered,
    hasUsableTileBuffer,
    onStateChange,
    tileMode,
  ]);

  activeTileIdsRef.current = new Set(
    [...frontTiles, ...midTiles, ...backTiles].map((t) => t.canvasId),
  );

  const frontTileIdSet = new Set(frontTiles.map((t) => t.canvasId));
  const midTileIdSet = new Set(midTiles.map((t) => t.canvasId));
  const backTileIdSet = new Set(backTiles.map((t) => t.canvasId));
  const tileByIdInPaintOrder = new Map<string, TileInfo>();
  const pushTiles = (tiles: TileInfo[]) => {
    for (const t of tiles) {
      if (tileByIdInPaintOrder.has(t.canvasId)) {
        tileByIdInPaintOrder.delete(t.canvasId);
      }
      tileByIdInPaintOrder.set(t.canvasId, t);
    }
  };
  pushTiles(frontTiles);
  pushTiles(midTiles);
  pushTiles(backTiles);
  const allTiles = Array.from(tileByIdInPaintOrder.values());

  if (!showTileCanvases) {
    return null;
  }

  // Used to re-render tiles when the viewport changes (per-tile hidden optimization).
  void viewportVersion;

  return (
    <>
      {allTiles.map((t) => {
        const isBack = backTileIdSet.has(t.canvasId);
        const isMid = midTileIdSet.has(t.canvasId);
        const isFront = frontTileIdSet.has(t.canvasId);

        const baseW = isBack
          ? backTilesPageW
          : isMid
            ? midTilesPageW
            : frontTilesPageW;
        const baseH = isBack
          ? backTilesPageH
          : isMid
            ? midTilesPageH
            : frontTilesPageH;

        const hideByViewport = (() => {
          if (!tileMode) return false;
          const rect = viewportRectNormRef.current;
          if (!rect) return false;
          if (!baseW || !baseH) return false;

          const [vl, vt, vr, vb] = rect;
          const marginX = Math.min(0.25, (TILE_MAX_DIM / baseW) * 1.5);
          const marginY = Math.min(0.25, (TILE_MAX_DIM / baseH) * 1.5);
          const l = vl - marginX;
          const t0 = vt - marginY;
          const r = vr + marginX;
          const b = vb + marginY;

          const x0 = t.x / baseW;
          const y0 = t.y / baseH;
          const x1 = (t.x + t.w) / baseW;
          const y1 = (t.y + t.h) / baseH;

          const intersects = x1 >= l && x0 <= r && y1 >= t0 && y0 <= b;
          return !intersects;
        })();

        const tileDisplay = !isInView || hideByViewport ? "none" : "block";

        return (
          <canvas
            key={t.canvasId}
            ref={(el) => {
              if (el) {
                tileCanvasElsRef.current.set(t.canvasId, el);
                const wasRendered = el.dataset.rendered === "1";
                if (!wasRendered && !tileRenderedRef.current.has(t.canvasId)) {
                  el.style.visibility = "hidden";
                }
              } else {
                tileCanvasElsRef.current.delete(t.canvasId);
              }
            }}
            className="absolute"
            style={{
              display: tileDisplay,
              left: baseW ? `${(t.x / baseW) * 100}%` : t.x / dprRef.current,
              top: baseH ? `${(t.y / baseH) * 100}%` : t.y / dprRef.current,
              width: baseW ? `${(t.w / baseW) * 100}%` : t.w / dprRef.current,
              height: baseH ? `${(t.h / baseH) * 100}%` : t.h / dprRef.current,
              visibility: tileRenderedRef.current.has(t.canvasId)
                ? "visible"
                : "hidden",
            }}
          />
        );
      })}
    </>
  );
};

export default PDFTileLayer;
