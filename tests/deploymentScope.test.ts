// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  isWebsiteInput,
  websiteChanged,
} from "../scripts/check-www-changes.mjs";

const temporary: string[] = [];
afterEach(() => {
  temporary
    .splice(0)
    .forEach((directory) =>
      rmSync(directory, { recursive: true, force: true }),
    );
});

it("skips application-only changes but compares the entire range since the last website deployment", () => {
  const root = mkdtempSync(join(tmpdir(), "legir-deploy-"));
  temporary.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = (file: string, content: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    );
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  const base = commit("www/src/App.tsx", "initial");
  const app = commit("src/services/pdfService/index.ts", "app-only");
  expect(websiteChanged(base, app, root)).toBe(false);
  const shallow = mkdtempSync(join(tmpdir(), "legir-deploy-shallow-"));
  temporary.push(shallow);
  execFileSync("git", [
    "clone",
    "--quiet",
    "--depth=1",
    `file://${root}`,
    shallow,
  ]);
  // A shallow Vercel checkout must fetch the last successful website commit,
  // otherwise every sufficiently long sequence of app-only pushes rebuilds it.
  expect(websiteChanged(base, app, shallow)).toBe(false);
  const shared = commit("src/components/ui/button.tsx", "shared");
  const last = commit("src-tauri/src/lib.rs", "native-only");
  expect(websiteChanged(base, last, root)).toBe(true);
  expect(websiteChanged(shared, last, root)).toBe(false);
  git("mv", "src/components/ui/button.tsx", "src/moved.tsx");
  const renamed = commit("README.md", "docs");
  expect(websiteChanged(last, renamed, root)).toBe(true);
  expect(websiteChanged(undefined, last, root)).toBe(true);
  expect(websiteChanged("0".repeat(40), last, root)).toBe(true);
  expect(websiteChanged("missing-history", last, root)).toBe(true);
});

it.each([
  ["www/src/App.tsx", true],
  ["public/logo.svg", true],
  ["src/locales/en.ts", true],
  ["src/globals.css", true],
  ["packages/pdf-model/src/index.ts", true],
  ["bun.lock", true],
  ["packages/pdfium/src/index.ts", false],
  ["src/pages/Editor.tsx", false],
  ["src/services/pdfService/index.ts", false],
  ["src-tauri/Cargo.lock", false],
  ["www/README.md", false],
  ["docs/DEPLOYMENT.md", false],
])("classifies %s", (file, expected) => {
  expect(isWebsiteInput(file)).toBe(expected);
});

it.each([
  ["latest", "main", 1],
  ["latest", "feature/example", 0],
  ["stable", "main", 0],
  ["", "main", 0],
  ["stable", "v0.2.0", 0],
])(
  "only auto-builds the latest project's main branch (%s, %s)",
  (channel, branch, status) => {
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, "../scripts/ignore-web-build.mjs")],
      {
        env: {
          ...process.env,
          LEGIR_WEB_CHANNEL: channel,
          VERCEL_GIT_COMMIT_REF: branch,
        },
      },
    );
    expect(result.status).toBe(status);
  },
);
