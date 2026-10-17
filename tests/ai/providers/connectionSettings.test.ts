import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createAiConnection,
  getAiConnectionAuthMode,
  getAiConnectionAuthModes,
  getAiConnectionLabel,
  normalizeAiConnections,
} from "@/services/ai/providers/connections";
import { getModelsDevProvider } from "@/services/ai/providers/modelsDev";
import { getAiConnectionConfig } from "@/services/ai/providers/settings";
import { getConnectionCacheKey } from "@/services/ai/providers/modelCatalog/base";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import type { LLMOptions } from "@/types";

vi.mock("@/services/ai/providers/modelsDev", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/ai/providers/modelsDev")
  >()),
  getModelsDevProvider: vi.fn(),
}));
const catalogProvider = vi.mocked(getModelsDevProvider);
const catalogConnection = () => ({
  ...createAiConnection({
    id: "new-provider",
    label: "Saved Provider Name",
    backendKind: "anthropic",
    defaultBaseUrl: "https://saved.example/v1",
  }),
  apiKey: "saved-key",
});
beforeEach(() => {
  catalogProvider.mockReset();
  catalogProvider.mockReturnValue({
    id: "new-provider",
    name: "Current Provider Name",
    npm: "@ai-sdk/anthropic",
    api: "https://catalog.example/v1",
    models: {},
  });
});

describe("automatic connection settings", () => {
  test("uses catalog names consistently while preserving saved credentials, IDs and endpoints", () => {
    const llm: LLMOptions = { account: catalogConnection() };
    const app = { ...DEFAULT_EDITOR_UI_STATE.options, llm };
    const before = structuredClone(llm);
    const key = getConnectionCacheKey(app, "account");
    expect(getAiConnectionLabel(llm, "account")).toBe("Current Provider Name");
    expect(getAiConnectionConfig(app, "account")).toMatchObject({
      providerId: "account",
      label: "Current Provider Name",
      apiKey: "saved-key",
      baseURL: "https://saved.example/v1",
      authMode: "api-key",
    });
    catalogProvider.mockReset();
    expect(getAiConnectionLabel(llm, "account")).toBe("Saved Provider Name");
    expect(getConnectionCacheKey(app, "account")).toBe(key);
    expect(llm).toEqual(before);
  });

  test("numbers multiple accounts without renaming IDs or editable custom connections", () => {
    const llm: LLMOptions = {
      accountA: { ...catalogConnection(), name: "Old work alias" },
      custom: { ...createAiConnection(), name: "Local server" },
      accountB: { ...catalogConnection(), name: "Old personal alias" },
    };
    expect(getAiConnectionLabel(llm, "accountA")).toBe(
      "Current Provider Name (1)",
    );
    expect(getAiConnectionLabel(llm, "accountB")).toBe(
      "Current Provider Name (2)",
    );
    expect(getAiConnectionLabel(llm, "custom")).toBe("Local server");
    const restored = normalizeAiConnections(JSON.parse(JSON.stringify(llm)));
    expect(Object.keys(restored)).toEqual(["accountA", "custom", "accountB"]);
    expect(getAiConnectionLabel(restored, "accountB")).toBe(
      "Current Provider Name (2)",
    );
  });

  test("retains meaningful legacy authentication overrides for catalog connections", () => {
    for (const authMode of ["bearer", "none"] as const) {
      const llm = { account: { ...catalogConnection(), authMode } };
      const app = { ...DEFAULT_EDITOR_UI_STATE.options, llm };
      expect(getAiConnectionConfig(app, "account")?.authMode).toBe(authMode);
      expect(normalizeAiConnections(llm).account).toMatchObject({
        authMode,
        apiKey: "saved-key",
        apiUrl: "https://saved.example/v1",
      });
    }
  });

  test("only offers a distinct Bearer override for Anthropic-compatible protocols", () => {
    for (const backendKind of [
      "openai",
      "openai-compatible",
      "google",
      "groq",
    ] as const) {
      expect(getAiConnectionAuthModes({ backendKind })).toEqual([
        "api-key",
        "none",
      ]);
      // Older ineffective Bearer selections resolve to the same SDK default.
      expect(getAiConnectionAuthMode({ backendKind, authMode: "bearer" })).toBe(
        "api-key",
      );
    }
    for (const backendKind of ["anthropic", "anthropic-compatible"] as const) {
      expect(getAiConnectionAuthModes({ backendKind })).toEqual([
        "api-key",
        "bearer",
        "none",
      ]);
      expect(getAiConnectionAuthMode({ backendKind, authMode: "bearer" })).toBe(
        "bearer",
      );
    }
  });
});
