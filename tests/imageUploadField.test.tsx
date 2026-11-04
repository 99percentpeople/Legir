import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImageUploadField,
  type ImageUploadContext,
} from "@/components/ui/image-upload-field";

let host: HTMLDivElement;
let root: Root;
const first = new File(["one"], "one.png", { type: "image/png" });
const second = new File(["two"], "two.jpg", { type: "image/jpeg" });
const labels = {
  alt: "Photo",
  uploadLabel: "Upload image",
  replaceLabel: "Replace image",
  clearLabel: "Clear image",
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = async (view: React.ReactNode) => {
  await act(async () => root.render(view));
};
const input = () => host.querySelector<HTMLInputElement>('input[type="file"]')!;
const uploader = () =>
  host.querySelector<HTMLElement>('[data-slot="image-upload-field"]')!;
const selectFiles = async (files: File[]) => {
  await act(async () => {
    Object.defineProperty(input(), "files", {
      configurable: true,
      value: files,
    });
    input().dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const drag = async (
  target: Element,
  type: string,
  files: File[] = [],
  types = ["Files"],
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types, dropEffect: "none" },
  });
  await act(async () => target.dispatchEvent(event));
  return event;
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("shared image upload field", () => {
  it("supports upload, preview, replacement and an accessible clear action without submitting a form", async () => {
    const onUpload = vi.fn();
    const onClear = vi.fn();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    await render(
      <form onSubmit={submit}>
        <ImageUploadField
          {...labels}
          accept="image/png,image/jpeg"
          onUpload={onUpload}
        />
      </form>,
    );
    const picker = vi.spyOn(input(), "click").mockImplementation(() => {});
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(picker).toHaveBeenCalledOnce();
    expect(input().accept).toBe("image/png,image/jpeg");
    expect(input().multiple).toBe(false);
    expect(input().getAttribute("aria-label")).toBe(labels.uploadLabel);
    await selectFiles([first, second]);
    expect(onUpload).toHaveBeenCalledExactlyOnceWith(first, {
      signal: expect.any(AbortSignal),
    });
    await render(
      <form onSubmit={submit}>
        <ImageUploadField
          {...labels}
          imageData="data:image/png;base64,AAAA"
          onUpload={onUpload}
          onClear={onClear}
        />
      </form>,
    );
    expect(host.querySelector("img")?.alt).toBe("Photo");
    expect(host.querySelector("img")?.draggable).toBe(false);
    expect(host.querySelector("img")?.className).toContain(
      "h-full w-full object-contain",
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Clear image"]')!
        .click(),
    );
    expect(onClear).toHaveBeenCalledOnce();
    const replace = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Replace image",
    )!;
    await act(async () => replace.click());
    expect(picker).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
  });

  it("passes the complete batch to multi-image consumers, including drops on their library", async () => {
    const onUpload = vi.fn();
    const outerDrop = vi.fn();
    await render(
      <div onDrop={outerDrop}>
        <ImageUploadField {...labels} multiple onUpload={onUpload}>
          <div data-library="true">Library</div>
        </ImageUploadField>
      </div>,
    );
    expect(input().multiple).toBe(true);
    await selectFiles([first, second]);
    expect(onUpload).toHaveBeenLastCalledWith([first, second], {
      signal: expect.any(AbortSignal),
    });
    const drop = await drag(host.querySelector("[data-library]")!, "drop", [
      second,
      first,
    ]);
    expect(drop.defaultPrevented).toBe(true);
    expect(onUpload).toHaveBeenLastCalledWith([second, first], {
      signal: expect.any(AbortSignal),
    });
    expect(outerDrop).not.toHaveBeenCalled();
  });

  it("contains file drags but leaves internal image-library drags untouched", async () => {
    const onUpload = vi.fn();
    const parent = vi.fn();
    await render(
      <div onDrop={parent} onDragOver={parent}>
        <ImageUploadField {...labels} onUpload={onUpload} />
      </div>,
    );
    const child = uploader().querySelector("button")!;
    await drag(uploader(), "dragenter");
    await drag(child, "dragenter");
    await drag(child, "dragleave");
    expect(uploader().firstElementChild?.className).toContain("ring-2");
    await drag(child, "dragover");
    expect(parent).not.toHaveBeenCalled();
    await drag(child, "drop", [first, second]);
    expect(onUpload).toHaveBeenCalledExactlyOnceWith(first, {
      signal: expect.any(AbortSignal),
    });
    expect(uploader().firstElementChild?.className).not.toContain("ring-2");
    const internal = await drag(
      child,
      "drop",
      [],
      ["application/x-legir-stamp-image"],
    );
    expect(internal.defaultPrevented).toBe(false);
    expect(parent).toHaveBeenCalledOnce();
  });

  it("locks overlapping uploads and clears the file input immediately for same-file retries", async () => {
    const pending = deferred();
    const onUpload = vi.fn(() => pending.promise);
    await render(<ImageUploadField {...labels} onUpload={onUpload} />);
    Object.defineProperty(input(), "value", {
      configurable: true,
      writable: true,
      value: "same-file.png",
    });
    await selectFiles([first]);
    expect(input().value).toBe("");
    expect(uploader().getAttribute("aria-busy")).toBe("true");
    expect(input().matches(":disabled")).toBe(true);
    await drag(uploader(), "drop", [second]);
    expect(onUpload).toHaveBeenCalledOnce();
    await act(async () => pending.resolve());
    expect(uploader().getAttribute("aria-busy")).toBe("false");
    await selectFiles([first]);
    expect(onUpload).toHaveBeenCalledTimes(2);
  });

  it.each(["prop", "fieldset"])(
    "blocks drops and programmatic change events when disabled by %s",
    async (mode) => {
      const onUpload = vi.fn();
      const parent = vi.fn();
      await render(
        <div onDrop={parent}>
          <fieldset disabled={mode === "fieldset"}>
            <ImageUploadField
              {...labels}
              disabled={mode === "prop"}
              onUpload={onUpload}
            />
          </fieldset>
        </div>,
      );
      await selectFiles([first]);
      await drag(uploader(), "drop", [first]);
      expect(onUpload).not.toHaveBeenCalled();
      expect(parent).not.toHaveBeenCalled();
    },
  );

  it("recovers after an error and reports it without an unhandled rejection", async () => {
    const failure = new Error("Unsupported image");
    const onUpload = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    const onUploadError = vi.fn();
    await render(
      <ImageUploadField
        {...labels}
        onUpload={onUpload}
        onUploadError={onUploadError}
      />,
    );
    await selectFiles([first]);
    expect(onUploadError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(uploader().getAttribute("aria-busy")).toBe("false");
    await selectFiles([first]);
    expect(onUpload).toHaveBeenCalledTimes(2);
  });

  it.each(["target", "unmount", "disabled"])(
    "invalidates a pending result on %s",
    async (change) => {
      const pending = deferred();
      const applied = vi.fn();
      let signal!: AbortSignal;
      const onUpload = async (_file: File, context: ImageUploadContext) => {
        signal = context.signal;
        await pending.promise;
        if (!signal.aborted) applied();
      };
      await render(
        <ImageUploadField {...labels} selectionKey="old" onUpload={onUpload} />,
      );
      await selectFiles([first]);
      await render(
        change === "unmount" ? (
          <div />
        ) : (
          <ImageUploadField
            {...labels}
            selectionKey={change === "target" ? "new" : "old"}
            disabled={change === "disabled"}
            onUpload={onUpload}
          />
        ),
      );
      expect(signal.aborted).toBe(true);
      await act(async () => pending.resolve());
      expect(applied).not.toHaveBeenCalled();
    },
  );
});
