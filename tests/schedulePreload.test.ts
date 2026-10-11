import { afterEach, expect, it, vi } from "vitest";
import { schedulePreload } from "@/lib/schedulePreload";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function idleBrowser() {
  const pending: Array<() => void> = [];
  const request = vi.fn((run: () => void) => pending.push(run));
  const cancel = vi.fn();
  vi.stubGlobal("requestIdleCallback", request);
  vi.stubGlobal("cancelIdleCallback", cancel);
  return { pending, request, cancel };
}

it("starts one task per idle turn and waits for the previous import to settle", async () => {
  const idle = idleBrowser();
  const first = Promise.withResolvers<void>();
  const loadFirst = vi.fn(() => first.promise);
  const loadSecond = vi.fn(async () => {});
  schedulePreload([loadFirst, loadSecond]);
  expect(loadFirst).not.toHaveBeenCalled();
  expect(idle.request).toHaveBeenCalledWith(expect.any(Function), {
    timeout: 800,
  });
  idle.pending.shift()!();
  await vi.waitFor(() => expect(loadFirst).toHaveBeenCalledOnce());
  expect(idle.pending).toHaveLength(0);
  expect(loadSecond).not.toHaveBeenCalled();
  first.resolve();
  await vi.waitFor(() => expect(idle.pending).toHaveLength(1));
  expect(loadSecond).not.toHaveBeenCalled();
  idle.pending.shift()!();
  await vi.waitFor(() => expect(loadSecond).toHaveBeenCalledOnce());
});

it("cancels queued work when its owner disappears, including late callbacks", async () => {
  const idle = idleBrowser();
  const load = vi.fn(async () => {});
  const cancel = schedulePreload([load]);
  cancel();
  idle.pending.shift()!();
  await Promise.resolve();
  expect(idle.cancel).toHaveBeenCalledWith(1);
  expect(load).not.toHaveBeenCalled();
});

it("does not start later tasks after cancellation during an in-flight import", async () => {
  const idle = idleBrowser();
  const pending = Promise.withResolvers<void>();
  const first = vi.fn(() => pending.promise);
  const second = vi.fn(async () => {});
  const cancel = schedulePreload([first, second]);
  idle.pending.shift()!();
  await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
  cancel();
  pending.resolve();
  await pending.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(idle.pending).toHaveLength(0);
  expect(second).not.toHaveBeenCalled();
});

it("continues after failed imports and uses a cancellable timer without idle callbacks", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", undefined);
  const failed = vi.fn(async () => {
    throw new Error("offline");
  });
  const next = vi.fn(async () => {});
  schedulePreload([failed, next]);
  await vi.advanceTimersByTimeAsync(199);
  expect(failed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(failed).toHaveBeenCalledOnce();
  expect(next).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(next).toHaveBeenCalledOnce();
  const cancelled = vi.fn(async () => {});
  schedulePreload([cancelled])();
  await vi.runAllTimersAsync();
  expect(cancelled).not.toHaveBeenCalled();
});
