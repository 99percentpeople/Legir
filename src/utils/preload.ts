import React from "react";

type AnyComponent = React.ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type LazyModule<T extends AnyComponent> = { default: T };
type LazyLoader<T extends AnyComponent> = () => Promise<LazyModule<T>>;

export type PreloadableLazyComponent<T extends AnyComponent> =
  React.LazyExoticComponent<T> & {
    preload: () => Promise<LazyModule<T>>;
  };

type LazyInternals = {
  _init?: (payload: unknown) => unknown;
  _payload?: unknown;
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

/**
 * Best-effort initialization of React.lazy's already-downloaded module.
 *
 * Calling the loader alone warms the browser module cache, but React.lazy can
 * still suspend for one microtask the first time it sees that fulfilled
 * promise. Priming the lazy payload here avoids that fallback flash after an
 * explicit preload. If React changes these internals, loading remains correct;
 * only the first render may fall back to normal Suspense behavior.
 */
const warmLazyPayload = async (
  component: React.LazyExoticComponent<AnyComponent>,
) => {
  const lazy = component as React.LazyExoticComponent<AnyComponent> &
    LazyInternals;
  if (typeof lazy._init !== "function") return;

  try {
    lazy._init(lazy._payload);
    return;
  } catch (thrown) {
    if (!isPromiseLike(thrown)) return;
    try {
      await thrown;
    } catch {
      return;
    }
  }

  try {
    lazy._init(lazy._payload);
  } catch {
    // React.lazy/Suspense remains the correctness fallback.
  }
};

/**
 * React.lazy with an explicit, reusable preload hook.
 *
 * The loader promise is memoized so background preloading and the eventual
 * React render share the exact same module request.
 *
 * @example
 * const SettingsDialog = preload(() => import("./SettingsDialog"));
 * void SettingsDialog.preload();
 *
 * @example Named export
 * const RightPanel = preload(() =>
 *   import("./RightPanel").then((module) => ({ default: module.RightPanel })),
 * );
 */
export function preload<T extends AnyComponent>(
  loader: LazyLoader<T>,
): PreloadableLazyComponent<T> {
  let modulePromise: Promise<LazyModule<T>> | undefined;
  let preloadPromise: Promise<LazyModule<T>> | undefined;

  const load = () => (modulePromise ??= loader());
  const component = React.lazy(load) as PreloadableLazyComponent<T>;

  component.preload = () =>
    (preloadPromise ??= load().then(async (module) => {
      await warmLazyPayload(component);
      return module;
    }));

  return component;
}
