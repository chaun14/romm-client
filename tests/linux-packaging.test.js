const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Linux AppImage keeps a stable filename for in-place updates", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

  assert.equal(packageJson.build.linux.target, "AppImage");
  assert.equal(packageJson.build.linux.artifactName, "RomMClient-${arch}.${ext}");
  assert.doesNotMatch(packageJson.build.linux.artifactName, /\$\{version\}/);
});
