// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const packagePath = "packages/pdfium";
let temporary: string;
let checkout: string;

const verify = () =>
  spawnSync(
    process.execPath,
    [join(checkout, packagePath, "scripts/verify-artifacts.mjs")],
    { cwd: checkout, encoding: "utf8" },
  );

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "legir-pdfium-checkout-"));
  checkout = join(temporary, "checkout");
  const attributes = join(temporary, "global-attributes");
  await writeFile(attributes, "");
  await mkdir(checkout);
  const provenance = JSON.parse(
    await readFile(join(root, packagePath, "wasm/provenance.json"), "utf8"),
  );
  const files = new Set([
    ".gitattributes",
    ...[
      "wasm/provenance.json",
      "native/versions.json",
      "scripts/verify-artifacts.mjs",
      "scripts/patch_source.py",
      "scripts/build.py",
      ...Object.keys(provenance.sha256).map((file) => `wasm/${file}`),
      ...Object.keys(provenance.sourceSha256),
    ].map((file) => `${packagePath}/${file}`),
  ]);
  for (const file of files) {
    const target = join(checkout, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, file), target);
  }
  await writeFile(join(checkout, "control.txt"), "ordinary text\n");
  const git = (...args: string[]) => {
    const result = spawnSync(
      "git",
      ["-c", `core.attributesFile=${attributes}`, ...args],
      {
        cwd: checkout,
        encoding: "utf8",
        env: { ...process.env, GIT_ATTR_NOSYSTEM: "1" },
      },
    );
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  };
  git("init", "--quiet");
  git("-c", "core.autocrlf=false", "add", "--all");
  // Remove the staged files so checkout cannot keep the existing LF worktree.
  for (const file of [...files, "control.txt"]) await rm(join(checkout, file));
  // Exercise Git's checkout filters, including a control that must become CRLF.
  // Merely normalizing strings before hashing would not protect the checkout.
  git("-c", "core.autocrlf=true", "checkout-index", "--force", "--all");
}, 30_000);

afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

it("preserves pinned artifact and source bytes in an autocrlf checkout", async () => {
  expect(await readFile(join(checkout, "control.txt"), "utf8")).toBe(
    "ordinary text\r\n",
  );
  const result = verify();
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
});

it.each(["wasm/pdfium.js", "wasm/pdfium.wasm", "native/bridge.cpp"])(
  "still rejects changed bytes in %s",
  async (file) => {
    const path = join(checkout, packagePath, file);
    const original = await readFile(path);
    const changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1;
    try {
      await writeFile(path, changed);
      const result = verify();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(file.replace(/^wasm\//, ""));
    } finally {
      await writeFile(path, original);
    }
  },
);
