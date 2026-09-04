const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");

const { DolphinEmulator, PCSX2Emulator, PPSSPPEmulator } = require("../out/managers/emulators/index.js");
const { makeRom, makeTempDir, silenceConsole } = require("./helpers.js");

function emulatorConfig(name) {
  return { path: `/emulators/${name}`, platform: "ignored", name, extensions: [], args: [] };
}

test("PPSSPP save preparation preserves nested PSP save folders", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-ppsspp-prep-");
  const local = path.join(root, "local");
  const session = path.join(root, "session");
  await fs.mkdir(path.join(local, "ULUS12345"), { recursive: true });
  await fs.writeFile(path.join(local, "ULUS12345", "DATA.BIN"), "save");
  const emulator = new PPSSPPEmulator(emulatorConfig("ppsspp"));

  assert.deepEqual(await emulator.handleSavePreparation(makeRom(), session, local, {}), { success: true });
  const target = path.join(emulator.getSessionMemstickDirectory(session), "PSP", "SAVEDATA", "ULUS12345", "DATA.BIN");
  assert.equal(await fs.readFile(target, "utf8"), "save");
});

test("PPSSPP save sync uploads a structured ZIP and refreshes the persistent snapshot", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-ppsspp-sync-");
  const session = path.join(root, "session");
  const persistent = path.join(root, "persistent");
  const emulator = new PPSSPPEmulator(emulatorConfig("ppsspp"));
  const saveData = path.join(emulator.getSessionMemstickDirectory(session), "PSP", "SAVEDATA", "ULUS12345");
  await fs.mkdir(saveData, { recursive: true });
  await fs.writeFile(path.join(saveData, "DATA.BIN"), "new-save");
  await fs.mkdir(persistent, { recursive: true });
  await fs.writeFile(path.join(persistent, "old.bin"), "old");
  let uploaded;
  const api = {
    uploadSave: async (romId, zipPath, emulatorName) => {
      const zip = new AdmZip(zipPath);
      uploaded = { romId, emulatorName, entries: zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName), content: zip.readAsText("ULUS12345/DATA.BIN") };
      return { success: true };
    },
  };
  const saveManager = { getLocalSaveDir: () => persistent };

  assert.deepEqual(await emulator.handleSaveSync(makeRom({ id: 101 }), session, api, saveManager), { success: true, message: "Save uploaded successfully" });
  assert.deepEqual(uploaded, { romId: 101, emulatorName: "ppsspp", entries: ["ULUS12345/DATA.BIN"], content: "new-save" });
  assert.equal(await fs.readFile(path.join(persistent, "ULUS12345", "DATA.BIN"), "utf8"), "new-save");
});

test("PPSSPP save sync handles offline and empty sessions", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-ppsspp-sync-");
  const emulator = new PPSSPPEmulator(emulatorConfig("ppsspp"));
  const offline = await emulator.handleSaveSync(makeRom(), path.join(root, "missing"), null, {});
  assert.equal(offline.success, false);
  assert.match(offline.error, /not available/);
  const empty = await emulator.handleSaveSync(makeRom(), path.join(root, "missing"), { uploadSave: async () => { throw new Error("must not upload"); } }, {});
  assert.deepEqual(empty, { success: true, message: "No saves to upload" });
});

test("PCSX2 save preparation copies memcards and folder saves independently", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-pcsx2-prep-");
  const local = path.join(root, "local");
  const session = path.join(root, "session");
  await fs.mkdir(path.join(local, "memcards"), { recursive: true });
  await fs.mkdir(path.join(local, "saves", "SLUS-00001"), { recursive: true });
  await fs.writeFile(path.join(local, "memcards", "Mcd001.ps2"), "card");
  await fs.writeFile(path.join(local, "saves", "SLUS-00001", "save.bin"), "folder-save");
  const emulator = new PCSX2Emulator(emulatorConfig("pcsx2"));

  assert.deepEqual(await emulator.handleSavePreparation(makeRom({ platform_slug: "ps2" }), session, local, {}), { success: true });
  const dataRoot = emulator.getDataRoot(session);
  assert.equal(await fs.readFile(path.join(dataRoot, "memcards", "Mcd001.ps2"), "utf8"), "card");
  assert.equal(await fs.readFile(path.join(dataRoot, "saves", "SLUS-00001", "save.bin"), "utf8"), "folder-save");
});

