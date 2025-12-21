import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import localizedFormat from "dayjs/plugin/localizedFormat";

dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

type Subscriber = () => void;

let intervalId: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<Subscriber>();

function ensureInterval() {
  if (intervalId) return;

  intervalId = setInterval(() => {
    subscribers.forEach((cb) => cb());
  }, 60000);
}

function teardownIntervalIfIdle() {
  if (subscribers.size > 0) return;
  if (!intervalId) return;

  clearInterval(intervalId);
  intervalId = null;
}

function useMinuteTicker(enabled: boolean) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const cb = () => setTick((v) => v + 1);

    subscribers.add(cb);
    ensureInterval();

    return () => {
      subscribers.delete(cb);
      teardownIntervalIfIdle();
    };
  }, [enabled]);

  return tick;
}

export function useTimeAgo(
  dayjsLocale: string | null,
  time: Date | string | number | null | undefined,
) {
  const tick = useMinuteTicker(dayjsLocale != null && time != null);

  return useMemo(() => {
    if (dayjsLocale == null) return "";
    if (time == null) return "";
    return dayjs(time).locale(dayjsLocale).fromNow();
  }, [dayjsLocale, time, tick]);
}

export function useTimeText(
  dayjsLocale: string | null,
  time: Date | string | number | null | undefined,
  format: string,
) {
  return useMemo(() => {
    if (dayjsLocale == null) return "";
    if (time == null) return "";
    return dayjs(time).locale(dayjsLocale).format(format);
  }, [dayjsLocale, time, format]);
}
