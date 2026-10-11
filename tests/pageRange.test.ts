import { describe, expect, it } from "vitest";
import { formatPageRange, parsePageRange } from "@/utils/pageRange";

describe("shared page ranges", () => {
  it("normalizes mixed ranges, Chinese separators and duplicate pages", () => {
    expect(parsePageRange("1-3， 8, 2, 10–12", 12)).toEqual({
      ok: true,
      pageIndices: [0, 1, 2, 7, 9, 10, 11],
    });
    expect(formatPageRange([11, 1, 10, 0, 9, 2, 7, 1])).toBe("1-3, 8, 10-12");
  });
  it("preserves translation's empty-means-all while allowing an empty import selection", () => {
    expect(parsePageRange(" ", 3)).toEqual({
      ok: true,
      pageIndices: [0, 1, 2],
    });
    expect(parsePageRange(" ", 3, { empty: "none" })).toEqual({
      ok: true,
      pageIndices: [],
    });
    expect(parsePageRange("All", 3, { empty: "none" })).toEqual({
      ok: true,
      pageIndices: [0, 1, 2],
    });
    expect(formatPageRange([])).toBe("");
  });
  it.each(["1foo", "1.5", "2-1", "1-2-3", "1/2", ",,"])(
    "rejects unfinished or malformed range %s",
    (input) => {
      expect(parsePageRange(input, 12).ok).toBe(false);
    },
  );
  it.each(["0", "1-13", "99"])("rejects out-of-bounds range %s", (input) => {
    expect(parsePageRange(input, 12)).toEqual({
      ok: false,
      errorKey: "properties.form_detection.err_bounds",
    });
  });
});
