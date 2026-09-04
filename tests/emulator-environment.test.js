const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { DolphinEmulator } = require("../out/managers/emulators/DolphinEmulator.js");
const { PCSX2Emulator } = require("../out/managers/emulators/PCSX2Emulator.js");
const { PPSSPPEmulator } = require("../out/managers/emulators/PPSSPPEmulator.js");
const { getPcsx2DataRoot, getPpssppSessionMemstickDirectory } = require("../out/utils/EmulatorRuntime.js");
const { makeRom, makeTempDir, silenceConsole } = require("./helpers.js");

const config = (executable) => ({ path: executable, platform: "ignored", name: "ignored", extensions: [], args: [] });

test("Dolphin creates Wii session storage", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-dolphin-env-");
  const saveDir = path.join(root, "session");
  const result = await new DolphinEmulator(config(path.join(root, "dolphin"))).setupEnvironment(makeRom({ platform_slug: "wii" }), saveDir, null, {}, path.join(root, "missing-config"));
  assert.equal(result.success, true);
  assert.equal(result.gameType, "wii");
  assert.equal(result.userDir, saveDir);
  assert.equal(fsSync.existsSync(path.join(saveDir, "Wii", "title", "00000001", "data")), true);
});

test("Dolphin recognizes ngc and creates GameCube memory-card storage", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-dolphin-env-");
  const saveDir = path.join(root, "session");
  const result = await new DolphinEmulator(config(path.join(root, "dolphin"))).setupEnvironment(makeRom({ platform_slug: "ngc", fs_size_bytes: 1_400_000_000 }), saveDir, null, {}, path.join(root, "missing-config"));
  assert.equal(result.success, true);
  assert.equal(result.gameType, "gamecube");
  assert.equal(fsSync.existsSync(path.join(saveDir, "GC", "USA")), true);
  assert.equal(fsSync.existsSync(path.join(saveDir, "Wii")), false);
});

test("Dolphin copies configuration files into the isolated user directory", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-dolphin-env-");
  const configDir = path.join(root, "config", "Config");
  const saveDir = path.join(root, "session");
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(saveDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "Dolphin.ini"), "[Core]\n");
  const result = await new DolphinEmulator(config(path.join(root, "dolphin"))).setupEnvironment(makeRom({ platform_slug: "wii" }), saveDir, null, {}, path.join(root, "config"));
  assert.equal(result.success, true);
  assert.equal(await fs.readFile(path.join(saveDir, "Config", "Dolphin.ini"), "utf8"), "[Core]\n");
});

test("PPSSPP rebuilds a clean session and excludes configured SAVEDATA", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-ppsspp-env-");
  const executable = path.join(root, "bin", "ppsspp");
  const configDir = path.join(root, "config");
  const saveDir = path.join(root, "session");
  await fs.mkdir(path.join(configDir, "PSP", "SYSTEM"), { recursive: true });
  await fs.mkdir(path.join(configDir, "PSP", "SAVEDATA", "OLDGAME"), { recursive: true });
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "binary");
  await fs.writeFile(path.join(configDir, "PSP", "SYSTEM", "ppsspp.ini"), "config");
  await fs.writeFile(path.join(configDir, "PSP", "SAVEDATA", "OLDGAME", "save.bin"), "old");
  await fs.mkdir(saveDir, { recursive: true });
  await fs.writeFile(path.join(saveDir, "stale"), "stale");
  const result = await new PPSSPPEmulator(config(executable)).setupEnvironment(makeRom(), saveDir, null, {}, configDir);
  const memstick = getPpssppSessionMemstickDirectory(saveDir);
  assert.equal(result.success, true);
  assert.equal(fsSync.existsSync(path.join(saveDir, "stale")), false);
  assert.equal(await fs.readFile(path.join(memstick, "PSP", "SYSTEM", "ppsspp.ini"), "utf8"), "config");
  assert.equal(fsSync.existsSync(path.join(memstick, "PSP", "SAVEDATA", "OLDGAME", "save.bin")), false);
  assert.equal(fsSync.existsSync(path.join(memstick, "PSP", "SAVEDATA")), true);
  if (process.platform !== "linux") {
    assert.equal(fsSync.existsSync(path.join(path.dirname(executable), "portable.txt")), true);
    assert.match(await fs.readFile(path.join(path.dirname(executable), "installed.txt"), "utf8"), /memstick/);
  }
});

test("PCSX2 creates isolated memcard and folder-save directories", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-pcsx2-env-");
  const executable = path.join(root, "bin", "pcsx2");
  const configDir = path.join(root, "config");
  const saveDir = path.join(root, "session");
  const configuredRoot = getPcsx2DataRoot(configDir);
  await fs.mkdir(path.join(configuredRoot, "bios"), { recursive: true });
  await fs.mkdir(path.join(configuredRoot, "memcards"), { recursive: true });
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "binary");
  await fs.writeFile(path.join(configuredRoot, "bios", "bios.bin"), "bios");
  await fs.writeFile(path.join(configuredRoot, "memcards", "old.ps2"), "old");
  const result = await new PCSX2Emulator(config(executable)).setupEnvironment(makeRom({ platform_slug: "ps2" }), saveDir, null, {}, configDir);
  const dataRoot = getPcsx2DataRoot(saveDir);
  assert.equal(result.success, true);
  assert.equal(await fs.readFile(path.join(dataRoot, "bios", "bios.bin"), "utf8"), "bios");
  assert.equal(fsSync.existsSync(path.join(dataRoot, "memcards", "old.ps2")), false);
  assert.equal(fsSync.existsSync(path.join(dataRoot, "memcards")), true);
  assert.equal(fsSync.existsSync(path.join(dataRoot, "saves")), true);
});
