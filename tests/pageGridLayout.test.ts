import { expect, it } from "vitest";
import { getPageGridLayout } from "@/components/page-editor/pageGridLayout";

it.each([390, 800, 1363])(
  "scales thumbnails and spacing continuously at viewport width %i",
  (width) => {
    const baseline = getPageGridLayout(width, 1);
    let previousSize = 0;
    for (const scale of [0.5, 0.625, 0.78, 0.79, 1, 1.1, 1.25, 1.6, 2]) {
      const layout = getPageGridLayout(width, scale);
      expect(layout.thumbnailSize).toBeGreaterThan(previousSize);
      expect(layout.thumbnailSize / scale).toBeCloseTo(baseline.thumbnailSize);
      expect(layout.padding / scale).toBeCloseTo(baseline.padding);
      expect(layout.gap / scale).toBeCloseTo(baseline.gap);
      expect(layout.cardPadding / scale).toBeCloseTo(baseline.cardPadding);
      previousSize = layout.thumbnailSize;
    }
  },
);

it("distributes spare room without stretching cards or their minimum gap", () => {
  const narrow = getPageGridLayout(760, 1);
  const wide = getPageGridLayout(800, 1);
  expect(wide.columns).toBe(narrow.columns);
  expect(wide.cardWidth).toBe(narrow.cardWidth);
  expect(wide.gap).toBe(8);
  expect(wide.columnGap).toBeGreaterThan(narrow.columnGap);
});

it.each([0.5, 0.78, 1, 1.6, 2])(
  "reserves all available columns with equal surrounding space at scale %s",
  (scale) => {
    const layout = getPageGridLayout(1363, scale);
    expect(layout.columns).toBeGreaterThan(2);
    const leftSpace = layout.offset - layout.padding;
    const rightSpace =
      1363 -
      layout.padding -
      (layout.offset +
        layout.cardWidth * layout.columns +
        layout.columnGap * (layout.columns - 1));
    expect(leftSpace).toBeCloseTo(rightSpace);
    expect(layout.columnGap - layout.gap).toBeCloseTo(leftSpace * 2);
  },
);

it("centers a single column at large zoom", () => {
  const layout = getPageGridLayout(390, 2);
  expect(layout.columns).toBe(1);
  expect(layout.offset).toBeCloseTo((390 - layout.cardWidth) / 2);
});
