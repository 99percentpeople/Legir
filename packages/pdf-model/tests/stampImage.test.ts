import { describe, expect, it } from "vitest";
import { getStampSvgIntrinsicSize } from "@legir/pdf-model/stampImage";

const dataUrl = (svg: string) =>
  `data:image/svg+xml,${encodeURIComponent(svg)}`;

describe("SVG stamp intrinsic size", () => {
  it.each([false, true])(
    "uses the root viewBox, not child dimensions (base64=%s)",
    (base64) => {
      const svg =
        '<svg viewBox="0 0 200 100"><rect width="10" height="20"/></svg>';
      const source = base64
        ? `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
        : dataUrl(svg);
      expect(getStampSvgIntrinsicSize(source)).toEqual({
        width: 200,
        height: 100,
      });
    },
  );

  it.each([
    '<svg width="300" height="150" viewBox="0 0 200 100"><rect width="10" height="20"/></svg>',
    "<svg width = '300' height = '150'/>",
    '<svg aria-label="a > b" width="300" height="150"/>',
    '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="300" height="150"/>',
  ])("preserves explicit root dimensions: %s", (svg) => {
    expect(getStampSvgIntrinsicSize(dataUrl(svg))).toEqual({
      width: 300,
      height: 150,
    });
  });

  it.each([
    '<svg data-width="10" data-height="20" viewBox="0 0 200 100"/>',
    "<svg aria-label=\"width='10' height='20'\" viewBox=\"0 0 200 100\"/>",
    '<svg viewBox = \'0 0\n200 100\'><svg width="10" height="20"/></svg>',
    '<svg><rect width="10" height="20" viewBox="0 0 10 20"/></svg>',
    '<svg data-width="10" data-height="20" data-viewBox="0 0 10 20"/>',
    '<not-svg width="10" height="20"/>',
  ])(
    "does not mistake other attributes or elements for root sizing: %s",
    (svg) => {
      const expected = svg.includes("200 100")
        ? { width: 200, height: 100 }
        : undefined;
      expect(getStampSvgIntrinsicSize(dataUrl(svg))).toEqual(expected);
    },
  );

  it("does not inspect non-SVG image data", () => {
    expect(
      getStampSvgIntrinsicSize("data:image/png;base64,AA=="),
    ).toBeUndefined();
  });
});
