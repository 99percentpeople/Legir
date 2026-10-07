import { EventBus, appEventBus, type AppEventMap } from "@/lib/eventBus";
import {
  activateEditorView,
  windowEditorView,
  createDocumentEditorView,
} from "@/store/useEditorView";
import type { EditorView } from "@/store/editorView";
import type { EditorTabSnapshot } from "./types";

export interface EditorTabRuntime {
  store: EditorView;
  events: EventBus<AppEventMap>;
  root: HTMLElement | null;
  scrollContainer: HTMLElement | null;
  active: boolean;
  disposed: boolean;
  signal: AbortSignal;
  dispose: () => void;
}

/** Clear the window's active document without mutating a transferable runtime. */
export const deactivateEditorTabRuntime = (
  runtime: EditorTabRuntime | null,
) => {
  if (runtime) runtime.active = false;
  activateEditorView();
  windowEditorView.getState().resetDocument();
};

export const createEditorTabRuntime = (
  snapshot: EditorTabSnapshot,
  thumbnailImages: Record<number, string>,
): EditorTabRuntime => {
  const { store, dispose } = createDocumentEditorView({
    ...snapshot,
    thumbnailImages,
  });
  const events = new EventBus<AppEventMap>();
  const lifetime = new AbortController();
  // PDF lifecycle notifications belong to the window; workspace interactions
  // are private to this document, including sticky navigation and selection.
  for (const event of [
    "pdf:firstPageRendered",
    "pdf:passwordRequired",
  ] as const) {
    events.on(event, (payload) => appEventBus.emit(event, payload));
  }
  const runtime: EditorTabRuntime = {
    store,
    events,
    signal: lifetime.signal,
    root: null,
    scrollContainer: null,
    active: false,
    disposed: false,
    dispose: () => {
      if (runtime.disposed) return;
      runtime.disposed = true;
      lifetime.abort();
      runtime.active = false;
      dispose();
      events.clear();
      runtime.root = null;
      runtime.scrollContainer = null;
    },
  };
  events.on("workspace:scrollContainerReady", ({ element }) => {
    runtime.scrollContainer = element;
  });
  return runtime;
};
