import os from "os";
import path from "path";

export interface AppPaths {
  configDir: string;
  dataDir: string;
  legacyDir: string | null;
}

/** Keep all client storage paths together; emulator-owned directories are separate. */
export function getAppPaths(platform = process.platform, env = process.env, home = os.homedir()): AppPaths {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const absoluteRoot = (value: string, name: string): string => {
    const normalized = paths.normalize(value);
    // On Windows, "\\folder" is rooted on the current drive, not fully qualified.
    if (!paths.isAbsolute(normalized) || (platform === "win32" && paths.parse(normalized).root === "\\") || value.includes("\0")) {
      throw new Error(`${name} must be an absolute path; refusing to resolve application storage relative to the working directory`);
    }
    return normalized;
  };

  if (platform === "linux") {
    const linuxHome = absoluteRoot(env.HOME || home, "HOME");
    const xdgRoot = (value: string | undefined, fallback: string, name: string) =>
      value && paths.isAbsolute(value) ? absoluteRoot(value, name) : fallback;
    return {
      configDir: paths.join(xdgRoot(env.XDG_CONFIG_HOME, paths.join(linuxHome, ".config"), "XDG_CONFIG_HOME"), "romm-client"),
      dataDir: paths.join(xdgRoot(env.XDG_DATA_HOME, paths.join(linuxHome, ".local/share"), "XDG_DATA_HOME"), "romm-client"),
      // Preserve the old lookup order, but never guess where relative legacy data lives.
      legacyDir: paths.join(env.APPDATA ? absoluteRoot(env.APPDATA, "APPDATA") : linuxHome, "romm-client"),
    };
  }

  const directory = paths.join(absoluteRoot(env.APPDATA || env.HOME || home, "APPDATA or HOME"), "romm-client");
  return { configDir: directory, dataDir: directory, legacyDir: null };
}

export function getInstancePaths(baseUrl: string, directories = getAppPaths()) {
  let suffix = "";
  try {
    if (baseUrl) suffix = `_${new URL(baseUrl).hostname}`;
  } catch {
    // Keep the historical unsuffixed paths for missing or invalid URLs.
  }
  return {
    roms: path.join(directories.dataDir, `roms${suffix}`),
    saves: path.join(directories.dataDir, `saves${suffix}`),
    emulatorConfigs: path.join(directories.configDir, `emulatorsConfig${suffix}`),
  };
}
