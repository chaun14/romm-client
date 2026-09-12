const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { getAppPaths, getInstancePaths } = require("../out/utils/AppPaths.js");

test("Linux separates configuration and persistent data with XDG defaults", () => {
  for (const value of [undefined, "", "relative/path"]) {
    assert.deepEqual(getAppPaths("linux", { HOME: "/home/player", XDG_CONFIG_HOME: value, XDG_DATA_HOME: value }, "/fallback"), {
      configDir: "/home/player/.config/romm-client",
      dataDir: "/home/player/.local/share/romm-client",
      legacyDir: "/home/player/romm-client",
    });
  }
});

test("Linux honors independent absolute XDG roots and remembers the old APPDATA override", () => {
  assert.deepEqual(getAppPaths("linux", { APPDATA: "/old", XDG_CONFIG_HOME: "/config", XDG_DATA_HOME: "/disk/games" }, "/home/player"), {
    configDir: "/config/romm-client", dataDir: "/disk/games/romm-client", legacyDir: "/old/romm-client",
  });
  assert.equal(getAppPaths("linux", { XDG_CONFIG_HOME: "/custom" }, "/home/player").dataDir, "/home/player/.local/share/romm-client");
});

test("Windows and macOS retain their locations without migration", () => {
  assert.deepEqual(getAppPaths("win32", { APPDATA: "C:\\Users\\player\\AppData\\Roaming", HOME: "C:\\other", XDG_DATA_HOME: "/ignored" }), {
    configDir: "C:\\Users\\player\\AppData\\Roaming\\romm-client", dataDir: "C:\\Users\\player\\AppData\\Roaming\\romm-client", legacyDir: null,
  });
  assert.deepEqual(getAppPaths("darwin", { HOME: "/Users/player" }), {
    configDir: "/Users/player/romm-client", dataDir: "/Users/player/romm-client", legacyDir: null,
  });
});

test("instance folders preserve hostname suffixes and use the appropriate root", () => {
  const roots = { configDir: "config", dataDir: "data", legacyDir: null };
  assert.deepEqual(getInstancePaths("https://romm.example:8443/library", roots), {
    roms: path.join("data", "roms_romm.example"),
    saves: path.join("data", "saves_romm.example"),
    emulatorConfigs: path.join("config", "emulatorsConfig_romm.example"),
  });
  for (const url of ["", "invalid"]) assert.equal(getInstancePaths(url, roots).roms, path.join("data", "roms"));
});

test("relative home and legacy roots are rejected instead of selecting data in the working directory", () => {
  assert.throws(() => getAppPaths("linux", { HOME: "relative-home" }, "/home/player"), /HOME must be an absolute path/);
  assert.throws(() => getAppPaths("linux", { HOME: "/home/player", APPDATA: "relative-data" }), /APPDATA must be an absolute path/);
  assert.throws(() => getAppPaths("linux", {}, "relative-fallback"), /HOME must be an absolute path/);
  assert.throws(() => getAppPaths("darwin", { HOME: "relative-home" }), /must be an absolute path/);
});

test("Windows rejects drive-relative and current-drive paths, while accepting UNC roots", () => {
  for (const APPDATA of ["relative", "C:relative", "\\rooted", "/rooted"]) {
    assert.throws(() => getAppPaths("win32", { APPDATA }), /must be an absolute path/);
  }
  assert.equal(getAppPaths("win32", { APPDATA: "\\\\server\\share\\profile" }).dataDir, "\\\\server\\share\\profile\\romm-client");
});

test("path resolution preserves spaces and normalizes trailing separators", () => {
  assert.deepEqual(getAppPaths("linux", { HOME: "/home/a player/", XDG_DATA_HOME: "/disk/my games/../library/" }), {
    configDir: "/home/a player/.config/romm-client",
    dataDir: "/disk/library/romm-client",
    legacyDir: "/home/a player/romm-client",
  });
  assert.throws(() => getAppPaths("linux", { HOME: "/home/player", XDG_DATA_HOME: "/data\0invalid" }), /XDG_DATA_HOME must be an absolute path/);
});
