import { Emulator, EmulatorConfig, EnvironmentSetupResult, SaveComparisonResult, SaveSyncResult, SaveChoiceResult, ProgressCallback } from "./Emulator";
import { Rom } from "../../types/RommApi";
import { RommApi } from "../../api/RommApi";
import { SaveManager } from "../SaveManager";
import { IniManager } from "../IniManager";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import AdmZip from "adm-zip";
import os from "os";
import { getPcsx2DataRoot, getPcsx2LaunchArguments } from "../../utils/EmulatorRuntime";

/**
 * PCSX2 (PS2) Emulator implementation
 */
export class PCSX2Emulator extends Emulator {
  private readonly INI_TEMPLATE_NAME = "pcsx2-rommclient.ini";

  constructor(config: EmulatorConfig) {
    super({
      ...config,
      platform: "ps2",
      name: "PCSX2",
      extensions: PCSX2Emulator.getExtensions(),
      args: ["{rom}"],
    });
  }

  /**
   * Get supported file extensions for PCSX2
   */
  public static getExtensions(): string[] {
    return [".iso", ".bin", ".cue", ".elf", ".gs"];
  }

  /**
   * Get supported platforms for PCSX2
   */
  public static getPlatforms(): string[] {
    return ["ps2"];
  }

  /**
   * Get the RomM slug for PCSX2
   */
  public static getRommSlug(): string {
    return "ps2";
  }

  /**
   * Get default arguments for PCSX2
   */
  public static getDefaultArgs(): string[] {
    return ["{rom}"];
  }

  /**
   * Prepare emulator arguments
   * Linux isolates PCSX2 through XDG_CONFIG_HOME; other platforms retain
   * the existing portable-mode behavior.
   */
  public prepareArgs(romPath: string, _configPath: string): string[] {
    return getPcsx2LaunchArguments(romPath);
  }

  /**
   * Check if PCSX2 supports saves
   */
  public static getSupportsSaves(): boolean {
    return true;
  }

  /** PCSX2 resolves its Linux data root as $XDG_CONFIG_HOME/PCSX2. */
  private getDataRoot(container: string): string {
    return getPcsx2DataRoot(container);
  }

  private getProcessEnvironment(container: string): NodeJS.ProcessEnv {
    return process.platform === "linux" ? { XDG_CONFIG_HOME: container } : { PCSX2_HOME: container };
  }

  /**
   * Start PCSX2 in configuration mode
   */
  public async startInConfigMode(configFolder: string): Promise<{ success: boolean; error?: string; pid?: number }> {
    try {
      const emulatorPath = this.getExecutablePath();
      if (!emulatorPath) {
        return {
          success: false,
          error: `PCSX2 path not configured`,
        };
      }

      const configDataRoot = this.getDataRoot(configFolder);
      await fs.mkdir(configDataRoot, { recursive: true });
      console.log(`Using emulator config folder for PCSX2: ${configDataRoot}`);

      // Setup INI file for config mode in the emulator's ini folder
      await this.setupIniFileForConfigMode(configDataRoot);

      console.log(`Launching PCSX2 in configuration mode: ${emulatorPath}`);
      const args = process.platform === "linux" ? [] : ["-portable"];

      const emulatorProcess = this.spawnProcess(args, {
        env: this.getProcessEnvironment(configFolder),
      });
      await this.waitForProcessStart(emulatorProcess);

      return {
        success: true,
        pid: emulatorProcess.pid,
      };
    } catch (error: any) {
      console.error(`Failed to start PCSX2 in config mode: ${error.message}`);
      return {
        success: false,
        error: `PCSX2 config mode failed: ${error.message}`,
      };
    }
  }

  /**
   * Setup INI file for configuration mode
   * Copies the template to the emulator's ini folder as PCSX2.ini
   */
  private async setupIniFileForConfigMode(emulatorConfigFolder: string): Promise<void> {
    try {
      // Set up the runtime INI without memcard path substitution (use defaults).
      await this.setupIniFile(emulatorConfigFolder, null);
      console.log(`[PCSX2] Config mode INI file created successfully`);
    } catch (error: any) {
      console.warn(`[PCSX2] Failed to setup config mode INI file: ${error.message}`);
    }
  }

