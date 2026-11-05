import { describe, expect, it } from "vitest";
import { getResizeCursorForHandle } from "@legir/pdf-model/controlRotation";

describe("resize handle cursors", () => {
  it.each([
    ["n", "ns-resize", "nesw-resize", "ew-resize", "nwse-resize"],
    ["s", "ns-resize", "nesw-resize", "ew-resize", "nwse-resize"],
    ["e", "ew-resize", "nwse-resize", "ns-resize", "nesw-resize"],
    ["w", "ew-resize", "nwse-resize", "ns-resize", "nesw-resize"],
    ["nw", "nwse-resize", "ns-resize", "nesw-resize", "ew-resize"],
    ["se", "nwse-resize", "ns-resize", "nesw-resize", "ew-resize"],
    ["ne", "nesw-resize", "ew-resize", "nwse-resize", "ns-resize"],
    ["sw", "nesw-resize", "ew-resize", "nwse-resize", "ns-resize"],
  ])(
    "matches the %s handle at clockwise screen rotations",
    (handle, zero, diagonal, quarter, negative) => {
      for (const offset of [-360, 0, 360]) {
        expect(getResizeCursorForHandle(handle, offset)).toBe(zero);
        expect(getResizeCursorForHandle(handle, 45 + offset)).toBe(diagonal);
        expect(getResizeCursorForHandle(handle, 90 + offset)).toBe(quarter);
        expect(getResizeCursorForHandle(handle, -45 + offset)).toBe(negative);
      }
    },
  );

  it("snaps to the nearest 45 degree cursor direction", () => {
    expect(getResizeCursorForHandle("e", 22)).toBe("ew-resize");
    expect(getResizeCursorForHandle("e", 23)).toBe("nwse-resize");
    expect(getResizeCursorForHandle("e", -22)).toBe("ew-resize");
    expect(getResizeCursorForHandle("e", -23)).toBe("nesw-resize");
  });

  it("retains non-resize cursor fallbacks", () => {
    expect(getResizeCursorForHandle("rotate", 45)).toBe("grab");
    expect(getResizeCursorForHandle("unknown", 0)).toBe("default");
  });
});
