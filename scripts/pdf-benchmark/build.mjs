/* global process, console, URL */
import { build } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { profilePlugin } from "./profile-plugin.mjs";
const [checkout, output] = process.argv.slice(2);
if (!checkout || !output)
  throw new Error("Usage: node build.mjs CHECKOUT OUTPUT");
process.chdir(checkout);
await build({
  configFile: resolve(checkout, "vite.config.ts"),
  root: checkout,
  worker: {
    plugins: () => (process.env.PDF_BENCH_PROFILE ? [profilePlugin()] : []),
  },
  build: {
    outDir: output,
    emptyOutDir: true,
    rollupOptions: {
      input: new URL("./entry.ts", import.meta.url).pathname,
      output: { entryFileNames: "benchmark.js" },
    },
  },
});
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, "benchmark.html"),
  '<!doctype html><title>PDF benchmark</title><script type="module" src="/benchmark.js"></script>',
);
console.log(output);
