const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { PCSX2Emulator } = require("../out/managers/emulators/PCSX2Emulator.js");
const { PPSSPPEmulator } = require("../out/managers/emulators/PPSSPPEmulator.js");
const { getPcsx2DataRoot, getPpssppSessionMemstickDirectory } = require("../out/utils/EmulatorRuntime.js");
const { makeTempDir, silenceConsole } = require("./helpers.js");

const config = { path: "/emulator", platform: "ignored", name: "ignored", extensions: [], args: [] };

test("PPSSPP extraction preserves game save folders", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-ppsspp-save-");
  const session = path.join(root, "session");
  const persistent = path.join(root, "persistent");
  const savedata = path.join(getPpssppSessionMemstickDirectory(session), "PSP", "SAVEDATA", "ULES01234", "DATA");
  await fs.mkdir(savedata, { recursive: true });
  await fs.writeFile(path.join(savedata, "SAVE.BIN"), "save");
  await fs.writeFile(path.join(savedata, "ICON0.PNG"), "icon");
  const extracted = await new PPSSPPEmulator(config).extractSavesFromSession(session, persistent);
  assert.deepEqual(extracted.sort(), ["ICON0.PNG", "SAVE.BIN"]);
  assert.equal(await fs.readFile(path.join(persistent, "ULES01234", "DATA", "SAVE.BIN"), "utf8"), "save");
});

test("PPSSPP extraction handles absent SAVEDATA", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-ppsspp-save-");
  const persistent = path.join(root, "persistent");
  assert.deepEqual(await new PPSSPPEmulator(config).extractSavesFromSession(path.join(root, "missing"), persistent), []);
  assert.equal(fsSync.existsSync(persistent), false);
});

test("PCSX2 extraction preserves memcard and folder-save categories", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-pcsx2-save-");
  const session = path.join(root, "session");
  const persistent = path.join(root, "persistent");
  const dataRoot = getPcsx2DataRoot(session);
  await fs.mkdir(path.join(dataRoot, "memcards"), { recursive: true });
  await fs.mkdir(path.join(dataRoot, "saves", "SLUS-12345"), { recursive: true });
  await fs.writeFile(path.join(dataRoot, "memcards", "Mcd001.ps2"), "card");
  await fs.writeFile(path.join(dataRoot, "saves", "SLUS-12345", "save.bin"), "folder-save");
  const extracted = await new PCSX2Emulator(config).extractSavesFromSession(session, persistent);
  assert.deepEqual(extracted.sort(), ["Mcd001.ps2", "save.bin"]);
  assert.equal(await fs.readFile(path.join(persistent, "memcards", "Mcd001.ps2"), "utf8"), "card");
  assert.equal(await fs.readFile(path.join(persistent, "saves", "SLUS-12345", "save.bin"), "utf8"), "folder-save");
});

test("PCSX2 extraction tolerates missing save categories", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-pcsx2-save-");
  assert.deepEqual(await new PCSX2Emulator(config).extractSavesFromSession(path.join(root, "missing"), path.join(root, "persistent")), []);
});
