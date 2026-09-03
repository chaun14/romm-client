import fs from "fs";
import path from "path";
import unzipper from "unzipper";

import { RommClient } from "../RomMClient";
import { LocalRom, Rom } from "../types/RommApi";
import { HashCalculator } from "../utils/HashCalculator";
import { SaveManager } from "./SaveManager";
import { EmulatorManager } from "./EmulatorManager";
import { on } from "events";

export class RomManager {
  private static readonly PARTIAL_DOWNLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  private roms: Rom[] = [];
  private rommClient: RommClient;
  private localRoms: LocalRom[] = [];
  public noCacheMode: boolean = false;

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

  /**
   * Remove partial downloads left behind by interrupted sessions.
   * Cleanup is restricted to stale *.part files inside the active ROM cache.
   */
  async cleanupStalePartialDownloads(maxAgeMs = RomManager.PARTIAL_DOWNLOAD_MAX_AGE_MS): Promise<{ deletedCount: number; failedCount: number }> {
    const romFolder = this.rommClient.getRomFolder();
    if (!romFolder || !fs.existsSync(romFolder)) {
      return { deletedCount: 0, failedCount: 0 };
    }

    const cutoffTime = Date.now() - maxAgeMs;
    let deletedCount = 0;
    let failedCount = 0;

    const visitDirectory = async (directory: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error: any) {
        failedCount++;
        console.warn(`[HOUSEKEEPING] Unable to inspect ${directory}: ${error.message}`);
        return;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visitDirectory(entryPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".part")) {
          continue;
        }

        try {
          const stats = await fs.promises.stat(entryPath);
          if (stats.mtimeMs > cutoffTime) continue;

          await fs.promises.unlink(entryPath);
          deletedCount++;
          console.log(`[HOUSEKEEPING] Deleted stale partial download: ${entryPath}`);
        } catch (error: any) {
          failedCount++;
          console.warn(`[HOUSEKEEPING] Unable to delete ${entryPath}: ${error.message}`);
        }
      }
    };

    await visitDirectory(romFolder);
    console.log(`[HOUSEKEEPING] Partial download cleanup complete: ${deletedCount} deleted, ${failedCount} failed`);
    return { deletedCount, failedCount };
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
        let romDirs: fs.Dirent[];
        try {
          romDirs = await fs.promises.readdir(platformPath, { withFileTypes: true });
        } catch (error: any) {
          console.warn(`[ROM MANAGER] Skipping platform folder ${platformPath}: ${error.code || error.message}`);
          continue;
        }

        for (const romDirent of romDirs) {
          if (romDirent.isDirectory() && romDirent.name.startsWith("rom_")) {
            const romId = romDirent.name.replace("rom_", "");
            let rom = this.roms.find((r) => r.id.toString() === romId);

            // if we don't have a matching rom in the cache, we try to fetch the rom by hand
            if (!rom) {
              console.log(`[ROM MANAGER] ROM not found in cache, fetching by ID: ${romId}`);
              let remoteRom = await this.rommClient.rommApi?.fetchRomById(parseInt(romId));
              if (remoteRom && remoteRom.success && remoteRom.data) {
                rom = remoteRom.data;
              }

              if (rom) {
                this.roms.push(rom);
              }
            }

            if (rom) {
              const romPath = path.join(platformPath, romDirent.name);
              let files: string[];
              try {
                files = await fs.promises.readdir(romPath);
              } catch (error: any) {
                console.warn(`[ROM MANAGER] Skipping local ROM folder ${romPath}: ${error.code || error.message}`);
                continue;
              }

              if (files.length === 0) {
                console.warn(`[ROM MANAGER] Skipping empty local ROM folder ${romPath}`);
                continue;
              }

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

  private async ensureDirectory(dirPath: string, label: string): Promise<void> {
    try {
      const stats = await fs.promises.stat(dirPath);
      if (!stats.isDirectory()) {
        throw new Error(`${label} path exists but is not a directory: ${dirPath}`);
      }
      return;
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        throw new Error(`Cannot access ${label} directory (${error.code || error.message}): ${dirPath}`);
      }
    }

    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      if (error.code === "EEXIST") {
        const stats = await fs.promises.stat(dirPath);
        if (stats.isDirectory()) return;
      }

      throw new Error(`Cannot create ${label} directory (${error.code || error.message}): ${dirPath}`);
    }
  }

  private async checkRomIntegrity(rom: LocalRom): Promise<boolean> {
    // Check integrity for all files in the localPath folder
    let ignoredExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".txt", ".nfo", ".md", ".7z", ".rar", ".pdf"];
    if (!rom.localFiles || rom.localFiles.length === 0) return false;

    const existingFiles = rom.localFiles.filter((filePath) => {
      try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    });

    if (existingFiles.length === 0) {
      console.log(`[ROM INTEGRITY] Local ROM folder has no files for ${rom.name} (ID: ${rom.id})`);
      return false;
    }

    rom.localFiles = existingFiles;

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

    let localRom: LocalRom | undefined;
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
      const platformRomPath = path.join(romFolder, romEmulatorSlug);
      const romEmulatorPath = path.join(platformRomPath, "rom_" + rom.id);
      await this.ensureDirectory(platformRomPath, "platform ROM");
      await this.ensureDirectory(romEmulatorPath, "ROM");
      if (!this.rommClient.rommApi) throw new Error("RomM API is not initialized");
      onProgress({ step: "download", percent: 0, downloaded: "0.00", total: "0.00", message: "Starting download..." });
      let dlres = await this.rommClient.rommApi.downloadRom(rom, romEmulatorPath, onProgress);
      if (!dlres || !dlres.success || dlres.error) throw new Error("Failed to download ROM: " + (dlres?.error || "Unknown error"));
      onProgress({ step: "download", percent: 100, downloaded: "100.00", total: "100.00", message: "Download complete" });
      // Add the folder and files to localRoms
      const files = await fs.promises.readdir(romEmulatorPath);
      if (files.length === 0) {
        throw new Error(`ROM download completed but no files were written for ${rom.name}`);
      }
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
      const zipFiles = localRom!.files.filter((f) => f.file_name.endsWith(".zip"));
      for (const zipFile of zipFiles) {
        const zipFilePath = path.join(localRom!.localPath, zipFile.file_name);
        console.log("[LAUNCH]" + `Extracting zip file (streaming): ${zipFilePath}`);
        if (!fs.existsSync(zipFilePath)) {
          throw new Error(`Downloaded ZIP file is missing: ${zipFile.file_name}`);
        }

        // Use streaming extraction for large files
        try {
          await new Promise<void>((resolve, reject) => {
            fs.createReadStream(zipFilePath)
              .pipe(unzipper.Extract({ path: localRom!.localPath }))
              .on("close", () => {
                console.log("[LAUNCH]" + `Zip extraction completed: ${zipFilePath}`);
                resolve();
              })
              .on("error", (err: any) => {
                console.error("[LAUNCH]" + `Zip extraction error: ${err.message}`);
                reject(err);
              });
          });

          // Get list of extracted files for tracking
          if (!localRom!.localFiles) localRom!.localFiles = [];
          try {
            const allFiles = fs.readdirSync(localRom!.localPath, { recursive: true }) as string[];
            localRom!.localFiles = allFiles.map((f: string) => path.join(localRom!.localPath, f)).filter((f: string) => fs.statSync(f).isFile());
            console.log("[LAUNCH]" + `Tracked ${localRom!.localFiles?.length || 0} extracted files`);
          } catch (err: any) {
            console.warn("[LAUNCH]" + `Failed to track extracted files: ${err.message}`);
          }
        } catch (extractError: any) {
          console.error("[LAUNCH]" + `Failed to extract zip file: ${extractError.message}`);
          throw new Error(`Failed to extract ZIP file: ${extractError.message}`);
        }

        // Optionally delete the zip file after successful extraction
        // try {
        //   await fs.promises.unlink(zipFilePath);
        //   console.log("[LAUNCH]" + `Deleted zip file: ${zipFilePath}`);
        // } catch (deleteError: any) {
        //   console.warn("[LAUNCH]" + `Failed to delete zip file: ${deleteError.message}`);
        // }
      }

      let isValid = await this.checkRomIntegrity(localRom!);
      if (!isValid) {
        console.log("[LAUNCH]" + `Downloaded ROM is invalid: ${localRom!.name} (ID: ${localRom!.id})`);
        throw new Error("Downloaded ROM is invalid");
      } else {
        console.log("[LAUNCH]" + `Downloaded ROM is valid: ${localRom!.name} (ID: ${localRom!.id})`);
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
    onSaveChoice?: (saveData: any) => Promise<any>,
    preferredEmulatorKey?: string,
  ): Promise<any> {
    try {
      console.log("[LAUNCH FLOW] Starting complete launch flow for ROM:", rom.name);

      // Step 2: Find appropriate emulator for this ROM (moved up before ROM preparation)
      console.log("[LAUNCH FLOW] Finding emulator for platform:", rom.platform_slug);
      const { emulator, emulatorKey } = this.findEmulatorForRomWithKey(rom, emulatorManager, preferredEmulatorKey);
      if (!emulator) {
        throw new Error(`No emulator configured for platform: ${rom.platform_slug}`);
      }

      console.log("[LAUNCH FLOW] Using emulator:", emulator.constructor.name);

      // Special handling for integrated emulator - bypass all local processing
      if (emulatorKey === "rommIntegrated") {
        console.log("[LAUNCH FLOW] Using integrated emulator - bypassing local processing");

        // Send progress update that ROM is ready
        onProgress({
          step: "download",
          percent: 100,
          downloaded: "0.00",
          total: "0.00",
          message: "ROM ready for integrated emulator",
        });

        // Call IPC to open the integrated emulator URL directly
        // This will be handled by IPCManager.launchWithIntegratedEmulator
        return {
          success: true,
          message: `ROM ${rom.name} launched in integrated emulator`,
          integrated: true,
          emulatorKey: emulatorKey,
        };
      }

      // Step 1: Ensure ROM is available (download if needed) - only for external emulators
      const launchResult = await this.launchRom(rom, onProgress, () => { }, () => {
        onProgress({ step: "download", percent: 100, downloaded: "100.00", total: "100.00", message: "ROM ready", complete: true });
      });
      if (!launchResult.success) {
        throw new Error("Failed to prepare ROM for launch");
      }

      const { localRom } = launchResult;

      // Resolve the actual game file before comparing saves. Emulators such as
      // Azahar derive the game's storage identifier directly from its header.
      const romFilePath = this.findRomFileInPath(localRom.localPath, emulator.getSupportedExtensions());
      if (!romFilePath) {
        throw new Error("Could not find ROM file in directory");
      }

      console.log("[LAUNCH FLOW] ROM file path:", romFilePath);

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

      const saveComparison = await emulator.getSaveComparison(rom, tempSaveDir, this.rommClient.rommApi, this.rommClient.saveManager, romFilePath);
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
          // Use the source reported by the emulator. This also covers a
          // one-time import from an emulator's pre-existing save directory.
          const localSaveSource = saveData.localSaveDir || saveManager.getLocalSaveDir(rom);
          if (fs.existsSync(localSaveSource)) {
            const stats = fs.statSync(localSaveSource);
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

          if (selectedSaveOption === "cancel") {
            console.log("[LAUNCH FLOW] Launch cancelled during save selection");
            try {
              if (fs.existsSync(tempSaveDir)) {
                fs.rmSync(tempSaveDir, { recursive: true, force: true });
              }
            } catch (cleanupError: any) {
              console.warn(`[LAUNCH FLOW] Failed to clean up cancelled session directory: ${cleanupError.message}`);
            }
            throw new Error("Launch cancelled");
          }
        }
      }

      let finalLaunchResult: any;

      // Always use handleSaveChoice for consistency - it handles save preparation and launching
      const romData = {
        rom,
        finalRomPath: romFilePath,
        saveDir: tempSaveDir,
      };

      if (selectedSaveOption === "cloud" && selectedSaveId) {
        // For cloud saves, use handleSaveChoice to download and launch
        console.log("[LAUNCH FLOW] Handling cloud save choice for save ID:", selectedSaveId);
        finalLaunchResult = await emulator.handleSaveChoice(romData, "cloud", saveManager, this.rommClient.rommApi, selectedSaveId, onProgress);
        if (!finalLaunchResult.success) {
          throw new Error(`Failed to handle cloud save choice: ${finalLaunchResult.error}`);
        }
        // Cloud saves handle their own process monitoring in handleSaveChoice
      } else if (selectedSaveOption === "local" && saveData.hasLocal) {
        // For local saves, use handleSaveChoice to prepare and launch
        console.log("[LAUNCH FLOW] Handling local save choice");
        finalLaunchResult = await emulator.handleSaveChoice(romData, "local", saveManager, this.rommClient.rommApi, undefined, onProgress);
        if (!finalLaunchResult.success) {
          throw new Error(`Failed to handle local save choice: ${finalLaunchResult.error}`);
        }
        // Local saves handle their own process monitoring in handleSaveChoice
      } else {
        // For no saves, use handleSaveChoice with "none"
        console.log("[LAUNCH FLOW] Handling fresh start (no saves)");
        finalLaunchResult = await emulator.handleSaveChoice(romData, "none", saveManager, this.rommClient.rommApi, undefined, onProgress);
        if (!finalLaunchResult.success) {
          throw new Error(`Failed to handle fresh start: ${finalLaunchResult.error}`);
        }
        // Fresh start handles its own process monitoring in handleSaveChoice
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
  private findEmulatorForRomWithKey(rom: Rom, emulatorManager: EmulatorManager, preferredEmulatorKey?: string): { emulator: any; emulatorKey: string } | { emulator: null; emulatorKey: string } {
    const supportedEmulators = emulatorManager.getSupportedEmulators();

    if (preferredEmulatorKey) {
      const spec = supportedEmulators[preferredEmulatorKey];
      if (!spec || !spec.platforms.includes(rom.platform_slug)) {
        return { emulator: null, emulatorKey: "" };
      }

      const preferredEmulator = emulatorManager.getEmulator(preferredEmulatorKey);
      if (preferredEmulator?.isConfigured()) {
        return { emulator: preferredEmulator, emulatorKey: preferredEmulatorKey };
      }

      return { emulator: null, emulatorKey: "" };
    }

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
  private findRomFileInPath(dirPath: string, supportedExtensions: string[]): string | null {
    const romExtensions = supportedExtensions.map((extension) => extension.toLowerCase());

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
