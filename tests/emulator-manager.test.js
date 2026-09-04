const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { EmulatorManager } = require("../out/managers/EmulatorManager.js");
const { makeTempDir, silenceConsole } = require("./helpers.js");

async function fixture(t, emulators = []) {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-emulator-manager-");
  let saveCount = 0;
  let lastUpdate = null;
  const client = {
    settings: { emulators: [...emulators] },
    appSettingsManager: {
      updateSettings(value) {
        lastUpdate = value;
      },
      async saveSettings() {
        saveCount++;
      },
    },
    saveManager: {},
    rommApi: { marker: "api" },
    getEmulatorConfigsFolder: () => path.join(directory, "configs"),
  };
  return { client, directory, manager: new EmulatorManager(client), getSaveCount: () => saveCount, getLastUpdate: () => lastUpdate };
}

async function executable(directory, name = "emulator") {
  const file = path.join(directory, name);
  await fs.writeFile(file, "#!/bin/sh\nexit 0\n");
  await fs.chmod(file, 0o755);
  return file;
}

test("supported emulator specs are serializable and complete", async (t) => {
  const { manager } = await fixture(t);
  const specs = manager.getSupportedEmulators();
  assert.deepEqual(Object.keys(specs).sort(), ["azahar", "dolphin", "pcsx2", "ppsspp", "rommIntegrated"]);
  assert.equal(specs.ppsspp.name, "PPSSPP");
  assert.ok(specs.dolphin.platforms.includes("ngc"));
  assert.equal(specs.rommIntegrated.supportsSaves, false);
  assert.equal("class" in specs.ppsspp, false);
});

test("configurations merge saved paths and always enable integrated emulation", async (t) => {
  const { manager } = await fixture(t, [{ name: "ppsspp", path: "/custom/ppsspp" }, { name: "unknown", path: "/ignored" }]);
  const configs = manager.getConfigurations();
  assert.equal(configs.ppsspp.path, "/custom/ppsspp");
  assert.equal(configs.dolphin.path, "");
  assert.equal(configs.rommIntegrated.path, "integrated");
});

test("unknown and integrated configurations are rejected", async (t) => {
  const { manager } = await fixture(t);
  assert.deepEqual(await manager.saveConfiguration("unknown", "x"), { success: false, error: "Unknown emulator: unknown" });
  assert.equal((await manager.saveConfiguration("rommIntegrated", "x")).success, false);
  assert.equal((await manager.unregisterConfiguration("rommIntegrated")).success, false);
  assert.equal((await manager.unregisterConfiguration("unknown")).success, false);
});

test("nonexistent paths and directories cannot be registered", async (t) => {
  const { directory, manager } = await fixture(t);
  assert.equal((await manager.saveConfiguration("ppsspp", path.join(directory, "missing"))).success, false);
  assert.equal((await manager.saveConfiguration("ppsspp", directory)).error, "The selected emulator path is not a file");
});

test("saving trims paths, persists settings and creates an emulator instance", async (t) => {
  const { client, directory, getLastUpdate, getSaveCount, manager } = await fixture(t);
  const file = await executable(directory, "ppsspp");
  assert.deepEqual(await manager.saveConfiguration("ppsspp", `  ${file}  `), { success: true });
  assert.deepEqual(client.settings.emulators, [{ name: "ppsspp", path: file }]);
  assert.deepEqual(getLastUpdate(), { emulators: [{ name: "ppsspp", path: file }] });
  assert.equal(getSaveCount(), 1);
  assert.equal(manager.getEmulator("ppsspp").getExecutablePath(), file);
});

test("saving an existing configuration replaces it without duplicates", async (t) => {
  const { client, directory, manager } = await fixture(t, [{ name: "ppsspp", path: "old" }]);
  const file = await executable(directory, "new-ppsspp");
  await manager.saveConfiguration("ppsspp", file);
  assert.deepEqual(client.settings.emulators, [{ name: "ppsspp", path: file }]);
});

