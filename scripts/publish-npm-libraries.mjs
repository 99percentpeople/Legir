import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const order = ["pdf-model", "pdfium", "pdf-core", "pdf-renderer"];
const registry = "https://registry.npmjs.org";

// Candidates are stable releases. For an existing prerelease latest, comparing
// its core version suffices: X.Y.Z is newer than any X.Y.Z-prerelease.
function isOlderThanLatest(version, latest) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(latest);
  if (!match) throw new Error(`Invalid npm latest version: ${latest}`);
  const candidate = version.split(".").map(Number);
  const current = match.slice(1, 4).map(Number);
  for (let index = 0; index < 3; index++) {
    if (candidate[index] !== current[index])
      return candidate[index] < current[index];
  }
  return false;
}

export async function publishNpmLibraries(
  directory,
  { checkOnly = false } = {},
) {
  directory = path.resolve(directory);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "legir-libraries.json"), "utf8"),
  );
  const taggedVersion = /^pdf-libs-v(\d+\.\d+\.\d+)$/.exec(manifest.tag)?.[1];
  const version = manifest.version ?? taggedVersion;
  if (
    manifest.format !== 2 ||
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    (manifest.tag !== null && taggedVersion !== version)
  )
    throw new Error(
      "Expected an npm library manifest with a stable release version",
    );

  const pending = [];
  // Preflight ALL packages before publishing any: checksum failures, version
  // conflicts and older releases must not leave a partially published set.
  for (const name of order) {
    const pkg = manifest.packages?.find(
      (item) => item.name === `@legir/${name}`,
    );
    if (!pkg || pkg.version !== version)
      throw new Error(`Missing or mismatched @legir/${name} in the manifest`);
    const file = path.join(directory, pkg.file);
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") !== pkg.sha256)
      throw new Error(`${pkg.file} does not match the release manifest`);

    const response = await fetch(
      `${registry}/${pkg.name.replace("/", "%2f")}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok && response.status !== 404)
      throw new Error(
        `Registry lookup for ${pkg.name} failed with ${response.status}`,
      );
    const metadata = response.status === 404 ? {} : await response.json();
    const existing = metadata.versions?.[version];
    if (existing) {
      const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
      if (existing.dist?.integrity !== integrity)
        throw new Error(
          `${pkg.name}@${version} already exists with different bytes; publish a new version`,
        );
      console.log(`Skipping ${pkg.name}@${version}; already published`);
      continue;
    }
    const latest = metadata["dist-tags"]?.latest;
    if (latest && isOlderThanLatest(version, latest))
      throw new Error(
        `Refusing to publish ${pkg.name}@${version}: latest is ${latest}; use a newer version`,
      );
    pending.push({ ...pkg, file });
  }

  for (const pkg of pending) {
    if (checkOnly) {
      console.log(`Would publish ${pkg.name}@${version}`);
      continue;
    }
    console.log(`Publishing ${pkg.name}@${version}`);
    execFileSync(
      "npm",
      ["publish", pkg.file, "--access", "public", "--registry", registry],
      { stdio: "inherit" },
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  await publishNpmLibraries(
    args.find((arg) => !arg.startsWith("--")) ?? "release-assets",
    { checkOnly: args.includes("--check") },
  );
}
