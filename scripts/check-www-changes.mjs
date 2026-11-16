import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
export const websiteBuildInputs = JSON.parse(
  readFileSync(
    new URL("../config/www-build-inputs.json", import.meta.url),
    "utf8",
  ),
);

export function isWebsiteInput(file) {
  return websiteBuildInputs.some((input) =>
    input.endsWith("/") ? file.startsWith(input) : file === input,
  );
}

// Runs before dependency installation, both in Vercel and Actions. Missing
// history must build, never silently leave a stale website in production.
export function websiteChanged(base, head = "HEAD", cwd = root) {
  if (!base || /^0+$/.test(base)) return true;
  const compare = () => {
    const files = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", base, head, "--"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).split("\0");
    return files.some(isWebsiteInput);
  };
  try {
    return compare();
  } catch {
    // Vercel may use a shallow checkout. The last website deployment can be
    // older than many app-only pushes; fetch that exact commit before giving up.
    if (!/^[a-f\d]{40}$/i.test(base)) return true;
    try {
      execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", base], {
        cwd,
        timeout: 10_000,
        stdio: "pipe",
      });
      return compare();
    } catch {
      return true;
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const vercel = process.argv.includes("--vercel");
  const changed = websiteChanged(
    vercel ? process.env.VERCEL_GIT_PREVIOUS_SHA : process.env.BASE_SHA,
    vercel
      ? process.env.VERCEL_GIT_COMMIT_SHA || "HEAD"
      : process.env.HEAD_SHA || "HEAD",
  );
  if (vercel) {
    console.log(
      changed
        ? "Website inputs changed; building."
        : "Website inputs unchanged; skipping.",
    );
    // Vercel's ignored-build exit codes are inverted: 0 skips, 1 builds.
    process.exitCode = changed ? 1 : 0;
  } else {
    console.log(String(changed));
  }
}
