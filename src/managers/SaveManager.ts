import fs from "fs";
import path from "path";
import * as fsPromises from "fs/promises";

import { RommClient } from "../RomMClient";
import { Rom } from "../types/RommApi";
import { EmulatorManager } from "./EmulatorManager";

export interface SaveData {
  hasLocal: boolean;
  hasCloud: boolean;
  localSaveDir: string;
  cloudSaves: any[];
}

export class SaveManager {
  rommClient: RommClient;
  emulatorManager: EmulatorManager;

  constructor(rommClient: RommClient, emulatorManager: EmulatorManager) {
    this.rommClient = rommClient;
    this.emulatorManager = emulatorManager;
  }

  /**
   * Get the local save directory for a ROM
   */
  getLocalSaveDir(rom: Rom): string {
    const platform = rom.platform_slug;
    const saveRootDir = this.rommClient.getSavesFolder();
    if (!saveRootDir) throw new Error("Saves folder is not configured in RommClient");
    return path.join(saveRootDir, platform, `rom_${rom.id}`);
  }

  /**
   * Check if local save directory has any files
   */
  async hasLocalSaves(rom: Rom): Promise<boolean> {
    try {
      const saveDir = this.getLocalSaveDir(rom);
      if (!fs.existsSync(saveDir)) {
        return false;
      }
      const files = await fsPromises.readdir(saveDir, { recursive: true });
      return files.some((file) => {
        const filePath = path.join(saveDir, file.toString());
        const stats = fs.statSync(filePath);
        return stats.isFile();
      });
    } catch {
      return false;
    }
  }

