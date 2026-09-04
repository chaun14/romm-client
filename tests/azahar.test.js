const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { AzaharEmulator } = require("../out/managers/emulators/AzaharEmulator.js");
const { makeTempDir, silenceConsole } = require("./helpers.js");

const config = (executable = "/emulator/azahar") => ({ path: executable, platform: "ignored", name: "ignored", extensions: [], args: [] });

test("Program IDs split into normalized high and low title IDs", () => {
  const emulator = new AzaharEmulator(config());
  assert.deepEqual(emulator.splitProgramId("000400000123ABCD"), { high: "00040000", low: "0123abcd" });
  assert.deepEqual(emulator.splitProgramId("1234"), { high: "00000000", low: "00001234" });
  assert.throws(() => emulator.splitProgramId("not-hex"), /Invalid 3DS Program ID/);
  assert.throws(() => emulator.splitProgramId("12345678901234567"), /Invalid 3DS Program ID/);
});

test("Windows tasklist CSV parsing handles commas and escaped quotes", () => {
  const emulator = new AzaharEmulator(config());
  assert.deepEqual(emulator.parseCsvRow('"azahar.exe","123","Console","1","10,000 K","Running","USER","0:01:00","Game, Title"'), [
    "azahar.exe", "123", "Console", "1", "10,000 K", "Running", "USER", "0:01:00", "Game, Title",
  ]);
  assert.deepEqual(emulator.parseCsvRow('"a","say ""hello"""'), ["a", 'say "hello"']);
});

test("Data Storage settings can be read, updated, inserted and removed", () => {
  const emulator = new AzaharEmulator(config());
  const source = "[General]\nfoo=bar\n[Data%20Storage]\nuse_custom_storage=false\nsdmc_directory=/old/\n[UI]\nx=1\n";
  assert.equal(emulator.readDataStorageSetting(source, "use_custom_storage"), "false");
  let updated = emulator.writeDataStorageSetting(source, "use_custom_storage", "true");
  updated = emulator.writeDataStorageSetting(updated, "new_key", "new-value");
  updated = emulator.writeDataStorageSetting(updated, "sdmc_directory", null);
  assert.equal(emulator.readDataStorageSetting(updated, "use_custom_storage"), "true");
  assert.equal(emulator.readDataStorageSetting(updated, "new_key"), "new-value");
  assert.equal(emulator.readDataStorageSetting(updated, "sdmc_directory"), null);
  assert.match(updated, /\[UI\]\nx=1/);
});

test("Data Storage section insertion preserves CRLF style", () => {
  const emulator = new AzaharEmulator(config());
  const updated = emulator.writeDataStorageSetting("[General]\r\nfoo=bar\r\n", "sdmc_directory", "C:/saves/");
  assert.match(updated, /\[Data%20Storage\]\r\nsdmc_directory=C:\/saves\/\r\n$/);
  assert.equal(emulator.writeDataStorageSetting("[General]\nfoo=bar\n", "missing", null), "[General]\nfoo=bar\n");
});

test("reads Program ID from a direct NCCH image", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-azahar-");
  const file = path.join(root, "game.cxi");
  const header = Buffer.alloc(0x200);
  header.write("NCCH", 0x100, "ascii");
  header.writeBigUInt64LE(0x000400000123abcdn, 0x118);
  await fs.writeFile(file, header);
  assert.equal(await new AzaharEmulator(config()).readProgramId(file), "000400000123abcd");
});

test("reads Program ID from the main NCSD partition", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-azahar-");
  const file = path.join(root, "game.3ds");
  const image = Buffer.alloc(0x400);
  image.write("NCSD", 0x100, "ascii");
  image.writeUInt32LE(1, 0x120);
  image.write("NCCH", 0x300, "ascii");
  image.writeBigUInt64LE(0x0004000000fedcban, 0x318);
  await fs.writeFile(file, image);
  assert.equal(await new AzaharEmulator(config()).readProgramId(file), "0004000000fedcba");
});

test("reads Program ID from Z3DS titleinfo metadata", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-azahar-");
  const file = path.join(root, "game.z3ds");
  const headerSize = 0x20;
  const name = Buffer.from("titleinfo");
  const metadata = Buffer.alloc(1 + 4 + name.length + 8 + 4);
  metadata[0] = 1;
  metadata[1] = 1;
  metadata[2] = name.length;
  metadata.writeUInt16LE(8, 3);
  name.copy(metadata, 5);
  metadata.writeBigUInt64LE(0x0004000000aabbccn, 5 + name.length);
  const image = Buffer.alloc(Math.max(0x200, headerSize + metadata.length));
  image.write("Z3DS", 0, "ascii");
  image.writeUInt16LE(headerSize, 0x0a);
  image.writeUInt32LE(metadata.length, 0x0c);
  metadata.copy(image, headerSize);
  await fs.writeFile(file, image);
  assert.equal(await new AzaharEmulator(config()).readProgramId(file), "0004000000aabbcc");
});

