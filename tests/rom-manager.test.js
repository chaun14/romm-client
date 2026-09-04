const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");

const { RomManager } = require("../out/managers/RomManager.js");
const { makeRom, makeTempDir, silenceConsole } = require("./helpers.js");

async function fixture(t, onlineApi = null) {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-rom-manager-");
  let api = onlineApi;
  const client = {
    settings: { baseUrl: "https://romm.test" },
    getRomFolder: () => root,
    getOnlineRommApi: () => api,
  };
  return { root, client, manager: new RomManager(client), setApi: (value) => (api = value) };
}

test("download metadata detection covers every RomM layout", async (t) => {
  const { manager } = await fixture(t);
  assert.equal(manager.hasDownloadMetadata(makeRom()), false);
  assert.equal(manager.hasDownloadMetadata(makeRom({ has_simple_single_file: true })), true);
  assert.equal(manager.hasDownloadMetadata(makeRom({ has_multiple_files: true })), true);
  assert.equal(manager.hasDownloadMetadata(makeRom({ has_nested_single_file: true })), true);
  assert.equal(manager.hasDownloadMetadata(makeRom({ files: [{ id: 1 }] })), true);
});

test("ROM file discovery is case-insensitive and recursive", async (t) => {
  const { manager, root } = await fixture(t);
  const nested = path.join(root, "archive", "PSP_GAME");
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(root, "readme.txt"), "ignore");
  await fs.writeFile(path.join(nested, "GAME.ISO"), "rom");
  assert.equal(manager.findRomFileInPath(root, [".iso", ".cso"]), path.join(nested, "GAME.ISO"));
  assert.equal(manager.findRomFileInPath(root, [".3ds"]), null);
  assert.equal(manager.findRomFileInPath(path.join(root, "missing"), [".iso"]), null);
});

test("ROM discovery prefers a supported top-level image", async (t) => {
  const { manager, root } = await fixture(t);
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, "top.cso"), "top");
  await fs.writeFile(path.join(root, "nested", "nested.iso"), "nested");
  assert.equal(manager.findRomFileInPath(root, [".iso", ".cso"]), path.join(root, "top.cso"));
});

test("ensureDirectory creates folders and rejects file collisions", async (t) => {
  const { manager, root } = await fixture(t);
  const directory = path.join(root, "new", "nested");
  await manager.ensureDirectory(directory, "test");
  assert.equal((await fs.stat(directory)).isDirectory(), true);
  const file = path.join(root, "file");
  await fs.writeFile(file, "x");
  await assert.rejects(manager.ensureDirectory(file, "test"), /not a directory/);
});

test("stale partial cleanup stays inside the cache and keeps recent files", async (t) => {
  const { manager, root } = await fixture(t);
  const directory = path.join(root, "psp", "rom_1");
  await fs.mkdir(directory, { recursive: true });
  const stale = path.join(directory, "old.iso.part");
  const recent = path.join(directory, "new.iso.part");
  const complete = path.join(directory, "game.iso");
  await fs.writeFile(stale, "old");
  await fs.writeFile(recent, "new");
  await fs.writeFile(complete, "rom");
  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await fs.utimes(stale, oldDate, oldDate);
  const result = await manager.cleanupStalePartialDownloads(24 * 60 * 60 * 1000);
  assert.deepEqual(result, { deletedCount: 1, failedCount: 0 });
  assert.equal(fsSync.existsSync(stale), false);
  assert.equal(fsSync.existsSync(recent), true);
  assert.equal(fsSync.existsSync(complete), true);
});

test("local ROM loading skips empty folders and records valid folders", async (t) => {
  const { manager, root } = await fixture(t);
  manager.roms = [makeRom({ id: 1 }), makeRom({ id: 2 })];
  await fs.mkdir(path.join(root, "psp", "rom_1"), { recursive: true });
  await fs.mkdir(path.join(root, "psp", "rom_2"), { recursive: true });
  await fs.writeFile(path.join(root, "psp", "rom_1", "game.iso"), "rom");
  assert.equal(await manager.loadLocalRoms(), 1);
  assert.equal(manager.getLocalRoms()[0].id, 1);
  assert.deepEqual(manager.getLocalRoms()[0].localFiles, [path.join(root, "psp", "rom_1", "game.iso")]);
});

