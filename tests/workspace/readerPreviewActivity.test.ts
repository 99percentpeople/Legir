import { afterEach, expect, it, vi } from "vitest";
import {
  deferReaderPreviews,
  waitForReaderPreviewIdle,
} from "@/components/workspace/lib/readerPreviewActivity";
afterEach(() => vi.useRealTimers());

it("waits until wheel/scroll activity stops, without delaying another editor", async () => {
  vi.useFakeTimers();
  const owner = {};
  const signal = new AbortController().signal;
  deferReaderPreviews(owner);
  const capture = vi.fn();
  const waiting = waitForReaderPreviewIdle(owner, signal).then(capture);
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(35);
    deferReaderPreviews(owner);
  }
  expect(capture).not.toHaveBeenCalled();
  await expect(waitForReaderPreviewIdle({}, signal)).resolves.toBe(true);
  await vi.advanceTimersByTimeAsync(160);
  await waiting;
  expect(capture).toHaveBeenCalledExactlyOnceWith(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels deferred captures on unmount or render replacement without retaining timers", async () => {
  vi.useFakeTimers();
  const owner = {};
  deferReaderPreviews(owner);
  const controller = new AbortController();
  const waiting = waitForReaderPreviewIdle(owner, controller.signal);
  controller.abort();
  await expect(waiting).resolves.toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  await expect(
    waitForReaderPreviewIdle(owner, controller.signal),
  ).resolves.toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
