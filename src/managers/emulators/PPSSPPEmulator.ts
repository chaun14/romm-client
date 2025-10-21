import { Emulator, EmulatorConfig, EnvironmentSetupResult, SaveComparisonResult, SaveSyncResult, SaveChoiceResult } from "./Emulator";
import { Rom } from "../../types/RommApi";
import { RommApi } from "../../api/RommApi";
import { SaveManager } from "../SaveManager";
import { spawn } from "child_process";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import AdmZip from "adm-zip";
import os from "os";

/**
 * PPSSPP (PSP) Emulator implementation
 */
export class PPSSPPEmulator extends Emulator {
  constructor(config: EmulatorConfig) {
    super({
      ...config,
      platform: "psp",
      name: "PPSSPP",
      extensions: PPSSPPEmulator.getExtensions(),
      args: ["{rom}"],
    });
  }

  /**
   * Get supported file extensions for PPSSPP
   */
  public static getExtensions(): string[] {
    return [".iso", ".cso", ".pbp", ".elf"];
  }

  /**
   * Get supported platforms for PPSSPP
   */
  public static getPlatforms(): string[] {
    return ["psp"];
  }

  /**
   * Get the RomM slug for PPSSPP
   */
  public static getRommSlug(): string {
    return "psp";
  }

  /**
   * Get default arguments for PPSSPP
   */
  public static getDefaultArgs(): string[] {
    return ["{rom}"];
  }

  /**
   * Check if PPSSPP supports saves
   */
  public static getSupportsSaves(): boolean {
    return true;
  }

  /**
   * Start PPSSPP in configuration mode with proper portable setup
   */
  public async startInConfigMode(configFolder: string): Promise<{ success: boolean; error?: string; pid?: number }> {
    try {
      const emulatorPath = this.getExecutablePath();
      if (!emulatorPath) {
        return {
          success: false,
          error: `PPSSPP path not configured`,
        };
      }

      const ppssppDir = path.dirname(emulatorPath);

      // 1. Create portable.txt to enable portable mode
      const portableTxtPath = path.join(ppssppDir, "portable.txt");
      if (!fsSync.existsSync(portableTxtPath)) {
        await fs.writeFile(portableTxtPath, "");
        console.log(`Created portable.txt in PPSSPP directory for config mode`);
      }

      // 2. Use the emulator-specific config folder for memstick
      await fs.mkdir(configFolder, { recursive: true });

      // 3. Create installed.txt pointing to the emulator config folder
      const installedTxtPath = path.join(ppssppDir, "installed.txt");
      const memstickPathForInstalled = configFolder.replace(/\\/g, "/");
      await fs.writeFile(installedTxtPath, memstickPathForInstalled);
      console.log(`Created installed.txt pointing to emulator config folder: ${memstickPathForInstalled}`);

      // Note: In config mode, we don't copy from default memstick
      // The config folder will become the source for future sessions
      console.log(`Using clean config folder for PPSSPP - no copying from default memstick`);

      // 4. Launch PPSSPP in configuration mode
      console.log(`Launching PPSSPP in configuration mode: ${emulatorPath}`);
      const emulatorProcess = spawn(emulatorPath, [], {
        detached: false,
        stdio: "ignore",
      });

      return {
        success: true,
        pid: emulatorProcess.pid,
      };
    } catch (error: any) {
      console.error(`Failed to start PPSSPP in config mode: ${error.message}`);
      return {
        success: false,
        error: `PPSSPP config mode failed: ${error.message}`,
      };
    }
  }

