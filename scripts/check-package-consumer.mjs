import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "legir-package-consumer-"),
);
const consumer = path.join(temporary, "consumer");
fs.mkdirSync(consumer);
const dependencies = {};
const unpacked = [];
const releaseDirectory = process.argv[2]
  ? path.resolve(process.argv[2])
  : undefined;
const release = releaseDirectory
  ? JSON.parse(
      fs.readFileSync(
        path.join(releaseDirectory, "legir-libraries.json"),
        "utf8",
      ),
    )
  : undefined;
try {
  for (const name of ["pdfium", "pdf-model", "pdf-core", "pdf-renderer"]) {
    const filename = releaseDirectory
      ? path.join(
          releaseDirectory,
          release.packages.find((pkg) => pkg.name === `@legir/${name}`).file,
        )
      : path.join(temporary, `${name}.tgz`);
    if (!releaseDirectory)
      execFileSync(
        "bun",
        ["pm", "pack", "--ignore-scripts", "--filename", filename, "--quiet"],
        {
          cwd: path.join(root, "packages", name),
          stdio: "pipe",
          timeout: 120_000,
        },
      );
    if (releaseDirectory) {
      // Release URLs are intentionally unavailable until all checks pass. Test
      // the unchanged package bytes now; public URL installation is checked after publishing.
      const destination = path.join(temporary, name);
      fs.mkdirSync(destination);
      execFileSync("tar", [
        "-xzf",
        filename,
        "--strip-components=1",
        "-C",
        destination,
      ]);
      const metadata = JSON.parse(
        fs.readFileSync(path.join(destination, "package.json"), "utf8"),
      );
      for (const [dependency, range] of Object.entries(
        metadata.dependencies ?? {},
      )) {
        if (!dependency.startsWith("@legir/")) dependencies[dependency] = range;
      }
      unpacked.push({ name, destination });
    } else dependencies[`@legir/${name}`] = `file:${filename}`;
  }
  fs.writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies,
        overrides: dependencies,
      },
      null,
      2,
    ),
  );
  execFileSync("bun", ["install", "--ignore-scripts"], {
    cwd: consumer,
    stdio: "pipe",
    timeout: 120_000,
  });
  for (const { name, destination } of unpacked) {
    fs.cpSync(
      destination,
      path.join(consumer, "node_modules", "@legir", name),
      { recursive: true },
    );
  }
  fs.copyFileSync(
    path.join(root, "scripts/pdf-consumer-smoke.mjs"),
    path.join(consumer, "smoke.mjs"),
  );
  // The script lives outside the repository. Node cannot resolve its imports
  // via Legir's workspace links, source aliases, Vite or test configuration.
  execFileSync(process.execPath, ["smoke.mjs"], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 60_000,
  });
  console.log(
    "Packed-package consumer passed (plain Node, outside the repository).",
  );
  fs.rmSync(temporary, { recursive: true, force: true });
} catch (error) {
  console.error(`Consumer failure retained at ${temporary}`);
  if (error.stderr) console.error(String(error.stderr));
  throw error;
}
