import { Emulator, EmulatorConfig, EnvironmentSetupResult, SaveComparisonResult, SaveSyncResult, SaveChoiceResult } from "./Emulator";
import { Rom } from "../../types/RommApi";
import { RommApi } from "../../api/RommApi";
import { SaveManager } from "../SaveManager";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

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

      // 2. Setup ROM-specific memstick directory
      const romMemstickDir = path.join(saveDir, "memstick");
      await fs.mkdir(romMemstickDir, { recursive: true });

      // 3. Create installed.txt pointing to ROM memstick
      const installedTxtPath = path.join(ppssppDir, "installed.txt");
      const memstickPathForInstalled = romMemstickDir.replace(/\\/g, "/");
      await fs.writeFile(installedTxtPath, memstickPathForInstalled);
      console.log(`Created installed.txt pointing to: ${memstickPathForInstalled}`);

      // 4. Copy emulator's config folder to ROM memstick (for configs)
      if (fsSync.existsSync(configFolder)) {
        console.log(`Syncing emulator configs from: ${configFolder}`);

        // Copy all folders except SAVEDATA (which is per-ROM)
        const copyDir = async (src: string, dest: string): Promise<void> => {
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
                    console.log(`Skipping SAVEDATA - using ROM-specific directory`);
                    continue;
                  }
                  await copyDir(srcPath, destPath);
                } else {
                  // Copy file if it doesn't exist or is newer
                  let shouldCopy = !fsSync.existsSync(destPath);

                  if (!shouldCopy) {
                    const srcStat = await fs.stat(srcPath);
                    const destStat = await fs.stat(destPath);
                    shouldCopy = srcStat.mtime > destStat.mtime;
                  }

                  if (shouldCopy) {
                    await fs.copyFile(srcPath, destPath);
                    console.log(`Copied: ${entry.name}`);
                  }
                }
              } catch (entryError: any) {
                console.warn(`Failed to copy ${entry.name}: ${entryError.message}`);
              }
            }
          } catch (dirError: any) {
            console.warn(`Failed to process directory ${src}: ${dirError.message}`);
          }
        };

        await copyDir(configFolder, romMemstickDir);
        console.log(`Synced emulator configs to ROM memstick`);
      } else {
        console.log(`No emulator config folder found at: ${configFolder}`);
      }

      // 5. Create a simple SAVEDATA directory (no game code extraction)
      const pspSaveDir = path.join(romMemstickDir, "PSP", "SAVEDATA");
      await fs.mkdir(pspSaveDir, { recursive: true });
      console.log(`ROM save directory: ${pspSaveDir} (Simple extraction - no game code)`);

      return { success: true, pspSaveDir, gameSaveDir: pspSaveDir, gameCode: "GAME" };
    } catch (error: any) {
      console.error(`Failed to setup PPSSPP portable mode: ${error.message}`);
      return {
        success: false,
        error: `PPSSPP setup failed: ${error.message}`,
      };
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

      // For now, just log that we would upload saves
      // TODO: Implement proper save directory upload
      console.log(`Save upload not yet implemented for PPSSPP emulator`);

      return {
        success: true,
        message: "Save sync completed (placeholder)",
      };
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
      // Use simple SAVEDATA directory (no game code subfolder)
      const pspSaveDir = path.join(saveDir, "memstick", "PSP", "SAVEDATA");
      console.log(`Comparing local and cloud saves for ROM ${rom.id}...`);

      if (!rommAPI) {
        throw new Error("RomM API is not available");
      }

      // Check for local saves
      let hasLocal = false;
      if (fsSync.existsSync(pspSaveDir)) {
        const files = await fs.readdir(pspSaveDir, { recursive: true });
        hasLocal = files.some((file: string) => {
          const filePath = path.join(pspSaveDir, file);
          const stat = fsSync.statSync(filePath);
          return stat.isFile();
        });
      }

      // Check for cloud saves
      const cloudResult = await rommAPI.downloadSave(rom.id);
      const hasCloud = cloudResult.success && cloudResult.data && Array.isArray(cloudResult.data) && cloudResult.data.length > 0;

      return {
        success: true,
        data: {
          hasLocal,
          hasCloud,
          localSave: hasLocal ? pspSaveDir : null,
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

      // Use simple SAVEDATA directory (no game code subfolder)
      const targetSaveDir = path.join(saveDir, "memstick", "PSP", "SAVEDATA");

      console.log(`User chose save: ${saveChoice}${saveId ? ` (ID: ${saveId})` : ""}`);
      console.log(`Target save directory: ${targetSaveDir}`);

      // Ensure the target directory exists
      await fs.mkdir(targetSaveDir, { recursive: true });

      // Handle save loading based on choice
      if (saveChoice === "cloud") {
        console.log(`Loading cloud save${saveId ? ` #${saveId}` : ""}...`);
        if (!rommAPI) {
          throw new Error("RomM API is not available");
        }
        // For now, just log that we would download saves
        // TODO: Implement proper cloud save download
        console.log(`Cloud save download not yet implemented for PPSSPP emulator`);
      } else if (saveChoice === "local") {
        console.log(`Using existing local save`);
      } else if (saveChoice === "none") {
        console.log(`Starting with no save (fresh start)`);
        // Clear local save directory
        if (fsSync.existsSync(targetSaveDir)) {
          const files = await fs.readdir(targetSaveDir, { recursive: true });
          for (const file of files) {
            const filePath = path.join(targetSaveDir, file);
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
}
