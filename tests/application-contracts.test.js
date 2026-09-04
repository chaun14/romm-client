const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function withoutBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

test("every preload invoke channel has an active main-process handler", () => {
  const preload = read("src/preload.js");
  const main = withoutBlockComments(read("src/managers/IPCManager.ts"));
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\(['\"]([^'\"]+)['\"]/g)].map((match) => match[1]);
  const handled = new Set([...main.matchAll(/ipcMain\.handle\(['\"]([^'\"]+)['\"]/g)].map((match) => match[1]));
  const missing = [...new Set(invoked)].filter((channel) => !handled.has(channel));
  assert.deepEqual(missing, []);
  assert.ok(invoked.length >= 30, "the preload contract unexpectedly lost most of its commands");
});

test("current renderer emulator commands remain exposed through preload", () => {
  const preload = read("src/preload.js");
  for (const channel of [
    "emulator:get-configs",
    "emulator:get-supported-emulators",
    "emulator:select-executable",
    "emulator:saveConfig",
    "emulator:unregister",
    "emulator:configure-emulator",
  ]) {
    assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`) || preload.includes(`ipcRenderer.invoke(\"${channel}\"`));
  }
});

test("all BrowserWindows keep renderer privileges isolated", () => {
  const sources = [read("src/RomMClient.ts"), read("src/managers/IPCManager.ts")].join("\n");
  const preferenceBlocks = [...sources.matchAll(/webPreferences\s*:\s*\{([\s\S]*?)\}/g)].map((match) => match[1]);
  assert.ok(preferenceBlocks.length >= 3);
  for (const preferences of preferenceBlocks) {
    assert.match(preferences, /contextIsolation\s*:\s*true/);
    assert.match(preferences, /nodeIntegration\s*:\s*false/);
  }
});

test("preload bridge forwards commands and sanitizes renderer callbacks", async () => {
  const Module = require("node:module");
  const originalLoad = Module._load;
  const originalConsole = global.console;
  const worlds = {};
  const invocations = [];
  const sends = [];
  const listeners = new Map();
  const removed = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { worlds[name] = value; } },
    ipcRenderer: {
      invoke: async (...args) => { invocations.push(args); return { success: true }; },
      send: (...args) => sends.push(args),
      on: (channel, listener) => listeners.set(channel, listener),
      removeAllListeners: (channel) => removed.push(channel),
    },
  };

  try {
    Module._load = function (request, parent, isMain) {
      return request === "electron" ? electron : originalLoad.call(this, request, parent, isMain);
    };
    const preloadPath = require.resolve("../src/preload.js");
    delete require.cache[preloadPath];
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
    global.console = originalConsole;
  }

  assert.ok(worlds.electronAPI);
  assert.ok(worlds.electronEvents);
  await worlds.electronAPI.config.setCredentials("alice", "secret");
  await worlds.electronAPI.roms.getByPlatform(7, 24, 48);
  await worlds.electronAPI.emulator.saveConfig("ppsspp", "/opt/ppsspp");
  assert.deepEqual(invocations, [
    ["config:set-credentials", { username: "alice", password: "secret" }],
    ["roms:get-by-platform", { platform: 7, limit: 24, offset: 48 }],
    ["emulator:saveConfig", { emulatorKey: "ppsspp", path: "/opt/ppsspp" }],
  ]);

  let payload;
  worlds.electronEvents.onRomLaunched((data) => { payload = data; });
  listeners.get("rom:launched")({ sender: "must not leak" }, { id: 42 });
  assert.deepEqual(payload, { id: 42 });
  worlds.electronEvents.sendSaveChoice("cloud", 99);
  assert.deepEqual(sends.at(-1), ["save:choice-selected", { choice: "cloud", saveId: 99 }]);
  worlds.electronEvents.removeRomLaunchListeners();
  assert.deepEqual(removed.slice(-2), ["rom:launched", "rom:launch-failed"]);
});

test("package test command discovers every lowercase test suite", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(packageJson.scripts.test, /tests\/\*\.test\.js/);
  assert.match(packageJson.scripts["test:coverage"], /--experimental-test-coverage/);
});
