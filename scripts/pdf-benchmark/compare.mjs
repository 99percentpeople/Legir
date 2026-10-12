/* global process, console, URL */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [before, after, fixtures, output, rounds = "3"] = process.argv.slice(2);
if (!before || !after || !fixtures || !output)
  throw new Error(
    "Usage: node compare.mjs BEFORE_BUILD AFTER_BUILD FIXTURES OUTPUT [ROUNDS]",
  );
const results = { before: [], after: [] },
  order = [];
await mkdir(output, { recursive: true });
for (let round = 0; round < Number(rounds); round++) {
  for (const variant of round % 2 ? ["after", "before"] : ["before", "after"]) {
    const destination = join(output, variant, `round-${round}`);
    console.log(`Round ${round + 1}: ${variant}`);
    order.push({ round, variant });
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          new URL("./run.mjs", import.meta.url).pathname,
          variant === "before" ? before : after,
          fixtures,
          destination,
          "1",
        ],
        { stdio: "inherit", env: process.env },
      );
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`Benchmark exited ${code}`)),
      );
    });
    const samples = JSON.parse(
      await readFile(join(destination, "results.json"), "utf8"),
    );
    results[variant].push(...samples.map((sample) => ({ ...sample, round })));
    await writeFile(
      join(output, `${variant}.json`),
      JSON.stringify(results[variant], null, 2),
    );
  }
}
for (const previous of results.before) {
  const next = results.after.find(
    (sample) =>
      sample.fixture === previous.fixture && sample.round === previous.round,
  );
  for (const phase of ["firstRender", "warmRender", "lastRender"])
    for (const key of ["hash", "width", "height"])
      if (previous.phases[phase][key] !== next.phases[phase][key])
        throw new Error(`${previous.fixture}: ${phase} ${key} differs`);
  for (const phase of ["exportValidation", "mergeValidation"]) {
    const normalize = (value) => ({
      ...value,
      fields: [...value.fields].sort((a, b) => a.name.localeCompare(b.name)),
    });
    if (
      JSON.stringify(normalize(previous[phase])) !==
      JSON.stringify(normalize(next[phase]))
    )
      throw new Error(`${previous.fixture}: ${phase} differs`);
  }
}
await writeFile(
  join(output, "comparison.json"),
  JSON.stringify(
    {
      before,
      after,
      fixtures,
      rounds: Number(rounds),
      order,
      originalRenderPixelsIdentical: true,
      reopenedPageAndFieldValuesIdentical: true,
    },
    null,
    2,
  ),
);
console.log(
  "Original render pixels and independently reopened page/field values match in every sample.",
);