test("invalid, zero and missing images have no Program ID", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-azahar-");
  const invalid = path.join(root, "invalid.3ds");
  const zero = path.join(root, "zero.cxi");
  await fs.writeFile(invalid, "too short");
  const zeroHeader = Buffer.alloc(0x200);
  zeroHeader.write("NCCH", 0x100, "ascii");
  await fs.writeFile(zero, zeroHeader);
  const emulator = new AzaharEmulator(config());
  assert.equal(await emulator.readProgramId(invalid), null);
  assert.equal(await emulator.readProgramId(zero), null);
  assert.equal(await emulator.readProgramId(path.join(root, "missing")), null);
});

test("identity root discovery ignores malformed console IDs", async (t) => {
  const root = await makeTempDir(t, "romm-azahar-");
  const valid0 = "a".repeat(32);
  const valid1 = "B".repeat(32);
  await fs.mkdir(path.join(root, "Nintendo 3DS", valid0, valid1), { recursive: true });
  await fs.mkdir(path.join(root, "Nintendo 3DS", "invalid", valid1), { recursive: true });
  await fs.mkdir(path.join(root, "Nintendo 3DS", valid0, "invalid"), { recursive: true });
  assert.deepEqual(await new AzaharEmulator(config()).getIdentityRoots(root), [path.join(root, "Nintendo 3DS", valid0, valid1)]);
});

test("title save lookup is case-insensitive", async (t) => {
  const root = await makeTempDir(t, "romm-azahar-");
  const identity = path.join(root, "Nintendo 3DS", "a".repeat(32), "b".repeat(32));
  await fs.mkdir(path.join(identity, "title", "00040000", "00AABBCC", "data"), { recursive: true });
  await fs.writeFile(path.join(identity, "title", "00040000", "00AABBCC", "data", "00000001.sav"), "save");
  assert.equal(await new AzaharEmulator(config()).hasTitleSaveData(root, "0004000000aabbcc"), true);
  assert.equal(await new AzaharEmulator(config()).hasTitleSaveData(root, "0004000000ddeeff"), false);
});

test("relevant SDMC copy keeps one title plus extdata and excludes other titles", async (t) => {
  const root = await makeTempDir(t, "romm-azahar-");
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  const identityRelative = path.join("Nintendo 3DS", "a".repeat(32), "b".repeat(32));
  const identity = path.join(source, identityRelative);
  await fs.mkdir(path.join(identity, "title", "00040000", "00aabbcc", "data"), { recursive: true });
  await fs.mkdir(path.join(identity, "title", "00040000", "00ddeeff", "data"), { recursive: true });
  await fs.mkdir(path.join(identity, "extdata", "00000000", "00001234"), { recursive: true });
  await fs.writeFile(path.join(identity, "title", "00040000", "00aabbcc", "data", "wanted.sav"), "wanted");
  await fs.writeFile(path.join(identity, "title", "00040000", "00ddeeff", "data", "other.sav"), "other");
  await fs.writeFile(path.join(identity, "extdata", "00000000", "00001234", "ext.sav"), "ext");
  const count = await new AzaharEmulator(config()).copyRelevantSdmcData(source, destination, "0004000000aabbcc");
  assert.equal(count, 2);
  assert.equal(fsSync.existsSync(path.join(destination, identityRelative, "title", "00040000", "00aabbcc", "data", "wanted.sav")), true);
  assert.equal(fsSync.existsSync(path.join(destination, identityRelative, "title", "00040000", "00ddeeff", "data", "other.sav")), false);
  assert.equal(fsSync.existsSync(path.join(destination, identityRelative, "extdata", "00000000", "00001234", "ext.sav")), true);
});

test("Azahar save extraction atomically replaces the persistent snapshot", async (t) => {
  const root = await makeTempDir(t, "romm-azahar-");
  const session = path.join(root, "session");
  const persistent = path.join(root, "persistent");
  await fs.mkdir(path.join(session, "sdmc", "Nintendo 3DS"), { recursive: true });
  await fs.mkdir(persistent, { recursive: true });
  await fs.writeFile(path.join(session, "sdmc", "Nintendo 3DS", "new.sav"), "new");
  await fs.writeFile(path.join(persistent, "old.sav"), "old");
  const extracted = await new AzaharEmulator(config()).extractSavesFromSession(session, persistent);
  assert.deepEqual(extracted, [path.join("Nintendo 3DS", "new.sav")]);
  assert.equal(fsSync.existsSync(path.join(persistent, "old.sav")), false);
  assert.equal(await fs.readFile(path.join(persistent, "Nintendo 3DS", "new.sav"), "utf8"), "new");
});

