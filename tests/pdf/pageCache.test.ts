import { expect, it, vi } from "vitest";
import type { PDFPage } from "@legir/pdfium";
import { NativePageCache } from "@/services/pdfService/engine/pageCache";

it("retains reader pages through background scans and promotes without loading twice", () => {
  const load = vi.fn(
    (index: number) => ({ index, destroy: vi.fn() }) as unknown as PDFPage,
  );
  const cache = new NativePageCache(load, 2, 1);
  const first = cache.get(0, true);
  const second = cache.get(1, true);
  for (let index = 2; index < 40; index++) cache.get(index);
  expect(first.destroy).not.toHaveBeenCalled();
  expect(second.destroy).not.toHaveBeenCalled();
  const background = cache.get(39);
  expect(cache.get(39, true)).toBe(background);
  expect(load).toHaveBeenCalledTimes(40);
  expect(first.destroy).toHaveBeenCalledOnce();
  expect(second.destroy).not.toHaveBeenCalled();
  cache.clear();
  cache.clear();
  for (const { value } of load.mock.results)
    expect(value.destroy).toHaveBeenCalledOnce();
});

it("keeps retained pages when loading another page fails", () => {
  const page = { destroy: vi.fn() } as unknown as PDFPage;
  const load = vi
    .fn()
    .mockReturnValueOnce(page)
    .mockImplementationOnce(() => {
      throw Error("Invalid page");
    });
  const cache = new NativePageCache(load, 1, 1);
  cache.get(0, true);
  expect(() => cache.get(1, true)).toThrow("Invalid page");
  expect(cache.get(0, true)).toBe(page);
  cache.clear();
  expect(page.destroy).toHaveBeenCalledOnce();
});
