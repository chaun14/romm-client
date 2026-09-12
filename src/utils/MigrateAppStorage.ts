import fs from "fs/promises";
import path from "path";
import { AppPaths, getAppPaths } from "./AppPaths";

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error: any) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Run before settings, ROM discovery or save recovery. Move each complete entry
 * atomically so a partially copied save session can never be used by the client.
 * Existing destinations win; their legacy counterparts remain for manual recovery.
 */
export async function migrateAppStorage(directories: AppPaths = getAppPaths()): Promise<string[]> {
  const { legacyDir, configDir, dataDir } = directories;
  if (!legacyDir || !(await exists(legacyDir))) return [];

  const conflicts: string[] = [];
  for (const entry of await fs.readdir(legacyDir, { withFileTypes: true })) {
    const isConfig = entry.name === "config.json" || /^emulatorsConfig(?:_|$)/.test(entry.name);
    const isData = /^(?:roms|saves)(?:_|$)/.test(entry.name);
    // Leave unrelated files alone, including leftovers from manual migrations.
    if (!isConfig && !isData) continue;

    const source = path.resolve(legacyDir, entry.name);
    const targetRoot = path.resolve(isConfig ? configDir : dataDir);
    const destination = path.join(targetRoot, entry.name);
    if (source === destination) continue;
    if (targetRoot === source || targetRoot.startsWith(source + path.sep)) {
      throw new Error(`Cannot migrate ${source} into its own subdirectory ${targetRoot}`);
    }
    if (await exists(destination)) {
      conflicts.push(source);
      continue;
    }

    await fs.mkdir(targetRoot, { recursive: true, mode: 0o700 });
    try {
      await fs.rename(source, destination);
    } catch (error: any) {
      if (error.code !== "EXDEV") throw error;

      // XDG roots can be on another filesystem. Publish only after the whole
      // copy succeeds, and retain the source until then (also on interruption).
      const staging = await fs.mkdtemp(path.join(targetRoot, ".romm-migration-"));
      try {
        const stagedEntry = path.join(staging, entry.name);
        await fs.cp(source, stagedEntry, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
        if (await exists(destination)) {
          conflicts.push(source);
          continue;
        }
        await fs.rename(stagedEntry, destination);
        // source is an immediate child enumerated from the legacy directory.
        if (path.dirname(source) !== path.resolve(legacyDir)) throw new Error("Invalid migration source");
        await fs.rm(source, { recursive: true });
      } finally {
        if (path.dirname(staging) !== targetRoot) throw new Error("Invalid migration staging directory");
        await fs.rm(staging, { recursive: true, force: true });
      }
    }
  }

  // Never recursively remove the legacy root: conflicts and unknown files stay.
  try {
    await fs.rmdir(legacyDir);
  } catch (error: any) {
    if (!["ENOTEMPTY", "EEXIST", "ENOENT"].includes(error.code)) throw error;
  }
  return conflicts;
}
