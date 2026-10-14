/* global process, console */
// Full content/stream syntax audit, separate from per-file structure/raster checks.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
const exec = promisify(execFile);
const [manifestPath, recordsPath, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    "Usage: node content-syntax.mjs MANIFEST RESULTS_JSON OUTPUT",
  );
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const records = JSON.parse(await readFile(recordsPath, "utf8"));
await mkdir(output, { recursive: true });
const tasks = manifest.fixtures.map((f) => ({
  id: `source-${f.id}`,
  fixture: f.id,
  file: f.path,
  mode: "source",
}));
for (const record of records.filter(
  (r) => r.variant === "after" && r.round === 0,
)) {
  for (const mode of ["export", "merged"])
    tasks.push({
      id: `${record.fixture}-${mode}`,
      fixture: record.fixture,
      donor: record.donor,
      mode,
      file: record.phases[`${mode}Download`].file,
    });
}
const program = `import pikepdf,sys,json,time
start=time.monotonic()
job=pikepdf.Job({'inputFile':sys.argv[1],'check':''})
error=None
try: job.run()
except Exception as e: error=str(e)
print(json.dumps(dict(qpdf=pikepdf.__libqpdf_version__,pikepdf=pikepdf.__version__,exitCode=job.exit_code,error=error,hasWarnings=job.has_warnings,seconds=time.monotonic()-start)))
`;
let next = 0;
const results = [];
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      console.log(`Checking ${task.id}`);
      const { stdout, stderr } = await exec(
        process.env.PDF_BENCH_PYTHON ?? "python3",
        ["-c", program, task.file],
        { maxBuffer: 16 * 1024 * 1024, timeout: 300000 },
      );
      await writeFile(join(output, `${task.id}.log`), stdout + stderr);
      const result = {
        ...task,
        ...JSON.parse(stdout.trim().split("\n").at(-1)),
        warningCategories: {},
      };
      // Keep exact logs as well as normalized categories. qpdf reports relocated
      // byte offsets in rewritten files; those offsets are not warning identities.
      for (const message of stderr.matchAll(/WARNING:\s*\n?([^\n]+)/g)) {
        const category = message[1]
          .replace(/^.*?\(offset \d+\):\s*/, "")
          .replace(/^.*?\(object \d+ \d+[^)]*\):\s*/, "");
        result.warningCategories[category] =
          (result.warningCategories[category] ?? 0) + 1;
      }
      results.push(result);
    }
  }),
);
for (const result of results) {
  const expected = {};
  for (const source of results.filter(
    (r) =>
      r.mode === "source" &&
      (r.fixture === result.fixture ||
        (result.mode === "merged" && r.fixture === result.donor)),
  )) {
    for (const [category, count] of Object.entries(source.warningCategories))
      expected[category] = (expected[category] ?? 0) + count;
  }
  result.sourceWarningCategories = expected;
  result.noAdditionalWarningCategoriesOrCounts = Object.entries(
    result.warningCategories,
  ).every(([category, count]) => count <= (expected[category] ?? 0));
  result.ok =
    !result.error &&
    [0, 3].includes(result.exitCode) &&
    result.noAdditionalWarningCategoriesOrCounts;
}
await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
console.log(
  JSON.stringify({
    files: results.length,
    passed: results.filter((r) => r.ok).length,
    warningsPresent: results.some((r) => r.hasWarnings),
  }),
);
if (results.some((r) => !r.ok)) process.exitCode = 1;
