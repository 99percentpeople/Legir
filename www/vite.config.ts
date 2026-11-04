import path from "path";
import { readFileSync } from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { workspacePackageAliases } from "../config/vite/workspacePackages";

const workspaceRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  readFileSync(path.resolve(workspaceRoot, "package.json"), "utf-8"),
);

export default defineConfig(({ command }) => ({
  root: __dirname,
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
    alias: [
      ...(command === "serve" ? workspacePackageAliases : []),
      { find: "@", replacement: path.resolve(workspaceRoot, "src") },
    ],
  },
  envPrefix: ["VITE_"],
}));
