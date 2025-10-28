import { Emulator, EmulatorConfig, EnvironmentSetupResult, SaveComparisonResult, SaveSyncResult, SaveChoiceResult } from "./Emulator";
import { Rom } from "../../types/RommApi";
import { RommApi } from "../../api/RommApi";
import { SaveManager } from "../SaveManager";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import AdmZip from "adm-zip";
import * as os from "os";
/**
 * Dolphin (Wii/GameCube) Emulator implementation
 */
export class DolphinEmulator extends Emulator {
  constructor(config: EmulatorConfig) {
    super({
      ...config,
      platform: "wii",
      name: "Dolphin",
      extensions: DolphinEmulator.getExtensions(),
      args: ["-u", "{userDir}", "-e", "{rom}"],
    });
  }

  /**
   * Get supported file extensions for Dolphin
   */
  public static getExtensions(): string[] {
    return [".iso", ".gcm", ".wbfs", ".ciso", ".gcz"];
  }

  /**
   * Get supported platforms for Dolphin
   */
  public static getPlatforms(): string[] {
    return ["wii", "gamecube"];
  }

  /**
   * Get the RomM slug for Dolphin
   */
  public static getRommSlug(): string {
    return "wii";
  }

  /**
   * Get default arguments for Dolphin
   */
  public static getDefaultArgs(): string[] {
    return ["-u", "{userDir}", "-e", "{rom}"];
  }

  /**
   * Check if Dolphin supports saves
   */
  public static getSupportsSaves(): boolean {
    return true;
  }

  /**
   * Start Dolphin in configuration mode with proper user directory setup
   */
  public async startInConfigMode(configFolder: string): Promise<{ success: boolean; error?: string; pid?: number }> {
    try {
      const emulatorPath = this.getExecutablePath();
      if (!emulatorPath) {
        return {
          success: false,
          error: `Dolphin path not configured`,
        };
      }

      // Use the emulator-specific config folder as user directory
      await fs.mkdir(configFolder, { recursive: true });
      console.log(`Using emulator config folder as Dolphin user directory: ${configFolder}`);

      // Launch Dolphin with the emulator-specific config folder as user directory
      console.log(`Launching Dolphin in configuration mode: ${emulatorPath} -u "${configFolder}"`);
      const emulatorProcess = spawn(emulatorPath, ["-u", configFolder], {
        detached: false,
        stdio: "ignore",
      });

      return {
        success: true,
        pid: emulatorProcess.pid,
      };
    } catch (error: any) {
      console.error(`Failed to start Dolphin in config mode: ${error.message}`);
      return {
        success: false,
        error: `Dolphin config mode failed: ${error.message}`,
      };
    }
  }

  /**
   * Prepare emulator arguments by replacing placeholders
   * Override to handle custom user directory
   */
  public prepareArgs(romPath: string, userDir: string): string[] {
    return this.defaultArgs.map(
      (arg) => arg.replace("{rom}", romPath).replace("{userDir}", userDir).replace("{save}", userDir) // For compatibility
    );
  }

  /**
   * Determine if a game is Wii or GameCube based on ROM metadata
   */
  private isWiiGame(rom: Rom): boolean {
    // Wii games typically have different region codes and metadata
    // For now, we'll use a simple heuristic based on file size and platform info
    // Wii games are generally larger and have different characteristics

    // Check platform info first
    if (rom.platform_slug && rom.platform_slug.toLowerCase().includes("wii")) {
      return true;
    }
    if (rom.platform_slug && rom.platform_slug.toLowerCase().includes("gamecube")) {
      return false;
    }

    // Check file size - Wii games are typically larger than GameCube games
    // Wii games are usually 4.7GB+, GameCube games are usually 1.4GB or less
    const fileSize = rom.fs_size_bytes;
    if (fileSize && fileSize > 2000000000) {
      // 2GB threshold
      return true;
    }

    // Default to Wii for Dolphin (most common)
    return true;
  }

