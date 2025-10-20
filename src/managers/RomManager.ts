import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

import { RommClient } from "../RomMClient";
import { LocalRom, Rom } from "../types/RommApi";
import { HashCalculator } from "../utils/HashCalculator";
import { SaveManager } from "./SaveManager";
import { EmulatorManager } from "./EmulatorManager";
import { on } from "events";

export class RomManager {
  private roms: Rom[] = [];
  private rommClient: RommClient;
  private localRoms: LocalRom[] = [];

  constructor(rommClient: RommClient) {
    this.rommClient = rommClient;
  }

  public getRoms(): Rom[] {
    return this.roms;
  }

  public getLocalRoms(): LocalRom[] {
    return this.localRoms;
  }

  public getLocalRomById(id: number): LocalRom | undefined {
    return this.localRoms.find((rom) => rom.id === id);
  }

  async loadRemoteRoms(): Promise<number> {
    if (!this.rommClient.rommApi) {
      throw new Error("Romm API is not available");
    }

    // Load ROMs from the remote API
    const response = await this.rommClient.rommApi.fetchAllRoms();
    if (!response.success) {
      throw new Error("Failed to load remote ROMs");
    }

    if (Array.isArray(response.data) && response.data.length > 0) {
      this.roms = response.data;
    }

    return this.roms.length;
  }

  async deleteLocalRom(id: number): Promise<{ success: boolean; error?: string }> {
    const localRom = this.getLocalRomById(id);
    if (localRom) {
      try {
        // Check if the path is a directory (it should be for cached ROMs)
        const stats = await fs.promises.stat(localRom.localPath);
        if (stats.isDirectory()) {
          // Use rmSync with force and recursive options for directories
          fs.rmSync(localRom.localPath, { recursive: true, force: true });
          console.log(`[ROM MANAGER] Deleted local ROM directory: ${localRom.localPath}`);
        } else {
          // If it's a file, use unlink
          await fs.promises.unlink(localRom.localPath);
          console.log(`[ROM MANAGER] Deleted local ROM file: ${localRom.localPath}`);
        }

        // Remove from local ROMs list
        this.localRoms = this.localRoms.filter((rom) => rom.id !== id);
        return { success: true };
      } catch (error: any) {
        console.error(`[ROM MANAGER] Failed to delete local ROM: ${localRom.localPath}`, error);

        // Provide more specific error messages
        let errorMessage = error.message;
        if (error.code === "EPERM" || error.code === "EBUSY") {
          errorMessage = "ROM is currently in use by the emulator. Please close the emulator first.";
        } else if (error.code === "ENOENT") {
          errorMessage = "ROM file or directory not found.";
        } else if (error.code === "EACCES") {
          errorMessage = "Permission denied. Please check file permissions.";
        }

        return {
          success: false,
          error: errorMessage,
        };
      }
    }
    return { success: false, error: "ROM not found in local cache" };
  }

  async loadLocalRoms(): Promise<number> {
    // ROMs are stored in folders named rom_<id> inside each platform subfolder
    const romFolder = this.rommClient.getRomFolder();
    if (!romFolder) throw new Error("ROM folder not set");
    this.localRoms = [];
    const platformFolders = await fs.promises.readdir(romFolder, { withFileTypes: true });
    for (const dirent of platformFolders) {
      if (dirent.isDirectory()) {
        const platformPath = path.join(romFolder, dirent.name);
        const romDirs = await fs.promises.readdir(platformPath, { withFileTypes: true });
        for (const romDirent of romDirs) {
          if (romDirent.isDirectory() && romDirent.name.startsWith("rom_")) {
            const romId = romDirent.name.replace("rom_", "");
            const rom = this.roms.find((r) => r.id.toString() === romId);
            if (rom) {
              const romPath = path.join(platformPath, romDirent.name);
              const files = await fs.promises.readdir(romPath);
              const localRom: LocalRom = {
                ...rom,
                localPath: romPath,
                localFiles: files.map((f) => path.join(romPath, f)),
              };
              this.localRoms.push(localRom);
            }
          }
        }
      }
    }
    return this.localRoms.length;
  }

  private saveRoms(): void {
    // Save ROMs to storage (e.g., file system, database)
  }

  private async checkRomIntegrity(rom: LocalRom): Promise<boolean> {
    // Check integrity for all files in the localPath folder
    let ignoredExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".txt", ".nfo", ".md", ".7z", ".rar", ".pdf"];
    if (!rom.localFiles || rom.localFiles.length === 0) return false;

