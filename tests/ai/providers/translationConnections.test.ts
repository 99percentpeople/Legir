import { afterEach, beforeAll, expect, test } from "vitest";
import {
  preferencesStore,
  setPreferenceOptions,
} from "@/store/preferencesStore";
import { createAiConnection } from "@/services/ai/providers/connections";
import { registerTranslateOptionsFromProviders } from "@/services/ai/translation";
import { translateService } from "@/services/translateService";
import { createAiDiscoveredModel } from "@/services/ai/providers/models";
import { initializeModelsDev } from "@/services/ai/providers/modelsDev";

const initial = preferencesStore.getState();
beforeAll(() => initializeModelsDev());
afterEach(() => {
  preferencesStore.setState(initial);
  registerTranslateOptionsFromProviders();
});

test("preserves catalog logos and separate model IDs for multiple translation connections", () => {
  const connection = {
    ...createAiConnection({
      id: "deepseek",
      label: "DeepSeek",
      backendKind: "deepseek",
      defaultBaseUrl: "https://api.deepseek.com",
    }),
    apiKey: "test-key",
  };
  setPreferenceOptions({
    llm: { accountA: connection, accountB: { ...connection } },
  });
  preferencesStore.setState({
    llmModelCache: Object.fromEntries(
      ["accountA", "accountB"].map((id) => [
        id,
        {
          models: [
            createAiDiscoveredModel({
              modelId: "deployment",
              inputModalities: ["text"],
            }),
          ],
          fetchedAt: Date.now(),
        },
      ]),
    ),
  });
  registerTranslateOptionsFromProviders();
  expect(
    translateService.getOptionGroups().filter((group) => group.id !== "cloud"),
  ).toMatchObject([
    {
      id: "accountA",
      catalogId: "deepseek",
      options: [{ id: "accountA:deployment" }],
    },
    {
      id: "accountB",
      catalogId: "deepseek",
      options: [{ id: "accountB:deployment" }],
    },
  ]);
});

test("removes deleted connections from translation without rerouting explicit requests", async () => {
  setPreferenceOptions({
    llm: {
      office: {
        ...createAiConnection(),
        name: "Office",
        apiUrl: "https://example.com/v1",
        authMode: "none",
      },
    },
  });
  preferencesStore.setState({
    llmModelCache: {
      office: {
        models: [
          createAiDiscoveredModel({
            modelId: "deployment",
            inputModalities: ["text"],
          }),
        ],
        fetchedAt: Date.now(),
      },
    },
  });
  registerTranslateOptionsFromProviders();
  expect(
    translateService.getOptionGroups().find((group) => group.id === "office")
      ?.options[0].id,
  ).toBe("office:deployment");
  setPreferenceOptions({ llm: {} });
  registerTranslateOptionsFromProviders();
  expect(translateService.getOptionGroups().map((group) => group.id)).toEqual([
    "cloud",
  ]);
  expect(translateService.isOptionAvailable("office:deployment")).toBe(false);
  await expect(
    translateService.translate("Hello", {
      targetLanguage: "zh-CN",
      translateOption: "office:deployment",
    }),
  ).rejects.toThrow("Unknown translate option: office:deployment");
  const stream = translateService.translateStream("Hello", {
    targetLanguage: "zh-CN",
    translateOption: "office:deployment",
  });
  await expect(stream.next()).rejects.toThrow("Unknown translate option");
});