  public async setupEnvironment(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager, configFolder: string): Promise<EnvironmentSetupResult> {
    try {
      // Use saveDir directly as the user directory for this ROM session
      const tempUserDir = saveDir;
      console.log(`Using ROM save directory as Dolphin user directory: ${tempUserDir}`);

      // Copy emulator configs from the dedicated config folder
      if (fsSync.existsSync(configFolder)) {
        console.log(`Copying emulator configs from: ${configFolder}`);

        const copyDirRecursive = async (src: string, dest: string): Promise<void> => {
          const entries = await fs.readdir(src, { withFileTypes: true });

          for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
              await fs.mkdir(destPath, { recursive: true });
              await copyDirRecursive(srcPath, destPath);
            } else {
              // Only copy if source is newer or destination doesn't exist
              let shouldCopy = true;
              if (fsSync.existsSync(destPath)) {
                const srcStat = await fs.stat(srcPath);
                const destStat = await fs.stat(destPath);
                shouldCopy = srcStat.mtime > destStat.mtime;
              }

              if (shouldCopy) {
                await fs.copyFile(srcPath, destPath);
                console.log(`Copied config file: ${entry.name}`);
              }
            }
          }
        };

        await copyDirRecursive(configFolder, tempUserDir);
        console.log(`Synced emulator configs to user directory`);
      } else {
        console.log(`No emulator config folder found at: ${configFolder}`);
      }

      // Determine if this is a Wii or GameCube game
      const isWiiGame = this.isWiiGame(rom);
      console.log(`Game type: ${isWiiGame ? "Wii" : "GameCube"}`);

