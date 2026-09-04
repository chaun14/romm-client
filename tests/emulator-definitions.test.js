const assert = require("node:assert/strict");
const test = require("node:test");

const { AzaharEmulator } = require("../out/managers/emulators/AzaharEmulator.js");
const { DolphinEmulator } = require("../out/managers/emulators/DolphinEmulator.js");
const { PCSX2Emulator } = require("../out/managers/emulators/PCSX2Emulator.js");
const { PPSSPPEmulator } = require("../out/managers/emulators/PPSSPPEmulator.js");
const { RommIntegratedEmulator } = require("../out/managers/emulators/RommIntegratedEmulator.js");

const config = (path = "/emulator") => ({ path, platform: "ignored", name: "ignored", extensions: [], args: [] });

test("PPSSPP declares PSP formats, platform and save support", () => {
  assert.deepEqual(PPSSPPEmulator.getExtensions(), [".iso", ".cso", ".pbp", ".elf"]);
  assert.deepEqual(PPSSPPEmulator.getPlatforms(), ["psp"]);
  assert.equal(PPSSPPEmulator.getRommSlug(), "psp");
  assert.equal(PPSSPPEmulator.getSupportsSaves(), true);
  assert.deepEqual(new PPSSPPEmulator(config()).prepareArgs("game.cso", "save"), ["game.cso"]);
});

test("PCSX2 declares PS2 formats and save support", () => {
  assert.deepEqual(PCSX2Emulator.getExtensions(), [".iso", ".bin", ".cue", ".elf", ".gs"]);
  assert.deepEqual(PCSX2Emulator.getPlatforms(), ["ps2"]);
  assert.equal(PCSX2Emulator.getRommSlug(), "ps2");
  assert.equal(PCSX2Emulator.getSupportsSaves(), true);
  const args = new PCSX2Emulator(config()).prepareArgs("game.iso", "save");
  assert.equal(args.at(-1), "game.iso");
  assert.ok(args.includes("-fullscreen"));
});

test("Dolphin declares current boot formats and both Nintendo platforms", () => {
  const extensions = DolphinEmulator.getExtensions();
  for (const extension of [".iso", ".gcm", ".wbfs", ".rvz", ".wia", ".wad", ".dol", ".elf"]) assert.ok(extensions.includes(extension));
  assert.deepEqual(DolphinEmulator.getPlatforms(), ["wii", "ngc"]);
  assert.equal(DolphinEmulator.getRommSlug(), "wii");
  assert.equal(DolphinEmulator.getSupportsSaves(), true);
  assert.deepEqual(new DolphinEmulator(config()).prepareArgs("game.rvz", "/tmp/user"), ["-u", "/tmp/user", "-e", "game.rvz"]);
});

test("Dolphin classifies Wii and GameCube metadata", () => {
  const emulator = new DolphinEmulator(config());
  assert.equal(emulator.isWiiGame({ platform_slug: "wii" }), true);
  assert.equal(emulator.isWiiGame({ platform_slug: "gamecube" }), false);
  assert.equal(emulator.isWiiGame({ platform_slug: "ngc" }), false);
  assert.equal(emulator.isWiiGame({ platform_slug: "custom", fs_size_bytes: 3_000_000_000 }), true);
  assert.equal(emulator.isWiiGame({ platform_slug: "custom", fs_size_bytes: 1_000_000_000 }), true);
});

test("Azahar excludes install-only CIA files and prepares fullscreen args", () => {
  const extensions = AzaharEmulator.getExtensions();
  assert.ok(extensions.includes(".3ds"));
  assert.ok(extensions.includes(".cxi"));
  assert.equal(extensions.includes(".cia"), false);
  assert.deepEqual(AzaharEmulator.getPlatforms(), ["3ds", "new-nintendo-3ds"]);
  assert.equal(AzaharEmulator.getRommSlug(), "3ds");
  assert.equal(AzaharEmulator.getSupportsSaves(), true);
  assert.deepEqual(new AzaharEmulator(config()).prepareArgs("game.3ds", "save"), ["-f", "game.3ds"]);
});

test("integrated emulator is always configured and does not claim local saves", async () => {
  const emulator = new RommIntegratedEmulator(config(undefined));
  assert.equal(emulator.isConfigured(), true);
  assert.equal(RommIntegratedEmulator.getSupportsSaves(), false);
  assert.ok(RommIntegratedEmulator.getPlatforms().includes("psx"));
  assert.ok(RommIntegratedEmulator.getPlatforms().includes("snes"));
  assert.deepEqual(await emulator.launch("https://romm/rom/42/ejs", "unused"), {
    success: true,
    message: "ROM launched in integrated emulator",
    integrated: true,
    romPath: "https://romm/rom/42/ejs",
  });
  assert.deepEqual(await emulator.startInConfigMode("unused"), { success: true });
});
