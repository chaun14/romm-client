const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { Emulator } = require("../out/managers/emulators/Emulator.js");
const { makeTempDir, silenceConsole } = require("./helpers.js");

class TestEmulator extends Emulator {}

function createEmulator(overrides = {}) {
  return new TestEmulator({ path: undefined, platform: "test", name: "Test", extensions: [".iso"], args: ["--rom={rom}", "--save={save}", "{rom}"], ...overrides });
}

test("base emulator exposes configuration and protects extension arrays", () => {
  const emulator = createEmulator({ path: "/tmp/emulator" });
  assert.equal(emulator.getExecutablePath(), "/tmp/emulator");
  emulator.setExecutablePath("/new/path");
  assert.equal(emulator.getExecutablePath(), "/new/path");
  const extensions = emulator.getSupportedExtensions();
  extensions.push(".bin");
  assert.deepEqual(emulator.getSupportedExtensions(), [".iso"]);
});

test("base placeholder substitution replaces ROM and save paths", () => {
  const emulator = createEmulator();
  assert.deepEqual(emulator.prepareArgs("/games/a.iso", "/saves/a"), ["--rom=/games/a.iso", "--save=/saves/a", "/games/a.iso"]);
});

test("isConfigured requires an existing configured path", async (t) => {
  const directory = await makeTempDir(t, "romm-emulator-");
  const executable = path.join(directory, "emulator");
  await fs.writeFile(executable, "binary");
  assert.equal(createEmulator().isConfigured(), false);
  assert.equal(createEmulator({ path: path.join(directory, "missing") }).isConfigured(), false);
  assert.equal(createEmulator({ path: executable }).isConfigured(), true);
});

test("default hooks return neutral successful results", async () => {
  const emulator = createEmulator();
  assert.deepEqual(await emulator.setupEnvironment({}, "", null, {}, ""), { success: true });
  assert.deepEqual(await emulator.handleSavePreparation({}, "", "", {}), { success: true });
  assert.deepEqual(await emulator.handleSaveSync({}, "", null, {}), { success: true });
  assert.deepEqual(await emulator.getSaveComparison({}, "", null, {}), {
    success: true,
    data: { hasLocal: false, hasCloud: false, localSave: null, cloudSaves: [], recommendation: "none" },
  });
});

test("launch without an executable returns a failure", async () => {
  const result = await createEmulator().launch("game.iso", "saves");
  assert.equal(result.success, false);
  assert.match(result.error, /path not configured/);
});

test("launch resolves only after the child emits spawn", async (t) => {
  silenceConsole(t);
  const emulator = createEmulator({ path: "fake-emulator" });
  const child = new EventEmitter();
  child.pid = 1234;
  let capturedArgs;
  emulator.spawnProcess = (args) => {
    capturedArgs = args;
    process.nextTick(() => child.emit("spawn"));
    return child;
  };
  const result = await emulator.launch("game.iso", "save-dir");
  assert.equal(result.success, true);
  assert.equal(result.pid, 1234);
  assert.equal(result.process, child);
  assert.deepEqual(capturedArgs, ["--rom=game.iso", "--save=save-dir", "game.iso"]);
});

test("launch reports child spawn errors", async (t) => {
  silenceConsole(t);
  const emulator = createEmulator({ path: "missing-emulator" });
  const child = new EventEmitter();
  emulator.spawnProcess = () => {
    process.nextTick(() => child.emit("error", new Error("ENOENT")));
    return child;
  };
  const result = await emulator.launch("game.iso", "save-dir");
  assert.equal(result.success, false);
  assert.match(result.error, /ENOENT/);
});

test("configuration mode waits for startup and returns the PID", async (t) => {
  silenceConsole(t);
  const emulator = createEmulator({ path: "fake-emulator" });
  const child = new EventEmitter();
  child.pid = 77;
  emulator.spawnProcess = () => {
    process.nextTick(() => child.emit("spawn"));
    return child;
  };
  assert.deepEqual(await emulator.configureEmulatorInConfigMode(), { success: true, pid: 77 });
});

test("configuration mode reports startup errors", async (t) => {
  silenceConsole(t);
  const emulator = createEmulator({ path: "fake-emulator" });
  const child = new EventEmitter();
  emulator.spawnProcess = () => {
    process.nextTick(() => child.emit("error", new Error("permission denied")));
    return child;
  };
  const result = await emulator.startInConfigMode("unused");
  assert.equal(result.success, false);
  assert.match(result.error, /permission denied/);
});

test("default save extraction recursively flattens files", async (t) => {
  const directory = await makeTempDir(t, "romm-extract-");
  const session = path.join(directory, "session");
  const persistent = path.join(directory, "persistent");
  await fs.mkdir(path.join(session, "one", "two"), { recursive: true });
  await fs.mkdir(persistent);
  await fs.writeFile(path.join(session, "root.sav"), "root");
  await fs.writeFile(path.join(session, "one", "two", "nested.sav"), "nested");
  const extracted = await createEmulator().extractSavesFromSession(session, persistent);
  assert.deepEqual(extracted.sort(), ["nested.sav", "root.sav"]);
  assert.equal(await fs.readFile(path.join(persistent, "nested.sav"), "utf8"), "nested");
});

test("default save choice forwards launch metadata", async () => {
  const emulator = createEmulator();
  emulator.launch = async () => ({ success: true, message: "ok", pid: 99 });
  assert.deepEqual(await emulator.handleSaveChoice({ finalRomPath: "game.iso", saveDir: "save" }, "none", {}, null), {
    success: true,
    message: "ok",
    error: undefined,
    pid: 99,
    romPath: "game.iso",
    saveDir: "save",
  });
});