      if (isWiiGame) {
        // Wii games use title-based save directories
        const wiiSaveDir = path.join(tempUserDir, "Wii");
        const titleSaveDir = path.join(wiiSaveDir, "title", "00000001", "data");
        await fs.mkdir(titleSaveDir, { recursive: true });

        console.log(`Wii save directory: ${titleSaveDir}`);

        return {
          success: true,
          userDir: tempUserDir,
          saveDir: wiiSaveDir,
          gameType: "wii",
        };
      } else {
        // GameCube games use memory card saves
        const gcSaveDir = path.join(tempUserDir, "GC");
        const memoryCardDir = path.join(gcSaveDir, "USA"); // Assume USA region for now
        await fs.mkdir(memoryCardDir, { recursive: true });

        console.log(`GC save directory: ${memoryCardDir}`);

        return {
          success: true,
          userDir: tempUserDir,
          saveDir: gcSaveDir,
          gameType: "gamecube",
        };
      }
    } catch (error: any) {
      console.error(`Failed to setup Dolphin environment: ${error.message}`);
      return {
        success: false,
        error: `Dolphin setup failed: ${error.message}`,
      };
    }
  }

  private async copySavesToRomDir(dolphinSaveDir: string, romSaveDir: string): Promise<void> {
    try {
      // Ensure ROM save directory exists
      await fs.mkdir(romSaveDir, { recursive: true });

      // Copy all files from Dolphin save directory to ROM save directory
      const copyDirRecursive = async (src: string, dest: string): Promise<void> => {
        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);

          if (entry.isDirectory()) {
            await fs.mkdir(destPath, { recursive: true });
            await copyDirRecursive(srcPath, destPath);
          } else {
            // Only copy if source is newer or destination doesn't exist
            let shouldCopy = true;
            if (fsSync.existsSync(destPath)) {
              const srcStat = await fs.stat(srcPath);
              const destStat = await fs.stat(destPath);
              shouldCopy = srcStat.mtime > destStat.mtime;
            }

            if (shouldCopy) {
              await fs.copyFile(srcPath, destPath);
              console.log(`Copied save file: ${entry.name}`);
            }
          }
        }
      };

      await copyDirRecursive(dolphinSaveDir, romSaveDir);
      console.log(`Saves copied from ${dolphinSaveDir} to ${romSaveDir}`);
    } catch (error: any) {
      console.warn(`Failed to copy saves: ${error.message}`);
    }
  }

  /**
   * Handle save preparation before launch
   * Copies local saves from the persistent storage to BOTH Wii and GC directories
   */
  public async handleSavePreparation(rom: Rom, saveDir: string, localSaveDir: string, saveManager: SaveManager): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[DOLPHIN] Preparing saves for ROM ${rom.id}...`);
      console.log(`[DOLPHIN] localSaveDir: ${localSaveDir}`);
      console.log(`[DOLPHIN] saveDir (session): ${saveDir}`);

      // Check if there are local saves
      if (!fsSync.existsSync(localSaveDir)) {
        console.log(`[DOLPHIN] No local save directory found: ${localSaveDir}`);
        return { success: true };
      }

      // List what's in the local save directory
      try {
        const contents = await fs.readdir(localSaveDir, { withFileTypes: true });
        console.log(
          `[DOLPHIN] Contents of ${localSaveDir}:`,
          contents.map((c) => ({ name: c.name, isDir: c.isDirectory() }))
        );
      } catch (err: any) {
        console.warn(`[DOLPHIN] Could not list directory contents: ${err.message}`);
      }

      // Prepare both Wii and GC directories
      const wiiSaveDir = path.join(saveDir, "Wii");
      const gcSaveDir = path.join(saveDir, "GC");

      // Clean existing directories to avoid recursive nesting
      console.log(`[DOLPHIN] Cleaning existing save directories...`);
      await this.clearSaveDirectories([wiiSaveDir, gcSaveDir]);

      // Ensure both directories exist
      await fs.mkdir(wiiSaveDir, { recursive: true });
      await fs.mkdir(gcSaveDir, { recursive: true });

      console.log(`[DOLPHIN] Copying local saves to both Wii and GC directories...`);

      // Helper function to copy directory recursively
      const copyDirRecursive = async (src: string, dest: string): Promise<number> => {
        let copiedCount = 0;
        if (!fsSync.existsSync(src)) return copiedCount;

        try {
          const entries = await fs.readdir(src, { withFileTypes: true });

          for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            try {
              if (entry.isDirectory()) {
                await fs.mkdir(destPath, { recursive: true });
                copiedCount += await copyDirRecursive(srcPath, destPath);
              } else {
                if (fsSync.existsSync(srcPath)) {
                  await fs.copyFile(srcPath, destPath);
                  console.log(`[DOLPHIN] Copied save: ${entry.name}`);
                  copiedCount++;
                }
              }
            } catch (entryError: any) {
              console.warn(`[DOLPHIN] Failed to copy ${entry.name}: ${entryError.message}`);
            }
          }
        } catch (readError: any) {
          console.warn(`[DOLPHIN] Failed to read directory ${src}: ${readError.message}`);
        }

        return copiedCount;
      };

      // Copy saves to Wii directory
      // Check if localSaveDir has Wii and GC subdirectories (from extracted ZIP)
      const localWiiDir = path.join(localSaveDir, "Wii");
      const localGcDir = path.join(localSaveDir, "GC");

      console.log(`[DOLPHIN] Checking for local Wii dir: ${localWiiDir} - exists: ${fsSync.existsSync(localWiiDir)}`);
      console.log(`[DOLPHIN] Checking for local GC dir: ${localGcDir} - exists: ${fsSync.existsSync(localGcDir)}`);

      let wiiCopied = 0;
      let gcCopied = 0;

      // If Wii subdirectory exists in local saves, copy from there
      if (fsSync.existsSync(localWiiDir)) {
        console.log(`[DOLPHIN] Copying from local Wii directory...`);
        try {
          const wiiContents = await fs.readdir(localWiiDir, { withFileTypes: true });
          console.log(
            `[DOLPHIN] Wii directory contents:`,
            wiiContents.map((c) => ({ name: c.name, isDir: c.isDirectory() }))
          );
        } catch (err: any) {
          console.warn(`[DOLPHIN] Could not read Wii dir: ${err.message}`);
        }
        wiiCopied = await copyDirRecursive(localWiiDir, wiiSaveDir);
      } else {
        // Otherwise copy the entire localSaveDir to Wii (flat structure)
        console.log(`[DOLPHIN] Copying from local save directory to Wii (flat structure)...`);
        try {
          const saveContents = await fs.readdir(localSaveDir, { withFileTypes: true });
          console.log(
            `[DOLPHIN] Local save directory contents:`,
            saveContents.map((c) => ({ name: c.name, isDir: c.isDirectory() }))
          );
        } catch (err: any) {
          console.warn(`[DOLPHIN] Could not read local save dir: ${err.message}`);
        }
        wiiCopied = await copyDirRecursive(localSaveDir, wiiSaveDir);
      }
      console.log(`[DOLPHIN] Copied ${wiiCopied} files to Wii directory`);

      // Copy to GC directory
      // If GC subdirectory exists in local saves, copy from there
      if (fsSync.existsSync(localGcDir)) {
        console.log(`[DOLPHIN] Copying from local GC directory...`);
        try {
          const gcContents = await fs.readdir(localGcDir, { withFileTypes: true });
          console.log(
            `[DOLPHIN] GC directory contents:`,
            gcContents.map((c) => ({ name: c.name, isDir: c.isDirectory() }))
          );
        } catch (err: any) {
          console.warn(`[DOLPHIN] Could not read GC dir: ${err.message}`);
        }
        gcCopied = await copyDirRecursive(localGcDir, gcSaveDir);
      } else {
        // Otherwise copy the entire localSaveDir to GC (flat structure)
        console.log(`[DOLPHIN] Copying from local save directory to GC (flat structure)...`);
        try {
          const saveContents = await fs.readdir(localSaveDir, { withFileTypes: true });
          console.log(
            `[DOLPHIN] Local save directory contents for GC:`,
            saveContents.map((c) => ({ name: c.name, isDir: c.isDirectory() }))
          );
        } catch (err: any) {
          console.warn(`[DOLPHIN] Could not read local save dir: ${err.message}`);
        }
        gcCopied = await copyDirRecursive(localSaveDir, gcSaveDir);
      }
      console.log(`[DOLPHIN] Copied ${gcCopied} files to GC directory`);

      console.log(`[DOLPHIN] Save preparation completed`);
      return { success: true };
    } catch (error: any) {
      console.error(`[DOLPHIN] Error preparing saves: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  public async getSaveComparison(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager): Promise<SaveComparisonResult> {
    try {
      console.log(`[DOLPHIN] Comparing local and cloud saves for ROM ${rom.id}...`);

      if (!rommAPI) {
        throw new Error("RomM API is not available");
      }

      // Check for local saves in both Wii and GC directories
      const wiiSaveDir = path.join(saveDir, "Wii");
      const gcSaveDir = path.join(saveDir, "GC");

      let hasLocal = false;

      // Check Wii directory
      if (fsSync.existsSync(wiiSaveDir)) {
        const files = await fs.readdir(wiiSaveDir, { recursive: true });
        if (
          files.some((file: string) => {
            const filePath = path.join(wiiSaveDir, file);
            const stat = fsSync.statSync(filePath);
            return stat.isFile();
          })
        ) {
          hasLocal = true;
        }
      }

      // Check GC directory
      if (!hasLocal && fsSync.existsSync(gcSaveDir)) {
        const files = await fs.readdir(gcSaveDir, { recursive: true });
        if (
          files.some((file: string) => {
            const filePath = path.join(gcSaveDir, file);
            const stat = fsSync.statSync(filePath);
            return stat.isFile();
          })
        ) {
          hasLocal = true;
        }
      }

      // Check for cloud saves
      console.log(`[DOLPHIN] Checking cloud saves for ROM ${rom.id} (${rom.name})`);
      const cloudResult = await rommAPI.downloadSave(rom.id);
      const hasCloud = cloudResult.success && cloudResult.data && Array.isArray(cloudResult.data) && cloudResult.data.length > 0;
      console.log(`[DOLPHIN] Cloud saves result for ROM ${rom.id}:`, {
        success: cloudResult.success,
        hasData: !!cloudResult.data,
        dataLength: Array.isArray(cloudResult.data) ? cloudResult.data.length : 0,
        hasCloud,
      });

      return {
        success: true,
        data: {
          hasLocal,
          hasCloud,
          localSave: hasLocal ? saveDir : null,
          cloudSaves: hasCloud ? cloudResult.data : [],
          recommendation: hasLocal ? "local" : hasCloud ? "cloud" : "none",
        },
      };
    } catch (error: any) {
      console.error(`[DOLPHIN] Error comparing saves for ROM ${rom.id}:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  public async handleSaveSync(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager): Promise<SaveSyncResult> {
    try {
      // Upload BOTH Wii and GC directories regardless of platform
      // This ensures saves are backed up no matter which platform the game runs on
      const wiiSaveDir = path.join(saveDir, "Wii");
      const gcSaveDir = path.join(saveDir, "GC");

      console.log(`[DOLPHIN] Uploading saves from both Wii and GC directories...`);

      if (!rommAPI) {
        throw new Error("RomM API is not available");
      }

      // Check if either directory has files
      const checkDirHasFiles = async (dirPath: string): Promise<boolean> => {
        if (!fsSync.existsSync(dirPath)) return false;
        try {
          const files = await fs.readdir(dirPath, { recursive: true });
          return files.some((file: string) => {
            const filePath = path.join(dirPath, file);
            try {
              return fsSync.statSync(filePath).isFile();
            } catch {
              return false;
            }
          });
        } catch {
          return false;
        }
      };

      const wiiHasFiles = await checkDirHasFiles(wiiSaveDir);
      const gcHasFiles = await checkDirHasFiles(gcSaveDir);

      if (!wiiHasFiles && !gcHasFiles) {
        console.log(`[DOLPHIN] No save files found in Wii or GC directories, skipping upload`);
        return {
          success: true,
          message: "No saves to upload",
        };
      }

      console.log(`[DOLPHIN] Found saves - Wii: ${wiiHasFiles}, GC: ${gcHasFiles}`);

      // Create a temporary ZIP file
      const tempDir = os.tmpdir();
      const tempZipPath = path.join(tempDir, `dolphin_save_${rom.id}_${Date.now()}.zip`);

      try {
        // Create ZIP file with both Wii and GC directories
        const zip = new AdmZip();

        // Add Wii saves if present
        if (wiiHasFiles && fsSync.existsSync(wiiSaveDir)) {
          console.log(`[DOLPHIN] Adding Wii saves to ZIP...`);
          zip.addLocalFolder(wiiSaveDir, "Wii");
        }

        // Add GC saves if present
        if (gcHasFiles && fsSync.existsSync(gcSaveDir)) {
          console.log(`[DOLPHIN] Adding GC saves to ZIP...`);
          zip.addLocalFolder(gcSaveDir, "GC");
        }

        // Write ZIP to temporary file
        console.log(`[DOLPHIN] Creating ZIP file: ${tempZipPath}`);
        zip.writeZip(tempZipPath);

        // Upload to RomM - use generic "dolphin" type since we're uploading both
        const uploadResult = await rommAPI.uploadSave(rom.id, tempZipPath, "dolphin");
        if (!uploadResult.success) {
          console.error(`[DOLPHIN] Failed to upload saves to RomM: ${uploadResult.error}`);
          return {
            success: false,
            error: uploadResult.error || "Upload failed",
          };
        }

        console.log(`[DOLPHIN] Successfully uploaded saves to RomM for ROM ${rom.id}`);

        // Wait a bit for emulator to fully close and release file handles
        console.log(`[DOLPHIN] Waiting for emulator to fully close before copying saves...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // After successful upload, copy saves to persistent local storage
        try {
          const persistentSaveDir = saveManager.getLocalSaveDir(rom);
          console.log(`[DOLPHIN] Copying saves to persistent storage: ${persistentSaveDir}`);

          // Ensure persistent directory exists
          await fs.mkdir(persistentSaveDir, { recursive: true });

          // Re-check if files still exist (they might have been cleaned up)
          const wiiStillHasFiles = await checkDirHasFiles(wiiSaveDir);
          const gcStillHasFiles = await checkDirHasFiles(gcSaveDir);

          console.log(`[DOLPHIN] Rechecked directories - Wii: ${wiiStillHasFiles}, GC: ${gcStillHasFiles}`);

          // Helper function to copy directory recursively with error handling
          const copyDirRecursive = async (src: string, dest: string): Promise<number> => {
            let copiedCount = 0;

            if (!fsSync.existsSync(src)) {
              console.warn(`[DOLPHIN] Source directory does not exist: ${src}`);
              return copiedCount;
            }

            try {
              const entries = await fs.readdir(src, { withFileTypes: true });

              for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);

                try {
                  if (entry.isDirectory()) {
                    await fs.mkdir(destPath, { recursive: true });
                    copiedCount += await copyDirRecursive(srcPath, destPath);
                  } else {
                    // Check if source file exists before copying
                    if (fsSync.existsSync(srcPath)) {
                      await fs.copyFile(srcPath, destPath);
                      console.log(`[DOLPHIN] Copied to persistent: ${entry.name}`);
                      copiedCount++;
                    } else {
                      console.warn(`[DOLPHIN] Source file disappeared: ${srcPath}`);
                    }
                  }
                } catch (entryError: any) {
                  console.warn(`[DOLPHIN] Failed to copy ${entry.name}: ${entryError.message}`);
                }
              }
            } catch (readError: any) {
              console.warn(`[DOLPHIN] Failed to read directory ${src}: ${readError.message}`);
            }

            return copiedCount;
          };

          // Copy both Wii and GC directories to persistent storage
          let totalCopied = 0;
          if (wiiStillHasFiles) {
            console.log(`[DOLPHIN] Copying Wii saves...`);
            const wiiCopied = await copyDirRecursive(wiiSaveDir, path.join(persistentSaveDir, "Wii"));
            totalCopied += wiiCopied;
            console.log(`[DOLPHIN] Copied ${wiiCopied} files from Wii directory`);
          }
          if (gcStillHasFiles) {
            console.log(`[DOLPHIN] Copying GC saves...`);
            const gcCopied = await copyDirRecursive(gcSaveDir, path.join(persistentSaveDir, "GC"));
            totalCopied += gcCopied;
            console.log(`[DOLPHIN] Copied ${gcCopied} files from GC directory`);
          }

          if (totalCopied === 0) {
            console.warn(`[DOLPHIN] No files were copied to persistent storage - might be empty after emulator close`);
          }

          console.log(`[DOLPHIN] Saves copied to persistent storage successfully (${totalCopied} files)`);

          // Clean up the session directory now that saves are backed up and copied
          try {
            console.log(`[DOLPHIN] Cleaning up session directory: ${saveDir}`);
            await this.deleteDirectoryRecursive(saveDir);
            console.log(`[DOLPHIN] Session directory cleaned up successfully`);
          } catch (cleanupError: any) {
            console.warn(`[DOLPHIN] Failed to clean up session directory: ${cleanupError.message}`);
            // Don't fail if cleanup fails, saves are already backed up
          }
        } catch (copyError: any) {
          console.warn(`[DOLPHIN] Failed to copy saves to persistent storage: ${copyError.message}`);
          // Don't fail the entire operation if local copy fails
        }

        return {
          success: true,
          message: "Save sync completed",
        };
      } finally {
        // Clean up temporary ZIP file
        try {
          if (fsSync.existsSync(tempZipPath)) {
            await fs.unlink(tempZipPath);
            console.log(`[DOLPHIN] Cleaned up temporary ZIP file: ${tempZipPath}`);
          }
        } catch (cleanupError: any) {
          console.warn(`[DOLPHIN] Failed to clean up temporary ZIP file: ${cleanupError.message}`);
        }
      }
    } catch (saveError: any) {
      console.error(`[DOLPHIN] Error uploading saves: ${saveError.message}`);
      return {
        success: false,
        error: saveError.message,
      };
    }
  }

  public async handleSaveChoice(romData: any, saveChoice: string, saveManager: SaveManager, rommAPI: RommApi | null, saveId?: number): Promise<SaveChoiceResult> {
    try {
      const { rom, finalRomPath, saveDir } = romData;

      console.log(`[DOLPHIN] User chose save: ${saveChoice}${saveId ? ` (ID: ${saveId})` : ""}`);

      const userDir = saveDir;
      const wiiSaveDir = path.join(userDir, "Wii");
      const gcSaveDir = path.join(userDir, "GC");

      // Ensure both directories exist
      await fs.mkdir(wiiSaveDir, { recursive: true });
      await fs.mkdir(gcSaveDir, { recursive: true });

      // Handle save loading based on choice
      if (saveChoice === "cloud") {
        console.log(`[DOLPHIN] User chose cloud save${saveId ? ` #${saveId}` : ""} for ROM ${rom.id}`);
        if (!rommAPI) {
          console.error(`[DOLPHIN] RomM API is not available for cloud save download`);
          throw new Error("RomM API is not available");
        }

        if (!saveId) {
          console.error(`[DOLPHIN] No saveId provided for cloud save download`);
          throw new Error("No save ID provided for cloud save");
        }

        console.log(`[DOLPHIN] Downloading cloud save #${saveId}`);

        // Get the specific save data
        const saveListResult = await rommAPI.downloadSave(rom.id);
        if (!saveListResult.success || !saveListResult.data) {
          console.error(`[DOLPHIN] Failed to get save list for ROM ${rom.id}`);
          throw new Error("Failed to get save list from RomM");
        }

        const saveData = saveListResult.data.find((save: any) => save.id === saveId);
        if (!saveData) {
          console.error(`[DOLPHIN] Save #${saveId} not found in save list for ROM ${rom.id}`);
          throw new Error(`Save ${saveId} not found`);
        }

        console.log(`[DOLPHIN] Found save data:`, {
          id: saveData.id,
          fileName: saveData.file_name,
          downloadPath: saveData.download_path,
        });

        // Download the save file
        console.log(`[DOLPHIN] Downloading save file from: ${saveData.download_path}`);
        const downloadResult = await rommAPI.downloadSaveFile(saveData);
        if (!downloadResult.success || !downloadResult.data) {
          console.error(`[DOLPHIN] Failed to download save file #${saveId}`);
          throw new Error("Failed to download save file");
        }

        console.log(`[DOLPHIN] Downloaded ${downloadResult.data.length} bytes, extracting to both Wii and GC directories...`);

        // Extract to both directories
        const zip = new AdmZip(downloadResult.data);

        // Extract to Wii directory
        console.log(`[DOLPHIN] Extracting to Wii directory: ${wiiSaveDir}`);
        zip.extractAllTo(wiiSaveDir, true);

        // Extract to GC directory
        console.log(`[DOLPHIN] Extracting to GC directory: ${gcSaveDir}`);
        zip.extractAllTo(gcSaveDir, true);

        console.log(`[DOLPHIN] Save extracted successfully to both directories`);

        // Verify extraction
        const wiiFiles = await fs.readdir(wiiSaveDir, { recursive: true });
        const gcFiles = await fs.readdir(gcSaveDir, { recursive: true });
        console.log(`[DOLPHIN] Extracted files - Wii:`, wiiFiles, `GC:`, gcFiles);
      } else if (saveChoice === "local") {
        console.log(`[DOLPHIN] Using existing local save for ROM ${rom.id}`);
        // Copy local saves to both directories for the session
        const localSaveDir = saveManager.getLocalSaveDir(rom);
        const prepareResult = await this.handleSavePreparation(rom, userDir, localSaveDir, saveManager);
        if (!prepareResult.success) {
          console.warn(`[DOLPHIN] Failed to prepare local saves: ${prepareResult.error}`);
        }
      } else if (saveChoice === "none") {
        console.log(`[DOLPHIN] Starting with no save (fresh start) for ROM ${rom.id}`);
        // Clear both save directories
        await this.clearSaveDirectories([wiiSaveDir, gcSaveDir]);
      }

      // Launch emulator with custom user directory
      console.log(`[DOLPHIN] Launching Dolphin: ${this.getExecutablePath()} -u "${userDir}" -e "${finalRomPath}"`);
      const launchResult = await this.launch(finalRomPath, userDir);

      // Monitor process to upload saves when it closes
      if (launchResult.process) {
        let saveUploaded = false; // Prevent duplicate uploads
        launchResult.process.on("exit", async (code) => {
          console.log(`[DOLPHIN] Dolphin closed with code ${code}`);

          // Sync saves back to ROM directory and upload to RomM (only once)
          if (rommAPI && !saveUploaded) {
            saveUploaded = true;
            await this.handleSaveSync(rom, saveDir, rommAPI, saveManager);
          }
        });
      }

      return {
        success: true,
        message: `ROM launched: ${rom.name}`,
        pid: launchResult.process ? launchResult.process.pid : undefined,
        romPath: finalRomPath,
        saveDir: saveDir,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private async clearSaveDirectories(directories: string[]): Promise<void> {
    for (const dir of directories) {
      if (fsSync.existsSync(dir)) {
        try {
          const files = await fs.readdir(dir, { recursive: true });
          for (const file of files) {
            const filePath = path.join(dir, file);
            try {
              const stat = await fs.stat(filePath);
              if (stat.isFile()) {
                await fs.unlink(filePath);
              }
            } catch (err: any) {
              console.warn(`Failed to delete ${filePath}: ${err.message}`);
            }
          }
        } catch (error: any) {
          console.warn(`Failed to clear directory ${dir}: ${error.message}`);
        }
      }
    }
  }

  private async deleteDirectoryRecursive(dirPath: string): Promise<void> {
    if (!fsSync.existsSync(dirPath)) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await this.deleteDirectoryRecursive(fullPath);
        } else {
          try {
            await fs.unlink(fullPath);
          } catch (err: any) {
            console.warn(`[DOLPHIN] Failed to delete file ${fullPath}: ${err.message}`);
          }
        }
      }

      await fs.rmdir(dirPath);
    } catch (error: any) {
      console.warn(`[DOLPHIN] Failed to delete directory ${dirPath}: ${error.message}`);
    }
  }
}
