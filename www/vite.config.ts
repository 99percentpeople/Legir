import path from "path";
import { readFileSync } from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { workspacePackageAliases } from "../config/vite/workspacePackages.ts";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(path.resolve(workspaceRoot, "package.json"), "utf-8"),
);
const sitePackageJson = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf-8"),
);

export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  envDir: workspaceRoot,
  publicDir: path.resolve(workspaceRoot, "public"),
  server: {
    port: 5174,
    fs: {
      allow: [workspaceRoot],
    },
  },
  plugins: [react(), tailwindcss()],
  define: {
    "process.env.APP_NAME": JSON.stringify(packageJson.displayName),
  },
  resolve: {
    // Shared src/ components use the site's dependency versions, including React.
    dedupe: Object.keys(sitePackageJson.dependencies),
    alias: [
      ...(command === "serve" ? workspacePackageAliases : []),
      { find: "@", replacement: path.resolve(workspaceRoot, "src") },
    ],
  },
  envPrefix: ["VITE_"],
}));
