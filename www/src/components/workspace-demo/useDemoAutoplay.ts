import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { PREVIEW_MODES, type PreviewMode } from "../../content/types";
import type { DemoCopy } from "./copy";
import type { DemoAction, DemoFields } from "./types";
import { demoRect } from "./displayGeometry";
import { flushSync } from "react-dom";
import { createDemoMotion } from "./demoMotion";
import type { DragDropManager } from "@dnd-kit/dom";

export type DemoChatCue = {
  token: number;
  kind: "reset" | "draft" | "send" | "stop";
  text?: string;
};
type Step = {
  target: string;
  actions?: DemoAction[];
  type?: { field: keyof DemoFields; text: string };
  chat?: "draft" | "send";
  dragTo?: string;
  hold?: number;
};
const page = (id: number) =>
  `[data-page-card="sample-${id}"] .demo-page-handle`;
const pageAction = (action: string) =>
  `[data-page-editor-toolbar] [data-demo-page-action="${action}"]`;

// Authored sample flows, deliberately independent of the PDF runtime.
export function demoSequence(mode: PreviewMode, copy: DemoCopy): Step[] {
  switch (mode) {
    case "read":
      return [
        {
          target: ".demo-thumbnail:nth-child(2)",
          actions: [{ type: "page", page: 2 }],
        },
        {
          target: ".demo-toolbar button:has(.lucide-zoom-out)",
          actions: [{ type: "zoom", delta: -20 }],
        },
        {
          target: ".demo-thumbnail:nth-child(3)",
          actions: [{ type: "page", page: 3 }],
          hold: 1800,
        },
      ];
    case "annotate":
      return [
        {
          target: ".demo-excerpt-trigger",
          actions: [{ type: "show-selection", open: true }],
        },
        {
          target: ".demo-selection-actions button:nth-child(2)",
          actions: [
            { type: "highlight" },
            { type: "show-selection", open: false },
          ],
        },
        {
          target: "#annotation-card-demo-highlight",
          actions: [{ type: "annotation-text", text: copy.translations.intro }],
          hold: 2000,
        },
      ];
    case "forms":
      return [
        { target: "#demo-name", type: { field: "name", text: "Alex Chen" } },
        {
          target: "#demo-email",
          type: { field: "email", text: "alex@example.com" },
        },
        {
          target: "#demo-note",
          type: { field: "note", text: copy.translations.intro },
        },
        {
          target: "#demo-reviewed",
          actions: [{ type: "field", field: "reviewed", value: true }],
          hold: 1600,
        },
      ];
    case "ai":
      return [
        {
          target: ".demo-editor-body button:has(.lucide-message-square)",
          actions: [{ type: "panel", panel: "ai" }],
        },
        { target: ".demo-runtime-panel textarea", chat: "draft" },
        {
          target: ".demo-runtime-panel button:has(.lucide-send)",
          chat: "send",
          hold: 2200,
        },
      ];
    case "translate":
      return [
        {
          target: ".demo-excerpt-trigger",
          actions: [{ type: "show-selection", open: true }],
        },
        {
          target: ".demo-selection-actions button:nth-child(3)",
          actions: [
            { type: "translate", open: true, auto: true },
            { type: "show-selection", open: false },
          ],
          hold: 2200,
        },
      ];
    case "pages":
      return [
        {
          target: page(1),
          actions: [{ type: "select-pages", intent: "single", id: "sample-1" }],
        },
        {
          target: page(1),
          dragTo: page(3),
        },
        {
          target: pageAction("clockwise"),
          actions: [{ type: "rotate-pages", ids: ["sample-1"], delta: 90 }],
        },
        {
          target: pageAction("duplicate"),
          actions: [
            { type: "duplicate-pages", ids: ["sample-1"] },
            { type: "select-pages", intent: "single", id: "sample-4" },
          ],
        },
        {
          target: pageAction("delete"),
          actions: [{ type: "delete-pages", ids: ["sample-4"] }],
          hold: 1800,
        },
        { target: ".demo-toolbar button:has(.lucide-check)", hold: 500 },
      ];
  }
}

