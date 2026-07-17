import { describe, expect, it } from "vitest";

import { parseEditorWindowBootstrap } from "@/services/platform/multiWindow/bootstrap";

describe("editor window bootstrap", () => {
  it("keeps all unique startup PDF paths in their original order", () => {
    expect(
      parseEditorWindowBootstrap({
        kind: "startup-open",
        filePaths: [" /tmp/one.pdf ", "/tmp/two.pdf", "/tmp/one.pdf"],
      }),
    ).toEqual({
      kind: "startup-open",
      filePaths: ["/tmp/one.pdf", "/tmp/two.pdf"],
    });
  });

  it("accepts the legacy singular startup path", () => {
    expect(
      parseEditorWindowBootstrap({
        kind: "startup-open",
        filePath: "/tmp/legacy.pdf",
      }),
    ).toEqual({
      kind: "startup-open",
      filePaths: ["/tmp/legacy.pdf"],
    });
  });

  it("rejects an empty startup PDF list", () => {
    expect(
      parseEditorWindowBootstrap({
        kind: "startup-open",
        filePaths: ["", "   "],
      }),
    ).toBeNull();
  });
});