test("deleteLocalRom removes its directory and manifest entry", async (t) => {
  const { manager, root } = await fixture(t);
  const directory = path.join(root, "psp", "rom_7");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "game.iso"), "rom");
  manager.localRoms = [{ ...makeRom({ id: 7 }), localPath: directory, localFiles: [path.join(directory, "game.iso")] }];
  assert.deepEqual(await manager.deleteLocalRom(7), { success: true });
  assert.equal(fsSync.existsSync(directory), false);
  assert.equal(manager.getLocalRoms().length, 0);
  assert.equal((await manager.deleteLocalRom(999)).success, false);
});

test("missing remote ROMs fail clearly while offline", async (t) => {
  const { manager } = await fixture(t);
  await assert.rejects(manager.launchRom(makeRom(), () => {}, () => {}), /RomM is offline/);
});

test("existing valid local ROMs avoid redundant downloads", async (t) => {
  const { manager, root } = await fixture(t, { downloadRom: async () => { throw new Error("must not download"); } });
  const directory = path.join(root, "psp", "rom_42");
  await fs.mkdir(directory, { recursive: true });
  const local = { ...makeRom(), localPath: directory, localFiles: [path.join(directory, "game.iso")] };
  manager.localRoms = [local];
  manager.checkRomIntegrity = async () => true;
  let completed = false;
  const result = await manager.launchRom(makeRom(), () => {}, () => {}, () => (completed = true));
  assert.equal(result.localRom, local);
  assert.equal(completed, true);
});

test("lightweight ROM metadata is refreshed before downloading", async (t) => {
  let receivedRom;
  const detailed = makeRom({ id: 12, fs_name: "game.iso", has_simple_single_file: true, files: [{ id: 120, file_name: "game.iso", file_size_bytes: 3 }] });
  const api = {
    fetchRomById: async () => ({ success: true, data: detailed }),
    downloadRom: async (rom, destination) => {
      receivedRom = rom;
      await fs.writeFile(path.join(destination, "game.iso"), "rom");
      return { success: true };
    },
    getBaseUrl: () => "https://romm.test",
    getAuthHeaders: () => ({}),
  };
  const { manager } = await fixture(t, api);
  manager.checkRomIntegrity = async () => true;
  const result = await manager.launchRom(makeRom({ id: 12, files: [] }), () => {}, () => {});
  assert.equal(receivedRom, detailed);
  assert.equal(result.rom, detailed);
  assert.equal(result.localRom.files[0].file_name, "game.iso");
});

test("uppercase ZIP downloads are extracted and nested images are discoverable", async (t) => {
  const zipBuffer = (() => {
    const zip = new AdmZip();
    zip.addFile("folder/GAME.ISO", Buffer.from("iso-data"));
    return zip.toBuffer();
  })();
  const detailed = makeRom({ id: 13, fs_name: "GAME.ZIP", has_simple_single_file: true, files: [{ id: 130, file_name: "GAME.ZIP", file_size_bytes: zipBuffer.length }] });
  const api = {
    fetchRomById: async () => ({ success: true, data: detailed }),
    downloadRom: async (_rom, destination) => {
      await fs.writeFile(path.join(destination, "GAME.ZIP"), zipBuffer);
      return { success: true };
    },
    getBaseUrl: () => "https://romm.test",
    getAuthHeaders: () => ({}),
  };
  const { manager } = await fixture(t, api);
  manager.checkRomIntegrity = async () => true;
  const result = await manager.launchRom(detailed, () => {}, () => {});
  assert.equal(await fs.readFile(path.join(result.localRom.localPath, "folder", "GAME.ISO"), "utf8"), "iso-data");
  assert.equal(manager.findRomFileInPath(result.localRom.localPath, [".iso"]), path.join(result.localRom.localPath, "folder", "GAME.ISO"));
});

