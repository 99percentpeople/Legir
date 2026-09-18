import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadSection } from "../../www/src/components/DownloadSection";
import { downloadCopy, getDownloadCopy } from "../../www/src/content/downloads";
import {
  detectDesktopPlatform,
  formatDownloadSize,
  LATEST_RELEASE_API,
  parseDesktopRelease,
  RELEASES_URL,
} from "../../www/src/lib/downloads";

const installerNames = [
  "Legir_0.1.0_x64-setup.exe",
  "Legir_0.1.0_windows_x64_portable.zip",
  "Legir_0.1.0_x64.dmg",
  "Legir_0.1.0_aarch64.dmg",
  "Legir_0.1.0_amd64.deb",
  "Legir_0.1.0_arm64.deb",
  "Legir_0.1.0_macos_x64_portable.tar.gz",
  "Legir_0.1.0_macos_arm64_portable.tar.gz",
  "Legir_0.1.0_linux_x64_portable",
  "Legir_0.1.0_linux_arm64_portable",
];
const fixture = {
  tag_name: "v0.1.0",
  draft: false,
  prerelease: false,
  assets: installerNames.map((name) => ({
    name,
    state: "uploaded",
    size: 7 * 1024 * 1024,
    browser_download_url: `${RELEASES_URL}/download/v0.1.0/${name}`,
  })),
};

function response(body: unknown, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe("desktop installer metadata", () => {
  it("recognizes all ten platform/architecture/format combinations", () => {
    const release = parseDesktopRelease(fixture)!;
    expect(release.version).toBe("v0.1.0");
    expect(release.downloads).toHaveLength(10);
    expect(
      release.downloads.filter((item) => item.platform === "windows"),
    ).toHaveLength(2);
    expect(
      release.downloads.filter((item) => item.platform === "macos"),
    ).toHaveLength(4);
    expect(
      release.downloads.filter((item) => item.platform === "linux"),
    ).toHaveLength(4);
    expect(
      release.downloads.filter((item) => item.kind === "installer"),
    ).toHaveLength(5);
    expect(
      release.downloads.filter((item) => item.kind === "portable"),
    ).toHaveLength(5);
    expect(new Set(release.downloads.map((item) => item.arch))).toEqual(
      new Set(["x64", "arm64"]),
    );
    expect(formatDownloadSize(7 * 1024 * 1024)).toBe("7.0 MB");
  });
  it.each([
    null,
    [],
    {},
    { ...fixture, draft: true },
    { ...fixture, prerelease: true },
    { ...fixture, tag_name: "v0.1.0-beta.1" },
    { ...fixture, tag_name: "main" },
    { ...fixture, assets: null },
  ])("rejects invalid or unpublished release metadata", (value) => {
    expect(parseDesktopRelease(value)).toBeNull();
  });
  it("ignores loose binaries, signatures, bad URLs, empty uploads and unknown architectures", () => {
    const good = fixture.assets[0];
    const badAssets = [
      { ...good, browser_download_url: "https://example.com/installer.exe" },
      {
        ...good,
        browser_download_url: `${RELEASES_URL}/download/v0.0.9/${good.name}`,
      },
      { ...good, browser_download_url: "javascript:alert(1)" },
      { ...good, name: "Legir_0.1.0_x64.exe" },
      { ...good, name: "Legir_0.1.0_x64-setup.exe.sig" },
      { ...good, name: "Legir_0.1.0_i686-setup.exe" },
      { ...good, name: "Another_0.1.0_x64-setup.exe" },
      { ...good, state: "starter" },
      { ...good, size: 0 },
      { ...good, size: NaN },
      null,
    ];
    expect(
      parseDesktopRelease({ ...fixture, assets: badAssets })?.downloads,
    ).toEqual([]);
  });
  it.each([
    "Legir_0.1.0_amd64.AppImage",
    "Legir_0.1.0_aarch64.AppImage",
    "Legir_0.1.0_linux_x64_portable.AppImage",
    "Legir_0.1.0_linux_x64_portable.elf",
    "Legir_0.1.0_linux_x64_portable.zip",
    "Legir_0.1.0_linux_amd64_portable",
    "Legir_0.1.0_linux_i686_portable",
    "Legir_0.1.0_windows_x64_portable",
    "Legir_0.2.0_linux_x64_portable",
    "Legir_0.1.0_linux_x64_portable.sig",
    "Legir_0.1.0_x64_en-US.msi",
    "Legir-0.1.0-1.x86_64.rpm",
    "Legir_0.1.0_x64.exe",
    "Legir_0.1.0_aarch64-setup.exe",
    "Legir_0.1.0_windows_x64.zip",
    "Legir_0.1.0_macos_x64_portable.zip",
    "Legir_0.1.0_windows_x64_portable.tar.gz",
    "Legir_0.1.0_linux_x64_portable.tar.gz",
    "Legir_0.1.0_aarch64.app.tar.gz",
    "Legir_0.1.0_source.zip",
    "Legir_0.2.0_windows_x64_portable.zip",
    "Legir_0.2.0_x64-setup.exe",
  ])("ignores removed, mislabelled or wrong-version downloads: %s", (name) => {
    const asset = {
      ...fixture.assets[0],
      name,
      browser_download_url: `${RELEASES_URL}/download/v0.1.0/${name}`,
    };
    expect(
      parseDesktopRelease({ ...fixture, assets: [asset] })?.downloads,
    ).toEqual([]);
  });
  it("deduplicates the same installer format for an architecture", () => {
    expect(
      parseDesktopRelease({
        ...fixture,
        assets: [fixture.assets[0], fixture.assets[0]],
      })?.downloads,
    ).toHaveLength(1);
  });
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0, "windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, "macos"],
    ["Mozilla/5.0 (X11; Linux aarch64)", 0, "linux"],
    ["Mozilla/5.0 (Linux; Android 15)", 5, null],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS)", 5, null],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, null],
    ["Mozilla/5.0 (X11; CrOS x86_64)", 0, null],
    ["unknown", 0, null],
  ])(
    "detects OS, without guessing Mac processor type: %s",
    (ua, touch, expected) => {
      expect(detectDesktopPlatform(ua as string, touch as number)).toBe(
        expected,
      );
    },
  );
  it("has complete copy in all seven languages and safe fallbacks", () => {
    for (const copy of Object.values(downloadCopy)) {
      expect(Object.keys(copy)).toEqual(Object.keys(downloadCopy.en));
      for (const value of Object.values(copy))
        expect(value.trim()).not.toBe("");
      expect(copy.linuxNote).toContain("ELF");
      expect(copy.linuxPortableNote).toContain("WebKitGTK 4.1");
      expect(copy.linuxPortableNote).toContain("chmod +x");
      expect(JSON.stringify(copy)).not.toMatch(/AppImage/i);
    }
    expect(Object.keys(downloadCopy)).toHaveLength(7);
    for (const value of ["system", "unknown", "__proto__", "constructor"]) {
      expect(getDownloadCopy(value)).toBe(downloadCopy.en);
    }
  });
});

