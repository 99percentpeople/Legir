import type { AiChatMessageAttachment } from "@/services/ai/chat/types";

export type Unsubscribe = () => void;

type ShapeDraftTool =
  | "draw_shape_polyline"
  | "draw_shape_polygon"
  | "draw_shape_cloud_polygon";

export class EventBus<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(payload: unknown) => void>>();
  private lastPayload = new Map<keyof Events, unknown>();

  on<K extends keyof Events>(
    event: K,
    handler: (payload: Events[K]) => void,
    options?: { replayLast?: boolean },
  ): Unsubscribe {
    const set =
      this.listeners.get(event) ?? new Set<(payload: unknown) => void>();
    const erasedHandler = handler as (payload: unknown) => void;
    set.add(erasedHandler);
    this.listeners.set(event, set);

    if (options?.replayLast && this.lastPayload.has(event)) {
      handler(this.lastPayload.get(event) as Events[K]);
    }

    return () => {
      const cur = this.listeners.get(event);
      if (!cur) return;
      cur.delete(erasedHandler);
      if (cur.size === 0) this.listeners.delete(event);
    };
  }

  emit<K extends keyof Events>(
    event: K,
    payload: Events[K],
    options?: { sticky?: boolean },
  ) {
    if (options?.sticky) {
      this.lastPayload.set(event, payload);
    }

    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch {
        console.error("EventBus: Error in handler", event, payload);
      }
    }
  }

  // Removes the last emitted payload tracking for a given event in the EventBus.
  clearSticky<K extends keyof Events>(event: K) {
    this.lastPayload.delete(event);
  }
}

export type AppEventMap = {
  "workspace:textSelectingChange": {
    pageIndex: number;
    isSelecting: boolean;
  };
  "workspace:textSelectionHandleDraggingChange": {
    dragging: boolean;
    handleKind?: "start" | "end";
  };
  "workspace:navigatePage": {
    pageIndex: number;
    behavior?: "auto" | "smooth";
    skipScroll?: boolean;
  };
  "workspace:scrollContainerReady": {
    element: HTMLElement;
  };
  "workspace:zoomInput": {
    at: number;
    source: "wheel" | "pinch";
    fromScale: number;
    targetScale: number;
  };
  "workspace:openTranslate": {
    sourceText?: string;
    autoTranslate?: boolean;
  };
  "workspace:askAi": AiChatMessageAttachment;
  "workspace:focusControl": {
    id: string;
    behavior?: "auto" | "smooth";
    skipScroll?: boolean;
  };
  "workspace:focusSearchResult": {
    pageIndex: number;
    rect: { x: number; y: number; width: number; height: number };
    behavior?: "auto" | "smooth";
    skipScroll?: boolean;
  };
  "workspace:focusTextRange": {
    pageIndex: number;
    startOffset: number;
    endOffset: number;
    rect: { x: number; y: number; width: number; height: number };
    behavior?: "auto" | "smooth";
    skipScroll?: boolean;
  };
  "workspace:shapeDraftStateChange": {
    active: boolean;
    tool: ShapeDraftTool | null;
    canFinish: boolean;
  };
  "workspace:pinchGestureActiveChange": {
    active: boolean;
  };
  "workspace:pointerDown": Record<string, never>;
  "workspace:finishShapeDraft": Record<string, never>;
  "workspace:cancelShapeDraft": Record<string, never>;
  "sidebar:focusAnnotation": {
    id: string;
  };
  "pdf:loadStart": {
    id: string;
    label?: string;
  };
  "pdf:loadProgress": {
    id: string;
    loaded: number;
    total?: number;
  };
  "pdf:loadEnd": {
    id: string;
    ok: boolean;
  };
  "pdf:passwordRequired": {
    id: string;
    reason: "need_password" | "incorrect_password";
    submit: (password: string) => void;
    cancel: () => void;
  };
};

export const appEventBus = new EventBus<AppEventMap>();
