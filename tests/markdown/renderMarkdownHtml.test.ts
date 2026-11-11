import { describe, expect, test } from "vitest";

import { renderMarkdownToHtml } from "@/components/markdown/lib/renderMarkdownHtml";

const render = (source: string) => {
  const container = document.createElement("div");
  container.innerHTML = renderMarkdownToHtml(source);
  return container;
};

describe("Markdown HTML rendering", () => {
  test("renders GFM tables, task lists and strikethrough", () => {
    const container = render(
      "| Name | Value |\n| --- | --- |\n| Example | 42 |\n\n- [x] Done\n\n~~Removed~~",
    );

    expect(
      container.querySelector(".markdown-table-scroll table td")?.textContent,
    ).toBe("Example");
    expect(
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(true);
    expect(container.querySelector("del")?.textContent).toBe("Removed");
  });

  test("sanitizes raw HTML while retaining safe formatting", () => {
    const container = render(
      '<strong>Safe</strong><script>alert(1)</script><img src="x" onerror="alert(1)">',
    );

    expect(container.querySelector("strong")?.textContent).toBe("Safe");
    expect(container.querySelector("script, [onerror]")).toBeNull();
  });

  test("decorates external links without changing local anchors", () => {
    const container = render(
      "[External](https://example.com) [Local](#section)",
    );
    const external = container.querySelector('a[href="https://example.com"]');
    const local = container.querySelector('a[href="#section"]');

    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.getAttribute("rel")).toBe("noreferrer noopener");
    expect(local?.hasAttribute("target")).toBe(false);
  });
});
