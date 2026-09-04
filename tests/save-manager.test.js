const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { SaveManager } = require("../out/managers/SaveManager.js");
const { makeRom, makeTempDir, silenceConsole } = require("./helpers.js");

async function fixture(t, options = {}) {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-saves-");
  let api = options.api === undefined ? null : options.api;
  const client = {
    getSavesFolder: () => (options.noRoot ? null : root),
    getOnlineRommApi: () => api,
  };
  const emulatorManager = options.emulatorManager || { getEmulatorForPlatform: () => null };
  return { root, client, manager: new SaveManager(client, emulatorManager), setApi: (value) => (api = value) };
}

test("builds stable per-platform save paths", async (t) => {
  const { root, manager } = await fixture(t);
  assert.equal(manager.getLocalSaveDir(makeRom({ id: 7, platform_slug: "psp" })), path.join(root, "psp", "rom_7"));
});

test("missing save root is reported", async (t) => {
  const { manager } = await fixture(t, { noRoot: true });
  assert.throws(() => manager.getLocalSaveDir(makeRom()), /not configured/);
  const result = await manager.checkSaves(makeRom());
  assert.equal(result.success, false);
});

test("local save detection handles missing, empty and nested directories", async (t) => {
  const { manager } = await fixture(t);
  const rom = makeRom();
  assert.equal(await manager.hasLocalSaves(rom), false);
  const saveDir = manager.getLocalSaveDir(rom);
  await fs.mkdir(path.join(saveDir, "nested"), { recursive: true });
  assert.equal(await manager.hasLocalSaves(rom), false);
  await fs.writeFile(path.join(saveDir, "nested", "data.bin"), "save");
  assert.equal(await manager.hasLocalSaves(rom), true);
});

test("cloud save detection handles offline, success and API errors", async (t) => {
  const { manager, setApi } = await fixture(t);
  const rom = makeRom();
  assert.equal(await manager.hasCloudSaves(rom), false);
  setApi({ downloadSave: async () => ({ success: true, data: [{ id: 1 }] }) });
  assert.equal(await manager.hasCloudSaves(rom), true);
  setApi({ downloadSave: async () => ({ success: false, error: "nope" }) });
  assert.equal(await manager.hasCloudSaves(rom), false);
  setApi({ downloadSave: async () => { throw new Error("network"); } });
  assert.equal(await manager.hasCloudSaves(rom), false);
});

test("getCloudSaves normalizes unavailable and malformed results", async (t) => {
  const { manager, setApi } = await fixture(t);
  const rom = makeRom();
  assert.deepEqual(await manager.getCloudSaves(rom), []);
  setApi({ downloadSave: async () => ({ success: true, data: [{ id: 1 }, { id: 2 }] }) });
  assert.equal((await manager.getCloudSaves(rom)).length, 2);
  setApi({ downloadSave: async () => ({ success: false, data: [{ id: 3 }] }) });
  assert.deepEqual(await manager.getCloudSaves(rom), []);
});

test("local save date uses the newest nested file", async (t) => {
  const { manager } = await fixture(t);
  const rom = makeRom();
  const saveDir = manager.getLocalSaveDir(rom);
  await fs.mkdir(path.join(saveDir, "nested"), { recursive: true });
  const oldFile = path.join(saveDir, "old.sav");
  const newFile = path.join(saveDir, "nested", "new.sav");
  await fs.writeFile(oldFile, "old");
  await fs.writeFile(newFile, "new");
  await fs.utimes(oldFile, new Date("2024-01-01T00:00:00Z"), new Date("2024-01-01T00:00:00Z"));
  await fs.utimes(newFile, new Date("2025-02-03T04:05:06Z"), new Date("2025-02-03T04:05:06Z"));
  assert.equal(await manager.getLocalSaveDate(rom), "2025-02-03T04:05:06.000Z");
});