    // Check if there's a zip file in the ROM's files list
    const zipFile = Array.isArray(rom.files) ? rom.files.find((f) => f.file_name.endsWith(".zip")) : undefined;
    let useZipHash = false;
    let zipHashParams;

    if (zipFile) {
      // Use the zip file's hash for integrity checking of extracted files
      zipHashParams = {
        crc_hash: zipFile.crc_hash,
        md5_hash: zipFile.md5_hash,
        sha1_hash: zipFile.sha1_hash,
      };
      useZipHash = true;
      console.log(`[ROM INTEGRITY] Found zip file ${zipFile.file_name}, using its hash for integrity checking`);
    }

    let allValid = true;
    for (const filePath of rom.localFiles) {
      if (ignoredExtensions.some((ext) => filePath.endsWith(ext))) {
        console.log(`[ROM INTEGRITY] Ignoring integrity check for file: ${filePath}`);
        continue;
      }

      // Skip zip files themselves if we're using zip hash
      if (useZipHash && filePath.endsWith(".zip")) {
        console.log(`[ROM INTEGRITY] Skipping zip file integrity check (using zip hash for others): ${filePath}`);
        continue;
      }

      let hashParams;
      if (useZipHash && zipHashParams) {
        // Use zip file's hash for all extracted files
        hashParams = zipHashParams;
        console.log(`[ROM INTEGRITY] Using zip hash for file: ${filePath}`);
      } else {
        // Find the file object in rom.files that matches this filePath
        const fileName = path.basename(filePath);
        const fileObj = Array.isArray(rom.files) ? rom.files.find((f) => f.file_name === fileName) : undefined;
        if (fileObj) {
          hashParams = {
            crc_hash: fileObj.crc_hash,
            md5_hash: fileObj.md5_hash,
            sha1_hash: fileObj.sha1_hash,
          };
        } else {
          // fallback to ROM-level hash if not found
          hashParams = {
            crc_hash: rom.crc_hash,
            md5_hash: rom.md5_hash,
            sha1_hash: rom.sha1_hash,
          };
        }
      }

      let result = await HashCalculator.verifyFileIntegrity(filePath, hashParams);
      if (!result.isValid) {
        allValid = false;
        console.log(`[ROM INTEGRITY] Invalid file: ${filePath}`);
      }
    }
    return allValid;
  }

  async launchRom(rom: Rom, onProgress: (progress: any) => void, onSaveUploadSuccess: (rom: any) => void, onDownloadComplete?: (rom: any) => void): Promise<any> {
    // first we need to check if we already have the file downloaded
    console.log("[LAUNCH]" + `Launching ROM: ${rom.name} (ID: ${rom.id})`);

    let localRom;
    let isRomOkay = false;
    if (rom && rom.id) {
      localRom = this.localRoms.find((r) => r.id === rom.id);
    }
    if (localRom && localRom.localPath) {
      console.log("[LAUNCH]" + `Found local ROM: ${localRom.name} (ID: ${localRom.id})`);
      // Check integrity for all files in the folder
      const isValid = await this.checkRomIntegrity(localRom);
      if (!isValid) {
        console.log("[LAUNCH]" + `Local ROM is invalid: ${localRom.name} (ID: ${localRom.id})`);
        // If integrity fails, redownload
      } else {
        console.log("[LAUNCH]" + `Local ROM is valid: ${localRom.name} (ID: ${localRom.id})`);
        isRomOkay = true;
        onProgress({ step: "download", percent: 100, downloaded: "0.00", total: "0.00", message: "ROM already available" });
        if (onDownloadComplete) {
          onDownloadComplete(rom);
        }
      }
    }

    // If we don't have the local ROM, we need to download it
    if (!isRomOkay) {
      console.log("[LAUNCH]" + `Local ROM is missing or invalid: ${rom.name} (ID: ${rom.id})`);

      let romFolder = this.rommClient.getRomFolder();
      if (!romFolder) throw new Error("ROM folder not set");
      let romEmulatorSlug = rom.platform_slug || "unknown";
      let romEmulatorPath = path.join(romFolder, romEmulatorSlug, "rom_" + rom.id);
      if (!fs.existsSync(romEmulatorPath)) {
        fs.mkdirSync(romEmulatorPath, { recursive: true });
      }
      if (!fs.existsSync(path.join(romFolder, romEmulatorSlug))) {
        fs.mkdirSync(path.join(romFolder, romEmulatorSlug), { recursive: true });
      }
      if (!this.rommClient.rommApi) throw new Error("RomM API is not initialized");
      onProgress({ step: "download", percent: 0, downloaded: "0.00", total: "0.00", message: "Starting download..." });
      let dlres = await this.rommClient.rommApi.downloadRom(rom, romEmulatorPath, onProgress);
      if (!dlres || !dlres.success || dlres.error) throw new Error("Failed to download ROM: " + (dlres?.error || "Unknown error"));
      onProgress({ step: "download", percent: 100, downloaded: "100.00", total: "100.00", message: "Download complete" });
      // Add the folder and files to localRoms
      const files = await fs.promises.readdir(romEmulatorPath);
      localRom = this.localRoms.find((r) => r.id === rom.id);
      if (!localRom) {
        (rom as LocalRom).localPath = romEmulatorPath;
        (rom as LocalRom).localFiles = files.map((f) => path.join(romEmulatorPath, f));
        this.localRoms.push(rom as LocalRom);
        localRom = rom as LocalRom;
      } else {
        localRom.localPath = romEmulatorPath;
        localRom.localFiles = files.map((f) => path.join(romEmulatorPath, f));
      }

      // if we've downloaded a zip file among the files, we need to extract it
      const zipFiles = localRom.files.filter((f) => f.file_name.endsWith(".zip"));
      for (const zipFile of zipFiles) {
        const zipFilePath = path.join(localRom.localPath, zipFile.file_name);
        const zip = new AdmZip(zipFilePath);
        let zipEntries = await zip.getEntries();
        console.log("[LAUNCH]" + `Extracting zip file: ${zipFilePath} with ${zipEntries.length} entries`);

        // extract all entries in the root of the localRom folder
        await zip.extractAllTo(localRom.localPath, true);

        for (const entry of zipEntries) {
          console.log("[LAUNCH]" + `Extracted entry: ${entry.entryName} to ${localRom.localPath}`);
          if (!localRom.localFiles) localRom.localFiles = [];
          localRom.localFiles.push(path.join(localRom.localPath, entry.entryName));
        }

        // delete the zip file after extraction
        // await fs.promises.unlink(zipFilePath);
        // console.log("[LAUNCH]" + `Extracted and deleted zip file: ${zipFilePath}`);
      }

      let isValid = await this.checkRomIntegrity(localRom);
      if (!isValid) {
        console.log("[LAUNCH]" + `Downloaded ROM is invalid: ${localRom.name} (ID: ${localRom.id})`);
        throw new Error("Downloaded ROM is invalid");
      } else {
        console.log("[LAUNCH]" + `Downloaded ROM is valid: ${localRom.name} (ID: ${localRom.id})`);
        if (onDownloadComplete) {
          onDownloadComplete(rom);
        }
      }
    }

    // Now that we have the ROM, proceed with save preparation
    return { success: true, rom, localRom };
  }

  /**
   * Complete launch flow: download if needed, setup emulator, check saves, launch with save handling
   */
  async launchRomWithSavesFlow(
    rom: Rom,
    saveManager: SaveManager,
    emulatorManager: EmulatorManager,
    onProgress: (progress: any) => void,
    onSaveChoice?: (saveData: any) => Promise<any>
  ): Promise<any> {
    try {
      console.log("[LAUNCH FLOW] Starting complete launch flow for ROM:", rom.name);

      // Step 1: Ensure ROM is available (download if needed)
      const launchResult = await this.launchRom(rom, onProgress, () => {}, onProgress);
      if (!launchResult.success) {
        throw new Error("Failed to prepare ROM for launch");
      }

      const { localRom } = launchResult;

      // Step 2: Find appropriate emulator for this ROM
      console.log("[LAUNCH FLOW] Finding emulator for platform:", rom.platform_slug);
      const { emulator, emulatorKey } = this.findEmulatorForRomWithKey(rom, emulatorManager);
      if (!emulator) {
        throw new Error(`No emulator configured for platform: ${rom.platform_slug}`);
      }

      console.log("[LAUNCH FLOW] Using emulator:", emulator.constructor.name);

      // Step 3: Setup save directory
      const savesFolder = this.rommClient.getSavesFolder();
      if (!savesFolder) {
        throw new Error("Saves folder not configured");
      }

      const tempSaveDir = path.join(savesFolder, rom.platform_slug, `rom_${rom.id}_session`);
      if (!fs.existsSync(tempSaveDir)) {
        fs.mkdirSync(tempSaveDir, { recursive: true });
      }

      console.log("[LAUNCH FLOW] Temp save directory:", tempSaveDir);

      // Step 4: Setup emulator environment (configs, portable mode, etc)
      const emulatorsConfigsFolder = this.rommClient.getEmulatorConfigsFolder();
      if (!emulatorsConfigsFolder) {
        throw new Error("Emulator configs folder not configured");
      }

      // Use emulator key (ppsspp, dolphin) not platform slug (psp, gc)
      const configFolder = path.join(emulatorsConfigsFolder, emulatorKey);
      console.log("[LAUNCH FLOW] Setup emulator environment with config folder:", configFolder);

      const setupResult = await emulator.setupEnvironment(rom, tempSaveDir, this.rommClient.rommApi, saveManager, configFolder);
      if (!setupResult.success) {
        throw new Error(`Failed to setup emulator environment: ${setupResult.error}`);
      }

      // Step 5: Check for available saves (local and cloud)
      console.log("[LAUNCH FLOW] Checking available saves...");

      const saveComparison = await emulator.getSaveComparison(rom, tempSaveDir, this.rommClient.rommApi, this.rommClient.saveManager);
      if (!saveComparison.success) {
        throw new Error(`Failed to check saves: ${saveComparison.error}`);
      }

      const saveData = {
        hasLocal: saveComparison.data.hasLocal,
        hasCloud: saveComparison.data.hasCloud,
        cloudSaves: saveComparison.data.cloudSaves,
        localSaveDir: saveComparison.data.localSave,
      };

      // Calculate local save modification date if local saves exist
      let localSaveDate: string | null = null;
      if (saveData.hasLocal) {
        try {
          // Use the persistent save directory from SaveManager instead of emulator temp directory
          const persistentSaveDir = saveManager.getLocalSaveDir(rom);
          if (fs.existsSync(persistentSaveDir)) {
            const stats = fs.statSync(persistentSaveDir);
            localSaveDate = new Date(stats.mtime).toISOString();
          }
        } catch (error) {
          console.warn(`[LAUNCH FLOW] Could not get local save date for ROM ${rom.id}:`, error);
        }
      }

      console.log("[LAUNCH FLOW] Save data:", {
        hasLocal: saveData.hasLocal,
        hasCloud: saveData.hasCloud,
        localSaveDate,
      });

      // Step 6: If there are saves, let user choose or use local by default
      let selectedSaveOption = "local";
      let selectedSaveId: number | undefined;
      if (saveData.hasLocal || saveData.hasCloud) {
        // Call save choice callback if provided
        if (onSaveChoice) {
          // Create a serializable version of the ROM object for IPC
          const serializableRom = {
            id: rom.id,
            name: rom.name,
            platform_slug: rom.platform_slug,
            platform_name: rom.platform_name,
            platform_display_name: rom.platform_display_name,
            regions: rom.regions,
            fs_size_bytes: rom.fs_size_bytes,
            path_cover_small: rom.path_cover_small,
            url_cover: rom.url_cover,
            files: rom.files,
            crc_hash: rom.crc_hash,
            md5_hash: rom.md5_hash,
            sha1_hash: rom.sha1_hash,
          };

          const choiceResult = await onSaveChoice({
            hasLocal: saveData.hasLocal,
            hasCloud: saveData.hasCloud,
            cloudSaves: saveData.cloudSaves,
            localSaveDir: saveData.localSaveDir,
            localSaveDate,
            rom: serializableRom,
          });
          selectedSaveOption = choiceResult.choice || "local";
          selectedSaveId = choiceResult.saveId;
        }
      }

      // Step 7: Prepare saves for emulator
      console.log("[LAUNCH FLOW] Preparing saves with option:", selectedSaveOption, selectedSaveId ? `(ID: ${selectedSaveId})` : "");
      if (selectedSaveOption === "local" && saveData.hasLocal) {
        const prepareResult = await emulator.handleSavePreparation(rom, tempSaveDir, saveData.localSaveDir, saveManager);
        if (!prepareResult.success) {
          console.warn("[LAUNCH FLOW] Save preparation failed:", prepareResult.error);
        }
      }

      // Step 8: Get the ROM file path
      const romFilePath = this.findRomFileInPath(localRom.localPath);
      if (!romFilePath) {
        throw new Error("Could not find ROM file in directory");
      }

      console.log("[LAUNCH FLOW] ROM file path:", romFilePath);

      let finalLaunchResult: any;

      if (selectedSaveOption === "cloud" && selectedSaveId) {
        // For cloud saves, use handleSaveChoice which downloads the save and launches
        console.log("[LAUNCH FLOW] Handling cloud save choice for save ID:", selectedSaveId);
        const romData = {
          rom,
          finalRomPath: romFilePath,
          saveDir: tempSaveDir,
        };
        finalLaunchResult = await emulator.handleSaveChoice(romData, "cloud", saveManager, this.rommClient.rommApi, selectedSaveId);
        if (!finalLaunchResult.success) {
          throw new Error(`Failed to handle cloud save choice: ${finalLaunchResult.error}`);
        }
        // Cloud saves handle their own process monitoring in handleSaveChoice
      } else {
        // For local saves or no saves, launch normally
        console.log("[LAUNCH FLOW] Launching emulator normally...");
        const launchGameResult = await emulator.launch(romFilePath, tempSaveDir);
        if (!launchGameResult.success || !launchGameResult.process) {
          throw new Error(`Failed to launch emulator: ${launchGameResult.error}`);
        }

        // Setup save sync on emulator close immediately after launch
        launchGameResult.process.on("exit", async (code: number) => {
          console.log("[LAUNCH FLOW] Emulator closed with code:", code);

          // Sync saves back
          const syncResult = await emulator.handleSaveSync(rom, tempSaveDir, this.rommClient.rommApi, saveManager);
          if (syncResult.success) {
            console.log("[LAUNCH FLOW] Saves synced successfully");
          } else {
            console.error("[LAUNCH FLOW] Save sync failed:", syncResult.error);
          }

          // Cleanup temp save directory
          try {
            // Use a more robust cleanup that handles nested directories
            const cleanupDir = async (dirPath: string): Promise<void> => {
              if (!fs.existsSync(dirPath)) return;

              const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

              for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                  await cleanupDir(fullPath);
                } else {
                  await fs.promises.unlink(fullPath);
                }
              }

              await fs.promises.rmdir(dirPath);
            };

            await cleanupDir(tempSaveDir);
            console.log("[LAUNCH FLOW] Cleaned up temp save directory");
          } catch (err: any) {
            console.warn("[LAUNCH FLOW] Cleanup failed:", err.message);
            // Try alternative cleanup method
            try {
              const { exec } = require("child_process");
              const { promisify } = require("util");
              const execAsync = promisify(exec);
              await execAsync(`rmdir /s /q "${tempSaveDir}"`, { windowsHide: true });
              console.log("[LAUNCH FLOW] Cleaned up temp save directory using alternative method");
            } catch (fallbackErr: any) {
              console.warn("[LAUNCH FLOW] Alternative cleanup also failed:", fallbackErr.message);
            }
          }
        });

        finalLaunchResult = {
          success: true,
          message: `ROM launched: ${rom.name}`,
          pid: launchGameResult.process.pid,
          romPath: romFilePath,
          saveDir: tempSaveDir,
          // Removed process object as it's not serializable for IPC
        };
      }

      return finalLaunchResult;
    } catch (error: any) {
      console.error("[LAUNCH FLOW] Error:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Find the appropriate emulator for a ROM based on platform
   * Returns both the emulator instance and its key
   */
  private findEmulatorForRomWithKey(rom: Rom, emulatorManager: EmulatorManager): { emulator: any; emulatorKey: string } | { emulator: null; emulatorKey: string } {
    const supportedEmulators = emulatorManager.getSupportedEmulators();

    for (const [key, spec] of Object.entries(supportedEmulators)) {
      if (spec.platforms.includes(rom.platform_slug)) {
        const emulator = emulatorManager.getEmulator(key);
        if (emulator && emulator.isConfigured()) {
          return { emulator, emulatorKey: key };
        }
      }
    }

    return { emulator: null, emulatorKey: "" };
  }

  /**
   * Find the appropriate emulator for a ROM based on platform
   */
  private findEmulatorForRom(rom: Rom, emulatorManager: EmulatorManager): any {
    const supportedEmulators = emulatorManager.getSupportedEmulators();

    for (const [key, spec] of Object.entries(supportedEmulators)) {
      if (spec.platforms.includes(rom.platform_slug)) {
        const emulator = emulatorManager.getEmulator(key);
        if (emulator && emulator.isConfigured()) {
          return emulator;
        }
      }
    }

    return null;
  }

  /**
   * Find the first ROM file in a directory
   */
  private findRomFileInPath(dirPath: string): string | null {
    // Common ROM file extensions
    const romExtensions = [".iso", ".cso", ".pbp", ".elf", ".gcm", ".iso", ".wbfs", ".bin"];

    if (!fs.existsSync(dirPath)) {
      return null;
    }

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (romExtensions.includes(ext)) {
        return path.join(dirPath, file);
      }
    }

    return null;
  }
}
