import { vi } from "vitest";

// Node has no Vite asset server. Use the real snapshot through a fetchable URL
// so catalog initialization still exercises JSON loading and validation.
vi.mock("@/services/ai/providers/models-dev.snapshot.json?url", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const bytes = await readFile(
    resolve(
      import.meta.dirname,
      "../src/services/ai/providers/models-dev.snapshot.json",
    ),
  );
  return {
    default: `data:application/json;base64,${bytes.toString("base64")}`,
  };
});
