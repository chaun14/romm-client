const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RommApi } = require("../out/api/RommApi.js");
const { getApiAvailabilityEffect } = require("../out/utils/ApiAvailability.js");

test("local download validation errors preserve RomM availability", () => {
  assert.equal(getApiAvailabilityEffect(new Error("No downloadable files found")), "unchanged");
  assert.equal(getApiAvailabilityEffect(Object.assign(new Error("Disk full"), { code: "ENOSPC" })), "unchanged");
});

test("HTTP application errors prove that RomM remains reachable", () => {
  assert.equal(getApiAvailabilityEffect({ isAxiosError: true, response: { status: 404 } }), "available");
  assert.equal(getApiAvailabilityEffect({ isAxiosError: true, response: { status: 500 } }), "available");
});

test("authentication and network failures make the API unavailable", () => {
  assert.equal(getApiAvailabilityEffect({ isAxiosError: true, response: { status: 401 } }), "unavailable");
  assert.equal(getApiAvailabilityEffect({ isAxiosError: true, code: "ECONNREFUSED", request: {} }), "unavailable");
});

test("a ROM without download metadata fails without taking RomM offline", async () => {
  const downloadDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "romm-download-test-"));
  try {
    const api = new RommApi("http://127.0.0.1");
    api.available = true;
    const result = await api.downloadRom(
      {
        id: 352,
        name: "Wipeout Pulse",
        fs_name: "Wipeout Pulse",
        files: [],
        has_simple_single_file: false,
        has_multiple_files: false,
        has_nested_single_file: false,
      },
      downloadDirectory,
    );

    assert.equal(result.success, false);
    assert.match(result.error, /No downloadable files found/);
    assert.equal(api.isAvailable, true);
  } finally {
    await fs.rm(downloadDirectory, { recursive: true, force: true });
  }
});
