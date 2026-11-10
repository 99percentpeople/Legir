// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishNpmLibraries } from "../scripts/publish-npm-libraries.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

// Synthetic registry versions, independent of every workspace package version.
// Never update these fixtures when publishing a new release.
const fixtureVersion = "1.2.3";
const names = ["pdf-model", "pdfium", "pdf-core", "pdf-renderer"];
let directory: string;
const fetchMock = vi.fn<typeof fetch>();

function release(version = fixtureVersion, tagged = true) {
  const packages = names.map((name) => {
    const file = `legir-${name}-${version}.tgz`;
    const bytes = Buffer.from(`${name}@${version}`);
    writeFileSync(path.join(directory, file), bytes);
    return {
      name: `@legir/${name}`,
      version,
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  writeFileSync(
    path.join(directory, "legir-libraries.json"),
    JSON.stringify({
      format: 2,
      tag: tagged ? `pdf-libs-v${version}` : null,
      version,
      packages,
    }),
  );
  return packages;
}

function integrity(file: string) {
  return `sha512-${createHash("sha512")
    .update(readFileSync(path.join(directory, file)))
    .digest("base64")}`;
}

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "legir-publish-test-"));
  release();
  vi.mocked(execFileSync).mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response("Not Found", { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

describe("npm publish preflight", () => {
  it("checks every package before publishing in dependency order", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
      return Buffer.alloc(0);
    });
    await publishNpmLibraries(directory);
    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls).toHaveLength(4);
    for (const [index, name] of names.entries()) {
      expect(calls[index][1]).toEqual([
        "publish",
        path.join(directory, `legir-${name}-${fixtureVersion}.tgz`),
        "--access",
        "public",
        "--registry",
        "https://registry.npmjs.org",
      ]);
    }
  });

  it("publishes a manually packed release without a Git tag", async () => {
    release(fixtureVersion, false);
    await publishNpmLibraries(directory);
    expect(execFileSync).toHaveBeenCalledTimes(4);
  });

  it("supports existing tagged manifests without an explicit version field", async () => {
    const file = path.join(directory, "legir-libraries.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    delete manifest.version;
    writeFileSync(file, JSON.stringify(manifest));
    await publishNpmLibraries(directory);
    expect(execFileSync).toHaveBeenCalledTimes(4);
  });

  it.each([
    { tag: null, version: "1.2.3-beta.1" },
    { tag: `pdf-libs-v${fixtureVersion}`, version: "9.9.9" },
    { tag: "v1.2.3", version: fixtureVersion },
    { tag: null, version: undefined },
  ])(
    "rejects inconsistent or non-stable release identity: %j",
    async (identity) => {
      const file = path.join(directory, "legir-libraries.json");
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      writeFileSync(file, JSON.stringify({ ...manifest, ...identity }));
      await expect(publishNpmLibraries(directory)).rejects.toThrow(
        "stable release version",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(execFileSync).not.toHaveBeenCalled();
    },
  );

  it("does not publish in check-only mode", async () => {
    await publishNpmLibraries(directory, { checkOnly: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("resumes a partial release without republishing identical tarballs", async () => {
    const [first] = release();
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("pdf-model")
        ? Response.json({
            versions: {
              [fixtureVersion]: { dist: { integrity: integrity(first.file) } },
            },
          })
        : new Response("Not Found", { status: 404 }),
    );
    await publishNpmLibraries(directory);
    expect(execFileSync).toHaveBeenCalledTimes(3);
    expect(vi.mocked(execFileSync).mock.calls[0][1]?.[1]).toContain("pdfium");
  });

  it("fails before any publication when a later package has different published bytes", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("pdf-renderer")
        ? Response.json({
            versions: {
              [fixtureVersion]: { dist: { integrity: "sha512-different" } },
            },
          })
        : new Response("Not Found", { status: 404 }),
    );
    await expect(publishNpmLibraries(directory)).rejects.toThrow(
      "different bytes",
    );
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("rejects a checksum failure on the last tarball before publishing anything", async () => {
    appendFileSync(
      path.join(directory, `legir-pdf-renderer-${fixtureVersion}.tgz`),
      "changed",
    );
    await expect(publishNpmLibraries(directory)).rejects.toThrow(
      "does not match",
    );
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("refuses an older release even if only the last package has a newer latest", async () => {
    fetchMock.mockImplementation(async (url) =>
      Response.json({
        "dist-tags": {
          latest: String(url).includes("pdf-renderer") ? "2.0.0" : "1.0.0",
        },
      }),
    );
    await expect(publishNpmLibraries(directory)).rejects.toThrow(
      "latest is 2.0.0",
    );
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each(["0.9.0", "0.10.0-rc.1", "0.10.0+build.1"])(
    "allows stable 0.10.0 when latest is %s",
    async (latest) => {
      release("0.10.0");
      fetchMock.mockImplementation(async () =>
        Response.json({ "dist-tags": { latest } }),
      );
      await publishNpmLibraries(directory);
      expect(execFileSync).toHaveBeenCalledTimes(4);
    },
  );

  it("treats a completed older release as a no-op without changing latest", async () => {
    const packages = release();
    fetchMock.mockImplementation(async (url) => {
      const pkg = packages.find((item) =>
        String(url).endsWith(item.name.replace("/", "%2f")),
      )!;
      return Response.json({
        "dist-tags": { latest: "2.0.0" },
        versions: {
          [fixtureVersion]: { dist: { integrity: integrity(pkg.file) } },
        },
      });
    });
    await publishNpmLibraries(directory);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("does not treat registry errors as a missing package", async () => {
    fetchMock.mockImplementation(
      async () => new Response("Unavailable", { status: 503 }),
    );
    await expect(publishNpmLibraries(directory)).rejects.toThrow("503");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("stops after a publish failure and leaves remaining packages for retry", async () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error("publish failed");
    });
    await expect(publishNpmLibraries(directory)).rejects.toThrow(
      "publish failed",
    );
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });
});