test("checkSaves combines local and newest cloud timestamps", async (t) => {
  const cloud = [
    { id: 1, updated_at: "2025-01-01T00:00:00Z" },
    { id: 2, created_at: "2026-01-01T00:00:00Z" },
    { id: 3, updated_at: "invalid" },
  ];
  const { manager } = await fixture(t, { api: { downloadSave: async () => ({ success: true, data: cloud }) } });
  const rom = makeRom();
  const saveDir = manager.getLocalSaveDir(rom);
  await fs.mkdir(saveDir, { recursive: true });
  const file = path.join(saveDir, "save.bin");
  await fs.writeFile(file, "save");
  await fs.utimes(file, new Date("2025-06-01T00:00:00Z"), new Date("2025-06-01T00:00:00Z"));
  const result = await manager.checkSaves(rom);
  assert.equal(result.success, true);
  assert.equal(result.hasLocal, true);
  assert.equal(result.hasCloud, true);
  assert.equal(result.cloudSaveDate, "2026-01-01T00:00:00.000Z");
  assert.equal(result.lastSaveDate, "2026-01-01T00:00:00.000Z");
});

test("offline checkSaves never calls cloud APIs", async (t) => {
  const { manager } = await fixture(t);
  const result = await manager.checkSaves(makeRom());
  assert.equal(result.success, true);
  assert.equal(result.hasCloud, false);
  assert.deepEqual(result.cloudSaves, []);
});

test("save preparation and sync are no-ops for absent or empty saves", async (t) => {
  const { manager } = await fixture(t);
  const rom = makeRom();
  assert.deepEqual(await manager.prepareSavesForEmulatorLaunch(rom, "/tmp/session"), { success: true });
  assert.deepEqual(await manager.syncSavesAfterEmulatorClose(rom), { success: true });
  await fs.mkdir(manager.getLocalSaveDir(rom), { recursive: true });
  assert.deepEqual(await manager.prepareSavesForEmulatorLaunch(rom, "/tmp/session"), { success: true });
  assert.deepEqual(await manager.syncSavesAfterEmulatorClose(rom), { success: true });
});

test("generic crash recovery flattens saves and removes recovered sessions", async (t) => {
  const { manager, root } = await fixture(t);
  const session = path.join(root, "psp", "rom_42_session");
  await fs.mkdir(path.join(session, "deep"), { recursive: true });
  await fs.writeFile(path.join(session, "root.sav"), "root");
  await fs.writeFile(path.join(session, "deep", "nested.sav"), "nested");
  const result = await manager.recoverLostSaves();
  assert.deepEqual(result, { success: true, recoveredCount: 1 });
  assert.equal(await fs.readFile(path.join(root, "psp", "rom_42", "nested.sav"), "utf8"), "nested");
  assert.equal(fsSync.existsSync(session), false);
});

test("recovery delegates to the configured emulator", async (t) => {
  let received;
  const emulator = {
    async extractSavesFromSession(session, persistent) {
      received = { session, persistent };
      await fs.writeFile(path.join(persistent, "managed.sav"), "managed");
      return ["managed.sav"];
    },
  };
  const { manager, root } = await fixture(t, { emulatorManager: { getEmulatorForPlatform: () => emulator } });
  const session = path.join(root, "ps2", "rom_9_session");
  await fs.mkdir(session, { recursive: true });
  await fs.writeFile(path.join(session, "source"), "x");
  const result = await manager.recoverLostSaves();
  assert.equal(result.recoveredCount, 1);
  assert.equal(received.session, session);
  assert.equal(received.persistent, path.join(root, "ps2", "rom_9"));
});

test("invalid session names and empty sessions are preserved", async (t) => {
  const { manager, root } = await fixture(t);
  const invalid = path.join(root, "psp", "invalid_session");
  const empty = path.join(root, "psp", "rom_8_session");
  await fs.mkdir(invalid, { recursive: true });
  await fs.mkdir(empty, { recursive: true });
  const result = await manager.recoverLostSaves();
  assert.equal(result.recoveredCount, 0);
  assert.equal(fsSync.existsSync(invalid), true);
  assert.equal(fsSync.existsSync(empty), true);
});

test("recovery reports a missing root without throwing", async (t) => {
  const { manager } = await fixture(t, { noRoot: true });
  const result = await manager.recoverLostSaves();
  assert.equal(result.success, false);
  assert.equal(result.recoveredCount, 0);
  assert.match(result.error, /not configured/);
});
