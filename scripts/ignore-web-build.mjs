// Only the development project builds branch pushes. Stable deployments come
// from the tag workflow via `vercel build` + `deploy --prebuilt`.
const latest = process.env.LEGIR_WEB_CHANNEL === "latest";
const main = process.env.VERCEL_GIT_COMMIT_REF === "main";
console.log(
  latest && main
    ? "Building latest Web App."
    : "Skipping automatic build; stable Web App requires a version tag.",
);
process.exitCode = latest && main ? 1 : 0;