  /**
   * Check cloud saves for a ROM
   */
  async hasCloudSaves(rom: Rom): Promise<boolean> {
    try {
      if (!this.rommClient.rommApi) throw new Error("RomM API is not initialized");
      const cloudResult = await this.rommClient.rommApi.downloadSave(rom.id);
      return cloudResult.success && cloudResult.data && cloudResult.data.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get cloud saves for a ROM
   */
  async getCloudSaves(rom: Rom): Promise<any[]> {
    try {
      console.log(`[SAVE MANAGER] Checking cloud saves for ROM ${rom.id} (${rom.name})`);
      if (!this.rommClient.rommApi) {
        console.error(`[SAVE MANAGER] RomM API is not initialized`);
        throw new Error("RomM API is not initialized");
      }

      console.log(`[SAVE MANAGER] Calling RomM API downloadSave for ROM ${rom.id}`);
      const cloudResult = await this.rommClient.rommApi.downloadSave(rom.id);
      console.log(`[SAVE MANAGER] RomM API response:`, {
        success: cloudResult.success,
        hasData: !!cloudResult.data,
        dataType: cloudResult.data ? typeof cloudResult.data : "null",
        dataLength: Array.isArray(cloudResult.data) ? cloudResult.data.length : "N/A",
        error: cloudResult.error,
      });

      const saves = cloudResult.success && cloudResult.data ? cloudResult.data : [];
      console.log(`[SAVE MANAGER] Returning ${saves.length} cloud saves for ROM ${rom.id}`);
      return saves;
    } catch (error: any) {
      console.error(`[SAVE MANAGER] Error getting cloud saves for ROM ${rom.id}:`, error.message);
      return [];
    }
  }

  /**
   * Check all saves (local and cloud) for a ROM
   * Does NOT create the local save directory if it doesn't exist
   */
  async checkSaves(rom: Rom): Promise<SaveData & { success: boolean; error?: string }> {
    try {
      console.log(`[SAVE MANAGER] Checking all saves for ROM ${rom.id} (${rom.name})`);
      const localSaveDir = this.getLocalSaveDir(rom);
      console.log(`[SAVE MANAGER] Local save directory: ${localSaveDir}`);

      console.log(`[SAVE MANAGER] Checking local, cloud, and getting cloud saves...`);
      const [hasLocal, hasCloud, cloudSaves] = await Promise.all([this.hasLocalSaves(rom), this.hasCloudSaves(rom), this.getCloudSaves(rom)]);

      console.log(`[SAVE MANAGER] Save check results for ROM ${rom.id}:`, {
        hasLocal,
        hasCloud,
        cloudSavesCount: cloudSaves.length,
        localSaveDir,
      });

      return {
        success: true,
        hasLocal,
        hasCloud,
        localSaveDir,
        cloudSaves,
      };
    } catch (error: any) {
      console.error(`[SAVE MANAGER] Error checking saves for ROM ${rom.id}:`, error.message);
      return {
        success: false,
        hasLocal: false,
        hasCloud: false,
        localSaveDir: "",
        cloudSaves: [],
        error: error.message,
      };
    }
  }

  /**
   * Prepare saves for emulator launch
   * This will copy local saves to the appropriate location for the emulator
   * The actual copying is handled by each emulator's setupEnvironment method
   */
  async prepareSavesForEmulatorLaunch(rom: Rom, tempSaveDir: string): Promise<{ success: boolean; error?: string }> {
    try {
      const localSaveDir = this.getLocalSaveDir(rom);

      if (!fs.existsSync(localSaveDir)) {
        console.log(`[SAVE MANAGER] No local saves found for ROM ${rom.id}`);
        return { success: true };
      }

      // Get files from local save directory
      const files = await fsPromises.readdir(localSaveDir, { recursive: true });
      const saveFiles = files.filter((file) => {
        const filePath = path.join(localSaveDir, file.toString());
        const stats = fs.statSync(filePath);
        return stats.isFile();
      });

      if (saveFiles.length === 0) {
        console.log(`[SAVE MANAGER] No save files found for ROM ${rom.id}`);
        return { success: true };
      }

      console.log(`[SAVE MANAGER] Found ${saveFiles.length} save files for ROM ${rom.id}`);
      console.log(`[SAVE MANAGER] Saves will be copied to: ${tempSaveDir}`);

      return { success: true };
    } catch (error: any) {
      console.error(`[SAVE MANAGER] Error preparing saves: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync saves after emulator closes
   * This will upload local saves to cloud if configured
   */
  async syncSavesAfterEmulatorClose(rom: Rom): Promise<{ success: boolean; error?: string }> {
    try {
      const localSaveDir = this.getLocalSaveDir(rom);

      if (!fs.existsSync(localSaveDir)) {
        return { success: true };
      }

      // Get save files
      const files = await fsPromises.readdir(localSaveDir, { recursive: true });
      const saveFiles = files.filter((file) => {
        const filePath = path.join(localSaveDir, file.toString());
        const stats = fs.statSync(filePath);
        return stats.isFile();
      });

      if (saveFiles.length === 0) {
        return { success: true };
      }

      console.log(`[SAVE MANAGER] Syncing ${saveFiles.length} save files for ROM ${rom.id}`);

      // Upload to cloud if API is available
      if (this.rommClient.rommApi) {
        // TODO: Implement cloud upload
        console.log(`[SAVE MANAGER] Cloud upload not yet implemented`);
      }

      return { success: true };
    } catch (error: any) {
      console.error(`[SAVE MANAGER] Error syncing saves: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Recover lost saves from session directories
   * This function scans for session directories that may contain unsaved data
   * due to crashes or improper shutdowns. Uses emulator-specific extraction.
   */
  async recoverLostSaves(): Promise<{ success: boolean; recoveredCount: number; error?: string }> {
    try {
      const saveRootDir = this.rommClient.getSavesFolder();
      if (!saveRootDir) {
        throw new Error("Saves folder is not configured");
      }

      console.log(`[SAVE MANAGER] Starting lost save recovery scan in: ${saveRootDir}`);

      let recoveredCount = 0;

      // Get all platform directories
      const platformDirs = await fsPromises.readdir(saveRootDir, { withFileTypes: true });
      const platformFolders = platformDirs.filter((dir) => dir.isDirectory()).map((dir) => dir.name);

      for (const platform of platformFolders) {
        const platformPath = path.join(saveRootDir, platform);
        console.log(`[SAVE MANAGER] Scanning platform: ${platform}`);

        try {
          // Get all directories in this platform
          const entries = await fsPromises.readdir(platformPath, { withFileTypes: true });

          // Find session directories (ending with _session)
          const sessionDirs = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith("_session"));

          console.log(`[SAVE MANAGER] Found ${sessionDirs.length} session directories in ${platform}`);

          for (const sessionDir of sessionDirs) {
            const sessionPath = path.join(platformPath, sessionDir.name);
            console.log(`[SAVE MANAGER] Processing session directory: ${sessionDir.name}`);

            try {
              // Extract ROM ID from session directory name (rom_X_session -> X)
              const romIdMatch = sessionDir.name.match(/^rom_(\d+)_session$/);
              if (!romIdMatch) {
                console.warn(`[SAVE MANAGER] Could not extract ROM ID from session directory: ${sessionDir.name}`);
                continue;
              }

              const romId = parseInt(romIdMatch[1]);
              console.log(`[SAVE MANAGER] Extracted ROM ID: ${romId} from ${sessionDir.name}`);

              // Find the appropriate emulator for this platform
              const emulator = this.emulatorManager.getEmulatorForPlatform(platform);
              if (!emulator) {
                console.warn(`[SAVE MANAGER] No emulator found for platform ${platform}, using generic extraction`);
              }

              // Create persistent save directory for this ROM
              const persistentSaveDir = path.join(platformPath, `rom_${romId}`);
              await fsPromises.mkdir(persistentSaveDir, { recursive: true });

              // Use emulator-specific extraction if available, otherwise use generic
              let extractedFiles: string[] = [];
              if (emulator) {
                console.log(`[SAVE MANAGER] Using ${emulator.constructor.name} for save extraction`);
                extractedFiles = await emulator.extractSavesFromSession(sessionPath, persistentSaveDir);
              } else {
                // Generic fallback
                console.log(`[SAVE MANAGER] Using generic save extraction`);
                extractedFiles = await this.extractSavesGeneric(sessionPath, persistentSaveDir);
              }

              if (extractedFiles.length === 0) {
                console.log(`[SAVE MANAGER] No save files found in session: ${sessionDir.name}`);
                continue;
              }

              console.log(`[SAVE MANAGER] Extracted ${extractedFiles.length} save files from ${sessionDir.name}`);
              console.log(`[SAVE MANAGER] Successfully recovered saves from ${sessionDir.name} to ${persistentSaveDir}`);

              // Clean up the session directory
              await this.deleteDirectoryRecursive(sessionPath);
              console.log(`[SAVE MANAGER] Cleaned up session directory: ${sessionDir.name}`);

              recoveredCount++;
            } catch (sessionError: any) {
              console.error(`[SAVE MANAGER] Error processing session ${sessionDir.name}: ${sessionError.message}`);
              // Continue with other sessions
            }
          }
        } catch (platformError: any) {
          console.error(`[SAVE MANAGER] Error scanning platform ${platform}: ${platformError.message}`);
          // Continue with other platforms
        }
      }

      console.log(`[SAVE MANAGER] Lost save recovery completed. Recovered ${recoveredCount} sessions.`);
      return {
        success: true,
        recoveredCount,
      };
    } catch (error: any) {
      console.error(`[SAVE MANAGER] Error during lost save recovery: ${error.message}`);
      return {
        success: false,
        recoveredCount: 0,
        error: error.message,
      };
    }
  }

  /**
   * Generic save extraction fallback - copies all files recursively
   */
  private async extractSavesGeneric(sessionPath: string, persistentSaveDir: string): Promise<string[]> {
    const extractedFiles: string[] = [];

    const copyFilesRecursively = async (src: string, dest: string) => {
      const entries = await fsPromises.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);

        if (entry.isDirectory()) {
          // Recursively process subdirectories
          await copyFilesRecursively(srcPath, dest);
        } else {
          // Copy file directly to destination (flatten structure)
          const destPath = path.join(dest, entry.name);
          await fsPromises.copyFile(srcPath, destPath);
          extractedFiles.push(entry.name);
        }
      }
    };

    await copyFilesRecursively(sessionPath, persistentSaveDir);
    return extractedFiles;
  }

  /**
   * Helper method to recursively delete a directory
   */
  private async deleteDirectoryRecursive(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) return;

    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.deleteDirectoryRecursive(fullPath);
      } else {
        await fsPromises.unlink(fullPath);
      }
    }

    await fsPromises.rmdir(dirPath);
  }
}
