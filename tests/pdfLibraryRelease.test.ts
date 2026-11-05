import { describe, expect, it } from "vitest";
import {
  releasePackageMetadata,
  releaseVersion,
} from "../scripts/release-pdf-libraries";

describe("PDF library releases", () => {
  it("rewrites internal workspace dependencies to fixed release URLs", () => {
    const source = {
      name: "@legir/pdf-core",
      version: "0.1.0",
      dependencies: {
        "@legir/pdf-model": "workspace:*",
        "@legir/pdfium": "workspace:*",
        "pdf-fontkit": "^1.8.9",
      },
    };
    const result = releasePackageMetadata(
      source,
      "pdf-libs-v0.1.0",
      "a".repeat(40),
    );
    expect(result.dependencies["@legir/pdf-model"]).toBe(
      "https://github.com/99percentpeople/Legir/releases/download/pdf-libs-v0.1.0/legir-pdf-model-0.1.0.tgz",
    );
    expect(result.dependencies["pdf-fontkit"]).toBe("^1.8.9");
    expect(source.dependencies["@legir/pdf-model"]).toBe("workspace:*");
    expect(result.legirRelease).toEqual({
      revision: "a".repeat(40),
      tag: "pdf-libs-v0.1.0",
    });
  });
  it("rejects desktop tags, mismatched versions and unknown workspaces", () => {
    expect(() => releaseVersion("v0.1.0")).toThrow();
    expect(() =>
      releasePackageMetadata(
        { name: "@legir/pdf-model", version: "0.2.0" },
        "pdf-libs-v0.1.0",
        "a".repeat(40),
      ),
    ).toThrow();
    expect(() =>
      releasePackageMetadata(
        {
          name: "@legir/pdf-core",
          version: "0.1.0",
          dependencies: { app: "workspace:*" },
        },
        "pdf-libs-v0.1.0",
        "a".repeat(40),
      ),
    ).toThrow();
  });
});
