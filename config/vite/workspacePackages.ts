import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Development reads workspace sources for HMR. Production and tests consume
 * the built package entry points, just like a separate application does. */
export const workspacePackageAliases = [
  "pdf-model",
  "pdf-core",
  "pdf-renderer",
].flatMap((name) => {
  const source = path.join(root, "packages", name, "src").replaceAll("\\", "/");
  return [
    { find: new RegExp(`^@legir/${name}/(.+)$`), replacement: `${source}/$1` },
    { find: `@legir/${name}`, replacement: `${source}/index.ts` },
  ];
});
