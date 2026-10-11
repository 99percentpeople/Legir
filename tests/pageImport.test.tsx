import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { LanguageProvider } from "@/components/language-provider";
import { usePageImport } from "@/components/page-editor/usePageImport";
import type { LoadedPdfDocument } from "@/services/pdfService";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  worker: vi.fn(),
  readPath: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { loading: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("@/services/pdfService", () => ({
  startPdfOpenSession: mocks.start,
}));
vi.mock("@/services/pdfService/pdfWorkerService", () => ({
  createPdfWorkerService: mocks.worker,
}));
vi.mock("@/services/platform", () => ({
  canOpenWithPicker: () => false,
  openFiles: vi.fn(),
  openFileFromPath: mocks.readPath,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function session() {
  const readable = deferred<void>();
  const hydrated = deferred<LoadedPdfDocument>();
  const worker = { destroy: vi.fn() };
  const document = {
    pages: [],
    documentPermissions: null,
    dispose: vi.fn(),
  } as unknown as LoadedPdfDocument;
  const open = {
    readable: readable.promise,
    hydrate: vi.fn(() => hydrated.promise),
    dispose: vi.fn(),
  };
  mocks.worker.mockReturnValueOnce(worker);
  mocks.start.mockReturnValueOnce(open);
  return { readable, hydrated, worker, document, open };
}

let host: HTMLDivElement;
let root: Root;
let importer: ReturnType<typeof usePageImport>;
const onLoaded = vi.fn();
const onStart = vi.fn();
function Harness() {
  importer = usePageImport(onLoaded, onStart);
  return null;
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.start.mockReset();
  mocks.worker.mockReset();
  mocks.readPath.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <LanguageProvider defaultLanguage="en">
        <Harness />
      </LanguageProvider>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const file = (name = "donor.pdf") => ({
  kind: "file" as const,
  file: new File(["%PDF-test"], name, { type: "application/pdf" }),
});
async function begin() {
  let completion!: Promise<void>;
  await act(async () => {
    completion = importer.loadDropped(file());
  });
  return { completion };
}

it("shows reading/parsing toasts and opens the preview only after hydration", async () => {
  const task = session();
  const { completion } = await begin();
  await act(async () => vi.advanceTimersByTime(100));
  expect(importer.loading).toBe(true);
  expect(importer.imported).toBeNull();
  expect(onStart).toHaveBeenCalledOnce();
  expect(onLoaded).not.toHaveBeenCalled();
  expect(task.open.hydrate).not.toHaveBeenCalled();
  expect(toast.loading).toHaveBeenLastCalledWith("Reading PDF...", {
    id: expect.any(String),
    duration: Infinity,
  });
  const toastId = vi.mocked(toast.loading).mock.calls[0][1]!.id;

  await act(async () => task.readable.resolve());
  expect(task.open.hydrate).toHaveBeenCalledOnce();
  expect(onLoaded).not.toHaveBeenCalled();
  expect(toast.loading).toHaveBeenLastCalledWith("Parsing PDF...", {
    id: toastId,
    duration: Infinity,
  });
  await act(async () => {
    task.hydrated.resolve(task.document);
    await completion;
  });
  expect(importer.loading).toBe(false);
  expect(importer.imported?.document).toBe(task.document);
  expect(onLoaded).toHaveBeenCalledOnce();
  expect(toast.dismiss).toHaveBeenLastCalledWith(toastId);
  // Cancelling the preview owns and releases the donor resources.
  await act(async () => importer.clear());
  expect(task.document.dispose).toHaveBeenCalledOnce();
  expect(task.worker.destroy).toHaveBeenCalledOnce();
});

it.each(["file", "path"] as const)(
  "rejects an empty %s with a named toast before starting a parser",
  async (kind) => {
    mocks.readPath.mockResolvedValue({
      bytes: new Uint8Array(),
      filename: "empty.pdf",
    });
    await act(async () => {
      await importer.loadDropped(
        kind === "file"
          ? { kind, file: new File([], "empty.pdf") }
          : { kind, filePath: "/empty.pdf" },
      );
    });
    expect(toast.error).toHaveBeenCalledWith("Failed to load PDF.", {
      description: expect.stringContaining('"empty.pdf" is empty (0 bytes)'),
    });
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(importer.loading).toBe(false);
    expect(importer.imported).toBeNull();
    expect(onLoaded).not.toHaveBeenCalled();
  },
);

it.each(["readable", "hydrated"] as const)(
  "reports a %s failure without opening a preview and releases the session",
  async (stage) => {
    const task = session();
    const { completion } = await begin();
    await act(async () => vi.advanceTimersByTime(100));
    const toastId = vi.mocked(toast.loading).mock.calls[0][1]!.id;
    if (stage === "hydrated") await act(async () => task.readable.resolve());
    await act(async () => {
      task[stage].reject(new Error("Invalid PDF"));
      await completion;
    });
    expect(onLoaded).not.toHaveBeenCalled();
    expect(importer.imported).toBeNull();
    expect(importer.loading).toBe(false);
    expect(task.open.dispose).toHaveBeenCalledOnce();
    expect(task.worker.destroy).toHaveBeenCalledOnce();
    expect(toast.dismiss).toHaveBeenLastCalledWith(toastId);
    expect(toast.error).toHaveBeenCalledWith("Failed to load PDF.", {
      description: "Invalid PDF",
    });
  },
);

it("dismisses loading on exit and ignores a late session error", async () => {
  const task = session();
  const { completion } = await begin();
  await act(async () => vi.advanceTimersByTime(100));
  const toastId = vi.mocked(toast.loading).mock.calls[0][1]!.id;
  await act(async () => root.render(null));
  expect(task.open.dispose).toHaveBeenCalledOnce();
  expect(task.worker.destroy).toHaveBeenCalledOnce();
  expect(toast.dismiss).toHaveBeenLastCalledWith(toastId);
  await act(async () => {
    task.readable.reject(new Error("Late failure"));
    await completion;
  });
  expect(onLoaded).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("quietly cancels when the shared password dialog is dismissed", async () => {
  const task = session();
  const { completion } = await begin();
  await act(async () => {
    task.readable.reject(new DOMException("Cancelled", "AbortError"));
    await completion;
  });
  expect(onLoaded).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(importer.loading).toBe(false);
  expect(task.open.dispose).toHaveBeenCalledOnce();
  expect(task.worker.destroy).toHaveBeenCalledOnce();
});

it("ignores an older load after a replacement starts", async () => {
  const previous = session();
  const first = await begin();
  const next = session();
  const second = await begin();
  expect(previous.open.dispose).toHaveBeenCalledOnce();
  await act(async () => {
    previous.readable.reject(new Error("Stale failure"));
    await first.completion;
  });
  expect(importer.loading).toBe(true);
  expect(toast.error).not.toHaveBeenCalled();
  await act(async () => {
    next.readable.resolve();
    next.hydrated.resolve(next.document);
    await second.completion;
  });
  expect(importer.imported?.document).toBe(next.document);
  expect(onLoaded).toHaveBeenCalledOnce();
  // After insertion, the receiving runtime owns the document's resources.
  await act(async () => importer.release());
  await act(async () => importer.clear());
  expect(next.worker.destroy).toHaveBeenCalledOnce();
  expect(next.document.dispose).not.toHaveBeenCalled();
});
