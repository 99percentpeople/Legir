import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** HMR follows the same explicit public export map as production. Aliases must
 * not make unexported implementation paths available only in development. */
export const workspacePackageAliases = [
  "pdf-model",
  "pdf-core",
  "pdf-renderer",
].flatMap((name) => {
  const base = path.join(root, "packages", name);
  const manifest = JSON.parse(
    readFileSync(path.join(base, "package.json"), "utf8"),
  ) as {
    name: string;
    exports: Record<string, { import: string }>;
  };
  return Object.entries(manifest.exports).map(([subpath, entry]) => {
    const specifier = manifest.name + (subpath === "." ? "" : subpath.slice(1));
    const source = entry.import
      .replace(/^\.\/dist\//, "src/")
      .replace(/\.js$/, ".ts");
    return {
      find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      replacement: path.join(base, source).replaceAll("\\", "/"),
    };
  });
});
