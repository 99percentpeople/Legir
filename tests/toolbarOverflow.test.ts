import { describe, expect, it } from "vitest";
import { getToolbarOverflowIds } from "@/components/toolbar/toolbarOverflow";

const items = [
  { id: "page", width: 60, pinned: true },
  { id: "layout", width: 44 },
  { id: "tool", width: 44, pinned: true },
  { id: "color", width: 44 },
  { id: "width", width: 100 },
  { id: "opacity", width: 60 },
  { id: "border", width: 60 },
  { id: "exit", width: 44, pinned: true },
];
const overflow = (width: number) =>
  getToolbarOverflowIds(items, width, 44, 4, 10);

describe("responsive toolbar overflow", () => {
  it("keeps everything visible at the exact full-width boundary", () => {
    expect(overflow(494)).toEqual([]);
    expect(overflow(493)).toEqual(["border"]);
  });
  it("reserves room for More and collapses trailing options progressively", () => {
    expect(overflow(420)).toEqual(["opacity", "border"]);
    expect(overflow(320)).toEqual(["width", "opacity", "border"]);
    expect(overflow(270)).toEqual(["color", "width", "opacity", "border"]);
    expect(overflow(220)).toEqual([
      "layout",
      "color",
      "width",
      "opacity",
      "border",
    ]);
  });
  it("never collapses pinned navigation, tool, or exit even in a tiny container", () => {
    expect(overflow(1)).toEqual([
      "layout",
      "color",
      "width",
      "opacity",
      "border",
    ]);
  });
  it("restores options on growth and accounts for label or control width changes", () => {
    expect(overflow(320)).toHaveLength(3);
    expect(overflow(494)).toEqual([]);
    expect(
      getToolbarOverflowIds(
        items.map((item) =>
          item.id === "tool" ? { ...item, width: 150 } : item,
        ),
        494,
        44,
        4,
        10,
      ),
    ).toEqual(["width", "opacity", "border"]);
  });
});
