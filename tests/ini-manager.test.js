const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { IniManager } = require("../out/managers/IniManager.js");
const { makeTempDir, silenceConsole } = require("./helpers.js");

test("loads sections and typed INI booleans", async (t) => {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-ini-");
  const file = path.join(directory, "config.ini");
  await fs.writeFile(file, "[Core]\nenabled=true\ncount=3\nname=RomM\n");
  const config = await IniManager.loadIni(file);
  assert.equal(config.Core.enabled, true);
  assert.equal(config.Core.count, "3");
  assert.equal(config.Core.name, "RomM");
});

test("missing INI files return an empty object", async (t) => {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-ini-");
  assert.deepEqual(await IniManager.loadIni(path.join(directory, "missing.ini")), {});
});

test("saveIni and loadIni round-trip sections", async (t) => {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-ini-");
  const file = path.join(directory, "roundtrip.ini");
  await IniManager.saveIni(file, { Core: { Renderer: "Vulkan", Fullscreen: true }, Paths: { Saves: "/tmp/saves" } });
  const config = await IniManager.loadIni(file);
  assert.equal(config.Core.Renderer, "Vulkan");
  assert.equal(config.Core.Fullscreen, true);
  assert.equal(config.Paths.Saves, "/tmp/saves");
});

test("saveIni surfaces filesystem errors", async (t) => {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-ini-");
  await assert.rejects(IniManager.saveIni(path.join(directory, "missing", "config.ini"), { Core: {} }), /ENOENT/);
});

test("template substitution replaces every placeholder occurrence", async (t) => {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-ini-");
  const file = path.join(directory, "template.ini");
  await fs.writeFile(file, "[Folders]\nfirst={SAVE}/one\nsecond={SAVE}/two\nrom={ROM}\n");
  const config = await IniManager.loadTemplateAndSubstitute(file, { "\\{SAVE\\}": "/saves", "\\{ROM\\}": "game.iso" });
  assert.equal(config.Folders.first, "/saves/one");
  assert.equal(config.Folders.second, "/saves/two");
  assert.equal(config.Folders.rom, "game.iso");
});

test("getConfigValue returns values and fallbacks", () => {
  const config = { Core: { Renderer: "OpenGL", Empty: null } };
  assert.equal(IniManager.getConfigValue(config, "Core", "Renderer", "fallback"), "OpenGL");
  assert.equal(IniManager.getConfigValue(config, "Core", "Missing", "fallback"), "fallback");
  assert.equal(IniManager.getConfigValue(config, "Missing", "Value", 42), 42);
  assert.equal(IniManager.getConfigValue(config, "Core", "Empty", "fallback"), null);
});

test("setConfigValue updates and creates sections", () => {
  const config = { Core: { Renderer: "OpenGL" } };
  IniManager.setConfigValue(config, "Core", "Renderer", "Vulkan");
  IniManager.setConfigValue(config, "Audio", "Volume", 80);
  assert.deepEqual(config, { Core: { Renderer: "Vulkan" }, Audio: { Volume: 80 } });
});

test("readTemplateAsString preserves exact formatting", async (t) => {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-ini-");
  const file = path.join(directory, "raw.ini");
  const source = "[Core]\r\nValue = exact\r\n";
  await fs.writeFile(file, source);
  assert.equal(await IniManager.readTemplateAsString(file), source);
  assert.equal(await IniManager.readTemplateAsString(path.join(directory, "missing.ini")), "");
});

test("raw template substitutions support regex and string patterns", async (t) => {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-ini-");
  const input = path.join(directory, "input.ini");
  const output = path.join(directory, "output.ini");
  await fs.writeFile(input, "MemoryCards = old\nSlot = OLD\nSlot = OLD\n");
  await IniManager.readTemplateSubstituteAndSave(input, output, [
    { pattern: /^MemoryCards = .+$/m, replacement: "MemoryCards = /new/cards" },
    { pattern: "OLD", replacement: "NEW" },
  ]);
  assert.equal(await fs.readFile(output, "utf8"), "MemoryCards = /new/cards\nSlot = NEW\nSlot = NEW\n");
});