describe("desktop downloads UI", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("navigator", { userAgent: "Unknown", maxTouchPoints: 0 });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  async function render() {
    await act(async () =>
      root.render(<DownloadSection copy={downloadCopy.en} />),
    );
  }
  it("shows real asset links, version, sizes and both Mac architectures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(fixture));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    expect(fetchMock).toHaveBeenCalledWith(
      LATEST_RELEASE_API,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.querySelectorAll(".download-options a")).toHaveLength(10);
    expect(container.textContent).toContain("v0.1.0");
    expect(container.textContent).toContain("7.0 MB");
    expect(container.textContent).toContain("Apple Silicon");
    expect(container.textContent).toContain("Intel");
    expect(container.querySelectorAll('a[data-kind="installer"]')).toHaveLength(
      5,
    );
    expect(container.querySelectorAll('a[data-kind="portable"]')).toHaveLength(
      5,
    );
    expect(container.textContent).not.toMatch(/MSI|RPM|AppImage/i);
    const linux = container.querySelector('[data-platform="linux"]')!;
    const elfLinks = linux.querySelectorAll('a[data-kind="portable"]');
    expect(elfLinks).toHaveLength(2);
    for (const link of elfLinks) {
      expect(link.textContent).toContain("ELF");
      expect(link.getAttribute("href")).toMatch(/_linux_(x64|arm64)_portable$/);
      expect(link.getAttribute("aria-describedby")).toBe(
        "download-linux-portable-note",
      );
    }
    expect(linux.textContent).toContain(downloadCopy.en.linuxPortableNote);
    expect(container.textContent).toContain("WebView2");
    expect(container.textContent).toContain(downloadCopy.en.portableNote);
    const windowsPortable = container.querySelector(
      'a[href$="windows_x64_portable.zip"]',
    );
    expect(windowsPortable?.textContent).toContain(downloadCopy.en.portable);
    expect(windowsPortable?.getAttribute("aria-label")).toContain("Windows");
    expect(
      container.querySelector(".download-grid")?.getAttribute("aria-busy"),
    ).toBe("false");
  });
  it.each([
    ["windows", "Windows", "windows", "0 0 448 512", "M0 93.7"],
    ["macos", "macOS", "apple", "0 0 384 512", "M318.7 268.7"],
    ["linux", "Linux", "linux", "0 0 448 512", "M220.8 123.3"],
  ])(
    "uses the monochrome %s brand glyph instead of a generic UI icon",
    async (platform, heading, source, viewBox, pathStart) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 404)));
      await render();
      const icon = container.querySelector(
        `.download-card-heading > svg[data-system-icon="${platform}"]`,
      );
      expect(icon).not.toBeNull();
      expect(icon?.parentElement?.querySelector("h3")?.textContent).toBe(
        heading,
      );
      expect(icon?.classList.contains("download-platform-icon")).toBe(true);
      expect(icon?.getAttribute("viewBox")).toBe(viewBox);
      expect(icon?.getAttribute("width")).toBe("28");
      expect(icon?.getAttribute("height")).toBe("28");
      expect(icon?.getAttribute("fill")).toBe("currentColor");
      expect(icon?.getAttribute("stroke")).toBe("none");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(icon?.getAttribute("focusable")).toBe("false");
      expect(
        icon?.querySelector("path")?.getAttribute("d")?.startsWith(pathStart),
      ).toBe(true);
      expect(icon?.querySelector("metadata")?.textContent).toContain(
        `6.7.2/svgs/brands/${source}.svg`,
      );
      expect(icon?.querySelector("metadata")?.textContent).toContain(
        "CC BY 4.0",
      );
      expect(icon?.querySelector("image, use")).toBeNull();
    },
  );
  it.each([
    ["windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"],
    ["macos", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"],
    ["linux", "Mozilla/5.0 (X11; Linux x86_64)"],
  ])(
    "features %s in the center and first in the keyboard/mobile order",
    async (platform, userAgent) => {
      vi.stubGlobal("navigator", { userAgent, maxTouchPoints: 0 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fixture)));
      await render();
      const cards = Array.from(
        container.querySelectorAll<HTMLElement>(".download-card"),
      );
      expect(cards.map((card) => card.dataset.position)).toEqual([
        "center",
        "left",
        "right",
      ]);
      expect(cards[0].dataset.platform).toBe(platform);
      expect(cards[0].dataset.current).toBe("true");
      expect(container.querySelectorAll('[data-current="true"]')).toHaveLength(
        1,
      );
      expect(
        container.querySelectorAll(".download-current-badge"),
      ).toHaveLength(1);
      expect(
        cards[0].querySelector(".download-current-badge")?.textContent,
      ).toBe(downloadCopy.en.current);
      expect(cards[0].querySelector("svg")?.getAttribute("width")).toBe("44");
      for (const card of cards.slice(1)) {
        expect(card.dataset.current).toBe("false");
        expect(card.querySelector("svg")?.getAttribute("width")).toBe("28");
      }
      const firstLink = container.querySelector(".download-options a");
      expect(firstLink?.closest("article")).toBe(cards[0]);
      expect(firstLink?.getAttribute("data-kind")).toBe("installer");
      expect(container.querySelectorAll(".download-options a")).toHaveLength(
        10,
      );
    },
  );
  it.each([
    ["Unknown", 0],
    ["Mozilla/5.0 (Linux; Android 15)", 5],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS)", 5],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5],
    ["Mozilla/5.0 (X11; CrOS x86_64)", 0],
  ])(
    "does not label a desktop download as the current system for %s",
    async (userAgent, maxTouchPoints) => {
      vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fixture)));
      await render();
      expect(
        container
          .querySelector(".download-grid")
          ?.getAttribute("data-has-current"),
      ).toBe("false");
      expect(
        container.querySelectorAll(
          '[data-current="true"], .download-current-badge',
        ),
      ).toHaveLength(0);
      expect(
        Array.from(
          container.querySelectorAll<HTMLElement>(".download-card"),
        ).map((card) => card.dataset.platform),
      ).toEqual(["windows", "macos", "linux"]);
      expect(container.querySelectorAll(".download-options a")).toHaveLength(
        10,
      );
    },
  );
  it("keeps installers as primary links and portable packages as secondary text links for every architecture", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fixture)));
    await render();
    const groups = container.querySelectorAll(".download-options > li");
    expect(groups).toHaveLength(5);
    for (const group of groups) {
      const links = group.querySelectorAll("a");
      expect(links[0].className).toBe("download-installer");
      expect(links[0].textContent).toContain(downloadCopy.en.downloadInstaller);
      expect(links[0].getAttribute("aria-label")).toContain(
        downloadCopy.en.downloadInstaller,
      );
      expect(links[1].className).toBe("download-portable");
      expect(links[1].textContent).toContain(downloadCopy.en.portable);
      expect(links[1].getAttribute("aria-label")).toContain(
        downloadCopy.en.portable,
      );
    }
    expect(
      Array.from(
        container.querySelectorAll<HTMLAnchorElement>(".download-options a"),
      )
        .map((link) => link.href)
        .sort(),
    ).toEqual(fixture.assets.map((asset) => asset.browser_download_url).sort());
  });
  it("keeps the featured system and download URLs stable when the language changes", async () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh", maxTouchPoints: 0 });
    const fetchMock = vi.fn().mockResolvedValue(response(fixture));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    const current = container.querySelector('[data-current="true"]');
    const linksBefore = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".download-options a"),
    ).map((link) => link.href);

    await act(async () =>
      root.render(<DownloadSection copy={downloadCopy["zh-CN"]} />),
    );

    expect(container.querySelector('[data-current="true"]')).toBe(current);
    expect(current?.getAttribute("data-platform")).toBe("macos");
    expect(current?.querySelector(".download-current-badge")?.textContent).toBe(
      downloadCopy["zh-CN"].current,
    );
    expect(
      current?.querySelector(".download-installer")?.textContent,
    ).toContain(downloadCopy["zh-CN"].downloadInstaller);
    expect(current?.querySelector(".download-portable")?.textContent).toContain(
      downloadCopy["zh-CN"].portable,
    );
    expect(
      Array.from(
        container.querySelectorAll<HTMLAnchorElement>(".download-options a"),
      ).map((link) => link.href),
    ).toEqual(linksBefore);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps a portable-only release secondary and does not invent an installer for the current system", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Windows NT 10.0",
      maxTouchPoints: 0,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ ...fixture, assets: [fixture.assets[1]] }),
        ),
    );
    await render();
    const current = container.querySelector('[data-current="true"]');
    expect(current?.querySelectorAll("a")).toHaveLength(1);
    expect(current?.querySelector(".download-installer")).toBeNull();
    expect(current?.querySelector("a")?.className).toBe("download-portable");
  });
  it("does not substitute another system's installer when the current system has no published package", async () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh", maxTouchPoints: 0 });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ ...fixture, assets: [fixture.assets[0]] }),
        ),
    );
    await render();
    const current = container.querySelector('[data-current="true"]');
    expect(current?.getAttribute("data-platform")).toBe("macos");
    expect(current?.querySelector("a")).toBeNull();
    expect(current?.textContent).toContain(downloadCopy.en.missing);
    expect(container.querySelectorAll(".download-options a")).toHaveLength(1);
  });
  it("never fabricates installer URLs before a first release exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 404)));
    await render();
    expect(container.textContent).toContain(downloadCopy.en.unpublished);
    expect(container.querySelectorAll(".download-options a")).toHaveLength(0);
    expect(container.querySelector(`a[href="${RELEASES_URL}"]`)).not.toBeNull();
  });
  it("reports missing platforms in a partial release without invented downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ ...fixture, assets: [fixture.assets[0]] }),
        ),
    );
    await render();
    expect(container.querySelectorAll(".download-options a")).toHaveLength(1);
    expect(container.querySelectorAll(".download-missing")).toHaveLength(2);
  });
  it("distinguishes API rate limiting from no release, and supports retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({}, 403))
        .mockResolvedValueOnce(response(fixture)),
    );
    await render();
    expect(container.textContent).toContain(downloadCopy.en.unavailable);
    expect(container.textContent).not.toContain(downloadCopy.en.unpublished);
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelectorAll(".download-options a")).toHaveLength(10);
    expect(container.querySelector("button")).toBeNull();
  });
  it("rejects malformed API responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ assets: "bad" })),
    );
    await render();
    expect(container.textContent).toContain(downloadCopy.en.unavailable);
  });
  it("times out instead of leaving an endless loading state", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    await render();
    expect(container.textContent).toContain(downloadCopy.en.loading);
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(container.textContent).toContain(downloadCopy.en.unavailable);
  });
  it("aborts network work when unmounted", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
  });
});
