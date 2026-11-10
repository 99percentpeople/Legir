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
const example = path.join(root, "examples/pdf-browser");
const exampleMetadata = JSON.parse(
  fs.readFileSync(path.join(example, "package.json"), "utf8"),
);
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
      // Internal npm versions may not exist yet. Test the unchanged tarball
      // contents locally without resolving unpublished @legir dependencies.
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
        devDependencies: exampleMetadata.devDependencies,
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
  // The same standalone example ships in the repository and is built using
  // ONLY the tarballs installed above, with no source aliases or workspace links.
  fs.cpSync(example, consumer, {
    recursive: true,
    filter: (file) =>
      !["node_modules", "dist", "public"].includes(path.basename(file)) &&
      path.basename(file) !== "package.json",
  });
  execFileSync(process.execPath, ["prepare-assets.mjs"], {
    cwd: consumer,
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    { cwd: consumer, stdio: "inherit", timeout: 60_000 },
  );
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 120_000,
  });
  console.log(
    "Packed-package browser example typecheck/build passed (no Legir aliases).",
  );
  if (process.env.LEGIR_BROWSER_BIN) {
    execFileSync(
      process.execPath,
      [
        path.join(root, "scripts/browser-consumer-smoke.mjs"),
        path.join(consumer, "dist"),
        path.join(root, "tests/fixtures/pdf/classic-form.pdf"),
      ],
      { stdio: "inherit", timeout: 120_000 },
    );
  }
  fs.rmSync(temporary, { recursive: true, force: true });
} catch (error) {
  console.error(`Consumer failure retained at ${temporary}`);
  if (error.stderr) console.error(String(error.stderr));
  throw error;
}