test("platform directory resolution follows Windows, macOS and XDG conventions", async (t) => {
  const root = await makeTempDir(t, "romm-azahar-");
  const executable = path.join(root, "azahar", "azahar.exe");
  await fs.mkdir(path.join(path.dirname(executable), "user"), { recursive: true });
  const emulator = new AzaharEmulator(config(executable));
  assert.deepEqual(emulator.getAzaharDirectories("win32"), {
    data: path.join(path.dirname(executable), "user"),
    config: path.join(path.dirname(executable), "user", "config"),
  });
  assert.match(emulator.getAzaharDirectories("darwin").data, /Library[\\/]Application Support[\\/]Azahar$/);
  const linux = emulator.getAzaharDirectories("linux");
  assert.equal(path.basename(linux.data), "azahar-emu");
  assert.equal(path.basename(linux.config), "azahar-emu");
});

test("Azahar config transactions redirect SDMC and restore only managed settings", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-azahar-transaction-");
  const saveDir = path.join(root, "session");
  const sdmcDir = path.join(saveDir, "sdmc");
  const configPath = path.join(root, "qt-config.ini");
  const original = [
    "[Data%20Storage]",
    "use_custom_storage\\default=true",
    "use_custom_storage=false",
    "sdmc_directory\\default=true",
    "sdmc_directory=/personal/",
    "unrelated=before",
    "",
  ].join("\n");
  await fs.writeFile(configPath, original);

  const emulator = new AzaharEmulator(config());
  emulator.getConfigPath = () => configPath;
  await emulator.beginConfigTransaction(saveDir, sdmcDir);

  const redirected = await fs.readFile(configPath, "utf8");
  assert.equal(emulator.readDataStorageSetting(redirected, "use_custom_storage\\default"), "false");
  assert.equal(emulator.readDataStorageSetting(redirected, "use_custom_storage"), "true");
  assert.equal(emulator.readDataStorageSetting(redirected, "sdmc_directory\\default"), "false");
  assert.equal(emulator.readDataStorageSetting(redirected, "sdmc_directory"), `${sdmcDir.replace(/\\/g, "/")}/`);
  assert.equal(await fs.readFile(path.join(saveDir, ".romm-client", "qt-config.ini.bak"), "utf8"), original);

  await fs.writeFile(configPath, redirected.replace("unrelated=before", "unrelated=during"));
  assert.equal(await emulator.restoreConfigTransaction(saveDir), true);
  const restored = await fs.readFile(configPath, "utf8");
  assert.equal(emulator.readDataStorageSetting(restored, "use_custom_storage\\default"), "true");
  assert.equal(emulator.readDataStorageSetting(restored, "use_custom_storage"), "false");
  assert.equal(emulator.readDataStorageSetting(restored, "sdmc_directory\\default"), "true");
  assert.equal(emulator.readDataStorageSetting(restored, "sdmc_directory"), "/personal/");
  assert.match(restored, /unrelated=during/);
  assert.equal(fsSync.existsSync(path.join(saveDir, ".romm-client")), false);
});

test("Azahar config restoration falls back to the backup when the config disappeared", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-azahar-transaction-");
  const saveDir = path.join(root, "session");
  const configPath = path.join(root, "qt-config.ini");
  const original = "[Data%20Storage]\nuse_custom_storage=false\nsdmc_directory=/personal/\n";
  await fs.writeFile(configPath, original);
  const emulator = new AzaharEmulator(config());
  emulator.getConfigPath = () => configPath;
  await emulator.beginConfigTransaction(saveDir, path.join(saveDir, "sdmc"));
  await fs.rm(configPath);

  assert.equal(await emulator.restoreConfigTransaction(saveDir), true);
  assert.equal(await fs.readFile(configPath, "utf8"), original);
});

test("Azahar config restoration is idempotent and rejects corrupt metadata", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-azahar-transaction-");
  const emulator = new AzaharEmulator(config());
  assert.equal(await emulator.restoreConfigTransaction(root), true);
  const transactionDir = path.join(root, ".romm-client");
  await fs.mkdir(transactionDir);
  await fs.writeFile(path.join(transactionDir, "azahar-config-transaction.json"), "{broken");
  assert.equal(await emulator.restoreConfigTransaction(root), false);
  assert.equal(fsSync.existsSync(transactionDir), true);
});
