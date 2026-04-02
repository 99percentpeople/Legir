import type {
  EditorTabSession,
  EditorWindowId,
  EditorWindowLayout,
} from "./types";

export interface EditorTabWorkspaceSnapshot {
  layout: EditorWindowLayout;
  sessions: EditorTabSession[];
}

export type EditorTabWorkspaceListener = (
  snapshot: EditorTabWorkspaceSnapshot,
) => void;

export interface AddEditorTabSessionOptions {
  activate?: boolean;
  targetIndex?: number;
}

export interface MoveEditorTabSessionOptions {
  sessionId: string;
  fromWindowId: EditorWindowId;
  toWindowId: EditorWindowId;
  activate?: boolean;
  targetIndex?: number;
}

export interface DetachEditorTabSessionOptions {
  sessionId: string;
  fromWindowId: EditorWindowId;
  targetWindowId?: EditorWindowId;
}

export interface DetachEditorTabSessionResult {
  session: EditorTabSession | null;
  targetWindowId: EditorWindowId;
}

export interface EditorTabWorkspaceBackend {
  addSession: (
    windowId: EditorWindowId,
    session: EditorTabSession,
    options?: AddEditorTabSessionOptions,
  ) => void;
  activateSession: (windowId: EditorWindowId, sessionId: string) => void;
  clearWindow: (windowId: EditorWindowId) => EditorTabSession[];
  detachSessionToNewWindow: (
    options: DetachEditorTabSessionOptions,
  ) => DetachEditorTabSessionResult;
  dispose: () => void;
  findSessionBySourceKey: (sourceKey: string | null) => EditorTabSession | null;
  getSession: (sessionId: string) => EditorTabSession | null;
  getWindowSnapshot: (windowId: EditorWindowId) => EditorTabWorkspaceSnapshot;
  moveSession: (
    options: MoveEditorTabSessionOptions,
  ) => EditorTabSession | null;
  removeSession: (
    windowId: EditorWindowId,
    sessionId: string,
  ) => EditorTabSession | null;
  subscribe: (
    windowId: EditorWindowId,
    listener: EditorTabWorkspaceListener,
  ) => () => void;
  updateSession: (
    sessionId: string,
    updates: Partial<EditorTabSession>,
  ) => EditorTabSession | null;
}

const createEmptyLayout = (windowId: EditorWindowId): EditorWindowLayout => ({
  windowId,
  tabIds: [],
  activeTabId: null,
});

const insertAt = <T>(list: T[], item: T, targetIndex?: number) => {
  const next = [...list];
  if (typeof targetIndex !== "number" || !Number.isFinite(targetIndex)) {
    next.push(item);
    return next;
  }

  const normalizedIndex = Math.max(0, Math.min(next.length, targetIndex));
  next.splice(normalizedIndex, 0, item);
  return next;
};

