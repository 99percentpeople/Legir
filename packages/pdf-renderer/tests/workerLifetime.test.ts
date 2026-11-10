import { afterEach, expect, it, vi } from "vitest";

import { PDFWorkerService } from "@legir/pdf-renderer";

const hooks = { started: vi.fn(), terminated: vi.fn() };
class FakeWorker {
  constructor() {
    hooks.started();
  }
  postMessage() {}
  terminate() {
    hooks.terminated();
  }
}

afterEach(() => vi.unstubAllGlobals());

it("does not resurrect a closed document worker when delayed cleanup or commands arrive", async () => {
  vi.stubGlobal("Worker", class {});
  hooks.started.mockClear();
  hooks.terminated.mockClear();
  const worker = new PDFWorkerService({
    createWorker: () => new FakeWorker() as unknown as Worker,
  });
  expect(hooks.started).toHaveBeenCalledOnce();
  const pendingRelease = worker.releaseCanvas({ canvasIds: ["in-flight"] });
  worker.destroy();
  await expect(pendingRelease).resolves.toBe(true);
  await expect(
    worker.releaseCanvas({ canvasIds: ["late-cleanup"] }),
  ).resolves.toBe(true);
  worker.unloadDocument("default");
  await expect(worker.documentCommand("documentStats", {})).rejects.toThrow(
    "Worker not initialized",
  );
  worker.destroy();
  expect(hooks.started).toHaveBeenCalledOnce();
  expect(hooks.terminated).toHaveBeenCalledOnce();
});
