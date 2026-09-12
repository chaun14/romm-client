const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { migrateAppStorage } = require("../out/utils/MigrateAppStorage.js");
const { makeTempDir } = require("./helpers.js");

async function fixture(t) {
  const root = await makeTempDir(t, "romm-migration-");
  const paths = { legacyDir: path.join(root, "legacy"), configDir: path.join(root, "config"), dataDir: path.join(root, "data") };
  const write = async (root, name, content = name) => {
    const filename = path.join(root, name);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
  };
  return { paths, write };
}

test("fresh installs and non-Linux storage need no migration", async (t) => {
  const { paths } = await fixture(t);
  assert.deepEqual(await migrateAppStorage(paths), []);
  assert.deepEqual(await migrateAppStorage({ ...paths, legacyDir: null }), []);
  await assert.rejects(fs.stat(paths.legacyDir), { code: "ENOENT" });
});

test("migrates settings, every instance, offline metadata and unfinished sessions before reuse", async (t) => {
  const { paths, write } = await fixture(t);
  const entries = [
    ["configDir", "config.json", '{"baseUrl":"https://one.test","sessionToken":"token","emulators":[{"name":"ppsspp","path":"/bin/ppsspp"}]}'],
    ["configDir", "emulatorsConfig_one.test/pcsx2/inis/PCSX2.ini", "settings"],
    ["configDir", "emulatorsConfig/dolphin/User.ini", "settings"],
    ["dataDir", "roms_one.test/psp/rom_42/game.iso", "ROM bytes"],
    ["dataDir", "roms_one.test/local-roms.json", '{"version":1}'],
    ["dataDir", "roms_one.test/.metadata/covers/42.image", "cover bytes"],
    ["dataDir", "saves_two.test/psp/rom_42/save.bin", "save bytes"],
    ["dataDir", "saves_two.test/3ds/rom_42_session/.romm-client/azahar-config-transaction.json", "transaction"],
    ["dataDir", "saves_two.test/3ds/rom_42_session/sdmc/title/save.bin", "session bytes"],
    ["dataDir", "roms/psp/rom_43.zip", "zip bytes"],
  ];
  for (const [, name, content] of entries) await write(paths.legacyDir, name, content);
  assert.deepEqual(await migrateAppStorage(paths), []);
  for (const [root, name, content] of entries) assert.equal(await fs.readFile(path.join(paths[root], name), "utf8"), content);
  await assert.rejects(fs.stat(paths.legacyDir), { code: "ENOENT" });
  assert.deepEqual(await migrateAppStorage(paths), []);
});

test("existing entries win without mixing save sessions; legacy conflicts and unknown files remain", async (t) => {
  const { paths, write } = await fixture(t);
  await write(paths.legacyDir, "config.json", "old config");
  await write(paths.configDir, "config.json", "new config");
  await write(paths.legacyDir, "saves_one/rom_42_session/old.bin", "old save");
  await write(paths.dataDir, "saves_one/rom_42_session/new.bin", "new save");
  await write(paths.legacyDir, "roms_two/game.iso", "migrate me");
  await write(paths.legacyDir, "notes.txt", "keep me");
  const expected = [path.join(paths.legacyDir, "config.json"), path.join(paths.legacyDir, "saves_one")];
  assert.deepEqual((await migrateAppStorage(paths)).sort(), expected.sort());
  assert.equal(await fs.readFile(path.join(paths.configDir, "config.json"), "utf8"), "new config");
  assert.equal(await fs.readFile(path.join(paths.legacyDir, "config.json"), "utf8"), "old config");
  assert.equal(await fs.readFile(path.join(paths.legacyDir, "saves_one/rom_42_session/old.bin"), "utf8"), "old save");
  assert.equal(await fs.readFile(path.join(paths.dataDir, "saves_one/rom_42_session/new.bin"), "utf8"), "new save");
  await assert.rejects(fs.stat(path.join(paths.dataDir, "saves_one/rom_42_session/old.bin")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(paths.legacyDir, "notes.txt"), "utf8"), "keep me");
  assert.equal(await fs.readFile(path.join(paths.dataDir, "roms_two/game.iso"), "utf8"), "migrate me");
  assert.deepEqual((await migrateAppStorage(paths)).sort(), expected.sort());
});

function simulateCrossDevice(t, paths) {
  const rename = fs.rename;
  t.mock.method(fs, "rename", async (source, destination) => {
    if (path.dirname(source) === paths.legacyDir) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
    return rename(source, destination);
  });
}

test("cross-filesystem migration publishes a complete copy and removes the source", async (t) => {
  const { paths, write } = await fixture(t);
  await write(paths.legacyDir, "config.json", "config");
  await write(paths.legacyDir, "saves_one/session/save.bin", "save");
  simulateCrossDevice(t, paths);
  assert.deepEqual(await migrateAppStorage(paths), []);
  assert.equal(await fs.readFile(path.join(paths.configDir, "config.json"), "utf8"), "config");
  assert.equal(await fs.readFile(path.join(paths.dataDir, "saves_one/session/save.bin"), "utf8"), "save");
  assert.deepEqual(await fs.readdir(paths.dataDir), ["saves_one"]);
  await assert.rejects(fs.stat(paths.legacyDir), { code: "ENOENT" });
});

test("failed cross-filesystem copies retain original data and can be retried", async (t) => {
  const { paths, write } = await fixture(t);
  await write(paths.legacyDir, "saves_one/session/save.bin", "save");
  simulateCrossDevice(t, paths);
  const cp = t.mock.method(fs, "cp", async (_source, destination) => {
    await write(destination, "partial.bin", "partial");
    throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
  });
  await assert.rejects(migrateAppStorage(paths), { code: "ENOSPC" });
  assert.equal(await fs.readFile(path.join(paths.legacyDir, "saves_one/session/save.bin"), "utf8"), "save");
  assert.deepEqual(await fs.readdir(paths.dataDir), []);
  cp.mock.restore();
  await migrateAppStorage(paths);
  assert.equal(await fs.readFile(path.join(paths.dataDir, "saves_one/session/save.bin"), "utf8"), "save");
});

test("an XDG root equal to the legacy root is left in place", async (t) => {
  const { paths, write } = await fixture(t);
  paths.configDir = paths.legacyDir;
  await write(paths.legacyDir, "config.json", "config");
  await write(paths.legacyDir, "roms_one/game.iso", "ROM");
  assert.deepEqual(await migrateAppStorage(paths), []);
  assert.equal(await fs.readFile(path.join(paths.configDir, "config.json"), "utf8"), "config");
  assert.equal(await fs.readFile(path.join(paths.dataDir, "roms_one/game.iso"), "utf8"), "ROM");
});

test("read errors abort migration instead of pretending no legacy data exists", async (t) => {
  const { paths } = await fixture(t);
  t.mock.method(fs, "lstat", async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); });
  await assert.rejects(migrateAppStorage(paths), { code: "EACCES" });
});

test("migration refuses to move a directory inside itself", async (t) => {
  const { paths, write } = await fixture(t);
  await write(paths.legacyDir, "roms_one/game.iso", "ROM");
  for (const suffix of ["", "nested"]) {
    await assert.rejects(migrateAppStorage({ ...paths, dataDir: path.join(paths.legacyDir, "roms_one", suffix) }), /own subdirectory/);
    assert.equal(await fs.readFile(path.join(paths.legacyDir, "roms_one/game.iso"), "utf8"), "ROM");
  }
});