type Options = {
  host: RefObject<HTMLDivElement | null>;
  mode: PreviewMode;
  enabled: boolean;
  copy: DemoCopy;
  dispatch: (action: DemoAction) => void;
  onChat: (cue: DemoChatCue) => void;
  onNext: (mode: PreviewMode) => void;
  pageDrag?: RefObject<DragDropManager | null>;
};
type Point = { x: number; y: number };
const transform = ({ x, y }: Point) => `translate(${x}px, ${y}px)`;
const CARD = "[data-page-card]";
const OVERLAYS =
  ".demo-selection-actions,.demo-translation-window,.demo-runtime-panel:not([hidden]),#annotation-card-demo-highlight";

export function useDemoAutoplay(options: Options) {
  const { host, mode, enabled, copy } = options;
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const token = useRef(0);

  useEffect(() => {
    const element = host.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting && entry.intersectionRatio >= 0.2;
        update();
      },
      { threshold: 0.2 },
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [host]);

  useLayoutEffect(() => {
    const root = host.current;
    const cursor = cursorRef.current;
    if (!root || !enabled || !visible) return;
    const body = root.querySelector<HTMLElement>(".demo-editor-body");
    const abort = new AbortController();
    const { signal } = abort;
    const motion = createDemoMotion(signal);
    let active: HTMLElement | null = null;
    let position: Point | null = null;
    const send = (action: DemoAction) => latest.current.dispatch(action);
    const chat = (kind: DemoChatCue["kind"], text?: string) =>
      latest.current.onChat({ token: ++token.current, kind, text });
    const phase = (value: string) => {
      root.dataset.demoPhase = value;
    };
    const paint = async () => {
      await motion.frame();
      await motion.frame();
    };
    const cards = () => [...root.querySelectorAll<HTMLElement>(CARD)];
    const overlays = () => [...root.querySelectorAll<HTMLElement>(OVERLAYS)];

    function point(element: HTMLElement, text = false): Point {
      const box = demoRect(element),
        frame = demoRect(root!);
      return {
        x:
          box.left -
          frame.left +
          (text ? Math.min(20, box.width / 3) : box.width / 2),
        y: box.top - frame.top + box.height / 2,
      };
    }
    async function move(to: Point, duration?: number) {
      if (!cursor) return;
      const from = position ?? { x: to.x + 32, y: to.y + 24 };
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      cursor.dataset.visible = "true";
      cursor.style.transform = transform(to);
      if (distance > 1)
        await motion.animate(
          cursor,
          [{ transform: transform(from) }, { transform: transform(to) }],
          duration ?? Math.min(760, 280 + distance * 0.55),
        );
      position = to;
    }
    async function target(selector: string, text: boolean) {
      active?.removeAttribute("data-demo-active");
      active = null;
      const element = root!.querySelector<HTMLElement>(selector);
      if (!element || !element.getClientRects().length) return null;
      phase("moving");
      if (cursor) {
        cursor.dataset.kind = "pointer";
        cursor.dataset.pressed = "false";
      }
      const scroller = element.closest<HTMLElement>(
        ".demo-stage,.demo-sidebar-scroll,[data-page-grid]",
      );
      if (scroller) {
        const box = demoRect(element),
          viewport = demoRect(scroller);
        if (box.top < viewport.top + 48 || box.bottom > viewport.bottom - 64) {
          if (cursor) cursor.dataset.visible = "false";
          await motion.scroll(
            scroller,
            scroller.scrollTop +
              box.top -
              viewport.top -
              (viewport.height - box.height) / 2,
          );
        }
      }
      await paint();
      await move(point(element, text));
      // Layout changes (panel resizing, fonts) can move a target during travel.
      const destination = point(element, text);
      if (
        position &&
        Math.hypot(destination.x - position.x, destination.y - position.y) > 1
      )
        await move(destination, 160);
      active = element;
      active.setAttribute("data-demo-active", "true");
      await motion.wait(120);
      phase("pressing");
      if (cursor) cursor.dataset.pressed = "true";
      const ring = cursor?.querySelector<HTMLElement>(".demo-cursor-ring");
      if (ring)
        void motion
          .animate(
            ring,
            [
              { opacity: 0.3, transform: "scale(0.5)" },
              { opacity: 0, transform: "scale(1.5)" },
            ],
            420,
          )
          .catch((error) => {
            if (!signal.aborted) throw error;
          });
      await motion.wait(110);
      return element;
    }

    async function apply(actions: DemoAction[]) {
      if (!actions.length) return;
      phase("responding");
      const before = new Map(
        cards().map((card) => [card.dataset.pageCard, demoRect(card)]),
      );
      const previousOverlays = new Set(overlays());
      const scrolls = [
        ...root!.querySelectorAll<HTMLElement>(
          ".demo-stage,.demo-sidebar-scroll",
        ),
      ].map((element) => ({
        element,
        top: element.scrollTop,
        left: element.scrollLeft,
      }));
      const rotations = actions.flatMap((action) =>
        action.type === "rotate-pages"
          ? action.ids.flatMap((id) => {
              const element = root!.querySelector<HTMLElement>(
                `[data-page-card="${id}"] .demo-page-handle`,
              );
              return element
                ? [{ element, before: demoRect(element), delta: action.delta }]
                : [];
            })
          : [],
      );
      const removed = actions.flatMap((action) =>
        action.type === "delete-pages" ? action.ids : [],
      );
      await Promise.all(
        cards()
          .filter((card) => removed.includes(card.dataset.pageCard!))
          .map((card) =>
            motion.animate(
              card,
              [
                { opacity: 1, transform: "scale(1)" },
                { opacity: 0, transform: "scale(0.94)" },
              ],
              180,
            ),
          ),
      );
      motion.check();
      flushSync(() => actions.forEach(send));
      const transitions: Promise<void>[] = [];
      for (const card of cards()) {
        const old = before.get(card.dataset.pageCard),
          next = demoRect(card);
        if (!old)
          transitions.push(
            motion.animate(
              card,
              [
                { opacity: 0, transform: "translateY(12px) scale(0.96)" },
                { opacity: 1, transform: "translateY(0) scale(1)" },
              ],
              360,
            ),
          );
        else if (
          Math.abs(old.left - next.left) + Math.abs(old.top - next.top) >
          1
        )
          transitions.push(
            motion.animate(
              card,
              [
                {
                  transform: `translate(${old.left - next.left}px, ${old.top - next.top}px)`,
                },
                { transform: "translate(0, 0)" },
              ],
              420,
            ),
          );
      }
      for (const { element, before, delta } of rotations) {
        const after = demoRect(element);
        transitions.push(
          motion.animate(
            element,
            [
              {
                transform: `rotate(${-delta}deg) scale(${before.height / (after.width || before.height)})`,
              },
              { transform: "rotate(0) scale(1)" },
            ],
            520,
          ),
        );
      }
      for (const { element, top, left } of scrolls) {
        const toTop = element.scrollTop,
          toLeft = element.scrollLeft;
        if (Math.abs(toTop - top) + Math.abs(toLeft - left) < 1) continue;
        element.scrollTop = top;
        element.scrollLeft = left;
        transitions.push(motion.scroll(element, toTop, toLeft));
      }
      for (const overlay of overlays()) {
        if (!previousOverlays.has(overlay))
          transitions.push(
            motion.animate(
              overlay,
              [
                { opacity: 0, translate: "0 6px" },
                { opacity: 1, translate: "0 0" },
              ],
              260,
            ),
          );
      }
      await Promise.all(transitions);
    }

    async function drag(element: HTMLElement, step: Step) {
      const destination = root!.querySelector<HTMLElement>(step.dragTo!);
      const card = element.closest<HTMLElement>(CARD);
      const manager = latest.current.pageDrag?.current;
      if (!destination || !card || !manager) return;
      phase("dragging");
      const from = point(element),
        to = point(destination);
      const screenPoint = (value: Point) => {
        const bounds = root!.getBoundingClientRect();
        const scale = bounds.width / root!.offsetWidth;
        return {
          x: bounds.left + value.x * scale,
          y: bounds.top + value.y * scale,
        };
      };
      const cancel = () => manager.actions.stop({ canceled: true });
      manager.actions.start({
        source: card.dataset.pageCard,
        coordinates: screenPoint(from),
      });
      signal.addEventListener("abort", cancel, { once: true });
      try {
        while (manager.dragOperation.status.initializing) await motion.frame();
        const start = await motion.frame();
        const reduced = window.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        let progress = 0;
        do {
          progress = reduced
            ? 1
            : Math.min(1, ((await motion.frame()) - start) / 900);
          const eased = progress * progress * (3 - 2 * progress);
          position = {
            x: from.x + (to.x - from.x) * eased,
            y: from.y + (to.y - from.y) * eased,
          };
          if (cursor) cursor.style.transform = transform(position);
          manager.actions.move({ to: screenPoint(position) });
        } while (progress < 1);
        await motion.wait(140);
        if (cursor) cursor.dataset.pressed = "false";
        manager.actions.stop();
        while (!manager.dragOperation.status.idle) await motion.frame();
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    }

    async function type(step: Step) {
      phase("typing");
      if (cursor) cursor.dataset.kind = "text";
      const letters = Array.from(step.type?.text ?? copy.prompts[0]);
      const interval = Math.max(18, Math.min(55, 1300 / letters.length));
      for (let index = 0; index < letters.length; index++) {
        await motion.wait(interval * [0.85, 1.1, 1][index % 3]);
        const value = letters.slice(0, index + 1).join("");
        if (step.type) send({ type: "field", field: step.type.field, value });
        else chat("draft", value);
        if (/[,.!?。！？]/.test(letters[index])) await motion.wait(90);
      }
    }

    phase("preparing");
    if (body) body.style.opacity = "0";
    setStepIndex(-1);
    send({ type: "scene", mode });
    if (root.dataset.compact === "true") send({ type: "hide-sidebar" });
    if (mode === "ai") chat("reset");

    async function play() {
      await paint();
      if (body) {
        body.style.opacity = "1";
        await motion.animate(body, [{ opacity: 0 }, { opacity: 1 }], 320);
      }
      phase("holding");
      await motion.wait(500);
      const steps = demoSequence(mode, copy);
      for (const [index, step] of steps.entries()) {
        flushSync(() => setStepIndex(index));
        const element = await target(
          step.target,
          !!step.type || step.chat === "draft",
        );
        motion.check();
        if (step.dragTo && element) await drag(element, step);
        else {
          if (cursor) cursor.dataset.pressed = "false";
          await apply(step.actions ?? []);
        }
        if (step.type || step.chat === "draft") await type(step);
        if (step.chat === "send")
          flushSync(() => chat("send", copy.prompts[0]));
        await paint();
        // Let an authored answer finish before giving it time to be read.
        for (
          let tick = 0;
          tick < 100 && root!.querySelector('[data-demo-streaming="true"]');
          tick++
        )
          await motion.wait(100);
        phase("holding");
        await motion.wait(
          step.hold ?? (step.type || step.chat === "draft" ? 650 : 1000),
        );
      }
      active?.removeAttribute("data-demo-active");
      if (cursor) cursor.dataset.visible = "false";
      phase("leaving");
      if (body) {
        body.style.opacity = "0";
        await motion.animate(body, [{ opacity: 1 }, { opacity: 0 }], 180);
      }
      motion.check();
      latest.current.onNext(
        PREVIEW_MODES[(PREVIEW_MODES.indexOf(mode) + 1) % PREVIEW_MODES.length],
      );
    }
    void play().catch((error) => {
      if (!signal.aborted) throw error;
    });
    return () => {
      abort.abort();
      active?.removeAttribute("data-demo-active");
      if (cursor) {
        delete cursor.dataset.visible;
        delete cursor.dataset.pressed;
        delete cursor.dataset.kind;
      }
      if (body) body.style.opacity = "";
      delete root.dataset.demoPhase;
      chat("stop");
      setStepIndex(-1);
    };
  }, [host, mode, enabled, visible, copy]);
  return { cursorRef, stepIndex, running: enabled && visible };
}
