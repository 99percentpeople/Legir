import { useEffect, useRef } from "react";

export const useEventListener = <TEvent extends Event>(
  target: EventTarget | null | undefined,
  type: string,
  handler: (event: TEvent) => void,
  options?: boolean | AddEventListenerOptions,
) => {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!target) return;

    const listener: EventListener = (event) => {
      handlerRef.current(event as TEvent);
    };

    target.addEventListener(type, listener, options);

    return () => {
      target.removeEventListener(type, listener, options);
    };
  }, [target, type, options]);
};

export type EventListenerSpec<TEvent extends Event = Event> = {
  type: string;
  handler: (event: TEvent) => void;
  options?: boolean | AddEventListenerOptions;
};

type EventListenersInput =
  | EventListenerSpec[]
  | Record<
      string,
      | ((event: Event) => void)
      | {
          handler: (event: Event) => void;
          options?: boolean | AddEventListenerOptions;
        }
    >;

const normalizeOptionsKey = (options?: boolean | AddEventListenerOptions) => {
  if (typeof options === "boolean") {
    return `b:${options ? 1 : 0}`;
  }
  if (!options) return "u";
  return `o:${options.capture ? 1 : 0}:${options.passive ? 1 : 0}:${
    options.once ? 1 : 0
  }`;
};

const buildListenerKey = (spec: EventListenerSpec) => {
  return `${spec.type}::${normalizeOptionsKey(spec.options)}`;
};

const toSpecsArray = (input: EventListenersInput): EventListenerSpec[] => {
  if (Array.isArray(input)) return input;
  return Object.entries(input).map(([type, v]) => {
    if (typeof v === "function") return { type, handler: v };
    return { type, handler: v.handler, options: v.options };
  });
};

export const useEventListeners = (
  target: EventTarget | null | undefined,
  listeners: EventListenersInput,
) => {
  const attachedRef = useRef(
    new Map<
      string,
      {
        type: string;
        options?: boolean | AddEventListenerOptions;
        handlerRef: { current: (event: Event) => void };
        listener: EventListener;
      }
    >(),
  );
  const targetRef = useRef<EventTarget | null | undefined>(null);

  const detachAllFrom = (t: EventTarget | null | undefined) => {
    if (!t) return;
    for (const entry of attachedRef.current.values()) {
      t.removeEventListener(entry.type, entry.listener, entry.options);
    }
  };

  useEffect(() => {
    if (targetRef.current !== target) {
      detachAllFrom(targetRef.current);
      targetRef.current = target;
    }

    const t = targetRef.current;
    if (!t) return;

    const specs = toSpecsArray(listeners);
    const nextKeys = new Set<string>();

    for (const spec of specs) {
      const key = buildListenerKey(spec);
      nextKeys.add(key);

      const existing = attachedRef.current.get(key);
      if (existing) {
        existing.handlerRef.current = spec.handler;
        continue;
      }

      const handlerRef = { current: spec.handler };
      const listener: EventListener = (event) => {
        handlerRef.current(event);
      };

      attachedRef.current.set(key, {
        type: spec.type,
        options: spec.options,
        handlerRef,
        listener,
      });
      t.addEventListener(spec.type, listener, spec.options);
    }

    for (const [key, entry] of Array.from(attachedRef.current.entries())) {
      if (nextKeys.has(key)) continue;
      t.removeEventListener(entry.type, entry.listener, entry.options);
      attachedRef.current.delete(key);
    }
  });

  useEffect(() => {
    return () => {
      detachAllFrom(targetRef.current);
      attachedRef.current.clear();
      targetRef.current = null;
    };
  }, []);
};
