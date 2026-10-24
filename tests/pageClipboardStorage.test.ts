import { beforeEach, expect, it, vi } from "vitest";
import {
  readPageClipboard,
  readPageClipboardId,
  writePageClipboard,
} from "@/services/pageClipboard";

const db = vi.hoisted(() => ({ value: undefined as unknown, fail: false }));
vi.mock("@/services/browserDb", () => ({
  APP_DB_STORES: { workspace: "workspace" },
  withAppDb: (run: (database: unknown) => Promise<unknown>) =>
    run({
      transaction: () => ({
        objectStore: () => ({
          get: () =>
            db.fail
              ? Promise.reject(new Error("Read failed"))
              : Promise.resolve(db.value),
          put: (value: unknown) => {
            db.value = value;
          },
        }),
      }),
    }),
  waitForRequest: (request: Promise<unknown>) => request,
  waitForTransaction: () =>
    db.fail
      ? Promise.reject(new Error("Transaction aborted"))
      : Promise.resolve(),
}));
const clipboard = () => {
  const values = new Map<string, string>();
  return {
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
  } as unknown as DataTransfer;
};
beforeEach(() => {
  db.value = undefined;
  db.fail = false;
});

it("does not let an older export replace a newer copied PDF", async () => {
  let finish!: (blob: Blob) => void;
  const first = clipboard(),
    second = clipboard();
  const old = writePageClipboard(
    first,
    "old.pdf",
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  const latest = await writePageClipboard(
    second,
    "latest.pdf",
    async () => new Blob(["latest"]),
  );
  finish(new Blob(["old"]));
  await old;
  expect(db.value).toMatchObject({
    id: readPageClipboardId(second),
    status: "ready",
    file: latest,
  });
  expect(await readPageClipboard(readPageClipboardId(second)!)).toBe(latest);
});

it("keeps same-window paste working when both a request and its transaction fail", async () => {
  db.fail = true;
  const data = clipboard();
  const file = await writePageClipboard(
    data,
    "local.pdf",
    async () => new Blob(["local"]),
  );
  expect(await readPageClipboard(readPageClipboardId(data)!)).toBe(file);
  expect(file.size).toBe(5);
});

it("reports failed copies and never substitutes the previous PDF", async () => {
  const data = clipboard();
  const failed = writePageClipboard(data, "failed.pdf", () => {
    throw new Error("Export failed");
  });
  await expect(failed).rejects.toThrow("Export failed");
  expect(db.value).toMatchObject({
    id: readPageClipboardId(data),
    status: "failed",
  });
  await expect(readPageClipboard(readPageClipboardId(data)!)).rejects.toThrow(
    "Export failed",
  );
});