test("blank paths unregister configurations", async (t) => {
  const { client, getSaveCount, manager } = await fixture(t, [{ name: "dolphin", path: "old" }]);
  assert.deepEqual(await manager.saveConfiguration("dolphin", "  "), { success: true });
  assert.deepEqual(client.settings.emulators, []);
  assert.equal(getSaveCount(), 1);
});

test("platform lookup respects configured external emulators", async (t) => {
  const { directory, manager } = await fixture(t);
  assert.equal(manager.getEmulatorForPlatform("psp"), null);
  const file = await executable(directory, "ppsspp");
  await manager.saveConfiguration("ppsspp", file);
  assert.equal(manager.getEmulatorForPlatform("psp").constructor.name, "PPSSPPEmulator");
  assert.equal(manager.getEmulatorForPlatform("psx").constructor.name, "RommIntegratedEmulator");
  assert.equal(manager.getEmulatorForPlatform("nonexistent"), null);
});

test("emulator instances are cached until configuration changes", async (t) => {
  const { directory, manager } = await fixture(t);
  const firstPath = await executable(directory, "first");
  const secondPath = await executable(directory, "second");
  await manager.saveConfiguration("pcsx2", firstPath);
  const first = manager.getEmulator("pcsx2");
  assert.equal(manager.getEmulator("pcsx2"), first);
  await manager.saveConfiguration("pcsx2", secondPath);
  const second = manager.getEmulator("pcsx2");
  assert.notEqual(second, first);
  assert.equal(second.getExecutablePath(), secondPath);
});

test("environment setup delegates all expected dependencies", async (t) => {
  const { client, directory, manager } = await fixture(t);
  const file = await executable(directory, "ppsspp");
  await manager.saveConfiguration("ppsspp", file);
  const emulator = manager.getEmulator("ppsspp");
  let received;
  emulator.setupEnvironment = async (...args) => {
    received = args;
    return { success: true, marker: 1 };
  };
  const rom = { id: 42 };
  assert.deepEqual(await manager.setupEmulatorEnvironment("ppsspp", rom, "/session"), { success: true, marker: 1 });
  assert.equal(received[0], rom);
  assert.equal(received[1], "/session");
  assert.equal(received[2], client.rommApi);
  assert.equal(received[3], client.saveManager);
  assert.equal(received[4], path.join(directory, "configs", "ppsspp"));
});

test("manager operations report missing configuration or SaveManager", async (t) => {
  const { client, directory, manager } = await fixture(t);
  assert.equal((await manager.setupEmulatorEnvironment("ppsspp", {}, "x")).success, false);
  const file = await executable(directory, "ppsspp");
  await manager.saveConfiguration("ppsspp", file);
  client.saveManager = null;
  assert.equal((await manager.setupEmulatorEnvironment("ppsspp", {}, "x")).error, "SaveManager not available");
  assert.equal((await manager.getSaveComparison("ppsspp", {}, "x")).error, "SaveManager not available");
  assert.equal((await manager.handleSaveSync("ppsspp", {}, "x")).error, "SaveManager not available");
});

test("comparison, sync and config mode delegate and normalize failures", async (t) => {
  const { directory, manager } = await fixture(t);
  const file = await executable(directory, "dolphin");
  await manager.saveConfiguration("dolphin", file);
  const emulator = manager.getEmulator("dolphin");
  emulator.getSaveComparison = async () => ({ success: true, data: { marker: "comparison" } });
  emulator.handleSaveSync = async () => ({ success: true, marker: "sync" });
  emulator.startInConfigMode = async (folder) => ({ success: folder.endsWith("dolphin") });
  assert.equal((await manager.getSaveComparison("dolphin", {}, "session")).data.marker, "comparison");
  assert.equal((await manager.handleSaveSync("dolphin", {}, "session")).marker, "sync");
  assert.deepEqual(await manager.configureEmulatorInConfigMode("dolphin"), { success: true, error: undefined });
  emulator.handleSaveSync = async () => {
    throw new Error("sync exploded");
  };
  assert.equal((await manager.handleSaveSync("dolphin", {}, "session")).error, "sync exploded");
});
