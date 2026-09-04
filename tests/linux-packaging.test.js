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

test("Linux packaging includes desktop integration metadata", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(packageJson.desktopName, "fr.chaun14.rommclient.desktop");
  assert.equal(packageJson.build.linux.executableName, "romm-client");
  assert.equal(packageJson.build.linux.category, "Game");
  assert.equal(packageJson.build.linux.syncDesktopName, true);
  assert.match(packageJson.build.linux.icon, /icon\.png$/);
});

test("GitHub publishing and Linux release jobs remain configured", () => {
  const root = path.join(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.deepEqual(packageJson.build.publish, { provider: "github", owner: "chaun14", repo: "romm-client" });
  assert.match(packageJson.scripts["publish:linux"], /electron-builder --linux --publish always/);
  assert.match(workflow, /os: ubuntu-latest/);
  assert.match(workflow, /publish_script: publish:linux/);
  assert.match(workflow, /run: npm test/);
});

test("pushes and pull requests run tests on Windows and Linux", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "test.yml"), "utf8");
  assert.match(workflow, /^\s*push:/m);
  assert.match(workflow, /^\s*pull_request:/m);
  assert.match(workflow, /os: windows-latest/);
  assert.match(workflow, /os: ubuntu-latest/);
  assert.match(workflow, /node-version: "24"/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run build/);
});