test("PCSX2 save sync packages both save systems and replaces persistent categories", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-pcsx2-sync-");
  const session = path.join(root, "session");
  const persistent = path.join(root, "persistent");
  const emulator = new PCSX2Emulator(emulatorConfig("pcsx2"));
  const dataRoot = emulator.getDataRoot(session);
  await fs.mkdir(path.join(dataRoot, "memcards"), { recursive: true });
  await fs.mkdir(path.join(dataRoot, "saves", "SLUS"), { recursive: true });
  await fs.writeFile(path.join(dataRoot, "memcards", "Mcd001.ps2"), "card");
  await fs.writeFile(path.join(dataRoot, "saves", "SLUS", "save.bin"), "folder");
  await fs.mkdir(path.join(persistent, "memcards"), { recursive: true });
  await fs.writeFile(path.join(persistent, "memcards", "obsolete.ps2"), "old");
  let entries;
  const api = {
    uploadSave: async (romId, zipPath, emulatorName) => {
      assert.equal(romId, 202);
      assert.equal(emulatorName, "pcsx2");
      entries = new AdmZip(zipPath).getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName).sort();
      return { success: true };
    },
  };

  const result = await emulator.handleSaveSync(makeRom({ id: 202, platform_slug: "ps2" }), session, api, { getLocalSaveDir: () => persistent });
  assert.deepEqual(result, { success: true, message: "Save uploaded successfully" });
  assert.deepEqual(entries, ["memcards/Mcd001.ps2", "saves/SLUS/save.bin"]);
  assert.equal(fsSync.existsSync(path.join(persistent, "memcards", "obsolete.ps2")), false);
  assert.equal(await fs.readFile(path.join(persistent, "memcards", "Mcd001.ps2"), "utf8"), "card");
  assert.equal(await fs.readFile(path.join(persistent, "saves", "SLUS", "save.bin"), "utf8"), "folder");
});

test("PCSX2 save sync reports rejected uploads and empty sessions", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-pcsx2-sync-");
  const emulator = new PCSX2Emulator(emulatorConfig("pcsx2"));
  const dataRoot = emulator.getDataRoot(root);
  await fs.mkdir(path.join(dataRoot, "memcards"), { recursive: true });
  assert.deepEqual(await emulator.handleSaveSync(makeRom(), root, { uploadSave: async () => { throw new Error("must not upload"); } }, {}), { success: true, message: "No saves to upload" });
  await fs.writeFile(path.join(dataRoot, "memcards", "card.ps2"), "card");
  const rejected = await emulator.handleSaveSync(makeRom(), root, { uploadSave: async () => ({ success: false, error: "quota" }) }, {});
  assert.deepEqual(rejected, { success: false, error: "quota" });
});

test("Dolphin preparation keeps Wii and GameCube snapshots separated", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-dolphin-prep-");
  const local = path.join(root, "local");
  const session = path.join(root, "session");
  await fs.mkdir(path.join(local, "Wii", "title"), { recursive: true });
  await fs.mkdir(path.join(local, "GC", "USA"), { recursive: true });
  await fs.writeFile(path.join(local, "Wii", "title", "save.bin"), "wii");
  await fs.writeFile(path.join(local, "GC", "USA", "card.raw"), "gc");
  const emulator = new DolphinEmulator(emulatorConfig("dolphin"));
  assert.deepEqual(await emulator.handleSavePreparation(makeRom({ platform_slug: "wii" }), session, local, {}), { success: true });
  assert.equal(await fs.readFile(path.join(session, "Wii", "title", "save.bin"), "utf8"), "wii");
  assert.equal(await fs.readFile(path.join(session, "GC", "USA", "card.raw"), "utf8"), "gc");
  assert.equal(fsSync.existsSync(path.join(session, "Wii", "GC")), false);
});

test("external emulators compare persistent local saves against cloud saves", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-save-compare-");
  const persistent = path.join(root, "persistent");
  await fs.mkdir(path.join(persistent, "nested"), { recursive: true });
  await fs.writeFile(path.join(persistent, "nested", "save.bin"), "save");
  const saveManager = { getLocalSaveDir: () => persistent };
  const cloud = [{ id: 8, updated_at: "2026-01-01" }];
  const api = { downloadSave: async (romId) => { assert.equal(romId, 42); return { success: true, data: cloud }; } };

  for (const emulator of [new PPSSPPEmulator(emulatorConfig("ppsspp")), new PCSX2Emulator(emulatorConfig("pcsx2")), new DolphinEmulator(emulatorConfig("dolphin"))]) {
    const online = await emulator.getSaveComparison(makeRom(), path.join(root, "session"), api, saveManager);
    assert.equal(online.success, true);
    assert.equal(online.data.hasLocal, true);
    assert.equal(online.data.hasCloud, true);
    assert.equal(online.data.recommendation, "local");
    assert.deepEqual(online.data.cloudSaves, cloud);
    const offline = await emulator.getSaveComparison(makeRom(), path.join(root, "session"), null, saveManager);
    assert.deepEqual(offline.data, { hasLocal: true, hasCloud: false, localSave: persistent, cloudSaves: [], recommendation: "local" });
  }
});