  public async setupEnvironment(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager, configFolder: string): Promise<EnvironmentSetupResult> {
    try {
      const ppssppDir = path.dirname(this.getExecutablePath()!);

      // 1. Create portable.txt to enable portable mode
      const portableTxtPath = path.join(ppssppDir, "portable.txt");
      if (!fsSync.existsSync(portableTxtPath)) {
        await fs.writeFile(portableTxtPath, "");
        console.log(`Created portable.txt in PPSSPP directory`);
      }

      // 2. Clean slate - delete entire session directory if it exists and rebuild from config
      console.log(`[PPSSPP] Cleaning up existing session directory: ${saveDir}`);
      if (fsSync.existsSync(saveDir)) {
        await this.deleteDirectoryRecursive(saveDir);
        console.log(`[PPSSPP] Deleted existing session directory`);
      }

      // 3. Setup ROM-specific memstick directory (fresh)
      const romMemstickDir = path.join(saveDir, "memstick");
      await fs.mkdir(romMemstickDir, { recursive: true });
      console.log(`[PPSSPP] Created fresh memstick directory: ${romMemstickDir}`);

      // 4. Create installed.txt pointing to ROM memstick
      const installedTxtPath = path.join(ppssppDir, "installed.txt");
      const memstickPathForInstalled = romMemstickDir.replace(/\\/g, "/");
      await fs.writeFile(installedTxtPath, memstickPathForInstalled);
      console.log(`Created installed.txt pointing to: ${memstickPathForInstalled}`);

      // 5. Copy entire emulator config folder to ROM memstick (with all subdirectories)
      if (fsSync.existsSync(configFolder)) {
        console.log(`[PPSSPP] Full config sync from: ${configFolder}`);

        // Recursive copy of all files and folders, excluding SAVEDATA
        const copyDirRecursive = async (src: string, dest: string): Promise<void> => {
          try {
            await fs.mkdir(dest, { recursive: true });
            const entries = await fs.readdir(src, { withFileTypes: true });

            for (const entry of entries) {
              try {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);

                if (entry.isDirectory()) {
                  // Skip SAVEDATA directory - this is per-ROM
                  if (entry.name === "SAVEDATA") {
                    console.log(`[PPSSPP] Skipping SAVEDATA - will be populated with ROM-specific saves`);
                    continue;
                  }
                  // Recursively copy all other subdirectories
                  await copyDirRecursive(srcPath, destPath);
                } else {
                  // Copy all files
                  await fs.copyFile(srcPath, destPath);
                  console.log(`[PPSSPP] Copied: ${entry.name}`);
                }
              } catch (entryError: any) {
                console.warn(`[PPSSPP] Failed to copy ${entry.name}: ${entryError.message}`);
              }
            }
          } catch (dirError: any) {
            console.warn(`[PPSSPP] Failed to process directory ${src}: ${dirError.message}`);
          }
        };

        await copyDirRecursive(configFolder, romMemstickDir);
        console.log(`[PPSSPP] Full config sync completed`);
      } else {
        console.log(`[PPSSPP] No emulator config folder found at: ${configFolder}`);
      }

      // 6. Create SAVEDATA directory for this ROM
      const pspSaveDir = path.join(romMemstickDir, "PSP", "SAVEDATA");
      await fs.mkdir(pspSaveDir, { recursive: true });
      console.log(`[PPSSPP] Created SAVEDATA directory: ${pspSaveDir}`);

      return { success: true, pspSaveDir, gameSaveDir: pspSaveDir };
    } catch (error: any) {
      console.error(`Failed to setup PPSSPP portable mode: ${error.message}`);
      return {
        success: false,
        error: `PPSSPP setup failed: ${error.message}`,
      };
    }
  }

  /**
   * Helper method to recursively delete a directory
   */
  private async deleteDirectoryRecursive(dirPath: string): Promise<void> {
    if (!fsSync.existsSync(dirPath)) return;

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.deleteDirectoryRecursive(fullPath);
      } else {
        await fs.unlink(fullPath);
      }
    }

    await fs.rmdir(dirPath);
  }

  /**
   * Handle save preparation before launch
   * Copies local saves from the save manager's directory to the memstick SAVEDATA
   */
  public async handleSavePreparation(rom: Rom, saveDir: string, localSaveDir: string, saveManager: SaveManager): Promise<{ success: boolean; error?: string }> {
    try {
      const pspSaveDir = path.join(saveDir, "memstick", "PSP", "SAVEDATA");

      // Check if there are local saves
      if (!fsSync.existsSync(localSaveDir)) {
        console.log(`[PPSSPP] No local save directory found: ${localSaveDir}`);
        return { success: true };
      }

      // Get save files
      const saveFiles = await fs.readdir(localSaveDir, { recursive: true });
      const filesToCopy = saveFiles.filter((file) => {
        const filePath = path.join(localSaveDir, file.toString());
        const stats = fsSync.statSync(filePath);
        return stats.isFile();
      });

      if (filesToCopy.length === 0) {
        console.log(`[PPSSPP] No save files found in: ${localSaveDir}`);
        return { success: true };
      }

      console.log(`[PPSSPP] Found ${filesToCopy.length} save files - copying to emulator...`);

      // Copy save files to memstick SAVEDATA
      for (const file of filesToCopy) {
        const srcPath = path.join(localSaveDir, file.toString());
        const destPath = path.join(pspSaveDir, file.toString());

        try {
          // Create directory structure if needed
          const destDir = path.dirname(destPath);
          await fs.mkdir(destDir, { recursive: true });

          // Copy the file
          await fs.copyFile(srcPath, destPath);
          console.log(`[PPSSPP] Copied save: ${file}`);
        } catch (err: any) {
          console.warn(`[PPSSPP] Failed to copy save file ${file}: ${err.message}`);
        }
      }

      console.log(`[PPSSPP] Save preparation completed`);
      return { success: true };
    } catch (error: any) {
      console.error(`[PPSSPP] Error preparing saves: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  public async handleSaveSync(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager): Promise<SaveSyncResult> {
    try {
      // Use simple SAVEDATA directory
      const pspSaveDir = path.join(saveDir, "memstick", "PSP", "SAVEDATA");
      console.log(`Uploading saves from ${pspSaveDir} to RomM...`);

      if (!rommAPI) {
        throw new Error("RomM API is not available");
      }

      // Check if there are any save files to upload
      if (!fsSync.existsSync(pspSaveDir)) {
        console.log(`[PPSSPP] No save directory found: ${pspSaveDir}`);
        return {
          success: true,
          message: "No saves to upload",
        };
      }

      // Check if directory has any files
      const files = await fs.readdir(pspSaveDir, { recursive: true });
      const hasFiles = files.some((file: string) => {
        const filePath = path.join(pspSaveDir, file);
        const stat = fsSync.statSync(filePath);
        return stat.isFile();
      });

      if (!hasFiles) {
        console.log(`[PPSSPP] No save files found in: ${pspSaveDir}`);
        return {
          success: true,
          message: "No saves to upload",
        };
      }

      console.log(`[PPSSPP] Found ${files.length} items in save directory, preparing upload...`);

      // Create a temporary ZIP file
      const tempDir = os.tmpdir();
      const tempZipPath = path.join(tempDir, `ppsspp_save_${rom.id}_${Date.now()}.zip`);

      try {
        // Create ZIP archive
        const zip = new AdmZip();

        // Add the entire SAVEDATA directory to the ZIP
        // We need to add files relative to the SAVEDATA directory
        const addDirectoryToZip = async (dirPath: string, zipPath: string = "") => {
          const items = await fs.readdir(dirPath, { withFileTypes: true });

          for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            const relativePath = zipPath ? path.join(zipPath, item.name) : item.name;

            if (item.isDirectory()) {
              // Recursively add subdirectories
              await addDirectoryToZip(fullPath, relativePath);
            } else if (item.isFile()) {
              // Add file to ZIP
              const fileContent = await fs.readFile(fullPath);
              zip.addFile(relativePath, fileContent);
              console.log(`[PPSSPP] Added file to ZIP: ${relativePath}`);
            }
          }
        };

        await addDirectoryToZip(pspSaveDir);

        // Write ZIP to temporary file
        console.log(`[PPSSPP] Creating ZIP file: ${tempZipPath}`);
        zip.writeZip(tempZipPath);

        // Upload the ZIP file to RomM
        console.log(`[PPSSPP] Uploading save ZIP to RomM for ROM ${rom.id}`);
        const uploadResult = await rommAPI.uploadSave(rom.id, tempZipPath, "ppsspp");

        if (uploadResult.success) {
          console.log(`[PPSSPP] Save upload successful for ROM ${rom.id}`);

          // After successful upload, copy saves to persistent local storage
          try {
            const persistentSaveDir = saveManager.getLocalSaveDir(rom);
            console.log(`[PPSSPP] Copying saves to persistent storage: ${persistentSaveDir}`);

            // Ensure persistent directory exists
            await fs.mkdir(persistentSaveDir, { recursive: true });

            // Copy all files from the temporary SAVEDATA directory to persistent storage
            const copyDirRecursive = async (src: string, dest: string) => {
              const entries = await fs.readdir(src, { withFileTypes: true });

              for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);

                if (entry.isDirectory()) {
                  await fs.mkdir(destPath, { recursive: true });
                  await copyDirRecursive(srcPath, destPath);
                } else {
                  await fs.copyFile(srcPath, destPath);
                  console.log(`[PPSSPP] Copied to persistent: ${entry.name}`);
                }
              }
            };

            await copyDirRecursive(pspSaveDir, persistentSaveDir);
            console.log(`[PPSSPP] Saves copied to persistent storage successfully`);
          } catch (copyError: any) {
            console.warn(`[PPSSPP] Failed to copy saves to persistent storage: ${copyError.message}`);
            // Don't fail the entire operation if local copy fails
          }

          return {
            success: true,
            message: "Save uploaded successfully",
          };
        } else {
          console.error(`[PPSSPP] Save upload failed: ${uploadResult.error}`);
          return {
            success: false,
            error: uploadResult.error,
          };
        }
      } finally {
        // Clean up temporary ZIP file
        try {
          if (fsSync.existsSync(tempZipPath)) {
            await fs.unlink(tempZipPath);
            console.log(`[PPSSPP] Cleaned up temporary ZIP file: ${tempZipPath}`);
          }
        } catch (cleanupError: any) {
          console.warn(`[PPSSPP] Failed to clean up temporary ZIP file: ${cleanupError.message}`);
        }
      }
    } catch (saveError: any) {
      console.error(`Error uploading saves: ${saveError.message}`);
      return {
        success: false,
        error: saveError.message,
      };
    }
  }

  public async getSaveComparison(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager): Promise<SaveComparisonResult> {
    try {
      console.log(`Comparing local and cloud saves for ROM ${rom.id}...`);

      if (!rommAPI) {
        throw new Error("RomM API is not available");
      }

      // Check for local saves in persistent save directory
      const localSaveDir = saveManager.getLocalSaveDir(rom);
      let hasLocal = false;
      if (fsSync.existsSync(localSaveDir)) {
        const items = await fs.readdir(localSaveDir, { recursive: true });
        hasLocal = items.length > 0;
      }

      // Check for cloud saves
      console.log(`[PPSSPP EMULATOR] Checking cloud saves for ROM ${rom.id} (${rom.name})`);
      const cloudResult = await rommAPI.downloadSave(rom.id);
      const hasCloud = cloudResult.success && cloudResult.data && Array.isArray(cloudResult.data) && cloudResult.data.length > 0;
      console.log(`[PPSSPP EMULATOR] Cloud saves result for ROM ${rom.id}:`, {
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
          localSave: hasLocal ? localSaveDir : null,
          cloudSaves: hasCloud ? cloudResult.data : [],
          recommendation: hasLocal ? "local" : hasCloud ? "cloud" : "none",
        },
      };
    } catch (error: any) {
      console.error(`Error comparing saves for ROM ${rom.id}:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  public async handleSaveChoice(romData: any, saveChoice: string, saveManager: SaveManager, rommAPI: RommApi | null, saveId?: number): Promise<SaveChoiceResult> {
    try {
      const { rom, finalRomPath, saveDir } = romData;

      // Use SAVEDATA directory
      const pspSaveDir = path.join(saveDir, "memstick", "PSP", "SAVEDATA");

      console.log(`User chose save: ${saveChoice}${saveId ? ` (ID: ${saveId})` : ""}`);
      console.log(`Target save directory: ${pspSaveDir}`);

      // Ensure the target directory exists
      await fs.mkdir(pspSaveDir, { recursive: true });

      // Handle save loading based on choice
      if (saveChoice === "cloud") {
        console.log(`[PPSSPP EMULATOR] User chose cloud save${saveId ? ` #${saveId}` : ""} for ROM ${rom.id}`);
        if (!rommAPI) {
          console.error(`[PPSSPP EMULATOR] RomM API is not available for cloud save download`);
          throw new Error("RomM API is not available");
        }

        if (!saveId) {
          console.error(`[PPSSPP EMULATOR] No saveId provided for cloud save download`);
          throw new Error("No save ID provided for cloud save");
        }

        console.log(`[PPSSPP EMULATOR] Downloading cloud save #${saveId} to ${pspSaveDir}`);

        // Get the specific save data
        const saveListResult = await rommAPI.downloadSave(rom.id);
        if (!saveListResult.success || !saveListResult.data) {
          console.error(`[PPSSPP EMULATOR] Failed to get save list for ROM ${rom.id}`);
          throw new Error("Failed to get save list from RomM");
        }

        const saveData = saveListResult.data.find((save: any) => save.id === saveId);
        if (!saveData) {
          console.error(`[PPSSPP EMULATOR] Save #${saveId} not found in save list for ROM ${rom.id}`);
          throw new Error(`Save ${saveId} not found`);
        }

        console.log(`[PPSSPP EMULATOR] Found save data:`, {
          id: saveData.id,
          fileName: saveData.file_name,
          downloadPath: saveData.download_path,
        });

        // Download the save file
        console.log(`[PPSSPP EMULATOR] Downloading save file from: ${saveData.download_path}`);
        const downloadResult = await rommAPI.downloadSaveFile(saveData);
        if (!downloadResult.success || !downloadResult.data) {
          console.error(`[PPSSPP EMULATOR] Failed to download save file #${saveId}`);
          throw new Error("Failed to download save file");
        }

        console.log(`[PPSSPP EMULATOR] Downloaded ${downloadResult.data.length} bytes, extracting to ${pspSaveDir}`);

        // Extract the ZIP file
        const zip = new AdmZip(downloadResult.data);
        zip.extractAllTo(pspSaveDir, true);

        console.log(`[PPSSPP EMULATOR] Save extracted successfully to ${pspSaveDir}`);

        // Verify extraction
        const extractedFiles = await fs.readdir(pspSaveDir, { recursive: true });
        console.log(`[PPSSPP EMULATOR] Extracted files:`, extractedFiles);
      } else if (saveChoice === "local") {
        console.log(`[PPSSPP EMULATOR] Using existing local save for ROM ${rom.id}`);
      } else if (saveChoice === "none") {
        console.log(`[PPSSPP EMULATOR] Starting with no save (fresh start) for ROM ${rom.id}`);
        // Clear local save directory
        if (fsSync.existsSync(pspSaveDir)) {
          const files = await fs.readdir(pspSaveDir, { recursive: true });
          for (const file of files) {
            const filePath = path.join(pspSaveDir, file);
            try {
              const stat = await fs.stat(filePath);
              if (stat.isFile()) {
                await fs.unlink(filePath);
              }
            } catch (err: any) {
              console.warn(`Failed to delete ${filePath}: ${err.message}`);
            }
          }
        }
      }

      // Prepare emulator arguments
      const preparedArgs = this.prepareArgs(finalRomPath, saveDir);

      // Launch emulator
      console.log(`Launching emulator: ${this.getExecutablePath()} ${preparedArgs.join(" ")}`);
      const emulatorProcess = spawn(this.getExecutablePath()!, preparedArgs, {
        detached: false,
        stdio: "ignore",
      });

      // Monitor process to upload saves when it closes
      let saveUploaded = false; // Prevent duplicate uploads
      emulatorProcess.on("exit", async (code) => {
        console.log(`Emulator closed with code ${code}`);
        if (!saveUploaded) {
          saveUploaded = true;
          // Upload saves back to RomM
          if (rommAPI) {
            await this.handleSaveSync(rom, saveDir, rommAPI, saveManager);
          }
        }
      });

      return {
        success: true,
        message: `ROM launched: ${rom.name}`,
        pid: emulatorProcess.pid,
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

  /**
   * Extract saves from PPSSPP session directory
   * PPSSPP stores saves in memstick/PSP/SAVEDATA/
   * Preserves the save folder structure (e.g., ULES01230userdata0/)
   */
  public async extractSavesFromSession(sessionPath: string, persistentSaveDir: string): Promise<string[]> {
    const extractedFiles: string[] = [];

    // PPSSPP saves are in memstick/PSP/SAVEDATA/
    const ppssppSavePath = path.join(sessionPath, "memstick", "PSP", "SAVEDATA");

    if (!fsSync.existsSync(ppssppSavePath)) {
      console.log(`[PPSSPP] No SAVEDATA directory found in session: ${ppssppSavePath}`);
      return extractedFiles;
    }

    // Copy all save folders and files from SAVEDATA, preserving directory structure
    const copySaveFilesPreservingStructure = async (src: string, dest: string) => {
      const entries = await fs.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          // Preserve directory structure - create dest folder and recurse
          await fs.mkdir(destPath, { recursive: true });
          await copySaveFilesPreservingStructure(srcPath, destPath);
        } else {
          // Copy file directly
          await fs.copyFile(srcPath, destPath);
          extractedFiles.push(entry.name);
          console.log(`[PPSSPP] Extracted save file: ${entry.name}`);
        }
      }
    };

    await copySaveFilesPreservingStructure(ppssppSavePath, persistentSaveDir);
    return extractedFiles;
  }
}
