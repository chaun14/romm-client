const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { HashCalculator } = require("../out/utils/HashCalculator.js");
const { makeTempDir, silenceConsole } = require("./helpers.js");

async function fixture(t, contents, name = "fixture.bin") {
  const directory = await makeTempDir(t, "romm-hash-");
  const file = path.join(directory, name);
  await fs.writeFile(file, contents);
  return file;
}

test("calculates canonical CRC32, MD5 and SHA1 values", async (t) => {
  silenceConsole(t);
  const file = await fixture(t, "123456789");
  assert.equal(await HashCalculator.calculateCRC32(file), "cbf43926");
  assert.equal(await HashCalculator.calculateMD5(file), "25f9e794323b453885f5181f1b624d0b");
  assert.equal(await HashCalculator.calculateSHA1(file), "f7c3bc1d808e04732adf679965ccc34ca7ae3441");
});

test("calculates hashes for an empty file", async (t) => {
  silenceConsole(t);
  const file = await fixture(t, Buffer.alloc(0));
  assert.deepEqual(await HashCalculator.calculateAllHashes(file), {
    crc32: "00000000",
    md5: "d41d8cd98f00b204e9800998ecf8427e",
    sha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
  });
});

test("calculateAllHashes returns every digest", async (t) => {
  silenceConsole(t);
  const file = await fixture(t, "RomM");
  const hashes = await HashCalculator.calculateAllHashes(file);
  assert.match(hashes.crc32, /^[0-9a-f]{8}$/);
  assert.match(hashes.md5, /^[0-9a-f]{32}$/);
  assert.match(hashes.sha1, /^[0-9a-f]{40}$/);
});

test("integrity succeeds when any supported digest matches", async (t) => {
  silenceConsole(t);
  const file = await fixture(t, "123456789");
  const result = await HashCalculator.verifyFileIntegrity(file, {
    crc_hash: "wrong",
    md5_hash: "25f9e794323b453885f5181f1b624d0b",
    sha1_hash: "wrong",
  });
  assert.equal(result.isValid, true);
  assert.equal(result.results.md5.valid, true);
  assert.equal(result.results.crc32.valid, false);
});

test("integrity comparison is case-insensitive", async (t) => {
  silenceConsole(t);
  const file = await fixture(t, "123456789");
  const result = await HashCalculator.verifyFileIntegrity(file, {
    crc_hash: "CBF43926",
    md5_hash: "",
    sha1_hash: "",
  });
  assert.equal(result.isValid, true);
  assert.equal(result.results.crc32.valid, true);
});

test("integrity fails when all digests differ", async (t) => {
  silenceConsole(t);
  const file = await fixture(t, "123456789");
  const result = await HashCalculator.verifyFileIntegrity(file, { crc_hash: "0", md5_hash: "0", sha1_hash: "0" });
  assert.equal(result.isValid, false);
});

test("missing files produce contextual calculation errors", async (t) => {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-hash-");
  await assert.rejects(HashCalculator.calculateMD5(path.join(directory, "missing.bin")), /Failed to calculate MD5/);
  await assert.rejects(HashCalculator.calculateCRC32(path.join(directory, "missing.bin")), /Failed to calculate CRC32/);
});

test("integrity converts filesystem errors into a failed result", async (t) => {
  silenceConsole(t);
  const directory = await makeTempDir(t, "romm-hash-");
  const missing = path.join(directory, "missing.bin");
  const result = await HashCalculator.verifyFileIntegrity(missing, { crc_hash: "", md5_hash: "", sha1_hash: "" });
  assert.equal(result.isValid, false);
  assert.equal(result.filePath, missing);
  assert.match(result.error, /Failed to calculate hashes/);
});
