/* global console, process, URL */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const hash = (file) =>
  createHash("sha256")
    .update(readFileSync(new URL(file, root)))
    .digest("hex");
try {
  const build = JSON.parse(
    readFileSync(new URL("wasm/provenance.json", root), "utf8"),
  );
  const pins = JSON.parse(
    readFileSync(new URL("native/versions.json", root), "utf8"),
  );
  for (const [key, value] of Object.entries(pins))
    if (build[key] !== value) throw new Error(`Revision mismatch: ${key}`);
  for (const [file, expected] of Object.entries(build.sha256))
    if (hash(`wasm/${file}`) !== expected)
      throw new Error(`Artifact mismatch: ${file}`);
  for (const [file, expected] of Object.entries(build.sourceSha256))
    if (hash(file) !== expected)
      throw new Error(`Native source changed: ${file}`);
  if (
    hash("scripts/patch_source.py") !== build.patchSha256 ||
    hash("scripts/build.py") !== build.buildScriptSha256
  )
    throw new Error("Native build scripts changed");
} catch (error) {
  console.error(
    `${error.message}. Run bun run build:native:pdfium to rebuild the pinned WASM artifacts.`,
  );
  process.exit(1);
}
