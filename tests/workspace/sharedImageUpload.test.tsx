import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StampImageLibrary } from "@/components/stamps/StampImageLibrary";
import { ButtonProperties } from "@/components/workspace/controls/properties/ButtonProperties";
import { FieldType, type FormField } from "@/types";
import { STAMP_LIBRARY_DRAG_TYPE } from "@legir/pdf-model/stampImage";

const mocks = vi.hoisted(() => ({
  entries: [] as { id: string; name: string; image: { dataUrl: string } }[],
  refresh: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  load: vi.fn(),
  readButton: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/store/stampLibraryStore", () => ({
  useStampLibraryStore: () => mocks,
}));
vi.mock("@legir/pdf-model/stampImage", async (original) => ({
  ...(await original<typeof import("@legir/pdf-model/stampImage")>()),
  loadStampImageFile: mocks.load,
}));
vi.mock("@/components/workspace/controls/form/buttonImageFile", () => ({
  readButtonImageFile: mocks.readButton,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/components/language-provider", () => {
  const t = (key: string, params?: { name?: string }) =>
    params?.name ? `${key}:${params.name}` : key;
  return { useLanguage: () => ({ t }) };
});

let host: HTMLDivElement;
let root: Root;
const png = new File(["png"], "photo.png", { type: "image/png" });
const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
const image = "data:image/png;base64,AAAA";
const field: FormField = {
  id: "button-one",
  name: "Photo",
  type: FieldType.BUTTON,
  pageIndex: 0,
  rect: { x: 0, y: 0, width: 100, height: 80 },
  buttonLayout: 0,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.entries = [];
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.add.mockReset().mockResolvedValue({});
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.load.mockReset().mockImplementation(async (file: File) => ({
    dataUrl: `${image}${file.name}`,
    width: 100,
    height: 50,
  }));
  mocks.readButton.mockReset().mockResolvedValue(image);
  mocks.error.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async (view: React.ReactNode) => {
  await act(async () => root.render(view));
};
const input = () => host.querySelector<HTMLInputElement>('input[type="file"]')!;
const upload = async (files: File[]) => {
  await act(async () => {
    Object.defineProperty(input(), "files", {
      configurable: true,
      value: files,
    });
    input().dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("stamp and button upload adapters", () => {
  it("uses the shared uploader for stamp batches while keeping image-library persistence and selection", async () => {
    const selected = vi.fn();
    await render(<StampImageLibrary onSelect={selected} />);
    expect(
      host.querySelectorAll('[data-slot="image-upload-field"]'),
    ).toHaveLength(1);
    expect(input().multiple).toBe(true);
    expect(input().accept).toContain("image/svg+xml");
    await upload([svg, png]);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add.mock.calls[0][0]).toBe("logo.svg");
    expect(selected).toHaveBeenCalledExactlyOnceWith({
      dataUrl: `${image}logo.svg`,
      intrinsicSize: { width: 100, height: 50 },
    });
    expect(mocks.readButton).not.toHaveBeenCalled();
  });

  it("keeps saved images selectable, draggable and removable without clearing placed content", async () => {
    const resource = { dataUrl: image };
    mocks.entries = [{ id: "asset", name: "Saved photo", image: resource }];
    const selected = vi.fn();
    await render(<StampImageLibrary image={resource} onSelect={selected} />);
    expect(host.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(
      host
        .querySelector('img[alt="properties.image_stamp"]')
        ?.getAttribute("src"),
    ).toBe(image);
    const saved = host.querySelector<HTMLButtonElement>(
      '[aria-label="Saved photo"]',
    )!;
    await act(async () => saved.click());
    expect(selected).toHaveBeenCalledWith(resource);
    const setData = vi.fn();
    const event = new Event("dragstart", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { setData, effectAllowed: "none" },
    });
    await act(async () => {
      saved.dispatchEvent(event);
    });
    expect(setData).toHaveBeenCalledExactlyOnceWith(
      STAMP_LIBRARY_DRAG_TYPE,
      "asset",
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="stamp.remove_named_image:Saved photo"]',
        )!
        .click(),
    );
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("asset");
    expect(selected).toHaveBeenCalledTimes(1);
  });

  it("uses the same uploader for a single button image and checkpoints before updating the field", async () => {
    const changed = vi.fn();
    const history = vi.fn();
    await render(
      <ButtonProperties
        data={field}
        onChange={changed}
        onTriggerHistorySave={history}
      />,
    );
    expect(
      host.querySelectorAll('[data-slot="image-upload-field"]'),
    ).toHaveLength(1);
    expect(input().accept).toBe("image/png,image/jpeg");
    expect(input().multiple).toBe(false);
    await upload([png, svg]);
    expect(mocks.readButton).toHaveBeenCalledExactlyOnceWith(png);
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      buttonImage: image,
      buttonLayout: 1,
    });
    expect(history.mock.invocationCallOrder[0]).toBeLessThan(
      changed.mock.invocationCallOrder[0],
    );
    expect(mocks.add).not.toHaveBeenCalled();
    await render(
      <ButtonProperties
        data={{ ...field, buttonImage: image }}
        onChange={changed}
        onTriggerHistorySave={history}
      />,
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="common.actions.delete"]',
        )!
        .click(),
    );
    expect(changed).toHaveBeenLastCalledWith({ buttonImage: null });
  });

  it("keeps each consumer's error handling and does not overwrite a button with an invalid image", async () => {
    const changed = vi.fn();
    const history = vi.fn();
    mocks.readButton.mockRejectedValue(new Error("Unsupported image"));
    await render(
      <ButtonProperties
        data={field}
        onChange={changed}
        onTriggerHistorySave={history}
      />,
    );
    await upload([svg]);
    expect(changed).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("properties.button_image_error");
    await render(<StampImageLibrary onSelect={changed} />);
    mocks.load.mockRejectedValueOnce(new Error("Invalid SVG"));
    await upload([svg, png]);
    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add.mock.calls[0][0]).toBe("photo.png");
    expect(mocks.error).toHaveBeenCalledWith("stamp.import_error:logo.svg");
  });

  it.each(["button", "stamp"])(
    "does not apply a late %s upload to another selected control",
    async (kind) => {
      let finish!: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        finish = resolve;
      });
      const changed = vi.fn();
      const view = (id: string) =>
        kind === "button" ? (
          <ButtonProperties
            data={{ ...field, id }}
            onChange={changed}
            onTriggerHistorySave={vi.fn()}
          />
        ) : (
          <StampImageLibrary selectionKey={id} onSelect={changed} />
        );
      if (kind === "button") mocks.readButton.mockReturnValue(promise);
      else mocks.load.mockReturnValue(promise);
      await render(view("one"));
      await upload([png]);
      await render(view("two"));
      await act(async () =>
        finish(
          kind === "button"
            ? image
            : { dataUrl: image, width: 100, height: 50 },
        ),
      );
      expect(changed).not.toHaveBeenCalled();
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );
});
