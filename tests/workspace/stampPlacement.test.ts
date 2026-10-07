import { describe, expect, it } from "vitest";
import { getStampRectAtPoint } from "@/lib/stamps";

describe("new image stamp placement", () => {
  it.each([0.25, 0.5, 1, 2, 4])(
    "bounds the screen size at zoom %s and preserves aspect ratio",
    (scale) => {
      const rect = getStampRectAtPoint(
        { x: 500, y: 500 },
        {
          kind: "image",
          imageWidth: 4000,
          imageHeight: 2000,
          scale,
          viewportWidth: 1000,
          viewportHeight: 800,
          pageWidth: 2000,
          pageHeight: 2000,
        },
      );
      expect(rect.width * scale).toBe(240);
      expect(rect.height * scale).toBe(120);
      expect(rect.x + rect.width / 2).toBe(500);
      expect(rect.y + rect.height / 2).toBe(500);
    },
  );

  it("fits a portrait image in a narrow viewport without placing it off-page", () => {
    const rect = getStampRectAtPoint(
      { x: 199, y: 1 },
      {
        kind: "image",
        imageWidth: 1000,
        imageHeight: 5000,
        scale: 2,
        viewportWidth: 160,
        viewportHeight: 200,
        pageWidth: 200,
        pageHeight: 300,
      },
    );
    expect(rect.width / rect.height).toBeCloseTo(0.2);
    expect(rect.height * 2).toBeLessThanOrEqual(80);
    expect(rect.y).toBe(0);
    expect(rect.x + rect.width).toBe(200);
  });

  it("keeps a large image within a small zoomed-out page", () => {
    const rect = getStampRectAtPoint(
      { x: 100, y: 100 },
      {
        kind: "image",
        imageWidth: 4000,
        imageHeight: 4000,
        scale: 0.1,
        pageWidth: 200,
        pageHeight: 300,
      },
    );
    expect(rect.width).toBeLessThanOrEqual(100);
    expect(rect.height).toBeLessThanOrEqual(150);
  });

  it("does not upscale small source images", () => {
    const rect = getStampRectAtPoint(
      { x: 100, y: 100 },
      {
        kind: "image",
        imageWidth: 32,
        imageHeight: 16,
        scale: 2,
      },
    );
    expect(rect.width).toBe(16);
    expect(rect.height).toBe(8);
  });
});
