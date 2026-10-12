import { THUMBNAIL_WARMUP_PRIORITY } from "@/constants";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import {
  getThumbnailContents,
  renderThumbnail,
} from "@/services/pdfService/thumbnailRenderer";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { ThumbnailContent } from "@/services/pdfService/types";
import type { EditorStore, EditorStoreSlice } from "./store.types";
import type { PageData } from "@/types";

const IDLE_MS = 600;
type Snapshot = { page: PageData; content: ThumbnailContent };
type SetState = Parameters<EditorStoreSlice<object>>[0];

// Structural edits remap pageIndex while preserving the actual control data.
// Compare only changed objects, without serializing strokes/images or the PDF.
function sameItem(a: object, b: object) {
  if (a === b) return true;
  const keys = Object.keys(a).filter((key) => key !== "pageIndex");
  return (
    keys.length ===
      Object.keys(b).filter((key) => key !== "pageIndex").length &&
    keys.every((key) => Object.is(Reflect.get(a, key), Reflect.get(b, key)))
  );
}
function sameItems(a: object[], b: object[]) {
  return (
    a.length === b.length && a.every((item, index) => sameItem(item, b[index]))
  );
}
function sameSnapshot(a: Snapshot, b: Snapshot) {
  const source = (page: PageData) =>
    page.blank
      ? "blank"
      : `${page.source?.documentId ?? "default"}:${page.source?.pageIndex ?? page.pageIndex}`;
  return (
    source(a.page) === source(b.page) &&
    a.page.width === b.page.width &&
    a.page.height === b.page.height &&
    sameItems(a.content.fields, b.content.fields) &&
    sameItems(a.content.annotations, b.content.annotations) &&
    sameItems(a.content.preserved, b.content.preserved)
  );
}

/** Per-document queue. No React subscription to revisions and no cache clearing
 * on edits: only a completed, current page snapshot replaces a displayed URL. */
