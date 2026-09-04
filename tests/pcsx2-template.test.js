const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const templatePath = path.resolve(__dirname, "../src/renderer/assets/configs/pcsx2-rommclient.ini");
const template = fs.readFileSync(templatePath, "utf8");

test("PCSX2 template declares every isolated writable folder", () => {
  const requiredFolders = {
    Bios: "bios",
    Snapshots: "snaps",
    Savestates: "sstates",
    MemoryCards: "memcards",
    Logs: "logs",
    Cheats: "cheats",
    Patches: "patches",
    Cache: "cache",
    Textures: "textures",
    InputProfiles: "inputprofiles",
  };
  for (const [key, value] of Object.entries(requiredFolders)) {
    assert.match(template, new RegExp(`^${key} = ${value}$`, "m"));
  }
});

test("PCSX2 template enables a primary memory card and leaves BIOS selectable", () => {
  assert.match(template, /^\[MemoryCards\]$/m);
  assert.match(template, /^Slot1_Enable = true$/m);
  assert.match(template, /^Slot1_Filename = Mcd001\.ps2$/m);
  assert.match(template, /^\[Filenames\]$/m);
  assert.match(template, /^BIOS = todo$/m);
});

test("PCSX2 template contains exactly one folders and memory-card section", () => {
  assert.equal((template.match(/^\[Folders\]$/gm) || []).length, 1);
  assert.equal((template.match(/^\[MemoryCards\]$/gm) || []).length, 1);
});