const createDetachedWindowId = () =>
  `editor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createLocalSingleWindowTabBackend =
  (): EditorTabWorkspaceBackend => {
    const sessionsById = new Map<string, EditorTabSession>();
    const layoutsByWindowId = new Map<EditorWindowId, EditorWindowLayout>();
    const listenersByWindowId = new Map<
      EditorWindowId,
      Set<EditorTabWorkspaceListener>
    >();

    const ensureLayout = (windowId: EditorWindowId) => {
      const existing = layoutsByWindowId.get(windowId);
      if (existing) return existing;
      const next = createEmptyLayout(windowId);
      layoutsByWindowId.set(windowId, next);
      return next;
    };

    const getWindowSnapshot = (windowId: EditorWindowId) => {
      const layout = ensureLayout(windowId);
      return {
        layout: { ...layout, tabIds: [...layout.tabIds] },
        sessions: layout.tabIds
          .map((tabId) => sessionsById.get(tabId) ?? null)
          .filter((session): session is EditorTabSession => session !== null),
      };
    };

    const emit = (windowId: EditorWindowId) => {
      const listeners = listenersByWindowId.get(windowId);
      if (!listeners || listeners.size === 0) return;
      const snapshot = getWindowSnapshot(windowId);
      listeners.forEach((listener) => {
        listener(snapshot);
      });
    };

    const getAdjacentActiveTabId = (
      previousTabIds: string[],
      removedTabId: string,
    ): string | null => {
      const index = previousTabIds.findIndex((tabId) => tabId === removedTabId);
      const remainingTabIds = previousTabIds.filter(
        (tabId) => tabId !== removedTabId,
      );
      if (index < 0) return remainingTabIds[0] ?? null;
      return remainingTabIds[index] ?? remainingTabIds[index - 1] ?? null;
    };

    return {
      subscribe(windowId, listener) {
        const listeners = listenersByWindowId.get(windowId) ?? new Set();
        listeners.add(listener);
        listenersByWindowId.set(windowId, listeners);
        listener(getWindowSnapshot(windowId));

        return () => {
          const current = listenersByWindowId.get(windowId);
          if (!current) return;
          current.delete(listener);
          if (current.size === 0) {
            listenersByWindowId.delete(windowId);
          }
        };
      },

      getWindowSnapshot,

      getSession(sessionId) {
        return sessionsById.get(sessionId) ?? null;
      },

      findSessionBySourceKey(sourceKey) {
        if (!sourceKey) return null;
        for (const session of sessionsById.values()) {
          if (session.sourceKey === sourceKey) return session;
        }
        return null;
      },

      addSession(windowId, session, options) {
        const layout = ensureLayout(windowId);
        sessionsById.set(session.id, { ...session, windowId });
        layout.tabIds = insertAt(
          layout.tabIds,
          session.id,
          options?.targetIndex,
        );
        if (options?.activate || !layout.activeTabId) {
          layout.activeTabId = session.id;
        }
        layoutsByWindowId.set(windowId, layout);
        emit(windowId);
      },

      updateSession(sessionId, updates) {
        const session = sessionsById.get(sessionId);
        if (!session) return null;
        const nextSession = {
          ...session,
          ...updates,
        };
        sessionsById.set(sessionId, nextSession);
        emit(nextSession.windowId);
        return nextSession;
      },

      activateSession(windowId, sessionId) {
        const layout = ensureLayout(windowId);
        if (!layout.tabIds.includes(sessionId)) return;
        layout.activeTabId = sessionId;
        layoutsByWindowId.set(windowId, layout);
        emit(windowId);
      },

      removeSession(windowId, sessionId) {
        const layout = ensureLayout(windowId);
        const session = sessionsById.get(sessionId);
        if (!session || session.windowId !== windowId) return null;

        const nextTabIds = layout.tabIds.filter((tabId) => tabId !== sessionId);
        const nextActiveTabId =
          layout.activeTabId === sessionId
            ? getAdjacentActiveTabId(layout.tabIds, sessionId)
            : layout.activeTabId;

        layoutsByWindowId.set(windowId, {
          ...layout,
          tabIds: nextTabIds,
          activeTabId: nextActiveTabId,
        });
        sessionsById.delete(sessionId);
        emit(windowId);
        return session;
      },

      clearWindow(windowId) {
        const snapshot = getWindowSnapshot(windowId);
        for (const session of snapshot.sessions) {
          sessionsById.delete(session.id);
        }
        layoutsByWindowId.set(windowId, createEmptyLayout(windowId));
        emit(windowId);
        return snapshot.sessions;
      },

      moveSession(options) {
        const session = sessionsById.get(options.sessionId);
        if (!session || session.windowId !== options.fromWindowId) return null;

        const fromLayout = ensureLayout(options.fromWindowId);
        const toLayout = ensureLayout(options.toWindowId);
        const nextFromTabIds = fromLayout.tabIds.filter(
          (tabId) => tabId !== options.sessionId,
        );
        const nextToTabIds = insertAt(
          toLayout.tabIds.filter((tabId) => tabId !== options.sessionId),
          options.sessionId,
          options.targetIndex,
        );

        layoutsByWindowId.set(options.fromWindowId, {
          ...fromLayout,
          tabIds: nextFromTabIds,
          activeTabId:
            fromLayout.activeTabId === options.sessionId
              ? getAdjacentActiveTabId(fromLayout.tabIds, options.sessionId)
              : fromLayout.activeTabId,
        });

        layoutsByWindowId.set(options.toWindowId, {
          ...toLayout,
          tabIds: nextToTabIds,
          activeTabId:
            options.activate || !toLayout.activeTabId
              ? options.sessionId
              : toLayout.activeTabId,
        });

        const movedSession = {
          ...session,
          windowId: options.toWindowId,
          lastActiveAt: new Date().toISOString(),
        };
        sessionsById.set(options.sessionId, movedSession);

        emit(options.fromWindowId);
        if (options.toWindowId !== options.fromWindowId) {
          emit(options.toWindowId);
        }

        return movedSession;
      },

      detachSessionToNewWindow(options) {
        const targetWindowId =
          options.targetWindowId ?? createDetachedWindowId();
        const session = this.moveSession({
          sessionId: options.sessionId,
          fromWindowId: options.fromWindowId,
          toWindowId: targetWindowId,
          activate: true,
        });

        return {
          session,
          targetWindowId,
        };
      },

      dispose() {
        listenersByWindowId.clear();
        layoutsByWindowId.clear();
        sessionsById.clear();
      },
    };
  };