  public async setupEnvironment(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager, configFolder: string): Promise<EnvironmentSetupResult> {
    try {
      // 1. Clean slate - delete entire session directory if it exists and rebuild from config
      console.log(`[PCSX2] Cleaning up existing session directory: ${saveDir}`);
      if (fsSync.existsSync(saveDir)) {
        await this.deleteDirectoryRecursive(saveDir);
        console.log(`[PCSX2] Deleted existing session directory`);
      }

      // 2. Setup ROM-specific config directory (fresh)
      const sessionDataRoot = this.getDataRoot(saveDir);
      await fs.mkdir(sessionDataRoot, { recursive: true });
      console.log(`[PCSX2] Created fresh session directory: ${sessionDataRoot}`);

      // 3. Copy entire emulator config folder to ROM session (with all subdirectories)
      const configuredDataRoot = this.getDataRoot(configFolder);
      const configSource = fsSync.existsSync(configuredDataRoot) ? configuredDataRoot : configFolder;
      if (fsSync.existsSync(configSource)) {
        console.log(`[PCSX2] Full config sync from: ${configSource}`);

        // Recursive copy of all files and folders, excluding memcards/saves and INI
        const copyDirRecursive = async (src: string, dest: string): Promise<void> => {
          try {
            await fs.mkdir(dest, { recursive: true });
            const entries = await fs.readdir(src, { withFileTypes: true });

            for (const entry of entries) {
              try {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);

                if (entry.isDirectory()) {
                  // Skip save directories - these are per-ROM
                  if (entry.name === "memcards" || entry.name === "saves") {
                    console.log(`[PCSX2] Skipping ${entry.name} - will be populated with ROM-specific saves`);
                    continue;
                  }
                  // Recursively copy all other subdirectories
                  await copyDirRecursive(srcPath, destPath);
                } else {
                  // Skip INI files - we'll handle them separately
                  if (entry.name.endsWith(".ini")) {
                    console.log(`[PCSX2] Skipping INI: ${entry.name}`);
                    continue;
                  }
                  // Copy all other files
                  await fs.copyFile(srcPath, destPath);
                  console.log(`[PCSX2] Copied: ${entry.name}`);
                }
              } catch (entryError: any) {
                console.warn(`[PCSX2] Failed to copy ${entry.name}: ${entryError.message}`);
              }
            }
          } catch (dirError: any) {
            console.warn(`[PCSX2] Failed to process directory ${src}: ${dirError.message}`);
          }
        };

        await copyDirRecursive(configSource, sessionDataRoot);
        console.log(`[PCSX2] Full config sync completed`);
      } else {
        console.log(`[PCSX2] No emulator config folder found at: ${configFolder}`);
      }

      // 4. Create save directories for this ROM
      const memcardsDir = path.join(sessionDataRoot, "memcards");
      const savesDir = path.join(sessionDataRoot, "saves");
      await fs.mkdir(memcardsDir, { recursive: true });
      await fs.mkdir(savesDir, { recursive: true });
      console.log(`[PCSX2] Created save directories: ${memcardsDir}, ${savesDir}`);

      // Linux reads this from $XDG_CONFIG_HOME/PCSX2/inis. Portable builds
      // on other platforms continue to read it beside the executable.
      const emulatorExePath = this.getExecutablePath();
      const iniDataRoot = process.platform === "linux" ? sessionDataRoot : emulatorExePath ? path.dirname(emulatorExePath) : null;
      if (iniDataRoot) await this.setupIniFile(iniDataRoot, memcardsDir);
      else console.warn("[PCSX2] Emulator executable path not configured, skipping INI setup");

      return { success: true, gameSaveDir: saveDir };
    } catch (error: any) {
      console.error(`Failed to setup PCSX2 environment: ${error.message}`);
      return {
        success: false,
        error: `PCSX2 setup failed: ${error.message}`,
      };
    }
  }

  /**
   * Set up PCSX2.ini in the selected data root.
   * Copies the template and optionally substitutes the MemoryCards path
   * @param emulatorConfigFolder - PCSX2 data root (XDG or portable install root)
   * @param memcardsDir - Optional: specific memcards directory path. If null, uses template defaults
   */
  private async setupIniFile(emulatorConfigFolder: string, memcardsDir: string | null): Promise<void> {
    try {
      const emulatorRoot = emulatorConfigFolder;
      const iniFolder = path.join(emulatorRoot, "inis"); // Note: plural "inis", not "ini"
      const pcsx2IniPath = path.join(iniFolder, "PCSX2.ini");

      // Path to our template
      const templatePath = path.join(__dirname, "../../renderer/assets/configs/pcsx2-rommclient.ini");

      console.log(`[PCSX2] Setting up runtime INI:`);
      console.log(`[PCSX2]   emulatorRoot: ${emulatorRoot}`);
      console.log(`[PCSX2]   iniFolder: ${iniFolder}`);
      console.log(`[PCSX2]   templatePath: ${templatePath}`);
      console.log(`[PCSX2]   pcsx2IniPath: ${pcsx2IniPath}`);
      console.log(`[PCSX2]   memcardsDir: ${memcardsDir}`);

      // Create ini folder if it doesn't exist
      await fs.mkdir(iniFolder, { recursive: true });

      // Verify template exists
      if (!fsSync.existsSync(templatePath)) {
        console.error(`[PCSX2] Template not found: ${templatePath}`);
        throw new Error(`Template file not found: ${templatePath}`);
      }

      // Load template and optionally substitute MemoryCards path
      if (memcardsDir) {
        // Normalize path to use forward slashes (PCSX2 expects this)
        const memcardsPath = memcardsDir.replace(/\\/g, "/");

        console.log(`[PCSX2] Substituting MemoryCards with: ${memcardsPath}`);

        // Check if INI file already exists
        if (fsSync.existsSync(pcsx2IniPath)) {
          // File exists - only update the MemoryCards line
          console.log(`[PCSX2] INI file exists, updating MemoryCards path only`);
          const content = await fs.readFile(pcsx2IniPath, "utf-8");
          const updatedContent = content.replace(/^MemoryCards = .+$/m, `MemoryCards = ${memcardsPath}`);
          await fs.writeFile(pcsx2IniPath, updatedContent);
        } else {
          // File doesn't exist - load template, substitute MemoryCards path, and save as PCSX2.ini
          console.log(`[PCSX2] INI file not found, creating from template`);
          await IniManager.readTemplateSubstituteAndSave(templatePath, pcsx2IniPath, [
            {
              pattern: /^MemoryCards = .+$/m,
              replacement: `MemoryCards = ${memcardsPath}`,
            },
          ]);
        }

        console.log(`[PCSX2] ✓ MemoryCards updated to: ${memcardsPath}`);
      } else {
        // No memcards dir specified - just copy template if file doesn't exist
        if (!fsSync.existsSync(pcsx2IniPath)) {
          console.log(`[PCSX2] INI file not found, copying template (config mode)`);
          const content = await fs.readFile(templatePath, "utf-8");
          await fs.writeFile(pcsx2IniPath, content);
          console.log(`[PCSX2] ✓ Template INI file copied: ${pcsx2IniPath}`);
        } else {
          console.log(`[PCSX2] INI file already exists, skipping copy`);
        }
      }

      // Verify the file was created and read it back
      if (fsSync.existsSync(pcsx2IniPath)) {
        const fileContent = await fs.readFile(pcsx2IniPath, "utf-8");
        const memcardsLine = fileContent.split("\n").find((line) => line.startsWith("MemoryCards"));
        console.log(`[PCSX2] ✓ Verified INI file exists. MemoryCards line: ${memcardsLine}`);
      } else {
        console.error(`[PCSX2] ✗ INI file was not created: ${pcsx2IniPath}`);
      }
    } catch (error: any) {
      console.error(`[PCSX2] Failed to setup runtime INI file: ${error.message}`);
      // Don't throw - the emulator might still work with existing config
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
   * Copies local saves from the save manager's directory to the session memcards/saves
   */
  public async handleSavePreparation(rom: Rom, saveDir: string, localSaveDir: string, saveManager: SaveManager): Promise<{ success: boolean; error?: string }> {
    try {
      const dataRoot = this.getDataRoot(saveDir);
      const memcardsDir = path.join(dataRoot, "memcards");
      const savesDir = path.join(dataRoot, "saves");

      // Check if there are local saves
      if (!fsSync.existsSync(localSaveDir)) {
        console.log(`[PCSX2] No local save directory found: ${localSaveDir}`);
        return { success: true };
      }

      console.log(`[PCSX2] Preparing local saves from: ${localSaveDir}`);

      // Copy entire memcards folder if it exists
      const localMemcardsDir = path.join(localSaveDir, "memcards");
      if (fsSync.existsSync(localMemcardsDir)) {
        console.log(`[PCSX2] Copying memcards folder: ${localMemcardsDir} -> ${memcardsDir}`);
        await fs.mkdir(memcardsDir, { recursive: true });
        await fs.cp(localMemcardsDir, memcardsDir, { recursive: true });
        console.log(`[PCSX2] Memcards folder copied successfully`);
      }

      // Copy entire saves folder if it exists
      const localSavesDir = path.join(localSaveDir, "saves");
      if (fsSync.existsSync(localSavesDir)) {
        console.log(`[PCSX2] Copying saves folder: ${localSavesDir} -> ${savesDir}`);
        await fs.mkdir(savesDir, { recursive: true });
        await fs.cp(localSavesDir, savesDir, { recursive: true });
        console.log(`[PCSX2] Saves folder copied successfully`);
      }

      console.log(`[PCSX2] Save preparation completed`);
      return { success: true };
    } catch (error: any) {
      console.error(`[PCSX2] Error preparing saves: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  public async handleSaveSync(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager): Promise<SaveSyncResult> {
    try {
      // Use both memcards and saves directories
      const dataRoot = this.getDataRoot(saveDir);
      const memcardsDir = path.join(dataRoot, "memcards");
      const savesDir = path.join(dataRoot, "saves");
      console.log(`Uploading saves from ${memcardsDir} and ${savesDir} to RomM...`);

      if (!rommAPI) {
        throw new Error("RomM API is not available");
      }

      // Check if there are any save files to upload
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

      const memcardsHasFiles = await checkDirHasFiles(memcardsDir);
      const savesHasFiles = await checkDirHasFiles(savesDir);

      if (!memcardsHasFiles && !savesHasFiles) {
        console.log(`[PCSX2] No save files found in either directory`);
        return {
          success: true,
          message: "No saves to upload",
        };
      }

      console.log(`[PCSX2] Found saves - Memcards: ${memcardsHasFiles}, Saves: ${savesHasFiles}`);

      // Create a temporary ZIP file
      const tempDir = os.tmpdir();
      const tempZipPath = path.join(tempDir, `pcsx2_save_${rom.id}_${Date.now()}.zip`);

      try {
        // Create ZIP archive
        const zip = new AdmZip();

        // Add the memcards directory to the ZIP if it has files
        if (memcardsHasFiles && fsSync.existsSync(memcardsDir)) {
          console.log(`[PCSX2] Adding memcards to ZIP...`);
          zip.addLocalFolder(memcardsDir, "memcards");
        }

        // Add the saves directory to the ZIP if it has files
        if (savesHasFiles && fsSync.existsSync(savesDir)) {
          console.log(`[PCSX2] Adding saves to ZIP...`);
          zip.addLocalFolder(savesDir, "saves");
        }

        // Write ZIP to temporary file
        console.log(`[PCSX2] Creating ZIP file: ${tempZipPath}`);
        zip.writeZip(tempZipPath);

        // Upload the ZIP file to RomM
        console.log(`[PCSX2] Uploading save ZIP to RomM for ROM ${rom.id}`);
        const uploadResult = await rommAPI.uploadSave(rom.id, tempZipPath, "pcsx2");

        if (uploadResult.success) {
          console.log(`[PCSX2] Save upload successful for ROM ${rom.id}`);

          // After successful upload, copy saves to persistent local storage
          try {
            const persistentSaveDir = saveManager.getLocalSaveDir(rom);
            console.log(`[PCSX2] Copying saves to persistent storage: ${persistentSaveDir}`);

            // Ensure persistent directory exists
            await fs.mkdir(persistentSaveDir, { recursive: true });

            // Copy entire memcards directory if it has files
            if (memcardsHasFiles && fsSync.existsSync(memcardsDir)) {
              const persistentMemcardsDir = path.join(persistentSaveDir, "memcards");
              console.log(`[PCSX2] Copying memcards folder: ${memcardsDir} -> ${persistentMemcardsDir}`);

              // Remove existing memcards folder if it exists
              if (fsSync.existsSync(persistentMemcardsDir)) {
                await fs.rm(persistentMemcardsDir, { recursive: true, force: true });
              }

              // Copy entire memcards folder
              await fs.cp(memcardsDir, persistentMemcardsDir, { recursive: true });
              console.log(`[PCSX2] Memcards folder copied successfully`);
            }

            // Copy entire saves directory if it has files
            if (savesHasFiles && fsSync.existsSync(savesDir)) {
              const persistentSavesDir = path.join(persistentSaveDir, "saves");
              console.log(`[PCSX2] Copying saves folder: ${savesDir} -> ${persistentSavesDir}`);

              // Remove existing saves folder if it exists
              if (fsSync.existsSync(persistentSavesDir)) {
                await fs.rm(persistentSavesDir, { recursive: true, force: true });
              }

              // Copy entire saves folder
              await fs.cp(savesDir, persistentSavesDir, { recursive: true });
              console.log(`[PCSX2] Saves folder copied successfully`);
            }

            console.log(`[PCSX2] Saves copied to persistent storage successfully`);
          } catch (copyError: any) {
            console.warn(`[PCSX2] Failed to copy saves to persistent storage: ${copyError.message}`);
            // Don't fail the entire operation if local copy fails
          }

          return {
            success: true,
            message: "Save uploaded successfully",
          };
        } else {
          console.error(`[PCSX2] Save upload failed: ${uploadResult.error}`);
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
            console.log(`[PCSX2] Cleaned up temporary ZIP file: ${tempZipPath}`);
          }
        } catch (cleanupError: any) {
          console.warn(`[PCSX2] Failed to clean up temporary ZIP file: ${cleanupError.message}`);
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

      // Check for local saves in persistent save directory
      const localSaveDir = saveManager.getLocalSaveDir(rom);
      let hasLocal = false;
      if (fsSync.existsSync(localSaveDir)) {
        const items = await fs.readdir(localSaveDir, { recursive: true });
        hasLocal = items.length > 0;
      }

      if (!rommAPI) {
        console.log(`[PCSX2] RomM is offline; using local save state only`);
        return {
          success: true,
          data: { hasLocal, hasCloud: false, localSave: hasLocal ? localSaveDir : null, cloudSaves: [], recommendation: hasLocal ? "local" : "none" },
        };
      }

      // Check for cloud saves
      console.log(`[PCSX2] Checking cloud saves for ROM ${rom.id} (${rom.name})`);
      const cloudResult = await rommAPI.downloadSave(rom.id);
      const hasCloud = cloudResult.success && cloudResult.data && Array.isArray(cloudResult.data) && cloudResult.data.length > 0;
      console.log(`[PCSX2] Cloud saves result for ROM ${rom.id}:`, {
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

  public async handleSaveChoice(romData: any, saveChoice: string, saveManager: SaveManager, rommAPI: RommApi | null, saveId?: number, onProgress?: ProgressCallback): Promise<SaveChoiceResult> {
    try {
      const { rom, finalRomPath, saveDir } = romData;

      // Use save directories
      const dataRoot = this.getDataRoot(saveDir);
      const memcardsDir = path.join(dataRoot, "memcards");
      const savesDir = path.join(dataRoot, "saves");

      console.log(`User chose save: ${saveChoice}${saveId ? ` (ID: ${saveId})` : ""}`);
      console.log(`Target save directories: ${memcardsDir}, ${savesDir}`);

      // Ensure the target directories exist
      await fs.mkdir(memcardsDir, { recursive: true });
      await fs.mkdir(savesDir, { recursive: true });

      // Handle save loading based on choice
      if (saveChoice === "cloud") {
        console.log(`[PCSX2] User chose cloud save${saveId ? ` #${saveId}` : ""} for ROM ${rom.id}`);
        if (!rommAPI) {
          console.error(`[PCSX2] RomM API is not available for cloud save download`);
          throw new Error("RomM API is not available");
        }

        if (!saveId) {
          console.error(`[PCSX2] No saveId provided for cloud save download`);
          throw new Error("No save ID provided for cloud save");
        }

        console.log(`[PCSX2] Downloading cloud save #${saveId}`);

        // Get the specific save data
        const saveListResult = await rommAPI.downloadSave(rom.id);
        if (!saveListResult.success || !saveListResult.data) {
          console.error(`[PCSX2] Failed to get save list for ROM ${rom.id}`);
          throw new Error("Failed to get save list from RomM");
        }

        const saveData = saveListResult.data.find((save: any) => save.id === saveId);
        if (!saveData) {
          console.error(`[PCSX2] Save #${saveId} not found in save list for ROM ${rom.id}`);
          throw new Error(`Save ${saveId} not found`);
        }

        console.log(`[PCSX2] Found save data:`, {
          id: saveData.id,
          fileName: saveData.file_name,
          downloadPath: saveData.download_path,
        });

        // Download the save file
        console.log(`[PCSX2] Downloading save file from: ${saveData.download_path}`);
        const downloadResult = await rommAPI.downloadSaveFile(saveData);
        if (!downloadResult.success || !downloadResult.data) {
          console.error(`[PCSX2] Failed to download save file #${saveId}`);
          throw new Error("Failed to download save file");
        }

        console.log(`[PCSX2] Downloaded ${downloadResult.data.length} bytes, extracting...`);

        // Extract the ZIP file
        const zip = new AdmZip(downloadResult.data);
        zip.extractAllTo(dataRoot, true);

        console.log(`[PCSX2] Save extracted successfully`);

        // Verify extraction
        const extractedFiles = await fs.readdir(dataRoot, { recursive: true });
        console.log(`[PCSX2] Extracted files:`, extractedFiles);
      } else if (saveChoice === "local") {
        console.log(`[PCSX2] Using existing local save for ROM ${rom.id}`);
        // Prepare local saves by copying them to the session directory
        const localSaveDir = saveManager.getLocalSaveDir(rom);
        const prepareResult = await this.handleSavePreparation(rom, saveDir, localSaveDir, saveManager);
        if (!prepareResult.success) {
          console.warn(`[PCSX2] Failed to prepare local saves: ${prepareResult.error}`);
        }
      } else if (saveChoice === "none") {
        console.log(`[PCSX2] Starting with no save (fresh start) for ROM ${rom.id}`);
        // Clear save directories
        for (const dir of [memcardsDir, savesDir]) {
          if (fsSync.existsSync(dir)) {
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
          }
        }
      }

      // Prepare emulator arguments
      const preparedArgs = this.prepareArgs(finalRomPath, saveDir);

      // Update the session INI with the current ROM's memcards directory.
      // This must happen right before launch to ensure correct paths
      // Get the actual emulator installation directory (where the exe is)
      const emulatorExePath = this.getExecutablePath();
      const iniDataRoot = process.platform === "linux" ? dataRoot : emulatorExePath ? path.dirname(emulatorExePath) : null;
      if (iniDataRoot) await this.setupIniFile(iniDataRoot, memcardsDir);
      else console.warn("[PCSX2] Emulator executable path not configured, skipping INI setup");

      // Launch emulator
      console.log(`Launching emulator: ${this.getExecutablePath()} ${preparedArgs.join(" ")}`);
      const emulatorProcess = this.spawnProcess(preparedArgs, {
        env: this.getProcessEnvironment(saveDir),
      });

      // Monitor process to upload saves when it closes
      let started = false;
      let saveUploaded = false; // Prevent duplicate uploads
      emulatorProcess.on("exit", async (code) => {
        if (!started) return;
        console.log(`Emulator closed with code ${code}`);
        onProgress?.({ step: "save-sync", percent: 60, message: "Game closed, syncing saves..." });
        if (!saveUploaded) {
          saveUploaded = true;
          try {
            // Upload saves back to RomM
            if (rommAPI) {
              onProgress?.({ step: "save-sync", percent: 75, message: "Uploading saves to RomM..." });
              const syncResult = await this.handleSaveSync(rom, saveDir, rommAPI, saveManager);
              if (!syncResult.success) {
                throw new Error(syncResult.error || "Save sync failed");
              }
            } else {
              onProgress?.({ step: "save-sync", percent: 75, message: "Storing saves locally..." });
              const extracted = await this.extractSavesFromSession(saveDir, saveManager.getLocalSaveDir(rom));
              console.log(`[PCSX2] Stored ${extracted.length} save files locally for ROM ${rom.id}`);
            }

            // Clean up session directory after save sync completes
            onProgress?.({ step: "cleanup", percent: 95, message: "Cleaning up session..." });
            console.log(`[PCSX2] Cleaning up session directory: ${saveDir}`);
            await this.deleteDirectoryRecursive(saveDir);
            console.log(`[PCSX2] Session directory cleaned up successfully`);

            onProgress?.({ step: "complete", percent: 100, message: rommAPI ? "Saves synced" : "Saves stored locally (offline)", complete: true });
          } catch (syncError: any) {
            console.warn(`[PCSX2] Failed to finish save sync: ${syncError.message}`);
            onProgress?.({ step: "error", percent: 100, message: syncError.message, complete: true, error: syncError.message });
          }
        }
      });

      await this.waitForProcessStart(emulatorProcess);
      started = true;
      onProgress?.({ step: "launch", percent: 100, message: "Game launched" });

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
   * Extract saves from PCSX2 session directory
   * PCSX2 stores saves in memcards/ and saves/
   * Preserves the directory structure
   */
  public async extractSavesFromSession(sessionPath: string, persistentSaveDir: string): Promise<string[]> {
    const extractedFiles: string[] = [];

    // PCSX2 saves are in memcards/ and saves/
    const dataRoot = this.getDataRoot(sessionPath);
    const memcardsPath = path.join(dataRoot, "memcards");
    const savesPath = path.join(dataRoot, "saves");

    const copySaveFilesPreservingStructure = async (src: string, dest: string, folder: string) => {
      if (!fsSync.existsSync(src)) {
        console.log(`[PCSX2] No ${folder} directory found in session: ${src}`);
        return;
      }

      const entries = await fs.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, folder, entry.name);

        if (entry.isDirectory()) {
          // Preserve directory structure - create dest folder and recurse
          await fs.mkdir(destPath, { recursive: true });
          await copySaveFilesPreservingStructure(srcPath, dest, `${folder}/${entry.name}`);
        } else {
          // Copy file directly
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(srcPath, destPath);
          extractedFiles.push(entry.name);
          console.log(`[PCSX2] Extracted save file: ${entry.name}`);
        }
      }
    };

    // Copy both memcards and saves
    await copySaveFilesPreservingStructure(memcardsPath, persistentSaveDir, "memcards");
    await copySaveFilesPreservingStructure(savesPath, persistentSaveDir, "saves");

    return extractedFiles;
  }
}