export function createDocumentThumbnails(
  set: SetState,
  get: () => EditorStore,
  render = renderThumbnail,
) {
  let worker: PDFWorkerService | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;
  let generation = 0;
  let notBefore = 0;
  let backgroundNotBefore = 0;
  let enabled = true;
  let bytes: Uint8Array | null | undefined;
  const completed = new Map<string, Snapshot>();
  let pending: Map<string, Snapshot> | undefined;
  // null means a newly mounted viewport is awaiting its first observation.
  const viewports = new Map<symbol, readonly string[] | null>();
  let visible = new Set<string>();
  const imageHolds = new Set<symbol>();
  const retiredImages = new Set<string>();
  const releaseImage = (url: string) => {
    // Give all consumers one paint to switch before releasing the old URL.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (imageHolds.size) retiredImages.add(url);
        else URL.revokeObjectURL(url);
      }),
    );
  };
  const awaitingViewport = () =>
    [...viewports.values()].some((ids) => ids === null);
  const stop = () => {
    generation++;
    abort?.abort();
    abort = undefined;
    clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    if (
      !worker ||
      !enabled ||
      timer ||
      abort ||
      !get().pdfBytes ||
      pending?.size === 0 ||
      awaitingViewport()
    )
      return;
    const hasVisible = [...visible].some((id) => !pending || pending.has(id));
    timer = setTimeout(
      () => {
        timer = undefined;
        void run();
      },
      Math.max(
        0,
        Math.max(notBefore, hasVisible ? 0 : backgroundNotBefore) - Date.now(),
      ),
    );
  };
  async function run() {
    const service = worker;
    if (!service || awaitingViewport()) return;
    const state = get();
    if (!state.pdfBytes || state.documentLoadState !== "ready") return;
    if (bytes !== state.pdfBytes) {
      bytes = state.pdfBytes;
      completed.clear();
      pending = undefined;
    }
    if (!pending) {
      const contents = getThumbnailContents(state);
      pending = new Map();
      const liveIds = new Set<string>();
      for (const page of state.pages) {
        const id = getPageId(page);
        liveIds.add(id);
        const snapshot = { page, content: contents[page.pageIndex] };
        const previous = completed.get(id);
        if (
          !state.thumbnailImages[page.pageIndex] ||
          !previous ||
          !sameSnapshot(previous, snapshot)
        )
          pending.set(id, snapshot);
      }
      for (const id of completed.keys())
        if (!liveIds.has(id)) completed.delete(id);
    }
    const queue = pending;
    const epoch = generation;
    const controller = new AbortController();
    abort = controller;
    const { signal } = controller;
    try {
      while (queue.size) {
        if (signal.aborted || awaitingViewport()) return;
        // Re-evaluate at each job boundary, so scrolling/mode switches replace
        // the old priority immediately without throwing away an in-flight render.
        let snapshot: Snapshot | undefined;
        for (const id of visible) {
          const candidate = queue.get(id);
          if (
            candidate &&
            (!snapshot || candidate.page.pageIndex < snapshot.page.pageIndex)
          )
            snapshot = candidate;
        }
        snapshot ??= queue.values().next().value;
        if (!snapshot) break;
        const { page, content } = snapshot;
        const id = getPageId(page);
        if (!visible.has(id) && Date.now() < backgroundNotBefore) return;
        const started = performance.now();
        try {
          const url = await render(
            service,
            page.pageIndex,
            signal,
            content,
            visible.has(id) ? 20 : THUMBNAIL_WARMUP_PRIORITY,
          );
          if (
            signal.aborted ||
            generation !== epoch ||
            getPageId(get().pages[page.pageIndex] ?? page) !== id
          ) {
            URL.revokeObjectURL(url);
            return;
          }
          const old = get().thumbnailImages[page.pageIndex];
          completed.set(id, snapshot);
          set((current) => ({
            thumbnailImages: {
              ...current.thumbnailImages,
              [page.pageIndex]: url,
            },
          }));
          if (old?.startsWith("blob:")) releaseImage(old);
        } catch {
          // Keep the last good image. A failed page must not block later pages.
        }
        if (signal.aborted) return;
        queue.delete(id);
        const elapsed = performance.now() - started;
        // Expensive previews get idle gaps instead of monopolizing the owner
        // worker. Cheap documents still warm quickly; visible items skip gaps.
        backgroundNotBefore =
          Date.now() +
          (elapsed >= 50 ? Math.min(2000, Math.max(IDLE_MS, elapsed * 2)) : 0);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      if (abort === controller) {
        abort = undefined;
        schedule();
      }
    }
  }
  return {
    warmup(workerService: PDFWorkerService) {
      enabled = true;
      if (worker !== workerService) {
        stop();
        worker = workerService;
      }
      schedule();
    },
    changed(immediate = false) {
      stop();
      enabled = true;
      pending = undefined;
      notBefore = Date.now() + (immediate ? 0 : IDLE_MS);
      schedule();
    },
    defer() {
      stop();
      notBefore = Date.now() + IDLE_MS;
      schedule();
    },
    setViewport(owner: symbol, pageIds: readonly string[] | null) {
      viewports.set(owner, pageIds);
      visible = new Set([...viewports.values()].flatMap((ids) => ids ?? []));
      clearTimeout(timer);
      timer = undefined;
      schedule();
    },
    removeViewport(owner: symbol) {
      viewports.delete(owner);
      visible = new Set([...viewports.values()].flatMap((ids) => ids ?? []));
      clearTimeout(timer);
      timer = undefined;
      schedule();
    },
    holdImages() {
      // Drag/drop clones keep their snapshot while the queue keeps rendering.
      const token = Symbol();
      imageHolds.add(token);
      return () => {
        if (!imageHolds.delete(token) || imageHolds.size) return;
        for (const url of retiredImages) releaseImage(url);
        retiredImages.clear();
      };
    },
    cancel() {
      stop();
      // Structural transactions resume via changed(); viewport cleanup alone
      // must not restart a closed document or release a pending drop's images.
      enabled = false;
    },
  };
}