test("cover MIME detection recognizes supported image signatures", async (t) => {
  const { manager } = await fixture(t);
  assert.equal(manager.getImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(manager.getImageMimeType(Buffer.from([0xff, 0xd8, 0xff])), "image/jpeg");
  assert.equal(manager.getImageMimeType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(manager.getImageMimeType(Buffer.from("RIFFxxxxWEBP")), "image/webp");
  assert.equal(manager.getImageMimeType(Buffer.from("xxxxftypavif")), "image/avif");
  assert.equal(manager.getImageMimeType(Buffer.from("not an image")), null);
});

test("cached covers are returned as validated data URLs", async (t) => {
  const { manager, root } = await fixture(t);
  const coverDir = path.join(root, ".metadata", "covers");
  await fs.mkdir(coverDir, { recursive: true });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  await fs.writeFile(path.join(coverDir, "7.image"), png);
  await fs.writeFile(path.join(coverDir, "8.image"), "html response");
  assert.equal(await manager.getLocalCoverDataUrl(7), `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(await manager.getLocalCoverDataUrl(8), null);
  assert.equal(await manager.getLocalCoverDataUrl(0), null);
  assert.equal(await manager.getLocalCoverDataUrl(999), null);
});

test("existing non-empty cover files are reused without network access", async (t) => {
  let onlineCalls = 0;
  const { manager, root } = await fixture(t, { getBaseUrl: () => "https://romm.test" });
  const coverPath = path.join(root, ".metadata", "covers", "42.image");
  await fs.mkdir(path.dirname(coverPath), { recursive: true });
  await fs.writeFile(coverPath, Buffer.from([0xff, 0xd8, 0xff]));
  const originalDownload = manager.downloadLocalCover;
  manager.downloadLocalCover = async () => { onlineCalls++; return undefined; };
  assert.equal(await manager.ensureLocalCover(makeRom({ url_cover: "/cover.jpg" })), "romm-local-cover://42");
  assert.equal(onlineCalls, 0);
  manager.downloadLocalCover = originalDownload;
});

test("cover caching is skipped without a source or an online API", async (t) => {
  const { manager } = await fixture(t);
  assert.equal(await manager.ensureLocalCover(makeRom()), undefined);
  assert.equal(await manager.ensureLocalCover(makeRom({ url_cover: "/cover.jpg" })), undefined);
});

test("local metadata manifests validate their schema and filter broken ROM entries", async (t) => {
  const { manager, root } = await fixture(t);
  const valid = makeRom({ id: 3, platform_slug: "psp" });
  await fs.writeFile(path.join(root, "local-roms.json"), JSON.stringify({
    version: 1,
    entrySource: "/api/roms/{id}",
    updatedAt: "2026-01-01T00:00:00.000Z",
    roms: [valid, null, { id: "4", platform_slug: "ps2" }, { id: 5 }],
  }));
  const manifest = await manager.loadLocalRomManifest();
  assert.deepEqual(manifest.roms, [valid]);
  assert.equal(manager.detailedMetadataRomIds.has(3), true);

  await fs.writeFile(path.join(root, "local-roms.json"), JSON.stringify({ version: 2, roms: [] }));
  assert.equal(await manager.loadLocalRomManifest(), null);
});

test("saved local metadata excludes machine-specific cache fields", async (t) => {
  const { manager, root } = await fixture(t);
  manager.localRoms = [{
    ...makeRom({ id: 4 }),
    localPath: path.join(root, "psp", "rom_4"),
    localFiles: ["game.iso"],
    localCoverUrl: "romm-local-cover://4",
  }];
  manager.detailedMetadataRomIds.add(4);
  await manager.saveLocalRomManifest();
  const stored = JSON.parse(await fs.readFile(path.join(root, "local-roms.json"), "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.entrySource, "/api/roms/{id}");
  assert.equal(stored.roms[0].id, 4);
  assert.equal("localPath" in stored.roms[0], false);
  assert.equal("localFiles" in stored.roms[0], false);
  assert.equal("localCoverUrl" in stored.roms[0], false);
});

test("remote ROM loading handles offline, failed and successful API states", async (t) => {
  const state = await fixture(t);
  await assert.rejects(state.manager.loadRemoteRoms(), /not available/);
  state.setApi({ fetchAllRoms: async () => ({ success: false, error: "server" }) });
  await assert.rejects(state.manager.loadRemoteRoms(), /Failed to load/);
  state.setApi({ fetchAllRoms: async () => ({ success: true, data: [makeRom({ id: 1 }), makeRom({ id: 2 })] }) });
  assert.equal(await state.manager.loadRemoteRoms(), 2);
  assert.deepEqual(state.manager.getRoms().map((rom) => rom.id), [1, 2]);
});

test("detailed metadata refresh updates known ROMs and tolerates API failures", async (t) => {
  const responses = [
    { success: true, data: makeRom({ id: 9, name: "Detailed" }) },
    { success: false, error: "missing" },
  ];
  const { manager } = await fixture(t, { fetchRomById: async () => responses.shift() });
  manager.roms = [makeRom({ id: 9, name: "Summary" })];
  assert.equal((await manager.fetchDetailedRomMetadata(9)).name, "Detailed");
  assert.equal(manager.getRoms()[0].name, "Detailed");
  assert.equal(await manager.fetchDetailedRomMetadata(10), null);
});

test("partial cleanup is a no-op when no cache root is configured", async (t) => {
  silenceConsole(t);
  const manager = new RomManager({ getRomFolder: () => null });
  assert.deepEqual(await manager.cleanupStalePartialDownloads(), { deletedCount: 0, failedCount: 0 });
});
