const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { AppSettingsManager } = require("../out/managers/AppSettingsManager.js");
const { makeTempDir, silenceConsole } = require("./helpers.js");

async function managerFixture(t) {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-settings-");
  const manager = new AppSettingsManager();
  manager.configPath = path.join(directory, "nested", "config.json");
  return { directory, manager };
}

test("starts with privacy-safe defaults", async (t) => {
  const { manager } = await managerFixture(t);
  assert.deepEqual(manager.getSettings(), { baseUrl: "", sessionToken: null, csrfToken: null, password: null, username: null });
  assert.equal(manager.hasSavedCredentials(), false);
});

test("missing and malformed config files keep defaults", async (t) => {
  const { manager } = await managerFixture(t);
  await manager.loadSettings();
  assert.equal(manager.getSetting("baseUrl"), "");
  await fs.mkdir(path.dirname(manager.configPath), { recursive: true });
  await fs.writeFile(manager.configPath, "{broken");
  await manager.loadSettings();
  assert.equal(manager.getSetting("baseUrl"), "");
});

test("loads persisted URL, tokens and emulator paths", async (t) => {
  const { manager } = await managerFixture(t);
  await fs.mkdir(path.dirname(manager.configPath), { recursive: true });
  await fs.writeFile(manager.configPath, JSON.stringify({ baseUrl: "https://romm.test", sessionToken: "session", csrfToken: "csrf", emulators: [{ name: "ppsspp", path: "/bin/ppsspp" }] }));
  await manager.loadSettings();
  assert.equal(manager.getSetting("baseUrl"), "https://romm.test");
  assert.equal(manager.getSetting("sessionToken"), "session");
  assert.deepEqual(manager.getSetting("emulators"), [{ name: "ppsspp", path: "/bin/ppsspp" }]);
});

test("legacy credentials are erased during migration", async (t) => {
  const { manager } = await managerFixture(t);
  await fs.mkdir(path.dirname(manager.configPath), { recursive: true });
  await fs.writeFile(manager.configPath, JSON.stringify({ baseUrl: "https://romm.test", username: "admin", password: "secret" }));
  await manager.loadSettings();
  assert.equal(manager.getSetting("username"), null);
  assert.equal(manager.getSetting("password"), null);
  const persisted = JSON.parse(await fs.readFile(manager.configPath, "utf8"));
  assert.equal("username" in persisted, false);
  assert.equal("password" in persisted, false);
});

test("saveSettings creates directories and excludes credentials", async (t) => {
  const { manager } = await managerFixture(t);
  manager.updateSettings({ baseUrl: "https://romm.test/", sessionToken: "token", csrfToken: "csrf", username: "legacy", password: "never", emulators: [{ name: "dolphin", path: "/bin/dolphin" }] });
  await manager.saveSettings();
  assert.deepEqual(JSON.parse(await fs.readFile(manager.configPath, "utf8")), {
    baseUrl: "https://romm.test/",
    sessionToken: "token",
    csrfToken: "csrf",
    emulators: [{ name: "dolphin", path: "/bin/dolphin" }],
  });
});

test("empty optional settings are omitted from disk", async (t) => {
  const { manager } = await managerFixture(t);
  manager.updateSettings({ baseUrl: "", sessionToken: "", csrfToken: null, emulators: [] });
  await manager.saveSettings();
  assert.deepEqual(JSON.parse(await fs.readFile(manager.configPath, "utf8")), { baseUrl: "" });
});

test("updateSettings, setSetting and getSetting update memory", async (t) => {
  const { manager } = await managerFixture(t);
  manager.updateSettings({ baseUrl: "https://one", sessionToken: "a" });
  manager.setSetting("baseUrl", "https://two");
  assert.equal(manager.getSetting("baseUrl"), "https://two");
  assert.equal(manager.getSetting("sessionToken"), "a");
});

test("resetSettings removes tokens and emulator configuration", async (t) => {
  const { manager } = await managerFixture(t);
  manager.updateSettings({ baseUrl: "https://romm", sessionToken: "x", emulators: [{ name: "ppsspp", path: "x" }] });
  manager.resetSettings();
  assert.deepEqual(manager.getSettings(), { baseUrl: "", sessionToken: null, csrfToken: null, password: null, username: null });
});
