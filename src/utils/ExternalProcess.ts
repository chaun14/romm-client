/**
 * Build an environment for programs launched outside RomM Client.
 *
 * AppImage launchers inject their own identity and library paths. Passing those
 * values to another AppImage or a system emulator can make it load RomM
 * Client's libraries or mistake RomM Client's AppImage for its own.
 */
export function createExternalProcessEnv(
  overrides: NodeJS.ProcessEnv = {},
  sourceEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...sourceEnv, ...overrides };
  if (platform !== "linux" || (!sourceEnv.APPIMAGE && !sourceEnv.APPDIR)) return env;

  const appDir = sourceEnv.APPDIR;
  for (const name of ["APPIMAGE", "APPDIR", "ARGV0", "OWD"]) delete env[name];

  if (appDir) {
    for (const name of [
      "PATH",
      "LD_LIBRARY_PATH",
      "LD_PRELOAD",
      "PYTHONPATH",
      "PERLLIB",
      "XDG_DATA_DIRS",
      "GTK_PATH",
      "GIO_EXTRA_MODULES",
      "GI_TYPELIB_PATH",
      "GSETTINGS_SCHEMA_DIR",
      "GDK_PIXBUF_MODULE_FILE",
      "QT_PLUGIN_PATH",
      "QT_QPA_PLATFORM_PLUGIN_PATH",
      "QML_IMPORT_PATH",
      "QML2_IMPORT_PATH",
    ]) {
      const value = env[name];
      if (!value) continue;
      const cleaned = value
        .split(name === "LD_PRELOAD" ? /[:\s]+/ : ":")
        .filter((entry) => entry && !isWithinAppDir(entry, appDir))
        .join(":");
      if (cleaned) env[name] = cleaned;
      else delete env[name];
    }
  }

  return env;
}

function isWithinAppDir(candidate: string, appDir: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedCandidate = normalize(candidate);
  const normalizedAppDir = normalize(appDir);
  return normalizedCandidate === normalizedAppDir || normalizedCandidate.startsWith(`${normalizedAppDir}/`);
}
