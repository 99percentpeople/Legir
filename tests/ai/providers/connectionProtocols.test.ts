import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  getAiConnectionProtocolPatch,
  getAiConnectionProtocols,
} from "@/services/ai/providers/connectionProtocols";
import { getModelsDevProvider } from "@/services/ai/providers/modelsDev";
import type { AiProviderBackendKind } from "@/services/ai/providers/catalog";
import type { LLMProviderOptions } from "@/types";

vi.mock("@/services/ai/providers/modelsDev", () => ({
  getModelsDevProvider: vi.fn(),
}));
const catalogProvider = vi.mocked(getModelsDevProvider);
const connection = (
  backendKind: AiProviderBackendKind,
): LLMProviderOptions => ({
  name: "Work",
  catalogId: "new-vendor",
  backendKind,
  apiKey: "saved-key",
  apiUrl: "https://saved.example/v1",
  enabled: true,
});
const setProvider = (npm: string, api = "https://catalog.example/v1") => {
  catalogProvider.mockReturnValue({
    id: "new-vendor",
    name: "New vendor",
    npm,
    api,
    models: {},
  });
};
beforeEach(() => {
  catalogProvider.mockReset();
});

describe("connection API formats", () => {
  test.each([
    ["@ai-sdk/openai", "openai", "OpenAI Responses"],
    ["@ai-sdk/anthropic", "anthropic", "Anthropic Messages"],
    ["@ai-sdk/google", "google", "Google Generative AI"],
    [
      "@ai-sdk/openai-compatible",
      "openai-compatible",
      "OpenAI Chat Completions",
    ],
    ["@ai-sdk/groq", "groq", "OpenAI Chat Completions"],
    ["@ai-sdk/xai", "xai", "OpenAI Chat Completions"],
    ["@openrouter/ai-sdk-provider", "openrouter", "OpenAI Chat Completions"],
  ] as const)(
    "only offers the declared format for a new %s provider",
    (npm, kind, label) => {
      setProvider(npm);
      expect(getAiConnectionProtocols(connection(kind))).toEqual([
        {
          id: kind,
          label,
          available: true,
          defaultBaseUrl: "https://catalog.example/v1",
        },
      ]);
    },
  );

  test.each([
    ["@ai-sdk/anthropic", "anthropic-compatible", "Anthropic Messages"],
    ["@ai-sdk/openai-compatible", "deepseek", "OpenAI Chat Completions"],
    ["@ai-sdk/openai-compatible", "zhipu", "OpenAI Chat Completions"],
  ] as const)(
    "retains the %s legacy %s adapter without duplicate format choices",
    (npm, kind, label) => {
      setProvider(npm);
      expect(getAiConnectionProtocols(connection(kind))).toMatchObject([
        { id: kind, label, available: true },
      ]);
    },
  );

  test("keeps an unlisted saved format but prevents selecting it or other undeclared formats", () => {
    setProvider("@ai-sdk/anthropic", "https://catalog.example/anthropic/v1");
    const saved = connection("openai-compatible");
    expect(getAiConnectionProtocols(saved)).toMatchObject([
      { id: "anthropic", available: true },
      { id: "openai-compatible", available: false },
    ]);
    expect(getAiConnectionProtocolPatch(saved, "openai-compatible")).toBeNull();
    expect(getAiConnectionProtocolPatch(saved, "google")).toBeNull();
    expect(getAiConnectionProtocolPatch(saved, "unknown")).toBeNull();
    expect(saved).toEqual(connection("openai-compatible"));

    const patch = getAiConnectionProtocolPatch(saved, "anthropic");
    expect(patch).toEqual({
      backendKind: "anthropic",
      apiUrl: "https://catalog.example/anthropic/v1",
    });
    const updated = { ...saved, ...patch };
    expect(updated.apiKey).toBe("saved-key");
    expect(getAiConnectionProtocols(updated)).toMatchObject([
      { id: "anthropic", available: true },
    ]);
  });

  test("does not unlock every protocol when the provider is absent or its SDK unsupported", () => {
    // The catalog may still be loading or no longer contain an older provider.
    const saved = connection("google");
    expect(getAiConnectionProtocols(saved)).toMatchObject([
      { id: "google", available: false },
    ]);
    setProvider("unsupported-sdk");
    expect(getAiConnectionProtocols(saved)).toMatchObject([
      { id: "google", available: false },
    ]);
    expect(getAiConnectionProtocolPatch(saved, "openai")).toBeNull();
  });

  test("updates choices after catalog changes without rewriting any saved configuration", () => {
    const saved = connection("anthropic");
    setProvider("@ai-sdk/anthropic");
    expect(getAiConnectionProtocols(saved)).toMatchObject([
      { id: "anthropic", available: true },
    ]);
    // Even a re-selection of the same format must not replace a custom endpoint.
    expect(getAiConnectionProtocolPatch(saved, "anthropic")).toBeNull();
    setProvider("@ai-sdk/google", "https://catalog.example/v1beta");
    expect(getAiConnectionProtocols(saved)).toMatchObject([
      { id: "google", available: true },
      { id: "anthropic", available: false },
    ]);
    expect(saved).toEqual(connection("anthropic"));
  });

  test("offers all formats for custom connections and keeps their endpoint and authentication", () => {
    const custom = {
      ...connection("groq"),
      catalogId: "",
      authMode: "none" as const,
    };
    expect(
      getAiConnectionProtocols(custom).map(({ id, available }) => ({
        id,
        available,
      })),
    ).toEqual([
      { id: "groq", available: true },
      { id: "openai", available: true },
      { id: "anthropic-compatible", available: true },
      { id: "google", available: true },
    ]);
    const patch = getAiConnectionProtocolPatch(custom, "anthropic-compatible");
    expect(patch).toEqual({ backendKind: "anthropic-compatible" });
    expect({ ...custom, ...patch }).toMatchObject({
      apiKey: "saved-key",
      apiUrl: "https://saved.example/v1",
      authMode: "none",
    });
  });

  test("resets an explicit Bearer override when switching to a protocol that cannot use it", () => {
    const custom = {
      ...connection("anthropic-compatible"),
      catalogId: "",
      authMode: "bearer" as const,
    };
    expect(getAiConnectionProtocolPatch(custom, "google")).toEqual({
      backendKind: "google",
      authMode: "api-key",
    });
    expect(getAiConnectionProtocolPatch(custom, "openai-compatible")).toEqual({
      backendKind: "openai-compatible",
      authMode: "api-key",
    });
    expect(custom.authMode).toBe("bearer");
  });
});
