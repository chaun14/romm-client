const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function makeTempDir(t, prefix = "romm-test-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function makeRom(overrides = {}) {
  return {
    id: 42,
    name: "Test ROM",
    fs_name: "test.iso",
    fs_size_bytes: 9,
    platform_slug: "psp",
    files: [],
    has_simple_single_file: false,
    has_multiple_files: false,
    has_nested_single_file: false,
    missing_from_fs: false,
    crc_hash: "",
    md5_hash: "",
    sha1_hash: "",
    ...overrides,
  };
}

function silenceConsole(t) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  t.after(() => Object.assign(console, original));
}

module.exports = { makeRom, makeTempDir, silenceConsole };
