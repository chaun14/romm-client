const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { createExternalProcessEnv } = require("../out/utils/ExternalProcess.js");
const {
  getPcsx2DataRoot,
  getPcsx2LaunchArguments,
  getPpssppSessionMemstickDirectory,
} = require("../out/utils/EmulatorRuntime.js");

test("external emulator environment does not inherit AppImage identity or bundled libraries", () => {
  const source = {
    APPIMAGE: "/home/user/RomMClient.AppImage",
    APPDIR: "/tmp/.mount_romm",
    ARGV0: "./RomMClient.AppImage",
    OWD: "/home/user",
    PATH: "/tmp/.mount_romm/usr/bin:/usr/local/bin:/usr/bin",
    LD_LIBRARY_PATH: "/tmp/.mount_romm/usr/lib:/opt/custom/lib",
    LD_PRELOAD: "/tmp/.mount_romm/usr/lib/libbroken.so /opt/custom/lib/libkeep.so",
    XDG_DATA_DIRS: "/tmp/.mount_romm/usr/share:/usr/local/share:/usr/share",
    GSETTINGS_SCHEMA_DIR: "/tmp/.mount_romm/usr/share/glib-2.0/schemas",
    CUSTOM_VALUE: "preserved",
  };

  const env = createExternalProcessEnv({ XDG_CONFIG_HOME: "/tmp/session" }, source, "linux");

  assert.equal(env.APPIMAGE, undefined);
  assert.equal(env.APPDIR, undefined);
  assert.equal(env.ARGV0, undefined);
  assert.equal(env.OWD, undefined);
  assert.equal(env.PATH, "/usr/local/bin:/usr/bin");
  assert.equal(env.LD_LIBRARY_PATH, "/opt/custom/lib");
  assert.equal(env.LD_PRELOAD, "/opt/custom/lib/libkeep.so");
  assert.equal(env.XDG_DATA_DIRS, "/usr/local/share:/usr/share");
  assert.equal(env.GSETTINGS_SCHEMA_DIR, undefined);
  assert.equal(env.CUSTOM_VALUE, "preserved");
  assert.equal(env.XDG_CONFIG_HOME, "/tmp/session");
});

test("ordinary Linux environments are preserved", () => {
  const source = { PATH: "/usr/local/bin:/usr/bin", LD_LIBRARY_PATH: "/opt/custom/lib" };
  assert.deepEqual(createExternalProcessEnv({}, source, "linux"), source);
});

test("AppImage variables do not affect non-Linux platforms", () => {
  const source = { APPIMAGE: "C:\\RomM.AppImage", APPDIR: "C:\\mount", PATH: "C:\\mount;C:\\Windows" };
  assert.deepEqual(createExternalProcessEnv({}, source, "win32"), source);
});

test("environment overrides are merged without mutating the source", () => {
  const source = { PATH: "/usr/bin", KEEP: "source" };
  const env = createExternalProcessEnv({ KEEP: "override", EXTRA: "yes" }, source, "linux");
  assert.deepEqual(env, { PATH: "/usr/bin", KEEP: "override", EXTRA: "yes" });
  assert.deepEqual(source, { PATH: "/usr/bin", KEEP: "source" });
});

test("AppDir prefix lookalikes are preserved", () => {
  const env = createExternalProcessEnv(
    {},
    { APPIMAGE: "/apps/romm.AppImage", APPDIR: "/tmp/romm", PATH: "/tmp/romm/usr/bin:/tmp/romm-other/bin:/usr/bin" },
    "linux",
  );
  assert.equal(env.PATH, "/tmp/romm-other/bin:/usr/bin");
});

test("fully bundled path variables are removed", () => {
  const env = createExternalProcessEnv(
    {},
    { APPIMAGE: "/apps/romm.AppImage", APPDIR: "/tmp/romm/", QT_PLUGIN_PATH: "/tmp/romm/usr/plugins", QML2_IMPORT_PATH: "/tmp/romm/usr/qml" },
    "linux",
  );
  assert.equal(env.QT_PLUGIN_PATH, undefined);
  assert.equal(env.QML2_IMPORT_PATH, undefined);
});

test("AppImage identity is removed even when APPDIR is unavailable", () => {
  const env = createExternalProcessEnv({}, { APPIMAGE: "/apps/romm.AppImage", ARGV0: "romm", PATH: "/custom/bin" }, "linux");
  assert.equal(env.APPIMAGE, undefined);
  assert.equal(env.ARGV0, undefined);
  assert.equal(env.PATH, "/custom/bin");
});

test("PPSSPP session layout matches its XDG memstick convention", () => {
  const session = path.join("tmp", "rom-42");
  assert.equal(getPpssppSessionMemstickDirectory(session, "linux"), path.join(session, "memstick", "ppsspp"));
  assert.equal(getPpssppSessionMemstickDirectory(session, "win32"), path.join(session, "memstick"));
});

test("PCSX2 Linux layout and arguments avoid portable mode", () => {
  const session = path.join("tmp", "rom-42");
  assert.equal(getPcsx2DataRoot(session, "linux"), path.join(session, "PCSX2"));
  assert.equal(getPcsx2DataRoot(session, "win32"), session);
  assert.deepEqual(getPcsx2LaunchArguments("/games/game.iso", "linux"), ["-fullscreen", "--", "/games/game.iso"]);
  assert.deepEqual(getPcsx2LaunchArguments("C:\\games\\game.iso", "win32"), ["-portable", "-fullscreen", "--", "C:\\games\\game.iso"]);
});

test("PCSX2 portable arguments are retained on macOS", () => {
  assert.deepEqual(getPcsx2LaunchArguments("/games/game.iso", "darwin"), ["-portable", "-fullscreen", "--", "/games/game.iso"]);
});

test("runtime path helpers preserve spaces and absolute paths", () => {
  const session = path.join(path.parse(process.cwd()).root, "RomM Saves", "rom 42");
  assert.equal(getPpssppSessionMemstickDirectory(session, "linux"), path.join(session, "memstick", "ppsspp"));
  assert.equal(getPcsx2DataRoot(session, "linux"), path.join(session, "PCSX2"));
});
