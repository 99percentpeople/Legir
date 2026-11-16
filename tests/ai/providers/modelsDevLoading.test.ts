import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

test("concurrent initialization shares the bundled JSON request", async () => {
  const fetcher = vi.fn(fetch);
  vi.stubGlobal("fetch", fetcher);
  const models = await import("@/services/ai/providers/modelsDev");

  await Promise.all([
    models.initializeModelsDev(),
    models.initializeModelsDev(),
  ]);

  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toEqual({ credentials: "omit" });
  expect(models.getModelsDevProvider("openai")?.models).toBeDefined();
});

test.each(["http", "invalid-json", "network"])(
  "catalog initialization can retry after a %s failure",
  async (failure) => {
    const fetcher = vi.fn(fetch);
    if (failure === "http")
      fetcher.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    else if (failure === "invalid-json")
      fetcher.mockResolvedValueOnce(new Response("not json"));
    else fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetcher);
    const models = await import("@/services/ai/providers/modelsDev");

    await expect(models.initializeModelsDev()).rejects.toThrow();
    await models.initializeModelsDev();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(models.getModelsDevProvider("openai")?.models).toBeDefined();
  },
);
