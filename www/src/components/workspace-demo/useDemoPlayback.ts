import { useCallback, useEffect, useRef, useState } from "react";

/** Local text playback only. Never imports the AI runtime or calls a provider. */
export function useDemoPlayback(initialText: string) {
  const [text, setText] = useState(initialText);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancelTimer, [cancelTimer]);
  const stop = useCallback(() => {
    cancelTimer();
    setPlaying(false);
  }, [cancelTimer]);
  const start = useCallback(
    (answer: string) => {
      cancelTimer();
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        setText(answer);
        setPlaying(false);
        return;
      }
      const characters = Array.from(answer);
      let cursor = 0;
      setText("");
      setPlaying(true);
      timer.current = setInterval(() => {
        cursor = Math.min(characters.length, cursor + 5);
        setText(characters.slice(0, cursor).join(""));
        if (cursor === characters.length) {
          cancelTimer();
          setPlaying(false);
        }
      }, 28);
    },
    [cancelTimer],
  );
  return { text, playing, start, stop };
}
