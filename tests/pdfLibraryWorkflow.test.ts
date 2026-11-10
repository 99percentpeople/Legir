// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("publishes library tags with npm OIDC and matching source provenance, not stored credentials or GitHub Releases", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/pdf-libraries-release.yml", import.meta.url),
    "utf8",
  );
  expect(workflow).toContain('tags: ["pdf-libs-v*"]');
  expect(workflow).toMatch(/contents:\s*read/);
  expect(workflow).toMatch(/id-token:\s*write/);
  expect(workflow).toContain("runs-on: ubuntu-");
  const nodeMajor = Number(/node-version:\s*["']?(\d+)/.exec(workflow)?.[1]);
  expect(nodeMajor).toBeGreaterThanOrEqual(24);
  expect(workflow).toContain("$(git -C source rev-parse HEAD)");
  expect(workflow).toContain('"$GITHUB_SHA"');
  expect(workflow).toContain('NPM_CONFIG_PROVENANCE: "true"');
  expect(workflow).toContain("$ACTIONS_ID_TOKEN_REQUEST_URL");
  expect(workflow).toContain("$ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  expect(workflow).toContain(
    "node tooling/scripts/publish-npm-libraries.mjs release-assets",
  );
  expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
  expect(workflow).not.toMatch(
    /gh release|action-gh-release|contents:\s*write/,
  );
});
