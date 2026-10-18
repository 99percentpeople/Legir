import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ModelSelect } from "@/components/ModelSelect";
import { ProviderLogo } from "@/components/ProviderLogo";

let node: HTMLDivElement;
let root: Root;
const scrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  vi.unstubAllGlobals();
});

test("model groups share catalog logos while selections retain independent connection IDs", async () => {
  const onValueChange = vi.fn();
  await act(async () => {
    root.render(
      <ModelSelect
        value="account-a:model"
        onValueChange={onValueChange}
        placeholder="Choose a model"
        groups={[
          {
            id: "account-a",
            catalogId: "deepseek",
            label: "DeepSeek (1)",
            options: [{ value: "account-a:model", label: "Model A" }],
          },
          {
            id: "account-b",
            catalogId: "deepseek",
            label: "DeepSeek (2)",
            options: [{ value: "account-b:model", label: "Model B" }],
          },
          {
            id: "new-account",
            catalogId: "new-provider",
            label: "New provider",
            options: [{ value: "new-account:model", label: "New model" }],
          },
        ]}
      />,
    );
  });
  await act(async () => {
    node
      .querySelector<HTMLElement>('[role="combobox"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
  });
  expect(
    Array.from(document.querySelectorAll('[data-slot="select-label"] img')).map(
      (image) => image.getAttribute("src"),
    ),
  ).toEqual([
    "https://models.dev/logos/deepseek.svg",
    "https://models.dev/logos/deepseek.svg",
    "https://models.dev/logos/new-provider.svg",
  ]);
  await act(async () => {
    document
      .querySelectorAll('[role="option"]')[1]!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
  });
  expect(onValueChange).toHaveBeenCalledWith("account-b:model");
});

test("shows a local icon until the catalog logo loads, recovers after errors and resets when the provider changes", async () => {
  await act(async () => root.render(<ProviderLogo catalogId="deepseek" />));
  expect(node.querySelector("svg")).not.toBeNull();
  const firstImage = node.querySelector("img")!;
  await act(async () => firstImage.dispatchEvent(new Event("error")));
  expect(node.querySelector("img")).toBeNull();
  expect(node.querySelector("svg")).not.toBeNull();

  await act(async () => root.render(<ProviderLogo catalogId="new-provider" />));
  const nextImage = node.querySelector("img")!;
  expect(nextImage.getAttribute("src")).toBe(
    "https://models.dev/logos/new-provider.svg",
  );
  expect(node.querySelector("svg")).not.toBeNull();
  await act(async () => nextImage.dispatchEvent(new Event("load")));
  expect(node.querySelector("svg")).toBeNull();
  expect(nextImage.classList.contains("opacity-0")).toBe(false);

  await act(async () => root.render(<ProviderLogo />));
  expect(node.querySelector("img")).toBeNull();
  expect(node.querySelector("svg")).not.toBeNull();
});
