import { createStore, type Mutate, type StoreApi } from "zustand/vanilla";
import type {
  DocumentState,
  DocumentResourceState,
  EditorState,
} from "@/types";
import type { EditorActions, EditorStore } from "./store.types";
import { createEditorActions } from "./createEditorActions";
import { initialState } from "./helpers";
import {
  documentKeys,
  pickDocumentState,
  preferenceKeys,
} from "./stateDomains";
import {
  preferencesStore,
  type createPreferencesStore,
} from "./preferencesStore";
import {
  workspaceStore,
  patchWorkspaceUi,
  readWorkspaceUi,
  type createWorkspaceStore,
} from "./workspaceStore";

export type EditorViewApi = Mutate<
  StoreApi<EditorStore>,
  [["zustand/subscribeWithSelector", never]]
>;
export interface EditorView extends EditorViewApi {
  document: StoreApi<DocumentState>;
  resources: StoreApi<DocumentResourceState>;
  preferences: ReturnType<typeof createPreferencesStore>;
  workspace: ReturnType<typeof createWorkspaceStore>;
  dispose: () => void;
}

type Listener = (state: EditorStore, previous: EditorStore) => void;
export const selectedSubscription = (
  subscribe: (listener: Listener) => () => void,
  getState: () => EditorStore,
): EditorViewApi["subscribe"] =>
  ((
    selector: (state: EditorStore, previous: EditorStore) => unknown,
    listener?: (state: unknown, previous: unknown) => void,
    options?: {
      equalityFn?: (a: unknown, b: unknown) => boolean;
      fireImmediately?: boolean;
    },
  ) => {
    if (!listener) return subscribe(selector as Listener);
    const select = selector as (state: EditorStore) => unknown;
    let current = select(getState());
    if (options?.fireImmediately) listener(current, current);
    return subscribe((state) => {
      const next = select(state);
      if ((options?.equalityFn ?? Object.is)(current, next)) return;
      const previous = current;
      current = next;
      listener(next, previous);
    });
  }) as EditorViewApi["subscribe"];

function patchDomain<T extends object>(store: StoreApi<T>, patch: Partial<T>) {
  const state = store.getState();
  const changed = Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => !Object.is(state[key as keyof T], value),
    ),
  ) as Partial<T>;
  if (Object.keys(changed).length) store.setState(changed);
}

// A view composes references from separate owners. It has no writable state
// of its own and never synchronizes/copies preferences into document stores.
export function createEditorView(
  options: {
    state?: Partial<EditorState>;
    preferences?: ReturnType<typeof createPreferencesStore>;
    workspace?: ReturnType<typeof createWorkspaceStore>;
  } = {},
): EditorView {
  const preferences = options.preferences ?? preferencesStore;
  const workspace = options.workspace ?? workspaceStore;
  const document = createStore<DocumentState>(() =>
    pickDocumentState({ ...initialState, ...options.state }),
  );
  const resources = createStore<DocumentResourceState>(() => ({
    thumbnailImages: options.state?.thumbnailImages ?? {},
  }));
  let cached: EditorStore | undefined;
  let previousOwners: unknown[] = [];
  const getState = (): EditorStore => {
    const owners = [
      document.getState(),
      preferences.getState(),
      workspace.getState(),
      resources.getState(),
    ];
    if (
      cached &&
      owners.every((owner, index) => owner === previousOwners[index])
    )
      return cached;
    previousOwners = owners;
    cached = {
      ...document.getState(),
      ...preferences.getState(),
      ...readWorkspaceUi(workspace.getState()),
      ...resources.getState(),
      ...actions,
    };
    return cached;
  };
  const listeners = new Set<Listener>();
  let unsubscriptions: (() => void)[] = [];
  let published: EditorStore;
  let batching = false;
  const publish = () => {
    if (batching || !listeners.size) return;
    const next = getState();
    if (published === next) return;
    const previous = published;
    published = next;
    listeners.forEach((listener) => listener(next, previous));
  };
  const subscribe = selectedSubscription((listener) => {
    if (!listeners.size) {
      published = getState();
      unsubscriptions = [document, preferences, workspace, resources].map(
        (owner) => owner.subscribe(publish),
      );
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        unsubscriptions.forEach((unsubscribe) => unsubscribe());
        unsubscriptions = [];
      }
    };
  }, getState);
  const setState: EditorViewApi["setState"] = (updates) => {
    const previous = getState();
    const patch = typeof updates === "function" ? updates(previous) : updates;
    if (patch === previous) return;
    batching = true;
    try {
      const values = <K extends keyof EditorState>(keys: readonly K[]) =>
        Object.fromEntries(
          keys.filter((key) => key in patch).map((key) => [key, patch[key]]),
        ) as Partial<Pick<EditorState, K>>;
      patchDomain(document, values(documentKeys));
      patchDomain(preferences, values(preferenceKeys));
      patchDomain(workspace, patchWorkspaceUi(workspace.getState(), patch));
      patchDomain(resources, values(["thumbnailImages"]));
    } finally {
      batching = false;
      publish();
    }
  };
  const actions: EditorActions = createEditorActions(setState, getState);
  const initial = {
    ...document.getInitialState(),
    ...preferences.getInitialState(),
    ...readWorkspaceUi(workspace.getInitialState()),
    ...resources.getInitialState(),
    ...actions,
  };
  return {
    document,
    resources,
    preferences,
    workspace,
    getState,
    getInitialState: () => initial,
    setState,
    subscribe,
    dispose: () => {
      getState().cancelThumbnailWarmup();
      unsubscriptions.forEach((unsubscribe) => unsubscribe());
      unsubscriptions = [];
      listeners.clear();
    },
  };
}
